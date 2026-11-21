import { expect, test } from 'vitest';
import type { ExportResult } from '../engine/result';
import { DEFAULT_OPTIONS } from '../engine/options';
import type { Comment } from '../reddit/model';
import { parseCsv } from '../../tests/support/export-checks';
import { makePost } from '../../tests/support/model';
import { archiveName, buildPackage } from './package';

const post = makePost({ title: 'What is: the "best" way?' });

function comment(
  id: string,
  parent: string,
  depth: number,
  path: string,
  replies: Comment[] = [],
): Comment {
  return {
    kind: 'comment',
    id,
    name: `t1_${id}`,
    link_id: 't3_p1',
    link_title: post.title,
    parent_id: parent,
    root_comment_id: path.split('/')[0]!,
    depth,
    path,
    author: 'someone',
    author_fullname: null,
    is_submitter: false,
    body: id === 'b' ? '=cmd|calc' : `body ${id}`,
    body_html: null,
    score: 1,
    score_hidden: null,
    controversiality: null,
    created_utc: null,
    created_unix: null,
    edited_utc: null,
    distinguished: null,
    stickied: null,
    locked: null,
    removal_status: null,
    subreddit: 'testsub',
    permalink: `https://www.reddit.com/r/testsub/comments/p1/x/${id}/`,
    replies,
  };
}

function result(overrides: Partial<ExportResult> = {}): ExportResult {
  return {
    options: { ...DEFAULT_OPTIONS, target: { kind: 'post', id: 'p1', subreddit: 'testsub' } },
    backend: 'html',
    startedAt: '2026-11-15T09:00:00.000Z',
    finishedAt: '2026-11-15T09:01:00.000Z',
    status: 'complete',
    error: null,
    errorKind: null,
    errorUrl: null,
    threads: [
      {
        post,
        comments: [comment('a', 't3_p1', 0, 'a', [comment('b', 't1_a', 1, 'a/b')])],
        comment_count: 2,
        gaps: [],
      },
    ],
    posts: [],
    standaloneComments: [],
    postFailures: [],
    media: [
      {
        path: 'media/testsub_p1_1.jpg',
        data: new Uint8Array([1, 2, 3]),
        source: 'https://i.redd.it/x.jpg',
      },
    ],
    mediaFailures: [],
    requests: 4,
    throttles: 0,
    diagnostics: [],
    ...overrides,
  };
}

const tool = { name: 'Reddit Export', version: '1.2.3', homepage: 'https://example.org' };

test('the layout of an export (scripts rely on these names)', () => {
  const files = buildPackage(
    result({ requestsByKind: { 'post pages': 1, 'more replies': 2 } }),
    tool,
    'https://www.reddit.com/r/testsub/comments/p1/x/',
  );
  expect(files.map((f) => f.path)).toEqual([
    'README.txt',
    'manifest.json',
    'data.json',
    'posts.csv',
    'comments.csv',
    'threads/testsub_p1_what-is-the-best-way.md',
    'media/testsub_p1_1.jpg',
  ]);
  const data = JSON.parse(files.find((f) => f.path === 'data.json')!.data as string);
  expect(data.posts[0]).toMatchObject({ id: 'p1', comments_loaded: true, comment_count: 2 });
  expect(data.posts[0].comments[0].replies[0].id).toBe('b');

  const manifest = JSON.parse(files.find((f) => f.path === 'manifest.json')!.data as string);
  expect(manifest).toMatchObject({
    status: 'complete',
    counts: { posts: 1, comments: 2, media_files: 1 },
    incomplete: { comments_reported_but_not_exported: 1 },
    requests_by_kind: { 'post pages': 1, 'more replies': 2 },
    tool,
  });

  // The CSV columns, in order: a contract, like the file names.
  const postColumns =
    'id subreddit author title selftext url permalink created_utc created_unix edited_utc score upvote_ratio num_comments comments_exported link_flair_text author_flair_text media_type media_urls over_18 spoiler locked stickied archived is_self distinguished removal_status domain crosspost_parent name subreddit_id author_fullname';
  const commentColumns =
    'id link_id link_title parent_id root_comment_id depth path author is_submitter body score created_utc created_unix edited_utc distinguished stickied removal_status controversiality score_hidden subreddit permalink name author_fullname';
  const csv = (name: string) => parseCsv(files.find((f) => f.path === name)!.data as string);
  expect(csv('posts.csv')[0]).toEqual(postColumns.split(' '));
  const rows = csv('comments.csv');
  expect(rows[0]).toEqual(commentColumns.split(' '));
  expect(rows.slice(1).map((r) => [r[0], r[3], r[5], r[6], r[9]])).toEqual([
    ['a', 't3_p1', '0', 'a', 'body a'],
    ['b', 't1_a', '1', 'a/b', "'=cmd|calc"],
  ]);
});

