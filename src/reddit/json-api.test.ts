// The JSON backend against a fake Reddit API with invented data, shaped like
// Reddit's documented responses (see docs/how-it-works.md).
import { describe, expect, test } from 'vitest';
import { BLOCKED_PAGE, fakeClock, fakeFetch, type Route } from '../../tests/support/fake';
import { createRedditClient } from './client';
import { createJsonBackend, listingUrl } from './json-api';
import { commentFromJson, postFromJson } from './json-parse';
import { walk } from './model';

const POST = { id: 'p1', name: 't3_p1' };

function postThing(extra: Record<string, unknown> = {}) {
  return {
    kind: 't3',
    data: {
      id: POST.id,
      name: POST.name,
      subreddit: 'testsub',
      subreddit_id: 't5_x',
      author: 'op_user',
      title: 'An invented post',
      selftext: 'Body **text**',
      is_self: true,
      permalink: '/r/testsub/comments/p1/an_invented_post/',
      url: 'https://www.reddit.com/r/testsub/comments/p1/an_invented_post/',
      created_utc: 1_794_000_000,
      score: 10,
      num_comments: 0,
      ...extra,
    },
  };
}

function comment(id: string, parent: string, replies: unknown[] = []) {
  return {
    kind: 't1',
    data: {
      id,
      name: `t1_${id}`,
      link_id: POST.name,
      parent_id: parent,
      author: `user_${id}`,
      body: `Comment ${id}`,
      score: 1,
      created_utc: 1_794_000_100,
      subreddit: 'testsub',
      permalink: `/r/testsub/comments/p1/x/${id}/`,
      replies: replies.length ? { kind: 'Listing', data: { after: null, children: replies } } : '',
    },
  };
}

function more(parent: string, children: string[], count = children.length) {
  return {
    kind: 'more',
    data: {
      id: children[0] ?? '_',
      name: `t1_${children[0] ?? '_'}`,
      parent_id: parent,
      count,
      children,
    },
  };
}

const listing = (children: unknown[], after: string | null = null) => ({
  kind: 'Listing',
  data: { after, children },
});

function backendWith(...routes: Route[]) {
  const clock = fakeClock();
  const f = fakeFetch(...routes);
  const client = createRedditClient({
    fetch: f.fetch,
    now: clock.now,
    sleep: clock.sleep,
    minIntervalMs: 0,
  });
  return { backend: createJsonBackend(client), calls: f.calls };
}

