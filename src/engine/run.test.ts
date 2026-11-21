import { describe, expect, test } from 'vitest';
import { BLOCKED_PAGE, fakeClock, fakeFetch, type Route } from '../../tests/support/fake';
import { commentEl, page, postEl } from '../../tests/support/shreddit';
import { DEFAULT_OPTIONS, type ExportOptions } from './options';
import { requestKind } from './diagnostics';
import { runExport } from './run';

const SUB = { kind: 'subreddit', name: 'testsub', sort: 'hot', time: 'day' } as const;

const BLOCKED: Route = (u) =>
  u.pathname.endsWith('.json') ? { status: 403, body: BLOCKED_PAGE } : undefined;

function postPage(id: string) {
  return page(
    postEl({ id, sub: 'testsub', title: `Post ${id}`, comments: 1 }),
    commentEl(id, { id: `c${id}`, body: 'hi' }),
  );
}

const threadRoute =
  (fail?: string): Route =>
  (u) => {
    // Reddit serves a post at its full address, and /comments/<id>/ (a redirect there).
    const m = /^(?:\/r\/\w+)?\/comments\/(\w+)\/(?:[^/]+\/)?$/.exec(u.pathname);
    if (!m) return undefined;
    if (m[1] === fail) return { status: 403, body: BLOCKED_PAGE };
    return { body: postPage(m[1]!) };
  };

const feedRoute: Route = (u) =>
  u.pathname === '/svc/shreddit/community-more-posts/hot/'
    ? {
        body: page(
          ['f1', 'f2', 'f3']
            // Each listed with the one comment its thread holds.
            .map((id) => postEl({ id, sub: 'testsub', title: `Post ${id}`, comments: 1 }))
            .join(''),
        ),
      }
    : undefined;

function run(options: Partial<ExportOptions>, routes: Route[], signal?: AbortSignal) {
  const clock = fakeClock();
  const f = fakeFetch(...routes);
  return runExport(
    { ...DEFAULT_OPTIONS, target: { kind: 'post', id: 'p1', subreddit: 'testsub' }, ...options },
    { fetch: f.fetch, now: clock.now, sleep: clock.sleep, signal, minIntervalMs: 0 },
  ).then((result) => ({ result, calls: f.calls }));
}

test('logged out: Reddit blocks the JSON API, so the web pages are used', async () => {
  const { result } = await run({}, [BLOCKED, threadRoute()]);
  expect(result.backend).toBe('html');
  expect(result.status).toBe('complete');
  expect(result.threads[0]!.comment_count).toBe(1);
});

test('logged in: the JSON API is used', async () => {
  const { result, calls } = await run({}, [
    (u) => (u.pathname === '/api/me.json' ? { body: { name: 'someone' } } : undefined),
    (u) =>
      u.pathname === '/comments/p1.json'
        ? {
            body: [
              {
                kind: 'Listing',
                data: {
                  children: [
                    {
                      kind: 't3',
                      data: {
                        id: 'p1',
                        name: 't3_p1',
                        subreddit: 's',
                        title: 'T',
                        permalink: '/r/s/comments/p1/t/',
                      },
                    },
                  ],
                },
              },
              { kind: 'Listing', data: { children: [] } },
            ],
          }
        : undefined,
  ]);
  expect(result.backend).toBe('json');
  expect(result.status).toBe('complete');
  expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/api/me.json', '/comments/p1.json']);
});

test('a block halfway through a listing keeps what was collected', async () => {
  const { result } = await run(
    {
      target: SUB,
      includeComments: true,
    },
    [BLOCKED, feedRoute, threadRoute('f2')],
  );
  expect(result.status).toBe('failed');
  expect(result.errorKind).toBe('blocked');
  expect(result.threads.map((t) => t.post.id)).toEqual(['f1']);
  // The posts whose comments weren't loaded are still in the export, from the listing.
  expect(result.posts.map((p) => p.id)).toEqual(['f2', 'f3']);
});

