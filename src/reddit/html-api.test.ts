// The web-page backend against invented pages in reddit.com's markup.
import { describe, expect, test } from 'vitest';
import { fakeClock, fakeFetch, type Route } from '../../tests/support/fake';
import {
  blockedCommunityPage,
  commentEl,
  missingCommunityPage,
  moreButton,
  moreLink,
  page,
  postEl,
} from '../../tests/support/shreddit';
import { createRedditClient } from './client';
import { describeError, RedditError } from './errors';
import { createHtmlBackend, resolveShareLink, SEARCH_GAP_MS, threadRequestCap } from './html-api';
import { parsePage, postFromElement, repliesCursor, searchResults } from './html-parse';
import { walk } from './model';

function backendWith(...routes: Route[]) {
  const clock = fakeClock();
  const f = fakeFetch(...routes);
  const client = createRedditClient({
    fetch: f.fetch,
    now: clock.now,
    sleep: clock.sleep,
    minIntervalMs: 0,
  });
  return { backend: createHtmlBackend(client), calls: f.calls, client, clock };
}

const P = 'p1';
const MORE = '/svc/shreddit/more-comments/testsub/t3_p1';

/** Reddit refusing the "more replies" requests built for "continue this thread" links. */
const refuseBuilt: Route = (u, init) =>
  init.method === 'POST' && u.searchParams.get('seeker-session') === 'true'
    ? { status: 400, body: 'bad request' }
    : undefined;

