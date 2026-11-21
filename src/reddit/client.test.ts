import { describe, expect, test } from 'vitest';
import { BLOCKED_PAGE, fakeClock, fakeFetch, rateHeaders } from '../../tests/support/fake';
import { createRedditClient, retryAfterSeconds } from './client';
import { classifyPage, RedditError } from './errors';

const URL_A = 'https://www.reddit.com/r/test/hot.json';

function setup(answers: Parameters<typeof fakeFetch>[0][], minIntervalMs = 1000) {
  const clock = fakeClock();
  const f = fakeFetch(...answers);
  const statuses: unknown[] = [];
  const client = createRedditClient({
    fetch: f.fetch,
    now: clock.now,
    sleep: clock.sleep,
    random: () => 0.5,
    minIntervalMs,
    onStatus: (s) => statuses.push(s),
  });
  return { clock, f, client, statuses };
}

describe('pacing', () => {
  test('minGapMs: at least that long after the previous send, whatever the pace', async () => {
    const { clock, client } = setup([() => ({ body: '<html></html>' })], 250);
    await client.html('https://www.reddit.com/r/test/');
    await client.html('https://www.reddit.com/search/?q=a', { minGapMs: 1600 });
    await client.html('https://www.reddit.com/r/test/');
    // The search waited 1.6 s; the request after it only the usual 250 ms.
    expect(clock.waits).toEqual([1600, 250]);
  });

  test('a referrer goes with the request', async () => {
    const seen: (string | undefined)[] = [];
    const { client } = setup([
      (_u, init) => {
        seen.push(init.referrer);
        return { body: '<html></html>' };
      },
    ]);
    await client.html('https://www.reddit.com/svc/shreddit/more-comments/x/t3_a', {
      method: 'POST',
      body: 'cursor=x',
      referrer: 'https://www.reddit.com/r/x/comments/a/title/',
    });
    await client.html('https://www.reddit.com/r/x/');
    expect(seen).toEqual(['https://www.reddit.com/r/x/comments/a/title/', undefined]);
  });

  test('counts the gap from the send, so a slow answer is not added to it', async () => {
    let remaining = 200;
    const clock = fakeClock();
    const f = fakeFetch(() => ({ body: {}, headers: rateHeaders(remaining--, 25, 500) }));
    const client = createRedditClient({
      // Each answer takes 800 ms.
      fetch: async (...args) => {
        await clock.sleep(800);
        return f.fetch(...args);
      },
      now: clock.now,
      sleep: clock.sleep,
      minIntervalMs: 1000,
    });
    for (let i = 0; i < 3; i++) await client.json(URL_A);
    // 800 ms answer + 200 ms left of the 1 s gap: one request a second, not one per 1.8 s.
    expect(clock.waits).toEqual([800, 200, 800, 200, 800]);
  });

  test('waits for the window to reset when only the reserve is left', async () => {
    const { clock, client, statuses } = setup([
      () => ({ body: {}, headers: rateHeaders(10, 215, 120) }),
    ]);
    await client.json(URL_A);
    await client.json(URL_A);
    expect(clock.waits).toEqual([121_000]);
    expect(statuses).toContainEqual(expect.objectContaining({ reason: 'budget' }));
  });

  test('without rate-limit headers, still keeps the minimum interval', async () => {
    const { clock, client } = setup([() => ({ body: {} })], 700);
    await client.json(URL_A);
    await client.json(URL_A);
    expect(clock.waits).toEqual([700]);
  });

  test('runs one request at a time even when called concurrently', async () => {
    let inFlight = 0;
    let max = 0;
    const clock = fakeClock();
    const client = createRedditClient({
      now: clock.now,
      sleep: clock.sleep,
      minIntervalMs: 0,
      fetch: async () => {
        inFlight++;
        max = Math.max(max, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        return new Response('{}', { headers: { 'content-type': 'application/json' } });
      },
    });
    await Promise.all([client.json(URL_A), client.json(URL_A), client.json(URL_A)]);
    expect(max).toBe(1);
  });
});

describe('backing off', () => {
  test('a 429 waits for Retry-After and tries again', async () => {
    let n = 0;
    const { clock, client, f } = setup([
      () =>
        n++ === 0
          ? { status: 429, body: 'Too Many Requests', headers: { 'retry-after': '42' } }
          : { body: { ok: true } },
    ]);
    await expect(client.json(URL_A)).resolves.toEqual({ ok: true });
    expect(f.calls).toHaveLength(2);
    expect(clock.waits).toContain(42_000);
    expect(client.status.throttles).toBe(1);
  });

  test('a 429 without Retry-After backs off exponentially, and gives up eventually', async () => {
    const { clock, client } = setup([() => ({ status: 429, body: '' })]);
    await expect(client.json(URL_A)).rejects.toMatchObject({ kind: 'throttled' });
    // 10, 20, 40, 80, 160, 320 s (random() is 0.5, so no jitter).
    expect(clock.waits).toEqual([10_000, 20_000, 40_000, 80_000, 160_000, 320_000]);
  });

  test('a 429 with only a reset waits until just after it', async () => {
    let n = 0;
    const { clock, client } = setup([
      () =>
        n++ === 0
          ? { status: 429, body: '', headers: { 'x-ratelimit-reset': '90' } }
          : { body: { ok: true } },
    ]);
    await client.json(URL_A);
    expect(clock.waits).toContain(91_000);
  });

  test('media: large files may take long, but files over the limit are refused', async () => {
    const { client } = setup([() => ({ body: 'x'.repeat(2000) })]);
    await expect(client.bytes('https://i.redd.it/a.png', 1000)).rejects.toMatchObject({
      kind: 'unexpected',
      detail: 'file too large',
    });
    expect((await client.bytes('https://i.redd.it/a.png', 5000)).data.byteLength).toBe(2000);
  });

  test('server errors are retried a few times', async () => {
    let n = 0;
    const { client } = setup([
      () => (n++ < 2 ? { status: 503, body: 'down' } : { body: { ok: 1 } }),
    ]);
    await expect(client.json(URL_A)).resolves.toEqual({ ok: 1 });
  });

  test('network failures are retried, then reported as transient', async () => {
    const clock = fakeClock();
    const client = createRedditClient({
      now: clock.now,
      sleep: clock.sleep,
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    await expect(client.json(URL_A)).rejects.toMatchObject({ kind: 'transient' });
  });
});

describe('pages that stop the export', () => {
  test("Reddit's network-security block stops at once, without retrying", async () => {
    const { client, f } = setup([
      () => ({
        status: 403,
        body: BLOCKED_PAGE,
      }),
    ]);
    await expect(client.json(URL_A)).rejects.toMatchObject({ kind: 'blocked' });
    expect(f.calls).toHaveLength(1);
  });

  test('a login redirect', async () => {
    const { client } = setup([
      () => ({ body: '<html></html>', url: 'https://old.reddit.com/login/?reason=lor2&dest=x' }),
    ]);
    await expect(client.html(URL_A)).rejects.toMatchObject({ kind: 'login' });
  });

  test('any other 403 page (a private community, an expired media link) is "forbidden", not a block', async () => {
    const { client } = setup([() => ({ status: 403, body: '<Error>AccessDenied</Error>' })]);
    await expect(client.bytes('https://v.redd.it/x/DASH_720.mp4')).rejects.toMatchObject({
      kind: 'forbidden',
    });
  });

  test('a JSON 403 with a reason is "forbidden", not "blocked"', async () => {
    const { client } = setup([() => ({ status: 403, body: { reason: 'private', error: 403 } })]);
    await expect(client.json(URL_A)).rejects.toMatchObject({
      kind: 'forbidden',
      detail: 'private',
    });
  });

  test('HTML where JSON was expected', async () => {
    const { client } = setup([() => ({ body: '<html>hello</html>' })]);
    await expect(client.json(URL_A)).rejects.toMatchObject({ kind: 'unexpected' });
  });

  test('aborting stops waiting', async () => {
    const controller = new AbortController();
    const clock = fakeClock();
    const client = createRedditClient({
      now: clock.now,
      sleep: clock.sleep,
      signal: controller.signal,
      fetch: fakeFetch(() => ({ body: {} })).fetch,
    });
    await client.json(URL_A);
    controller.abort();
    const err = await client.json(URL_A).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RedditError);
    expect((err as RedditError).kind).toBe('aborted');
  });
});

describe('classifyPage', () => {
  test.each([
    [{ status: 403, url: URL_A, text: 'blocked by network security' }, 'blocked'],
    [{ status: 200, url: URL_A, text: 'a comment quoting "blocked by network security"' }, null],
    [{ status: 200, url: URL_A, text: '<title>Reddit - Prove your humanity</title>' }, 'challenge'],
    [{ status: 200, url: `${URL_A}?js_challenge=1`, text: '' }, 'challenge'],
    [{ status: 200, url: 'https://www.reddit.com/login/', text: '' }, 'login'],
    // A post titled like the check page is still a post.
    [
      {
        status: 200,
        url: URL_A,
        text: '<title>Reddit - Prove your humanity</title><shreddit-post id="t3_x"></shreddit-post>',
      },
      null,
    ],
    [{ status: 200, url: URL_A, text: '<title>Prove your humanity : r/test</title>' }, null],
    [{ status: 200, url: 'https://www.reddit.com/r/login/', text: '' }, null],
  ])('%j → %s', (reply, kind) => {
    expect(classifyPage(reply)).toBe(kind);
  });
});

test('retryAfterSeconds reads seconds and HTTP dates', () => {
  const now = Date.UTC(2026, 0, 1, 0, 0, 0);
  expect(retryAfterSeconds(new Headers({ 'retry-after': '7' }), now)).toBe(7);
  expect(
    retryAfterSeconds(new Headers({ 'retry-after': 'Thu, 01 Jan 2026 00:00:30 GMT' }), now),
  ).toBe(30);
  expect(retryAfterSeconds(new Headers(), now)).toBeNull();
});

test('stopping while another export tab has the turn stops at once', async () => {
  const controller = new AbortController();
  const clock = fakeClock();
  const client = createRedditClient({
    now: clock.now,
    sleep: clock.sleep,
    signal: controller.signal,
    fetch: fakeFetch(() => ({ body: {} })).fetch,
    // A lock another tab holds: only an abort ends the wait.
    exclusive: (_job, signal) =>
      new Promise((_, reject) =>
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
      ),
  });
  const pending = client.json(URL_A);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
});

test("a wait for the budget is reported as one, also while holding another tab's lock", async () => {
  const clock = fakeClock();
  const reasons: (string | null)[] = [];
  const client = createRedditClient({
    fetch: fakeFetch(() => ({ body: {}, headers: rateHeaders(3, 222, 60) })).fetch,
    now: clock.now,
    sleep: clock.sleep,
    exclusive: (job) => job(),
    onStatus: (s) => reasons.push(s.reason),
  });
  await client.json(URL_A);
  expect(reasons).toContain('budget');
});