test('stopping keeps what was collected', async () => {
  const controller = new AbortController();
  let pages = 0;
  const { result } = await run(
    {
      target: SUB,
      includeComments: true,
    },
    [
      BLOCKED,
      feedRoute,
      (u) => {
        if (!u.pathname.includes('/comments/')) return undefined;
        if (++pages === 2) controller.abort();
        return threadRoute()(u, {});
      },
    ],
    controller.signal,
  );
  expect(result.status).toBe('stopped');
  expect(result.threads.length + result.posts.length).toBe(3);
});

test('a post that fails on its own is listed, and the others still load', async () => {
  const { result } = await run(
    {
      target: SUB,
      includeComments: true,
    },
    [
      BLOCKED,
      feedRoute,
      // Gone, at every address.
      (u) => (u.pathname.includes('/comments/f2/') ? { status: 404, body: 'gone' } : undefined),
      threadRoute(),
    ],
  );
  expect(result.status).toBe('complete');
  expect(result.threads.map((t) => t.post.id)).toEqual(['f1', 'f3']);
  expect(result.postFailures).toEqual([expect.objectContaining({ post_id: 'f2' })]);
  expect(result.posts.map((p) => p.id)).toEqual(['f2']);
});

test('stopping while posts are being listed keeps the posts listed so far', async () => {
  const controller = new AbortController();
  const { result } = await run(
    {
      target: { kind: 'subreddit', name: 'testsub', sort: 'new', time: 'day' },
      includeComments: true,
    },
    [
      BLOCKED,
      (u) => {
        if (u.pathname !== '/svc/shreddit/community-more-posts/new/') return undefined;
        if (u.searchParams.get('after')) {
          controller.abort();
          return { status: 500, body: 'slow' };
        }
        return {
          body: page(['f1', 'f2'].map((id) => postEl({ id, sub: 'testsub', title: id })).join('')),
        };
      },
    ],
    controller.signal,
  );
  expect(result.status).toBe('stopped');
  expect(result.posts.map((p) => p.id)).toEqual(['f1', 'f2']);
});

test('stopping in the middle of a thread keeps the comments loaded so far', async () => {
  const controller = new AbortController();
  const { result } = await run(
    {},
    [
      BLOCKED,
      (u) =>
        u.pathname === '/comments/p1/'
          ? {
              body: page(
                postEl({ id: 'p1', sub: 'testsub', title: 'Q', comments: 9 }),
                commentEl('p1', { id: 'a', body: 'one' }) +
                  `<faceplate-partial src="/svc/shreddit/more-comments/testsub/t3_p1?top-level=1"><input name="cursor" value="C"></faceplate-partial>`,
              ),
            }
          : undefined,
      (u) => {
        if (!u.pathname.startsWith('/svc/shreddit/more-comments/')) return undefined;
        controller.abort();
        return { status: 503, body: 'busy' };
      },
    ],
    controller.signal,
  );
  expect(result.status).toBe('stopped');
  expect(result.threads).toHaveLength(1);
  expect(result.threads[0]!.comment_count).toBe(1);
  expect(result.threads[0]!.gaps.at(-1)?.reason).toMatch(/stopped/);
});

test('post after post refused: the export stops asking, keeping what it has', async () => {
  const ids = Array.from({ length: 12 }, (_, i) => `g${i}`);
  const { result, calls } = await run(
    {
      target: SUB,
      includeComments: true,
    },
    [
      BLOCKED,
      (u) =>
        u.pathname === '/svc/shreddit/community-more-posts/hot/'
          ? {
              body: page(
                ids.map((id) => postEl({ id, sub: 'testsub', title: id, comments: 2 })).join(''),
              ),
            }
          : undefined,
      (u) => (u.pathname.includes('/comments/') ? { status: 403, body: 'Forbidden' } : undefined),
    ],
  );
  expect(result.status).toBe('failed');
  expect(result.error).toMatch(/8 posts in a row/);
  expect(result.posts).toHaveLength(12);
  expect(calls.filter((c) => c.url.includes('/comments/'))).toHaveLength(8);
});

