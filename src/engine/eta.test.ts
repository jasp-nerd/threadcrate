// The time-left estimate against simulated exports: a fake Reddit with a real
// budget (225 requests per 10 minutes, headers, 429s) and a fake clock, so an
// hour-long export runs in milliseconds. For each scenario we record what the
// estimate said along the way and compare it with when the export really ended.
import { describe, expect, test } from 'vitest';
import { budgetedFetch } from '../../tests/support/budget';
import { BLOCKED_PAGE, fakeClock } from '../../tests/support/fake';
import { commentEl, moreButton, page, postEl } from '../../tests/support/shreddit';
import { createRedditClient } from '../reddit/client';
import { DEFAULT_OPTIONS, type ExportOptions } from './options';
import { SteadyEta, timeForRequests } from './eta';
import { runExport, type Progress } from './run';

describe('timeForRequests matches the client it models', () => {
  test.each([
    ['fits in the budget', 100, 600],
    ['one window and a bit', 300, 600],
    ['several windows', 900, 600],
    ['slow answers (3 s)', 300, 3_000],
  ])('%s', async (_name, n, latencyMs) => {
    const clock = fakeClock();
    const { fetch } = budgetedFetch(clock, () => ({ body: '{}', type: 'application/json' }), {
      latencyMs,
    });
    let left = n;
    const client = createRedditClient({
      fetch,
      now: clock.now,
      sleep: clock.sleep,
      workLeft: () => left,
    });
    // First request, to learn the budget, as an export does.
    await client.json('https://www.reddit.com/a.json');
    left--;
    const s = client.status;
    const predicted = timeForRequests(left, { ...s, now: clock.now() });
    const start = clock.now();
    while (left > 0) {
      await client.json('https://www.reddit.com/a.json');
      left--;
    }
    const actual = clock.now() - start;
    expect(Math.abs(predicted - actual) / actual).toBeLessThan(0.1);
  });
});

// A subreddit of `n` posts with given comment counts; each thread's comments
// arrive ten per "more comments" request, as on reddit.com logged out.
function fakeSubreddit(counts: number[]) {
  const ids = counts.map((_, i) => `p${i}`);
  return (url: URL, init: RequestInit) => {
    if (url.pathname.endsWith('.json')) return { status: 403, body: BLOCKED_PAGE };
    if (url.pathname === '/svc/shreddit/community-more-posts/hot/') {
      const after = Number(url.searchParams.get('after') ?? 0);
      const slice = ids.slice(after, after + 25);
      const next =
        after + 25 < ids.length
          ? `<faceplate-partial slot="load-after" src="/svc/shreddit/community-more-posts/hot/?name=s&amp;t=DAY&amp;after=${after + 25}"></faceplate-partial>`
          : '';
      return {
        body: page(
          slice
            .map((id, i) => postEl({ id, sub: 's', title: id, comments: counts[after + i] }))
            .join('') + next,
        ),
      };
    }
    // At its full address, as the listing gives it, or at /comments/<id>/.
    const thread = /^(?:\/r\/\w+)?\/comments\/(p\d+)\/(?:[^/]+\/)?$/.exec(url.pathname)?.[1];
    if (thread) {
      const total = counts[Number(thread.slice(1))]!;
      const first = Math.min(total, 25);
      const comments = Array.from({ length: first }, (_, i) =>
        commentEl(thread, { id: `${thread}c${i}`, body: 'x' }),
      ).join('');
      const more =
        total > first
          ? moreButton(`/svc/shreddit/more-comments/s/t3_${thread}`, `${thread}:${first}`)
          : '';
      return {
        body: page(
          postEl({ id: thread, sub: 's', title: thread, comments: total }),
          comments + more,
        ),
      };
    }
    if (init.method === 'POST' && url.pathname.startsWith('/svc/shreddit/more-comments/')) {
      const [thread, from] = new URLSearchParams(init.body as string).get('cursor')!.split(':') as [
        string,
        string,
      ];
      const total = counts[Number(thread.slice(1))]!;
      const start = Number(from);
      const end = Math.min(total, start + 10);
      const comments = Array.from({ length: end - start }, (_, i) =>
        commentEl(thread, { id: `${thread}c${start + i}`, body: 'x' }),
      ).join('');
      const more =
        end < total
          ? moreButton(`/svc/shreddit/more-comments/s/t3_${thread}`, `${thread}:${end}`)
          : '';
      return { body: page('', comments + more) };
    }
    return { status: 404, body: 'not here' };
  };
}