describe('thread: requests', () => {
  const page1 = page(
    postEl({ id: P, sub: 'testsub', title: 'Short one', comments: 3 }),
    commentEl(P, { id: 'a', body: 'First' }) +
      moreButton(`${MORE}?top-level=1&comments-remaining=75`, 'CUR_TOP', '2 more comments'),
  );
  const morePage = page('', commentEl(P, { id: 'b', body: 'Second' }));
  const PERMALINK = `https://www.reddit.com/r/testsub/comments/${P}/short_one/`;

  test('the full address from a listing: one request for the page, no redirect', async () => {
    const asked: { path: string; accept: string | null }[] = [];
    const { backend } = backendWith((u, init) => {
      asked.push({ path: u.pathname, accept: new Headers(init.headers).get('accept') });
      if (u.pathname === `/r/testsub/comments/${P}/short_one/`) return { body: page1 };
      if (u.pathname === MORE) return { body: morePage };
      return undefined;
    });
    const thread = await backend.thread(P, {
      sort: 'top',
      maxComments: Infinity,
      permalink: PERMALINK,
    });
    expect(thread.comment_count).toBe(2);
    expect(asked.map((a) => a.path)).toEqual([`/r/testsub/comments/${P}/short_one/`, MORE]);
    // The "more" answer asked for as a bare fragment, which is a third of the bytes.
    expect(asked[1]!.accept).toMatch(/^text\/vnd\.reddit\.partial\+html/);
  });

  test('the first "more comments" asks for as many as Reddit sends at once', async () => {
    const { backend, calls } = backendWith(
      (u) => (u.pathname === `/comments/${P}/` ? { body: page1 } : undefined),
      (u) => (u.pathname === MORE ? { body: morePage } : undefined),
    );
    await backend.thread(P, { sort: 'top', maxComments: Infinity });
    const more = new URL(calls.find((c) => c.method === 'POST')!.url);
    expect(more.searchParams.get('comments-remaining')).toBe('500');
    expect(more.searchParams.get('top-level')).toBe('1');
  });

  test('with a comment limit, the cheap top-level chain goes before reply buttons', async () => {
    const withReplies = page(
      postEl({ id: P, sub: 'testsub', title: 'Short one', comments: 40 }),
      commentEl(P, {
        id: 'a',
        body: 'First',
        inner: moreButton(`${MORE}?startingDepth=1`, 'CUR_REPLIES'),
      }) + moreButton(`${MORE}?top-level=1&comments-remaining=75`, 'CUR_TOP', '30 more comments'),
    );
    const many = Array.from({ length: 30 }, (_, i) => commentEl(P, { id: `t${i}`, body: 'x' }));
    const { backend, calls } = backendWith(
      (u) => (u.pathname === `/comments/${P}/` ? { body: withReplies } : undefined),
      (u, init) =>
        u.pathname === MORE
          ? new URLSearchParams(init.body as string).get('cursor') === 'CUR_TOP'
            ? { body: page('', many.join('')) }
            : { body: page('', commentEl(P, { id: 'r1', parent: 'a', depth: 1, body: 'y' })) }
          : undefined,
    );
    const thread = await backend.thread(P, { sort: 'top', maxComments: 25 });
    const posts = calls.filter((c) => c.method === 'POST').map((c) => c.body);
    expect(posts).toEqual(['cursor=CUR_TOP']);
    expect(thread.comment_count).toBe(25);
  });

  test('after 10 comment pages in a row with nothing new, the rest become gaps', async () => {
    const ids = Array.from({ length: 14 }, (_, i) => `d${i}`);
    const deep = page(
      postEl({ id: P, sub: 'testsub', title: 'Deep one', comments: 40 }),
      ids.map((id) => commentEl(P, { id, body: 'x', inner: moreLink(P, id) })).join(''),
    );
    const { backend, calls } = backendWith(
      (u) => (u.pathname === `/comments/${P}/` ? { body: deep } : undefined),
      refuseBuilt,
      // Each comment's own page: that comment again, and nothing new.
      (u) => {
        const m = new RegExp(`^/r/testsub/comments/${P}/comment/(\\w+)/$`).exec(u.pathname);
        return m
          ? {
              body: page(
                postEl({ id: P, sub: 'testsub', title: 'Deep one' }),
                commentEl(P, { id: m[1]!, body: 'x' }),
              ),
            }
          : undefined;
      },
    );
    const thread = await backend.thread(P, { sort: 'top', maxComments: Infinity });
    // Three built requests refused, then only the comments' own pages.
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(3);
    expect(calls.filter((c) => c.url.includes('/comment/'))).toHaveLength(10);
    expect(thread.gaps.filter((g) => /deep replies/.test(g.reason))).toHaveLength(4);
    expect(thread.comment_count).toBe(14);
  });

  test('a stale or foreign address falls back to /comments/<id>/', async () => {
    const { backend, calls } = backendWith(
      (u) =>
        u.pathname === `/r/testsub/comments/${P}/short_one/`
          ? { status: 404, body: 'not here' }
          : undefined,
      (u) => (u.pathname === `/comments/${P}/` ? { body: page1 } : undefined),
      (u) => (u.pathname === MORE ? { body: morePage } : undefined),
    );
    const thread = await backend.thread(P, {
      sort: 'top',
      maxComments: Infinity,
      permalink: PERMALINK,
    });
    expect(thread.comment_count).toBe(2);
    expect(calls.slice(0, 2).map((c) => new URL(c.url).pathname)).toEqual([
      `/r/testsub/comments/${P}/short_one/`,
      `/comments/${P}/`,
    ]);
    // Never another post's address, nor another site.
    const other = backendWith(
      (u) => (u.pathname === `/comments/${P}/` ? { body: page1 } : undefined),
      (u) => (u.pathname === MORE ? { body: morePage } : undefined),
    );
    for (const permalink of [
      'https://www.reddit.com/r/testsub/comments/zzz/other_post/',
      'https://evil.example/r/testsub/comments/p1/x/',
    ])
      await other.backend.thread(P, { sort: 'top', maxComments: Infinity, permalink });
    expect(
      other.calls.filter((c) => c.method === 'GET').map((c) => new URL(c.url).pathname),
    ).toEqual([`/comments/${P}/`, `/comments/${P}/`]);
  });
});