test('logged in, but Reddit refuses its JSON API: the web pages take over', async () => {
  const { result, calls } = await run({}, [
    (u) => (u.pathname === '/api/me.json' ? { body: { name: 'someone' } } : undefined),
    (u) => (u.pathname === '/comments/p1.json' ? { status: 403, body: BLOCKED_PAGE } : undefined),
    threadRoute(),
  ]);
  expect(result.status).toBe('complete');
  expect(result.backend).toBe('html');
  expect(result.threads[0]!.comment_count).toBe(1);
  expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
    '/api/me.json',
    '/comments/p1.json',
    '/comments/p1/',
  ]);
});

test('hybrid: listings refused on the API come from the web pages; both budgets load comments', async () => {
  const thread = (id: string) => [
    {
      kind: 'Listing',
      data: {
        children: [
          {
            kind: 't3',
            data: {
              id,
              name: `t3_${id}`,
              subreddit: 'testsub',
              title: id,
              permalink: `/r/testsub/comments/${id}/x/`,
              num_comments: 1,
            },
          },
        ],
      },
    },
    {
      kind: 'Listing',
      data: {
        children: [
          {
            kind: 't1',
            data: {
              id: `c${id}`,
              name: `t1_c${id}`,
              link_id: `t3_${id}`,
              parent_id: `t3_${id}`,
              author: 'a',
              body: 'hi',
              subreddit: 'testsub',
              permalink: `/r/testsub/comments/${id}/x/c${id}/`,
              replies: '',
            },
          },
        ],
      },
    },
  ];
  const { result, calls } = await run(
    {
      target: SUB,
      includeComments: true,
    },
    [
      (u) => (u.pathname === '/api/me.json' ? { body: { name: 'someone' } } : undefined),
      (u) => {
        const m = /^\/comments\/(\w+)\.json$/.exec(u.pathname);
        return m ? { body: thread(m[1]!) } : undefined;
      },
      BLOCKED,
      feedRoute,
      threadRoute(),
    ],
  );
  expect(result.status).toBe('complete');
  expect(result.backend).toBe('json');
  // In listing order, whichever way each came.
  expect(result.threads.map((t) => t.post.id)).toEqual(['f1', 'f2', 'f3']);
  expect(result.threads.map((t) => t.comment_count)).toEqual([1, 1, 1]);
  // The API (its own budget) started on comments while the web pages listed posts.
  const apiThreads = calls.filter((c) => /^\/comments\/\w+\.json$/.test(new URL(c.url).pathname));
  expect(apiThreads.length).toBeGreaterThan(0);
  // Each post loaded once, by one or the other.
  const pages = calls.filter((c) =>
    /^\/r\/\w+\/comments\/\w+\/[^/]+\/$/.test(new URL(c.url).pathname),
  );
  expect(apiThreads.length + pages.length).toBe(3);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      kind: 'note',
      text: expect.stringContaining('refused its API for listings'),
    }),
  );
});

test('posts the listing says have no comments need no request', async () => {
  const { result, calls } = await run(
    {
      target: SUB,
      includeComments: true,
    },
    [
      BLOCKED,
      (u) =>
        u.pathname === '/svc/shreddit/community-more-posts/hot/'
          ? {
              body: page(
                postEl({ id: 'z1', sub: 'testsub', title: 'quiet', comments: 0 }) +
                  postEl({ id: 'z2', sub: 'testsub', title: 'busy', comments: 1 }),
              ),
            }
          : undefined,
      threadRoute(),
    ],
  );
  expect(result.status).toBe('complete');
  expect(result.threads.map((t) => [t.post.id, t.comment_count])).toEqual([
    ['z1', 0],
    ['z2', 1],
  ]);
  expect(
    calls.filter((c) => c.url.includes('/comments/')).map((c) => new URL(c.url).pathname),
  ).toEqual(['/r/testsub/comments/z2/busy/']);
});

