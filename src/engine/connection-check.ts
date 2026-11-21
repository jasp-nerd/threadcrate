// "Check connection": which ways of reading Reddit work in this browser right
// now. Reddit changes what it allows (and differs between logged-in and
// logged-out browsers), so this tries each way once and reports what Reddit
// answered, for the person to see and to paste into a bug report. It reads
// nothing beyond these few test addresses and keeps nothing.

import { browser } from 'wxt/browser';
import { sendMessage } from '../messaging';
import { textPreview } from '../reddit/client';
import { REDDIT } from '../reddit/model';
import { createTabFetch, type TabFetch } from './tab-fetch';

export interface CheckResult {
  name: string;
  /** What this way of reading is used for. */
  why: string;
  url: string;
  via: 'tab' | 'direct' | 'page';
  status: number | null;
  ok: boolean;
  contentType: string | null;
  rateLimit: string | null;
  preview: string;
  ms: number;
}

interface Probe {
  name: string;
  why: string;
  url: string;
  via: 'tab' | 'direct' | 'page';
  headers?: Record<string, string>;
  /** What a good answer looks like. */
  expect: 'json' | 'posts';
}

function probes(sub: string): Probe[] {
  const r = encodeURIComponent(sub);
  return [
    {
      name: 'Who am I (API)',
      why: 'decides the logged-in route',
      url: `${REDDIT}/api/me.json?raw_json=1`,
      via: 'tab',
      headers: { Accept: 'application/json' },
      expect: 'json',
    },
    {
      name: 'Listing (API), as the export asks',
      why: 'logged-in listings',
      url: `${REDDIT}/r/${r}/hot.json?limit=100&raw_json=1`,
      via: 'tab',
      headers: { Accept: 'application/json' },
      expect: 'json',
    },
    {
      name: 'Listing (API), no extra headers',
      why: 'is the Accept header the problem?',
      url: `${REDDIT}/r/${r}/hot.json?limit=100&raw_json=1`,
      via: 'tab',
      expect: 'json',
    },
    {
      name: 'Listing (API), no parameters',
      why: 'are the parameters the problem?',
      url: `${REDDIT}/r/${r}/hot.json`,
      via: 'tab',
      expect: 'json',
    },
    {
      name: 'Listing (API), trailing slash',
      why: 'the address form Reddit links to',
      url: `${REDDIT}/r/${r}/hot/.json`,
      via: 'tab',
      expect: 'json',
    },
    {
      name: 'Subreddit info (API)',
      why: 'any API at all?',
      url: `${REDDIT}/r/${r}/about.json`,
      via: 'tab',
      expect: 'json',
    },
    {
      name: 'Listing (API), from the extension',
      why: 'is the Reddit tab needed?',
      url: `${REDDIT}/r/${r}/hot.json?limit=100&raw_json=1`,
      via: 'direct',
      headers: { Accept: 'application/json' },
      expect: 'json',
    },
    {
      name: 'Listing (API), old.reddit',
      why: 'another way in',
      url: `https://old.reddit.com/r/${r}/hot.json?limit=100&raw_json=1`,
      via: 'direct',
      expect: 'json',
    },
    {
      name: 'Listing (API), opened as a page',
      why: 'like typing it in the address bar',
      url: `${REDDIT}/r/${r}/hot.json?limit=100&raw_json=1`,
      via: 'page',
      expect: 'json',
    },
    {
      name: 'Listing (web pages)',
      why: 'the logged-out route',
      url: `${REDDIT}/svc/shreddit/community-more-posts/hot/?name=${r}&t=DAY`,
      via: 'tab',
      expect: 'posts',
    },
  ];
}

function looksRight(text: string, expect: Probe['expect']): boolean {
  if (expect === 'posts') return /<shreddit-post[\s>]/.test(text);
  const s = text.trimStart();
  return s.startsWith('{') || s.startsWith('[');
}

/** Opens the address as a page in a background tab and reads it (what typing it in does). */
async function asPage(url: string): Promise<{ status: number | null; text: string }> {
  const tab = await browser.tabs.create({ url, active: false });
  if (tab.id === undefined) return { status: null, text: 'no tab' };
  try {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const page = await sendMessage('pageText', undefined, tab.id);
        if (page.text) return { status: null, text: page.text };
      } catch {
        // The page (or our script in it) isn't there yet.
      }
    }
    return { status: null, text: 'the page never loaded' };
  } finally {
    await browser.tabs.remove(tab.id).catch(() => undefined);
  }
}