describe('thread', () => {
  const postPage = page(
    postEl({
      id: P,
      sub: 'testsub',
      title: 'An invented question',
      body: 'Why <b>is</b> it so?',
      comments: 9,
    }),
    [
      commentEl(P, {
        id: 'a',
        author: 'poster',
        attrs: 'is-op',
        body: 'Top comment with <search-telemetry-tracker><a href="/search/?q=term&amp;cId=1">a term</a></search-telemetry-tracker> and <a href="/r/other/">a link</a>',
        inner:
          commentEl(P, { id: 'b', parent: 'a', depth: 1, body: 'Reply' }) +
          moreButton(`${MORE}?startingDepth=2&commentParentPositions=0`, 'CUR_A'),
      }),
      commentEl(P, { id: 'gone', author: 'ignored', attrs: 'is-author-deleted' }),
      commentEl(P, {
        id: 'mod',
        attrs: 'is-mod-distinguished',
        body: 'Rules',
        inner: moreLink(P, 'mod'),
      }),
      moreButton(`${MORE}?top-level=1&rootCommentOffset=3`, 'CUR_TOP', '5 more comments'),
    ].join(''),
  );

  const routes: Route[] = [
    // /comments/<id>/ redirects to the full address.
    (u) =>
      u.pathname === `/comments/${P}/`
        ? {
            body: postPage,
            url: `https://www.reddit.com/r/testsub/comments/${P}/an_invented_question/?sort=${u.searchParams.get('sort')}`,
          }
        : undefined,
    (u, init) => {
      if (init.method !== 'POST' || u.pathname !== MORE) return undefined;
      const cursor = new URLSearchParams(init.body as string).get('cursor');
      if (cursor === 'CUR_A')
        return {
          body: page('', commentEl(P, { id: 'c', parent: 'a', depth: 1, body: 'Second reply' })),
        };
      if (cursor === 'CUR_TOP')
        return {
          body: page(
            '',
            commentEl(P, { id: 'd', body: 'Later top comment' }) +
              moreButton(`${MORE}?top-level=1&rootCommentOffset=4`, 'CUR_TOP2'),
          ),
        };
      if (cursor === 'CUR_TOP2')
        return { body: page('', commentEl(P, { id: 'e', body: 'Last top comment' })) };
      // The request built for the mod comment's "continue this thread" link.
      if (cursor === repliesCursor('t1_mod', 1))
        return {
          body: page(
            '',
            commentEl(P, { id: 'm1', parent: 'mod', depth: 1, body: 'Under the mod' }),
          ),
        };
      // The thread's buttons as repeated on a comment's own page: never to be followed.
      if (cursor?.startsWith('DUP')) throw new Error(`followed a repeated button ${cursor}`);
      return undefined;
    },
    // A comment's own page: its replies, plus the thread's buttons again (with other cursors).
    (u) =>
      u.pathname === `/r/testsub/comments/${P}/comment/mod/`
        ? {
            body: page(
              postEl({ id: P, sub: 'testsub', title: 'An invented question' }),
              commentEl(P, {
                id: 'mod',
                attrs: 'is-mod-distinguished',
                body: 'Rules',
                inner: commentEl(P, { id: 'm1', parent: 'mod', depth: 1, body: 'Under the mod' }),
              }) +
                commentEl(P, {
                  id: 'a',
                  body: 'Top comment',
                  inner: moreButton(`${MORE}?commentId=t1_mod&startingDepth=2`, 'DUP_A'),
                }) +
                moreButton(`${MORE}?top-level=1&commentId=t1_mod`, 'DUP_TOP'),
            ),
          }
        : undefined,
  ];

  test('loads every comment once, and builds the tree from attributes', async () => {
    const { backend, calls } = backendWith(...routes);
    const progress: number[] = [];
    const thread = await backend.thread(P, {
      sort: 'top',
      maxComments: Infinity,
      onProgress: (n) => progress.push(n),
    });

    expect(thread.post).toMatchObject({
      id: P,
      title: 'An invented question',
      selftext: 'Why **is** it so?',
      subreddit: 'testsub',
      num_comments: 9,
      created_utc: '2026-11-15T08:48:17.197Z',
    });
    const all = [...walk(thread.comments)];
    expect(all.map((c) => c.path)).toEqual(['a', 'a/b', 'a/c', 'gone', 'mod', 'mod/m1', 'd', 'e']);
    expect(thread.gaps).toEqual([]);

    const a = all.find((c) => c.id === 'a')!;
    expect(a.is_submitter).toBe(true);
    // Reddit's own search links become plain words; the author's links stay, made absolute.
    expect(a.body).toBe('Top comment with a term and [a link](https://www.reddit.com/r/other/)');
    expect(all.find((c) => c.id === 'gone')).toMatchObject({
      author: '[deleted]',
      body: '[deleted]',
      removal_status: 'deleted',
    });
    expect(all.find((c) => c.id === 'mod')).toMatchObject({ distinguished: 'moderator' });

    expect(new URL(calls[0]!.url).pathname).toBe(`/comments/${P}/`);
    expect(new URL(calls[0]!.url).searchParams.get('sort')).toBe('top');
    // Post page, two top-level pages, one reply page, and the request built for the
    // mod comment's "continue this thread" link (instead of its ~550 KB page).
    expect(calls).toHaveLength(5);
    const built = calls.at(-1)!;
    expect(built.method).toBe('POST');
    expect(Object.fromEntries(new URL(built.url).searchParams)).toEqual({
      sort: 'TOP',
      startingDepth: '1',
      'seeker-session': 'true',
    });
    expect(new URL(built.url).pathname).toBe(MORE);
    expect(progress.at(-1)).toBe(8);
  });

  test('stops at the comment limit and lists the buttons it left', async () => {
    const { backend, calls } = backendWith(...routes);
    const thread = await backend.thread(P, { sort: 'confidence', maxComments: 2 });
    expect(calls).toHaveLength(1);
    // Exactly the limit, in reading order: a reply is never kept without its parent.
    expect(thread.comment_count).toBe(2);
    expect([...walk(thread.comments)].map((c) => c.path)).toEqual(['a', 'a/b']);
    // The buttons and the link not followed, then the two comments of the first page cut off.
    expect(thread.gaps.map((g) => [g.parent_id, g.count, g.reason])).toEqual([
      ['t1_a', null, 'comment limit'],
      ['t3_p1', 5, 'comment limit'],
      ['t1_mod', null, 'comment limit'],
      ['t3_p1', 2, 'comment limit'],
    ]);
  });
});