const ids = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe('thread', () => {
  test('loads every "load more" and "continue this thread" stub', async () => {
    const hidden = ids(150, 'h');
    const { backend, calls } = backendWith(
      (u) =>
        u.pathname === '/comments/p1.json'
          ? {
              body: [
                listing([postThing({ num_comments: 154 })]),
                listing([
                  comment('a', POST.name, [
                    comment('b', 't1_a', [more('t1_b', [], 0)]), // continue this thread
                  ]),
                  more(POST.name, hidden, 150),
                ]),
              ],
            }
          : undefined,
      (u) => {
        if (u.pathname !== '/api/morechildren.json') return undefined;
        const asked = u.searchParams.get('children')!.split(',');
        const things = asked.map((id) => comment(id, POST.name));
        // Reddit sometimes answers with a further stub inside.
        if (asked.includes('h0')) things.push(more('t1_h0', ['deep1']) as never);
        if (asked.includes('deep1'))
          return { body: { json: { data: { things: [comment('deep1', 't1_h0')] } } } };
        return { body: { json: { errors: [], data: { things } } } };
      },
      (u) =>
        u.pathname === '/comments/p1/_/b.json'
          ? {
              body: [
                listing([postThing()]),
                listing([comment('b', 't1_a', [comment('c', 't1_b')])]),
              ],
            }
          : undefined,
    );

    const thread = await backend.thread('p1', { sort: 'top', maxComments: Infinity });

    expect(thread.gaps).toEqual([]);
    expect(thread.comment_count).toBe(2 + 150 + 1 + 1);
    const all = [...walk(thread.comments)];
    expect(all.find((c) => c.id === 'c')).toMatchObject({
      depth: 2,
      path: 'a/b/c',
      parent_id: 't1_b',
    });
    expect(all.find((c) => c.id === 'deep1')).toMatchObject({ depth: 1, path: 'h0/deep1' });
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);

    const more_ = calls.filter((c) => c.url.includes('/api/morechildren.json'));
    // 150 ids in batches of at most 100, then the nested stub.
    expect(
      more_.map((c) => new URL(c.url).searchParams.get('children')!.split(',').length),
    ).toEqual([100, 50, 1]);
    for (const c of more_) {
      const q = new URL(c.url).searchParams;
      expect(q.get('link_id')).toBe(POST.name);
      expect(q.get('sort')).toBe('top');
      expect(q.get('api_type')).toBe('json');
      expect(q.get('raw_json')).toBe('1');
    }
  });

  test('stops at the comment limit and reports what it left', async () => {
    const { backend, calls } = backendWith((u) =>
      u.pathname === '/comments/p1.json'
        ? {
            body: [
              listing([postThing()]),
              listing([comment('a', POST.name), more(POST.name, ids(30, 'x'), 30)]),
            ],
          }
        : undefined,
    );
    const thread = await backend.thread('p1', { sort: 'confidence', maxComments: 1 });
    expect(thread.comment_count).toBe(1);
    expect(thread.gaps).toEqual([{ parent_id: POST.name, count: 30, reason: 'comment limit' }]);
    expect(calls).toHaveLength(1);
  });

  test('a stub that keeps failing becomes a gap; the rest still loads', async () => {
    const { backend } = backendWith(
      (u) =>
        u.pathname === '/comments/p1.json'
          ? {
              body: [
                listing([postThing()]),
                listing([
                  comment('a', POST.name),
                  more('t1_a', ['bad'], 1),
                  more(POST.name, ['ok'], 1),
                ]),
              ],
            }
          : undefined,
      (u) => {
        if (u.pathname !== '/api/morechildren.json') return undefined;
        if (u.searchParams.get('children') === 'bad') return { status: 500, body: 'oops' };
        return { body: { json: { data: { things: [comment('ok', POST.name)] } } } };
      },
    );
    const thread = await backend.thread('p1', { sort: 'confidence', maxComments: Infinity });
    expect([...walk(thread.comments)].map((c) => c.id)).toEqual(['a', 'ok']);
    expect(thread.gaps).toHaveLength(1);
    expect(thread.gaps[0]).toMatchObject({ parent_id: 't1_a', count: 1 });
  });

  const blocked = { status: 403, body: BLOCKED_PAGE };
  const firstPage = (u: URL) =>
    u.pathname === '/comments/p1.json'
      ? {
          body: [
            listing([postThing({ num_comments: 6 })]),
            listing([
              comment('a', POST.name),
              more('t1_a', ['a1', 'a2'], 2),
              more(POST.name, ['t1', 't2'], 2),
            ]),
          ],
        }
      : undefined;

  test('when Reddit refuses /api/morechildren, loads hidden comments by id from /api/info', async () => {
    const { backend, calls } = backendWith(
      firstPage,
      (u) => (u.pathname === '/api/morechildren.json' ? blocked : undefined),
      (u) => {
        if (u.pathname !== '/api/info.json') return undefined;
        const asked = u.searchParams.get('id')!.split(',');
        const parent: Record<string, string> = {
          t1_a1: 't1_a',
          t1_a2: 't1_a1',
          t1_t1: POST.name,
          t1_t2: POST.name,
        };
        return {
          body: listing(asked.map((name) => comment(name.slice(3), parent[name]!))),
        };
      },
    );
    const thread = await backend.thread('p1', { sort: 'top', maxComments: Infinity });
    expect(thread.gaps).toEqual([]);
    const all = [...walk(thread.comments)];
    expect(all.map((c) => c.id).sort()).toEqual(['a', 'a1', 'a2', 't1', 't2']);
    expect(all.find((c) => c.id === 'a2')).toMatchObject({ path: 'a/a1/a2', depth: 2 });
    // One refusal, then never again for this export.
    expect(calls.filter((c) => c.url.includes('/api/morechildren.json'))).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes('/api/info.json'))).toHaveLength(2);
  });

  test('when both are refused, loads each hidden comment with its replies', async () => {
    const { backend, calls } = backendWith(
      firstPage,
      (u) =>
        u.pathname === '/api/morechildren.json' || u.pathname === '/api/info.json'
          ? blocked
          : undefined,
      (u) => {
        const m = /^\/comments\/p1\/_\/(\w+)\.json$/.exec(u.pathname);
        if (!m) return undefined;
        const tree: Record<string, unknown> = {
          a: comment('a', POST.name, [comment('a1', 't1_a', [comment('a2', 't1_a1')])]),
          t1: comment('t1', POST.name),
          t2: comment('t2', POST.name),
        };
        return { body: [listing([postThing()]), listing([tree[m[1]!]])] };
      },
    );
    const thread = await backend.thread('p1', { sort: 'top', maxComments: Infinity });
    expect(thread.gaps).toEqual([]);
    expect([...walk(thread.comments)].map((c) => c.id).sort()).toEqual([
      'a',
      'a1',
      'a2',
      't1',
      't2',
    ]);
    const focus = calls.filter((c) => /\/comments\/p1\/_\//.test(c.url));
    expect(focus.map((c) => new URL(c.url).pathname).sort()).toEqual([
      '/comments/p1/_/a.json',
      '/comments/p1/_/t1.json',
      '/comments/p1/_/t2.json',
    ]);
  });
});