async function runOne(p: Probe, relay: TabFetch): Promise<{ result: CheckResult; text: string }> {
  const started = Date.now();
  try {
    if (p.via === 'page') {
      const page = await asPage(p.url);
      return {
        text: page.text,
        result: {
          ...p,
          status: page.status,
          ok: looksRight(page.text, p.expect),
          contentType: null,
          rateLimit: null,
          preview: textPreview(page.text, 200),
          ms: Date.now() - started,
        },
      };
    }
    const doFetch = p.via === 'tab' ? relay.fetch : fetch;
    const res = await doFetch(p.url, { credentials: 'include', headers: p.headers });
    const text = await res.text();
    const via = res.headers.get('x-threadcrate-via');
    return {
      text,
      result: {
        ...p,
        via: p.via === 'tab' && !via ? 'direct' : p.via,
        status: res.status,
        ok: res.ok && looksRight(text, p.expect),
        contentType: res.headers.get('content-type'),
        rateLimit: res.headers.get('x-ratelimit-remaining')
          ? `${res.headers.get('x-ratelimit-remaining')} left, resets in ${res.headers.get('x-ratelimit-reset')} s`
          : null,
        preview: textPreview(text, 200),
        ms: Date.now() - started,
      },
    };
  } catch (error) {
    return {
      text: '',
      result: {
        ...p,
        status: null,
        ok: false,
        contentType: null,
        rateLimit: null,
        preview: `failed: ${error instanceof Error ? error.message : String(error)}`,
        ms: Date.now() - started,
      },
    };
  }
}

/** A "load more comments" stub from a thread's JSON, for testing /api/morechildren. */
function moreStub(text: string): string[] | null {
  try {
    const data = JSON.parse(text) as {
      data?: { children?: { kind: string; data: { children?: string[] } }[] };
    }[];
    const stack = [...(data[1]?.data?.children ?? [])];
    while (stack.length) {
      const thing = stack.pop()!;
      if (thing.kind === 'more' && thing.data.children?.length)
        return thing.data.children.slice(0, 20);
      const replies = (thing.data as { replies?: { data?: { children?: typeof stack } } }).replies;
      if (replies && typeof replies === 'object') stack.push(...(replies.data?.children ?? []));
    }
  } catch {
    // Not the JSON we hoped for.
  }
  return null;
}

export async function runChecks(
  sub: string,
  onResult: (r: CheckResult) => void,
): Promise<CheckResult[]> {
  const relay = createTabFetch({});
  const results: CheckResult[] = [];
  const pause = () => new Promise((resolve) => setTimeout(resolve, 1_000));
  const record = (r: CheckResult) => {
    results.push(r);
    onResult(r);
  };
  let postId: string | null = null;
  let author: string | null = null;
  try {
    for (const p of probes(sub)) {
      const { result, text } = await runOne(p, relay);
      if (p.expect === 'posts' && result.ok) {
        // The busiest post on the page, so its comments have "load more" stubs to try.
        let best = -1;
        for (const m of text.matchAll(/<shreddit-post\s[^>]*>/gi)) {
          const tag = m[0];
          const id = /\bid="t3_([a-z0-9]+)"/i.exec(tag)?.[1];
          const count = Number(/\bcomment-count="(\d+)"/i.exec(tag)?.[1] ?? 0);
          const who = /\bauthor="([A-Za-z0-9_-]{3,20})"/.exec(tag)?.[1];
          if (id && count > best) {
            best = count;
            postId = id;
            if (who && who !== '[deleted]') author = who;
          }
        }
      }
      record(result);
      await pause();
    }
    // Comments are where an export spends its time: does the API still give them?
    if (postId) {
      const thread = await runOne(
        {
          name: 'Comments (API)',
          why: 'up to 100 comments a request instead of about 10',
          url: `${REDDIT}/comments/${postId}.json?limit=500&raw_json=1`,
          via: 'tab',
          headers: { Accept: 'application/json' },
          expect: 'json',
        },
        relay,
      );
      record(thread.result);
      const children = thread.result.ok ? moreStub(thread.text) : null;
      if (children) {
        await pause();
        const more = await runOne(
          {
            name: 'More comments (API)',
            why: '"load more comments", 100 at a time',
            url: `${REDDIT}/api/morechildren.json?api_type=json&link_id=t3_${postId}&children=${children.join(',')}&raw_json=1`,
            via: 'tab',
            headers: { Accept: 'application/json' },
            expect: 'json',
          },
          relay,
        );
        record(more.result);
        // Ways around "load more comments" should Reddit refuse it.
        await pause();
        const byId = await runOne(
          {
            name: 'Comments by id (API)',
            why: 'another way to load hidden comments, 100 at a time',
            url: `${REDDIT}/api/info.json?id=${children.map((c) => `t1_${c}`).join(',')}&raw_json=1`,
            via: 'tab',
            headers: { Accept: 'application/json' },
            expect: 'json',
          },
          relay,
        );
        record(byId.result);
        await pause();
        const focus = await runOne(
          {
            name: 'One comment and its replies (API)',
            why: 'the slow way to load hidden comments, one at a time',
            url: `${REDDIT}/comments/${postId}/_/${children[0]}.json?limit=500&raw_json=1`,
            via: 'tab',
            headers: { Accept: 'application/json' },
            expect: 'json',
          },
          relay,
        );
        record(focus.result);
      }
    }
    // Profiles can only be exported through the API.
    if (author) {
      await pause();
      const user = await runOne(
        {
          name: 'User posts (API)',
          why: 'exporting a profile',
          url: `${REDDIT}/user/${author}/submitted.json?limit=100&raw_json=1`,
          via: 'tab',
          headers: { Accept: 'application/json' },
          expect: 'json',
        },
        relay,
      );
      record(user.result);
    }
  } finally {
    await relay.close();
  }
  return results;
}