describe('thread safety', () => {
  const single = (inner: string) =>
    page(
      postEl({ id: P, sub: 'testsub', title: 'Q', comments: 3 }),
      commentEl(P, { id: 'a', body: 'x' }) + inner,
    );
  const pageRoute =
    (html: string): Route =>
    (u) =>
      u.pathname === `/comments/${P}/` ? { body: html } : undefined;

  test('a button that keeps answering with nothing new is given up on', async () => {
    let n = 0;
    const { backend, calls } = backendWith(pageRoute(single(moreButton(MORE, 'C0'))), (u, init) =>
      init.method === 'POST' ? { body: page('', moreButton(MORE, `C${++n}`)) } : undefined,
    );
    const thread = await backend.thread(P, { sort: 'top', maxComments: Infinity });
    expect(calls.length).toBeLessThan(15);
    expect(thread.gaps.at(-1)?.reason).toMatch(/without new comments/);
  });

  test('a comment\'s own page: its own "more replies" button is followed', async () => {
    const { backend } = backendWith(
      pageRoute(single(commentEl(P, { id: 'b', inner: moreLink(P, 'b') }))),
      refuseBuilt,
      (u) =>
        u.pathname === `/r/testsub/comments/${P}/comment/b/`
          ? {
              body: page(
                postEl({ id: P, sub: 'testsub', title: 'Q' }),
                commentEl(P, {
                  id: 'b',
                  inner:
                    commentEl(P, { id: 'r1', parent: 'b', depth: 1 }) + moreButton(MORE, 'OWN'),
                }),
              ),
            }
          : undefined,
      (u, init) =>
        init.method === 'POST' && new URLSearchParams(init.body as string).get('cursor') === 'OWN'
          ? { body: page('', commentEl(P, { id: 'r2', parent: 'b', depth: 1 })) }
          : undefined,
    );
    const thread = await backend.thread(P, { sort: 'top', maxComments: Infinity });
    expect([...walk(thread.comments)].map((c) => c.path)).toEqual(['a', 'b', 'b/r1', 'b/r2']);
    expect(thread.gaps).toEqual([]);
  });

  test('empty answers in one place do not stop expansion elsewhere', async () => {
    // Twelve comments with a reply button each; the first nine buttons bring nothing
    // (removed replies), the tenth brings a reply.
    const comments = Array.from({ length: 12 }, (_, i) =>
      commentEl(P, { id: `c${i}`, inner: moreButton(MORE, `R${i}`) }),
    ).join('');
    const { backend } = backendWith(pageRoute(single(comments)), (u, init) => {
      if (init.method !== 'POST') return undefined;
      const cursor = new URLSearchParams(init.body as string).get('cursor');
      return cursor === 'R9'
        ? { body: page('', commentEl(P, { id: 'late', parent: 'c9', depth: 1 })) }
        : { body: page('') };
    });
    const thread = await backend.thread(P, { sort: 'top', maxComments: Infinity });
    expect([...walk(thread.comments)].map((c) => c.id)).toContain('late');
    expect(thread.gaps).toEqual([]);
  });

  test('a follow-up button at the top of a fragment belongs to what the fragment was for', async () => {
    const { backend } = backendWith(
      pageRoute(single(commentEl(P, { id: 'b', inner: moreButton(MORE, 'REPLIES') }))),
      (u, init) => {
        if (init.method !== 'POST') return undefined;
        const cursor = new URLSearchParams(init.body as string).get('cursor');
        if (cursor === 'REPLIES')
          return {
            body: page(
              '',
              commentEl(P, { id: 'c', parent: 'b', depth: 1 }) + moreButton(MORE, 'NEXT'),
            ),
          };
        return { status: 404, body: 'gone' };
      },
    );
    const thread = await backend.thread(P, { sort: 'top', maxComments: Infinity });
    expect(thread.gaps.map((g) => g.parent_id)).toEqual(['t1_b']);
  });

  test('buttons and links pointing off www.reddit.com are ignored', async () => {
    const { backend, calls } = backendWith(
      pageRoute(
        single(
          moreButton('https://evil.example/svc/shreddit/more-comments/x', 'X') +
            moreButton('/svc/shreddit/elsewhere/more-comments/', 'Y') +
            commentEl(P, {
              id: 'z',
              inner:
                '<a slot="more-comments-permalink" href="https://evil.example/r/x/comments/abc/">x</a>',
            }),
        ),
      ),
    );
    await backend.thread(P, { sort: 'top', maxComments: Infinity });
    expect(calls).toHaveLength(1);
  });
});