describe('listing', () => {
  test('pages with `after` until the limit, skipping repeats', async () => {
    const page = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) =>
        postThing({ id: `q${from + i}`, name: `t3_q${from + i}` }),
      );
    const { backend, calls } = backendWith((u) => {
      if (u.pathname !== '/r/testsub/top.json') return undefined;
      const after = u.searchParams.get('after');
      if (!after) return { body: listing(page(0, 100), 't3_q99') };
      // Reddit's pages overlap now and then.
      return { body: listing(page(95, 100), 't3_q194') };
    });
    const out = [];
    for await (const item of backend.listing(
      { kind: 'subreddit', name: 'testsub', sort: 'top', time: 'week' },
      { limit: 150 },
    ))
      out.push(item);
    expect(out).toHaveLength(150);
    expect(new Set(out.map((i) => (i.kind === 'post' ? i.post.id : ''))).size).toBe(150);
    expect(new URL(calls[0]!.url).searchParams.get('t')).toBe('week');
    expect(calls).toHaveLength(2);
  });

  test('ends when Reddit has no more pages', async () => {
    const { backend, calls } = backendWith((u) =>
      u.pathname === '/user/someone/comments.json'
        ? { body: listing([comment('k', 't3_other')], null) }
        : undefined,
    );
    const out = [];
    for await (const item of backend.listing(
      { kind: 'user', name: 'someone', section: 'comments', sort: 'new', time: 'all' },
      { limit: 1000 },
    ))
      out.push(item);
    expect(out).toEqual([expect.objectContaining({ kind: 'comment' })]);
    expect(calls).toHaveLength(1);
  });

  test('search URLs', () => {
    const url = new URL(
      listingUrl(
        { kind: 'search', query: 'a b', subreddit: 'testsub', sort: 'new', time: 'year' },
        't3_z',
      ),
    );
    expect(url.pathname).toBe('/r/testsub/search.json');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      q: 'a b',
      restrict_sr: '1',
      sort: 'new',
      t: 'year',
      type: 'link',
      after: 't3_z',
      raw_json: '1',
    });
  });
});

