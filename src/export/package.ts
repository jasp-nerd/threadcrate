// The files an export produces. The layout is the same for every kind of page:
//
//   README.txt         what each file is
//   manifest.json      what was exported, how, and what's missing
//   data.json          everything: posts with their comment trees nested
//   posts.csv          one row per post
//   comments.csv       one row per comment, with parent_id / depth / path
//   threads/*.md       one readable Markdown file per post with comments
//   media/*            images and videos, when asked for
//
// These names are a public contract: scripts read them.

import type { ExportResult } from '../engine/result';
import { countComments, walk, type Comment, type Post, type Thread } from '../reddit/model';
import { describeTarget, sortLabel, type Target } from '../reddit/target';
import { commentsCsv, postsCsv } from './csv';
import { safeName, slug, stamp, uniquePaths } from './filenames';
import { threadMarkdown } from './thread-markdown';

export interface PackageFile {
  path: string;
  data: string | Uint8Array;
  lastModified?: Date;
}

export interface ToolInfo {
  name: string;
  version: string;
  homepage: string;
}

export function archiveName(target: Target, when: Date, firstPost?: Post): string {
  const s = stamp(when);
  switch (target.kind) {
    case 'post': {
      const sub = firstPost?.subreddit ?? target.subreddit ?? 'reddit';
      const title = firstPost ? `_${slug(firstPost.title, 40)}` : '';
      // A share link's post id is known only once the export followed it.
      return safeName(`reddit_${sub}_${firstPost?.id ?? target.id}${title}_${s}`, 120);
    }
    case 'subreddit': {
      const sort =
        target.sort === 'top' || target.sort === 'controversial'
          ? `${target.sort}-${target.time}`
          : target.sort;
      return safeName(`reddit_r-${target.name}_${sort}_${s}`, 120);
    }
    case 'user':
      return safeName(`reddit_u-${target.name}_${target.section}_${s}`, 120);
    case 'search':
      return safeName(
        `reddit_search-${slug(target.query, 30)}${target.subreddit ? `_r-${target.subreddit}` : ''}_${s}`,
        120,
      );
  }
}

function threadFileName(t: Thread): string {
  return `threads/${safeName(t.post.subreddit || 'reddit', 40)}_${safeName(t.post.id, 16)}_${slug(t.post.title, 50)}.md`;
}

function manifest(result: ExportResult, tool: ToolInfo, sourceUrl: string) {
  const { options } = result;
  const gaps = result.threads.flatMap((t) => t.gaps.map((g) => ({ post_id: t.post.id, ...g })));
  const missing = result.threads.reduce((n, t) => {
    const expected = t.post.num_comments;
    return n + (expected !== null && expected > t.comment_count ? expected - t.comment_count : 0);
  }, 0);
  const target = options.target;
  return {
    tool,
    source: {
      url: sourceUrl,
      description: describeTarget(target),
      target,
      ...(target.kind === 'subreddit' ? { sort: sortLabel(target.sort, target.time) } : {}),
    },
    status: result.status,
    error: result.error,
    failed_request: result.errorUrl,
    started_at: result.startedAt,
    finished_at: result.finishedAt,
    data_source:
      result.backend === 'json'
        ? "Reddit's JSON API (logged in)"
        : result.backend === 'html'
          ? "Reddit's web pages"
          : null,
    options: {
      max_posts: target.kind === 'post' ? null : options.maxPosts,
      include_comments: target.kind === 'post' ? true : options.includeComments,
      comment_sort: options.commentSort,
      max_comments_per_post: Number.isFinite(options.maxComments) ? options.maxComments : null,
      include_media: options.includeMedia,
      formats: options.formats,
    },
    counts: {
      posts: result.threads.length + result.posts.length,
      posts_with_comments: result.threads.length,
      comments: result.threads.reduce((n, t) => n + t.comment_count, 0),
      standalone_comments: result.standaloneComments.length,
      media_files: result.media.length,
    },
    incomplete: {
      /**
       * Reddit's comment counts include removed and deleted comments it no longer
       * shows anyone, so a small difference is normal.
       */
      comments_reported_but_not_exported: missing,
      comment_gaps: gaps,
      post_failures: result.postFailures,
      media_failures: result.mediaFailures,
    },
    notes: [
      ...(target.kind !== 'post'
        ? ['Reddit lists at most about 1000 posts for any one sort of a subreddit, user or search.']
        : []),
      ...(result.media.some((m) => m.path.includes('_video'))
        ? [
            'Reddit videos come as a silent video file and a separate _audio file. Play them together, or merge them with: ffmpeg -i x_video.mp4 -i x_audio.mp4 -c copy x.mp4',
          ]
        : []),
    ],
    requests: result.requests,
    // Where the requests went: post pages, "more comments", the API… (none for media).
    requests_by_kind: result.requestsByKind ?? {},
    rate_limit_waits: result.throttles,
  };
}