describe('thread: Reddit since November 2026', () => {
  const PERMALINK = `https://www.reddit.com/r/testsub/comments/${P}/a_post/`;
  const postPage = (streamed: string, comments = 3) =>
    page(postEl({ id: P, sub: 'testsub', title: 'A post', comments }), streamed);

  test('"more comments" carries the post\'s address as its referrer', async () => {
    const referrers: (string | undefined)[] = [];
    const { backend } = backendWith(
      (u) =>
        u.pathname === `/comments/${P}/`
          ? {
              body: postPage(
                commentEl(P, { id: 'a', body: 'x' }) + moreButton(`${MORE}?top-level=1`, 'TOP'),
              ),
            }
          : undefined,
      (u, init) => {
        if (init.method !== 'POST') return undefined;
        referrers.push(init.referrer);
        return { body: page('', commentEl(P, { id: 'b', body: 'y' })) };
      },
    );
    await backend.thread(P, { sort: 'top', maxComments: Infinity });
    expect(referrers).toEqual([PERMALINK]);
  });

  test('a "seeker" post page without comments: the comments partial, in the chosen order', async () => {
    const { backend, calls } = backendWith(
      (u) => (u.pathname === `/comments/${P}/` ? { body: postPage('') } : undefined),
      (u) =>
        u.pathname === `/svc/shreddit/comments/r/testsub/t3_${P}`
          ? {
              body: page(
                '',
                commentEl(P, { id: 'a', body: 'x' }) + commentEl(P, { id: 'b', body: 'y' }),
              ),
            }
          : undefined,
    );
    const thread = await backend.thread(P, { sort: 'new', maxComments: Infinity });
    expect(thread.comment_count).toBe(2);
    const partial = new URL(calls[1]!.url);
    expect(Object.fromEntries(partial.searchParams)).toEqual({
      'seeker-session': 'true',
      sort: 'new',
    });
    // Not when the page has its comments, nor when there are none to load.
    const quiet = backendWith((u) =>
      u.pathname === `/comments/${P}/` ? { body: postPage('', 0) } : undefined,
    );
    await quiet.backend.thread(P, { sort: 'new', maxComments: Infinity });
    expect(quiet.calls).toHaveLength(1);
  });

  test("a refused built request opens the comment's page, whose repeated buttons are not followed", async () => {
    const { backend, calls } = backendWith(
      (u) =>
        u.pathname === `/comments/${P}/`
          ? {
              body: postPage(
                commentEl(P, {
                  id: 'a',
                  body: 'x',
                  inner: moreButton(`${MORE}?startingDepth=1`, 'CUR_A'),
                }) + commentEl(P, { id: 'deep', body: 'y', inner: moreLink(P, 'deep') }),
              ),
            }
          : undefined,
      refuseBuilt,
      (u, init) =>
        init.method === 'POST' && new URLSearchParams(init.body as string).get('cursor') === 'CUR_A'
          ? { body: page('', commentEl(P, { id: 'a1', parent: 'a', depth: 1, body: 'r' })) }
          : undefined,
      (u) =>
        u.pathname === `/r/testsub/comments/${P}/comment/deep/`
          ? {
              body: page(
                postEl({ id: P, sub: 'testsub', title: 'A post' }),
                commentEl(P, {
                  id: 'deep',
                  body: 'y',
                  inner: commentEl(P, { id: 'd1', parent: 'deep', depth: 1, body: 'z' }),
                }) +
                  commentEl(P, { id: 'a', body: 'x', inner: moreButton(`${MORE}?x=1`, 'DUP_A') }),
              ),
            }
          : undefined,
    );
    const thread = await backend.thread(P, { sort: 'top', maxComments: Infinity });
    expect([...walk(thread.comments)].map((c) => c.path)).toEqual(['a', 'a/a1', 'deep', 'deep/d1']);
    expect(thread.gaps).toEqual([]);
    expect(calls.some((c) => c.body === 'cursor=DUP_A')).toBe(false);
  });

  test('the biggest branches load first, so a comment limit keeps them', async () => {
    const order: string[] = [];
    const button = (id: string, n: number) =>
      commentEl(P, {
        id,
        body: id,
        inner: moreButton(MORE, `R_${id}`, `<faceplate-number number="${n}"></faceplate-number>`),
      });
    const { backend } = backendWith(
      (u) =>
        u.pathname === `/comments/${P}/`
          ? { body: postPage(button('small', 2) + button('big', 40) + button('mid', 9), 60) }
          : undefined,
      (u, init) => {
        if (init.method !== 'POST') return undefined;
        const id = new URLSearchParams(init.body as string).get('cursor')!.slice(2);
        order.push(id);
        return { body: page('', commentEl(P, { id: `${id}1`, parent: id, depth: 1, body: 'r' })) };
      },
    );
    await backend.thread(P, { sort: 'top', maxComments: Infinity });
    expect(order).toEqual(['big', 'mid', 'small']);
  });

  test('past 900 top-level comments, the other sort orders are read too', async () => {
    const top = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => commentEl(P, { id: `t${from + i}`, body: 'x' })).join('');
    const sorts: string[] = [];
    const { backend } = backendWith(
      (u) =>
        u.pathname === `/comments/${P}/`
          ? { body: postPage(top(0, 500) + moreButton(`${MORE}?top-level=1`, 'TOP2'), 2000) }
          : undefined,
      (u, init) =>
        init.method === 'POST' && new URLSearchParams(init.body as string).get('cursor') === 'TOP2'
          ? { body: page('', top(500, 450)) }
          : undefined,
      (u) => {
        if (u.pathname !== `/svc/shreddit/comments/r/testsub/t3_${P}`) return undefined;
        const sort = u.searchParams.get('sort')!;
        sorts.push(sort);
        // Each order brings some of the same comments and some only it reaches.
        return {
          body: page('', top(0, 5) + commentEl(P, { id: `x${sort.slice(0, 5)}`, body: 'y' })),
        };
      },
    );
    const thread = await backend.thread(P, { sort: 'top', maxComments: Infinity });
    expect(sorts).toEqual(['new', 'old', 'controversial', 'confidence']);
    expect(thread.comment_count).toBe(954);
  });

  test('a thread stops at its request cap, a guard against loops', async () => {
    expect(threadRequestCap(Infinity, 5)).toBe(220);
    expect(threadRequestCap(25, 5000)).toBe(70);
    let n = 0;
    // Every answer brings one new comment and another button: it never ends by itself.
    const { backend, calls } = backendWith(
      (u) =>
        u.pathname === `/comments/${P}/`
          ? { body: postPage(commentEl(P, { id: 'a', body: 'x' }) + moreButton(MORE, 'C0'), 10) }
          : undefined,
      (u, init) =>
        init.method === 'POST'
          ? {
              body: page(
                '',
                commentEl(P, { id: `n${++n}`, body: 'x' }) + moreButton(MORE, `C${n}`),
              ),
            }
          : undefined,
    );
    const thread = await backend.thread(P, { sort: 'top', maxComments: Infinity });
    expect(calls).toHaveLength(220);
    expect(thread.gaps.at(-1)?.reason).toMatch(/request limit/);
  });
});