describe('postFromJson', () => {
  test('a gallery keeps its order and captions, with original image URLs', () => {
    const post = postFromJson(
      postThing({
        is_self: false,
        is_gallery: true,
        gallery_data: {
          items: [{ media_id: 'm2', caption: 'second' }, { media_id: 'm1' }, { media_id: 'gone' }],
        },
        media_metadata: {
          m1: {
            status: 'valid',
            e: 'Image',
            m: 'image/png',
            s: { u: 'https://preview.redd.it/m1.png?width=10&s=abc', x: 10, y: 20 },
          },
          m2: {
            status: 'valid',
            e: 'AnimatedImage',
            s: {
              gif: 'https://i.redd.it/m2.gif',
              mp4: 'https://preview.redd.it/m2.gif?format=mp4',
            },
          },
          gone: { status: 'failed' },
        },
      }).data,
    );
    expect(post.media_type).toBe('gallery');
    expect(post.media).toEqual([
      {
        type: 'video',
        url: 'https://preview.redd.it/m2.gif?format=mp4',
        width: null,
        height: null,
        caption: 'second',
        duration: null,
        hls_url: null,
        dash_url: null,
      },
      {
        type: 'image',
        url: 'https://i.redd.it/m1.png',
        width: 10,
        height: 20,
        caption: null,
        duration: null,
        hls_url: null,
        dash_url: null,
      },
    ]);
  });

  test('a crosspost takes its media from the original', () => {
    const post = postFromJson(
      postThing({
        is_self: false,
        url: '/r/other/comments/orig/',
        crosspost_parent: 't3_orig',
        crosspost_parent_list: [
          {
            is_video: true,
            secure_media: {
              reddit_video: {
                fallback_url: 'https://v.redd.it/vid/DASH_720.mp4?source=fallback',
                width: 1280,
                height: 720,
              },
            },
          },
        ],
      }).data,
    );
    expect(post.media_type).toBe('video');
    expect(post.media[0]).toMatchObject({
      type: 'video',
      url: 'https://v.redd.it/vid/DASH_720.mp4',
    });
    expect(post.crosspost_parent).toBe('t3_orig');
  });

  test('removed and deleted posts', () => {
    expect(
      postFromJson(
        postThing({ removed_by_category: 'moderator', selftext: '[removed]' }).data as never,
      ).removal_status,
    ).toBe('removed');
    expect(
      postFromJson(postThing({ removed_by_category: 'deleted', author: '[deleted]' }).data as never)
        .removal_status,
    ).toBe('deleted');
    expect(postFromJson(postThing().data as never).removal_status).toBeNull();
    // "author": the author deleted it (was exported as removed).
    expect(
      postFromJson(
        postThing({ removed_by_category: 'author', selftext: '[deleted]' }).data as never,
      ).removal_status,
    ).toBe('deleted');
    expect(
      postFromJson(postThing({ removed_by_category: 'reddit' }).data as never).removal_status,
    ).toBe('removed');
  });

  test('a poll, with its options and votes', () => {
    const data = {
      total_vote_count: 120,
      voting_end_timestamp: Date.UTC(2026, 10, 20, 12),
      options: [
        { id: '11', text: 'Yes', vote_count: 80 },
        { id: '12', text: 'No' },
      ],
    };
    const now = Date.UTC(2026, 10, 21);
    const post = postFromJson(postThing({ poll_data: data }).data, now);
    expect(post.media_type).toBe('poll');
    expect(post.poll).toEqual({
      total_votes: 120,
      ends_at: '2026-11-20T12:00:00.000Z',
      is_closed: true,
      options: [
        { id: '11', text: 'Yes', votes: 80 },
        { id: '12', text: 'No', votes: null },
      ],
    });
    expect(postFromJson(postThing().data as never).poll).toBeNull();
  });

  test('a crosspost names the original, and a thumbnail comes from the preview', () => {
    const post = postFromJson(
      postThing({
        is_self: false,
        url: '/r/other/comments/orig/the_original/',
        crosspost_parent: 't3_orig',
        thumbnail: 'default',
        crosspost_parent_list: [
          {
            id: 'orig',
            title: 'The original',
            subreddit: 'other',
            permalink: '/r/other/comments/orig/the_original/',
            score: 900,
            num_comments: 41,
            created_utc: 1_793_000_000,
            preview: {
              images: [
                {
                  resolutions: [
                    { url: 'https://preview.redd.it/o.jpg?width=320&amp;s=a', width: 320 },
                    { url: 'https://preview.redd.it/o.jpg?width=640&amp;s=b', width: 640 },
                    { url: 'https://preview.redd.it/o.jpg?width=960&amp;s=c', width: 960 },
                  ],
                },
              ],
            },
          },
        ],
      }).data,
    );
    expect(post.url).toBe('https://www.reddit.com/r/other/comments/orig/the_original/');
    expect(post.crosspost).toEqual({
      name: 't3_orig',
      permalink: 'https://www.reddit.com/r/other/comments/orig/the_original/',
      subreddit: 'other',
      title: 'The original',
      score: 900,
      num_comments: 41,
      created_utc: '2026-10-26T07:33:20.000Z',
    });
    expect(post.thumbnail).toBe('https://preview.redd.it/o.jpg?width=640&s=b');
    // "self", "default" and the like are placeholders, not images.
    expect(postFromJson(postThing({ thumbnail: 'self' }).data as never).thumbnail).toBeNull();
    expect(postFromJson(postThing().data as never).crosspost).toBeNull();
  });

  test('a video keeps its length and its playlists', () => {
    const post = postFromJson(
      postThing({
        is_self: false,
        is_video: true,
        secure_media: {
          reddit_video: {
            fallback_url: 'https://v.redd.it/vid9/CMAF_720.mp4?source=fallback',
            hls_url: 'https://v.redd.it/vid9/HLSPlaylist.m3u8?a=1&amp;v=1&amp;f=sd',
            dash_url: 'https://v.redd.it/vid9/DASHPlaylist.mpd?a=1&amp;v=1&amp;f=sd',
            duration: 61,
            width: 1280,
            height: 720,
          },
        },
      }).data,
    );
    expect(post.media).toEqual([
      {
        type: 'video',
        url: 'https://v.redd.it/vid9/CMAF_720.mp4',
        width: 1280,
        height: 720,
        caption: null,
        duration: 61,
        hls_url: 'https://v.redd.it/vid9/HLSPlaylist.m3u8',
        dash_url: 'https://v.redd.it/vid9/DASHPlaylist.mpd',
      },
    ]);
  });

  test('a locked comment', () => {
    const raw = {
      id: 'c1',
      name: 't1_c1',
      link_id: 't3_p1',
      parent_id: 't3_p1',
      body: 'x',
      subreddit: 'testsub',
      permalink: '/r/testsub/comments/p1/x/c1/',
    };
    expect(commentFromJson({ ...raw, locked: true }, null).locked).toBe(true);
    expect(commentFromJson(raw, null).locked).toBeNull();
  });
});