function readme(result: ExportResult, tool: ToolInfo): string {
  const f = result.options.formats;
  const lines = [
    `Reddit export made with ${tool.name} ${tool.version} (${tool.homepage})`,
    '',
    describeTarget(result.options.target),
    `Exported ${result.finishedAt.slice(0, 16).replace('T', ' ')} UTC`,
    '',
    result.status === 'complete'
      ? 'Status: complete.'
      : `Status: ${result.status} early. ${result.error ?? ''} Everything collected until then is included.`,
    '',
    'Files',
    '  manifest.json   what was exported, the settings, and anything missing',
  ];
  if (f.json)
    lines.push('  data.json       everything, with comment trees nested under their posts');
  if (f.csv)
    lines.push(
      '  posts.csv       one row per post (opens in Excel, Numbers, Google Sheets)',
      '  comments.csv    one row per comment; parent_id, depth and path rebuild the tree',
    );
  if (f.markdown) lines.push('  threads/        each post with its comments, as readable Markdown');
  if (result.media.length) lines.push('  media/          images and videos from the posts');
  lines.push(
    '',
    'Times are UTC. Comments Reddit removed or deleted are kept as rows reading [removed] or [deleted].',
    'Text that starts with = + - or @ in the CSV files has an apostrophe in front, so spreadsheets never run it as a formula.',
    '',
  );
  return lines.join('\r\n');
}

/** Deeper than this, indenting data.json would make it huge (it grows with depth squared). */
const INDENT_DEPTH = 100;

/**
 * data.json as text. Very deep threads (counting threads go thousands of replies
 * deep) are written without indentation; if even that is too deep for
 * JSON.stringify, every comment is written flat, with parent_id and path to
 * rebuild the tree, and `comments_flat: true` on the post.
 */
function dataJson(data: { posts: { comments: Comment[] }[] }, threads: Thread[]): string {
  let depth = 0;
  for (const t of threads) for (const c of walk(t.comments)) depth = Math.max(depth, c.depth);
  try {
    return `${JSON.stringify(data, null, depth > INDENT_DEPTH ? undefined : 2)}\n`;
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    const flat = {
      ...data,
      posts: data.posts.map((p) => ({
        ...p,
        comments_flat: true,
        comments: [...walk(p.comments)].map((c) => ({ ...c, replies: [] })),
      })),
    };
    return `${JSON.stringify(flat)}\n`;
  }
}

export function buildPackage(
  result: ExportResult,
  tool: ToolInfo,
  sourceUrl: string,
): PackageFile[] {
  const files: PackageFile[] = [];
  const unique = uniquePaths();
  const add = (path: string, data: string | Uint8Array) => files.push({ path: unique(path), data });
  const f = result.options.formats;

  add('README.txt', readme(result, tool));
  add('manifest.json', `${JSON.stringify(manifest(result, tool, sourceUrl), null, 2)}\n`);

  if (f.json) {
    const data = {
      posts: [
        ...result.threads.map((t) => ({
          ...t.post,
          comments_loaded: true,
          comment_count: countComments(t.comments),
          gaps: t.gaps,
          comments: t.comments,
        })),
        ...result.posts.map((p) => ({
          ...p,
          comments_loaded: false,
          comment_count: null,
          gaps: [],
          comments: [],
        })),
      ],
      comments: result.standaloneComments,
    };
    add('data.json', dataJson(data, result.threads));
  }
  if (f.csv) {
    if (result.threads.length || result.posts.length) {
      add(
        'posts.csv',
        postsCsv([
          ...result.threads.map((t) => ({ post: t.post, commentsExported: t.comment_count })),
          ...result.posts.map((p) => ({ post: p, commentsExported: null })),
        ]),
      );
    }
    if (result.threads.length || result.standaloneComments.length) {
      add('comments.csv', commentsCsv(result.threads, result.standaloneComments));
    }
  }
  if (f.markdown) {
    for (const t of result.threads) add(threadFileName(t), threadMarkdown(t));
  }
  for (const m of result.media) add(m.path, m.data);
  return files;
}