describe('listings: silent empties', () => {
  const sub = { kind: 'subreddit', name: 'gone', sort: 'hot', time: 'day' } as const;
  const empty: Route = (u) =>
    u.pathname.startsWith('/svc/shreddit/community-more-posts/') ? { body: page('') } : undefined;

  test.each([
    ['BANNED', 'forbidden', 'banned'],
    ['QUARANTINED', 'forbidden', 'quarantined'],
    ['PRIVATE', 'forbidden', 'private'],
  ])('a %s subreddit says why it has no posts', async (reason, kind, detail) => {
    const { backend, calls } = backendWith(empty, (u) =>
      u.pathname === '/r/gone/' ? { body: blockedCommunityPage(reason) } : undefined,
    );
    await expect(backend.listing(sub, { limit: 10 }).next()).rejects.toMatchObject({
      kind,
      detail,
    });
    expect(calls).toHaveLength(2);
  });

  test('the reason, in words for the person exporting', () => {
    const url = 'https://www.reddit.com/r/gone/';
    expect(describeError(new RedditError('forbidden', url, 200, 'quarantined'))).toBe(
      "Reddit doesn't show this community's posts: it is quarantined.",
    );
    expect(describeError(new RedditError('notfound', url, 200, 'community not found'))).toMatch(
      /community does not exist/,
    );
  });

  test('an unknown subreddit says so; a quiet one is just empty', async () => {
    const missing = backendWith(empty, (u) =>
      u.pathname === '/r/gone/' ? { body: missingCommunityPage() } : undefined,
    );
    await expect(missing.backend.listing(sub, { limit: 10 }).next()).rejects.toMatchObject({
      kind: 'notfound',
    });
    const quiet = backendWith(empty, (u) =>
      u.pathname === '/r/gone/'
        ? { body: page(postEl({ id: 'q1', sub: 'gone', title: 'Old' })) }
        : undefined,
    );
    const items = [];
    for await (const item of quiet.backend.listing(sub, { limit: 10 })) items.push(item);
    expect(items).toEqual([]);
  });

  test('search pages wait at least 1.6 s after the previous request', async () => {
    const result = (id: string) =>
      `<search-telemetry-tracker data-faceplate-tracking-context="${JSON.stringify({ post: { id: `t3_${id}`, title: id } }).replace(/"/g, '&quot;')}"><a data-testid="post-title" href="/r/testsub/comments/${id}/x/">${id}</a></search-telemetry-tracker>`;
    const { backend, clock } = backendWith((u) => {
      if (u.pathname !== '/r/testsub/search/') return undefined;
      return u.searchParams.get('cursor')
        ? { body: page(result('s2')) }
        : {
            body: page(
              result('s1') +
                '<faceplate-partial src="/r/testsub/search/?q=x&amp;cursor=abc"></faceplate-partial>',
            ),
          };
    });
    const items = [];
    for await (const item of backend.listing(
      { kind: 'search', query: 'x', subreddit: 'testsub', sort: 'relevance', time: 'all' },
      { limit: 10 },
    ))
      items.push(item);
    expect(items).toHaveLength(2);
    expect(clock.waits).toEqual([SEARCH_GAP_MS]);
  });
});