test('the JSON keys added in 0.1.0: thumbnail, poll, crosspost, comment locked, media links', () => {
  const p = makePost({
    thumbnail: 'https://preview.redd.it/t.jpg',
    poll: {
      total_votes: 3,
      ends_at: null,
      is_closed: true,
      options: [{ id: null, text: 'yes', votes: 3 }],
    },
    crosspost_parent: 't3_orig',
    crosspost: {
      name: 't3_orig',
      permalink: 'https://www.reddit.com/r/o/comments/orig/x/',
      subreddit: 'o',
      title: 'Original',
      score: 1,
      num_comments: 2,
      created_utc: null,
    },
    media: [
      {
        type: 'video',
        url: 'https://packaged-media.redd.it/v/pb/m2-res_720p.mp4?e=1&s=x',
        width: 720,
        height: 1280,
        caption: null,
        duration: 12,
        hls_url: 'https://v.redd.it/v/HLSPlaylist.m3u8',
        dash_url: 'https://v.redd.it/v/DASHPlaylist.mpd',
      },
    ],
  });
  const r = result();
  r.threads = [{ ...r.threads[0]!, post: p }];
  const data = JSON.parse(
    buildPackage(r, tool, '').find((f) => f.path === 'data.json')!.data as string,
  );
  const out = data.posts[0];
  expect(Object.keys(out)).toEqual(expect.arrayContaining(['thumbnail', 'poll', 'crosspost']));
  expect(out.poll.options[0]).toEqual({ id: null, text: 'yes', votes: 3 });
  expect(out.crosspost.name).toBe('t3_orig');
  expect(Object.keys(out.media[0])).toEqual([
    'type',
    'url',
    'width',
    'height',
    'caption',
    'duration',
    'hls_url',
    'dash_url',
  ]);
  expect(out.comments[0]).toHaveProperty('locked', null);
  // The CSV files are unchanged: the new data is in data.json only.
  const header = parseCsv(
    buildPackage(r, tool, '').find((f) => f.path === 'posts.csv')!.data as string,
  )[0];
  expect(header).not.toContain('thumbnail');
});

test('formats that are turned off are left out', () => {
  const r = result();
  r.options = { ...r.options, formats: { json: false, csv: true, markdown: false } };
  expect(buildPackage(r, tool, '').map((f) => f.path)).toEqual([
    'README.txt',
    'manifest.json',
    'posts.csv',
    'comments.csv',
    'media/testsub_p1_1.jpg',
  ]);
});

test('archive names', () => {
  const when = new Date(2026, 10, 15, 18, 30);
  expect(archiveName({ kind: 'post', id: 'p1', subreddit: 'testsub' }, when, post)).toBe(
    'reddit_testsub_p1_what-is-the-best-way_2026-11-15_1830',
  );
  expect(archiveName({ kind: 'subreddit', name: 'pics', sort: 'top', time: 'week' }, when)).toBe(
    'reddit_r-pics_top-week_2026-11-15_1830',
  );
  expect(
    archiveName(
      {
        kind: 'search',
        query: 'Rome & Carthage?',
        subreddit: null,
        sort: 'relevance',
        time: 'all',
      },
      when,
    ),
  ).toBe('reddit_search-rome-carthage_2026-11-15_1830');
});

test('a thread thousands of replies deep still saves', () => {
  let node = comment('d0', 't3_p1', 0, 'd0');
  const root = node;
  let path = 'd0';
  for (let i = 1; i < 6000; i++) {
    path = `${path}/d${i}`;
    const next = comment(`d${i}`, `t1_d${i - 1}`, i, path);
    node.replies.push(next);
    node = next;
  }
  const r = result({ threads: [{ post, comments: [root], comment_count: 6000, gaps: [] }] });
  const data = buildPackage(r, tool, '').find((f) => f.path === 'data.json')!.data as string;
  const parsed = JSON.parse(data) as {
    posts: { comments_flat: boolean; comments: { path: string }[] }[];
  };
  expect(parsed.posts[0]!.comments_flat).toBe(true);
  expect(parsed.posts[0]!.comments).toHaveLength(6000);
  expect(parsed.posts[0]!.comments[5999]!.path.split('/')).toHaveLength(6000);
});