async function simulate(counts: number[], options: Partial<ExportOptions>) {
  const clock = fakeClock();
  const { fetch, budget } = budgetedFetch(clock, fakeSubreddit(counts));
  const samples: { at: number; eta: number | null; progress: Progress }[] = [];
  const start = clock.now();
  const result = await runExport(
    {
      ...DEFAULT_OPTIONS,
      target: { kind: 'subreddit', name: 's', sort: 'hot', time: 'day' },
      maxPosts: counts.length,
      includeComments: true,
      ...options,
    },
    {
      fetch,
      now: clock.now,
      sleep: clock.sleep,
      onProgress: (p) => samples.push({ at: clock.now(), eta: p.etaSeconds, progress: p }),
    },
  );
  const end = clock.now();
  return { result, samples, start, end, budget };
}

/** Worst relative error of "now + time left" against the real end, once a share of the time has passed. */
function worstError(
  run: Awaited<ReturnType<typeof simulate>>,
  after: number,
): { error: number; at: string } {
  const total = run.end - run.start;
  let worst = { error: 0, at: '' };
  for (const s of run.samples) {
    if (s.eta === null || s.at - run.start < total * after) continue;
    const predictedEnd = s.at + s.eta * 1000;
    const error = Math.abs(predictedEnd - run.end) / total;
    if (error > worst.error) {
      const p = s.progress;
      worst = {
        error,
        at: `${Math.round((s.at - run.start) / 1000)}s of ${Math.round(total / 1000)}s: phase ${p.phase}, thread ${p.threadsDone}/${p.threadsTotal}, current ${p.current?.loaded}/${p.current?.expected}, eta ${Math.round(s.eta)}s, requests left ${p.requestsLeft}, budget ${p.rate.remaining}, waiting ${p.rate.waitingUntil ? Math.round((p.rate.waitingUntil - s.at) / 1000) : 0}s`,
      };
    }
  }
  return worst;
}

// Each simulation takes seconds of real time: more than Vitest's default under load.
describe('time left, against simulated exports', { timeout: 30_000 }, () => {
  const scenarios: [string, number[]][] = [
    ['25 small posts (fits in one window)', Array(25).fill(5)],
    [
      '100 posts, mixed threads',
      Array.from({ length: 100 }, (_, i) => [3, 40, 12, 150, 0][i % 5]!),
    ],
    [
      '60 posts with a few huge threads',
      Array.from({ length: 60 }, (_, i) => (i % 15 === 0 ? 900 : 20)),
    ],
  ];

  test.each(scenarios)('%s', async (_name, counts) => {
    const run = await simulate(counts, {});
    expect(run.result.status).toBe('complete');
    // Never overspends Reddit's budget.
    expect(run.budget.overspent).toBe(0);
    // Once a fifth of the time has passed, the predicted end is within 25% of the
    // real one; past halfway, within 15%.
    const early = worstError(run, 0.2);
    const late = worstError(run, 0.5);
    expect(early.error, early.at).toBeLessThan(0.25);
    expect(late.error, late.at).toBeLessThan(0.15);
  });

  // Fast helps exports that fit in about one window of Reddit's budget; past that,
  // the budget is the limit either way and it gains only its smaller reserve.
  test('fast mode finishes an export that fits the budget much sooner', async () => {
    const counts = Array.from({ length: 100 }, (_, i) => i % 6);
    const normal = await simulate(counts, {});
    const fast = await simulate(counts, { speed: 'fast' });
    expect(fast.end - fast.start).toBeLessThan((normal.end - normal.start) * 0.7);
    expect(fast.budget.overspent).toBe(0);
  });
});

describe('SteadyEta', () => {
  test('counts down on its own and ignores small changes', () => {
    const s = new SteadyEta();
    expect(s.update(600, 0)).toBe(600);
    expect(s.update(598, 10_000)).toBe(590);
  });
  test('falls quickly, rises slowly', () => {
    const s = new SteadyEta();
    s.update(600, 0);
    expect(s.update(400, 0)).toBe(540);
    expect(s.update(900, 0)).toBe(576);
    expect(s.update(100, 0)).toBe(100);
  });
});