describe('share links', () => {
  test('one request: where Reddit redirects the link', async () => {
    const { client, calls } = backendWith((u) =>
      u.pathname === '/r/testsub/s/AbCd1234'
        ? {
            body: page(postEl({ id: 'sh1', sub: 'testsub', title: 'Shared' })),
            url: 'https://www.reddit.com/r/testsub/comments/sh1/shared/?share_id=x',
          }
        : undefined,
    );
    await expect(
      resolveShareLink(client, 'https://www.reddit.com/r/testsub/s/AbCd1234'),
    ).resolves.toEqual({
      id: 'sh1',
      subreddit: 'testsub',
      permalink: 'https://www.reddit.com/r/testsub/comments/sh1/shared/?share_id=x',
    });
    expect(calls).toHaveLength(1);
  });

  test('or the post the page says it is', async () => {
    const { client } = backendWith((u) =>
      u.pathname === '/r/testsub/s/AbCd1234'
        ? {
            body: page(
              '<input id="canonical-url-updater" value="/r/testsub/comments/sh2/shared_too/">',
            ),
          }
        : undefined,
    );
    await expect(
      resolveShareLink(client, 'https://www.reddit.com/r/testsub/s/AbCd1234'),
    ).resolves.toMatchObject({ id: 'sh2', subreddit: 'testsub' });
  });
});

describe('feed', () => {
  const feedPage = (ids: string[], next?: string) =>
    page(
      ids.map((id) => postEl({ id, sub: 'testsub', title: `Post ${id}` })).join('') +
        '<shreddit-ad-post id="t3_ad1"></shreddit-ad-post>' +
        (next
          ? `<faceplate-partial slot="load-after" src="/svc/shreddit/community-more-posts/new/?after=${next}&amp;name=testsub&amp;t=DAY" method="GET"></faceplate-partial>`
          : ''),
    );

  test('pages through the feed, skipping ads and repeats, up to the limit', async () => {
    const { backend, calls } = backendWith((u) => {
      if (u.pathname !== '/svc/shreddit/community-more-posts/new/') return undefined;
      const after = u.searchParams.get('after');
      if (!after) return { body: feedPage(['f1', 'f2', 'f3'], 'CURSOR2') };
      if (after === 'CURSOR2') return { body: feedPage(['f3', 'f4', 'f5']) };
      return undefined;
    });
    const out = [];
    for await (const item of backend.listing(
      { kind: 'subreddit', name: 'testsub', sort: 'new', time: 'day' },
      { limit: 4 },
    ))
      out.push(item.kind === 'post' ? item.post.id : '');
    expect(out).toEqual(['f1', 'f2', 'f3', 'f4']);
    expect(new URL(calls[0]!.url).searchParams.get('name')).toBe('testsub');
    expect(calls).toHaveLength(2);
  });

  test("without a load-after button, continues from the last post's cursor", async () => {
    const { backend, calls } = backendWith((u) => {
      if (u.pathname !== '/svc/shreddit/community-more-posts/hot/') return undefined;
      return u.searchParams.get('after') ? { body: feedPage([]) } : { body: feedPage(['g1']) };
    });
    const out = [];
    for await (const item of backend.listing(
      { kind: 'subreddit', name: 'testsub', sort: 'hot', time: 'day' },
      { limit: 100 },
    ))
      out.push(item);
    expect(out).toHaveLength(1);
    expect(new URL(calls[1]!.url).searchParams.get('after')).toBe(btoa('t3_g1').replace(/=+$/, ''));
  });

  test('user profiles need a login on the web pages', async () => {
    const { backend } = backendWith();
    const items = backend.listing(
      { kind: 'user', name: 'someone', section: 'overview', sort: 'new', time: 'all' },
      { limit: 10 },
    );
    await expect(items.next()).rejects.toMatchObject({ kind: 'login' });
  });
});