describe('going past the 1000-post limit', () => {
  // A subreddit whose lists overlap: "new" has posts 0–999, "top" of all time 500–1499, the rest 1000–1999.
  const big: Route = (u) => {
    const m = /^\/svc\/shreddit\/community-more-posts\/(\w+)\/$/.exec(u.pathname);
    if (!m) return undefined;
    const start =
      m[1] === 'new' ? 0 : m[1] === 'top' && u.searchParams.get('t') === 'ALL' ? 500 : 1000;
    const after = Number(u.searchParams.get('after') ?? 0);
    const ids = Array.from({ length: 25 }, (_, i) => `q${start + after + i}`);
    const next =
      after + 25 < 1000
        ? `<faceplate-partial slot="load-after" src="${u.pathname}?name=testsub&amp;t=${u.searchParams.get('t')}&amp;after=${after + 25}"></faceplate-partial>`
        : '';
    return {
      body: page(ids.map((id) => postEl({ id, sub: 'testsub', title: id })).join('') + next),
    };
  };

  test('reads every list and keeps each post once', async () => {
    const { result } = await run(
      {
        target: SUB,
        includeComments: false,
        maxPosts: 1000,
        deep: true,
      },
      [BLOCKED, big],
    );
    expect(result.status).toBe('complete');
    expect(result.posts).toHaveLength(2000);
    expect(new Set(result.posts.map((p) => p.id)).size).toBe(2000);
  });

  test('a "newest" list a little short of 1000 (moderated subreddits) still reads the other lists', async () => {
    const short: Route = (u) =>
      u.pathname === '/svc/shreddit/community-more-posts/new/' &&
      Number(u.searchParams.get('after') ?? 0) >= 975
        ? { body: page('') }
        : big(u, {});
    const { result } = await run(
      {
        target: SUB,
        includeComments: false,
        maxPosts: 1000,
        deep: true,
      },
      [BLOCKED, short],
    );
    // All lists were read: far more than the 975 from "newest".
    expect(result.posts).toHaveLength(2000);
  });

  test('a small subreddit: the newest list holds everything, so the others are skipped', async () => {
    const { result, calls } = await run(
      {
        target: SUB,
        includeComments: false,
        maxPosts: 1000,
        deep: true,
      },
      [
        BLOCKED,
        feedRoute,
        (u) =>
          u.pathname.includes('/community-more-posts/new/')
            ? feedRoute(new URL(u.href.replace('/new/', '/hot/')), {})
            : undefined,
      ],
    );
    expect(result.posts.map((p) => p.id)).toEqual(['f1', 'f2', 'f3']);
    // Only the newest list was read (its last page confirms the end).
    const lists = calls.filter((c) => c.url.includes('community-more-posts'));
    expect(lists.every((c) => c.url.includes('/community-more-posts/new/'))).toBe(true);
  });
});

test('requests are counted by kind, for manifest.json', () => {
  const kinds = [
    ['https://www.reddit.com/svc/shreddit/community-more-posts/hot/?name=x', 'GET'],
    ['https://www.reddit.com/r/x/comments/abc/some_title/?sort=top', 'GET'],
    ['https://www.reddit.com/comments/abc/?sort=top', 'GET'],
    ['https://www.reddit.com/r/x/comments/abc/comment/def/', 'GET'],
    [
      'https://www.reddit.com/svc/shreddit/more-comments/x/t3_abc?top-level=1&comments-remaining=500',
      'POST',
    ],
    ['https://www.reddit.com/svc/shreddit/more-comments/x/t3_abc?startingDepth=2', 'POST'],
    ['https://www.reddit.com/comments/abc.json?limit=500', 'GET'],
    ['https://www.reddit.com/comments/abc/_/def.json?limit=500', 'GET'],
    ['https://www.reddit.com/api/info.json?id=t1_a', 'GET'],
    ['https://www.reddit.com/api/morechildren.json?api_type=json', 'GET'],
    ['https://www.reddit.com/search/?q=x&type=posts', 'GET'],
  ].map(([url, method]) => requestKind(url!, method!));
  expect(kinds).toEqual([
    'listing pages',
    'post pages',
    'post pages',
    'comment pages',
    'more comments',
    'more replies',
    'API threads',
    'API comment subtrees',
    'API comments by id',
    'API more comments',
    'search pages',
  ]);
});