describe('parsing', () => {
  test('a video post finds the packaged MP4 with the best bitrate', () => {
    const packaged = JSON.stringify({
      playbackMp4s: {
        permutations: [
          {
            source: {
              url: 'https://packaged-media.redd.it/v1/pb/m2-res_240p.mp4?s=a',
              bitrateBps: 100,
              dimensions: { width: 240, height: 240 },
            },
          },
          {
            source: {
              url: 'https://packaged-media.redd.it/v1/pb/m2-res_720p.mp4?s=b',
              bitrateBps: 900,
              dimensions: { width: 720, height: 720 },
            },
          },
        ],
      },
    });
    const doc = parsePage(
      page(
        postEl({
          id: 'v1',
          sub: 'testsub',
          title: 'A video',
          type: 'video',
          href: 'https://v.redd.it/v1',
          inner: `<shreddit-player packaged-media-json="${packaged.replace(/"/g, '&quot;')}"></shreddit-player>`,
        }),
      ),
    );
    const post = postFromElement(doc.querySelector('shreddit-post')!, doc);
    expect(post.media_type).toBe('video');
    expect(post.media).toEqual([
      {
        type: 'video',
        url: 'https://packaged-media.redd.it/v1/pb/m2-res_720p.mp4?s=b',
        width: 720,
        height: 720,
        caption: null,
        duration: null,
        hls_url: 'https://v.redd.it/v1/HLSPlaylist.m3u8',
        dash_url: 'https://v.redd.it/v1/DASHPlaylist.mpd',
      },
    ]);
  });

  test('an image post', () => {
    const doc = parsePage(
      page(
        postEl({
          id: 'i1',
          sub: 'testsub',
          title: 'A picture',
          type: 'image',
          href: 'https://i.redd.it/abc.jpeg',
        }),
      ),
    );
    const post = postFromElement(doc.querySelector('shreddit-post')!, doc);
    expect(post.media).toEqual([
      {
        type: 'image',
        url: 'https://i.redd.it/abc.jpeg',
        width: null,
        height: null,
        caption: null,
        duration: null,
        hls_url: null,
        dash_url: null,
      },
    ]);
  });

  test('search results come from the title links and their tracking data', () => {
    const ctx = (id: string, title: string) =>
      JSON.stringify({
        post: { id: `t3_${id}`, title, nsfw: false },
        profile: { name: 'asker' },
        subreddit: { id: 't5_q', name: 'testsub' },
      }).replace(/"/g, '&quot;');
    const doc = parsePage(
      page(
        `<div data-testid="search-sdui-post"><search-telemetry-tracker data-faceplate-tracking-context="${ctx('s1', 'First')}"><h2><a data-testid="post-title" href="/r/testsub/comments/s1/first/">First</a></h2></search-telemetry-tracker></div>` +
          `<search-telemetry-tracker data-faceplate-tracking-context="${ctx('s2', 'Second')}"><a data-testid="post-title" href="/r/testsub/comments/s2/second/">Second</a></search-telemetry-tracker>` +
          `<a data-testid="post-title" href="/r/testsub/comments/s1/first/">First again</a>`,
      ),
    );
    expect(
      searchResults(doc).map((p) => [p.id, p.title, p.author, p.subreddit, p.permalink]),
    ).toEqual([
      ['s1', 'First', 'asker', 'testsub', 'https://www.reddit.com/r/testsub/comments/s1/first/'],
      ['s2', 'Second', 'asker', 'testsub', 'https://www.reddit.com/r/testsub/comments/s2/second/'],
    ]);
  });
});
