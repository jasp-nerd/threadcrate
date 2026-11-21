// CSV that opens correctly in Excel, Numbers, Google Sheets and pandas:
// UTF-8 with a byte-order mark (Excel needs it for non-ASCII text), CRLF line
// ends, and RFC 4180 quoting. Text starting with = + - @ or a tab is prefixed
// with an apostrophe so a spreadsheet never runs it as a formula (OWASP's advice
// for CSV injection): Reddit comments are written by strangers.

import { walk, type Comment, type Post, type Thread } from '../reddit/model';
import type { RawComment } from '../reddit/tree';

export type Cell = string | number | boolean | null | undefined;

// Also after leading spaces, and the full-width forms some spreadsheets accept.
const FORMULA_START = /^[\s\u3000]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]|^[\t\r]/;

export function csvCell(value: Cell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  let text = value;
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: Iterable<readonly Cell[]>): string {
  const lines = [header.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

const POST_COLUMNS = [
  'id',
  'subreddit',
  'author',
  'title',
  'selftext',
  'url',
  'permalink',
  'created_utc',
  'created_unix',
  'edited_utc',
  'score',
  'upvote_ratio',
  'num_comments',
  'comments_exported',
  'link_flair_text',
  'author_flair_text',
  'media_type',
  'media_urls',
  'over_18',
  'spoiler',
  'locked',
  'stickied',
  'archived',
  'is_self',
  'distinguished',
  'removal_status',
  'domain',
  'crosspost_parent',
  'name',
  'subreddit_id',
  'author_fullname',
] as const;

function postRow(post: Post, commentsExported: number | null): Cell[] {
  const values: Record<(typeof POST_COLUMNS)[number], Cell> = {
    ...post,
    media_urls: post.media.map((m) => m.url).join(' '),
    comments_exported: commentsExported,
  };
  return POST_COLUMNS.map((c) => values[c]);
}

const COMMENT_COLUMNS = [
  'id',
  'link_id',
  'link_title',
  'parent_id',
  'root_comment_id',
  'depth',
  'path',
  'author',
  'is_submitter',
  'body',
  'score',
  'created_utc',
  'created_unix',
  'edited_utc',
  'distinguished',
  'stickied',
  'removal_status',
  'controversiality',
  'score_hidden',
  'subreddit',
  'permalink',
  'name',
  'author_fullname',
] as const;

function commentRow(c: Comment | RawComment): Cell[] {
  const full = c as Partial<Comment> & RawComment;
  const values: Record<(typeof COMMENT_COLUMNS)[number], Cell> = {
    ...full,
    root_comment_id: full.root_comment_id ?? null,
    depth: full.depth ?? null,
    path: full.path ?? null,
  };
  return COMMENT_COLUMNS.map((col) => values[col]);
}

export function postsCsv(posts: { post: Post; commentsExported: number | null }[]): string {
  return toCsv(
    POST_COLUMNS,
    posts.map((p) => postRow(p.post, p.commentsExported)),
  );
}

/** Every comment of every thread, in reading order, then comments listed on their own. */
export function commentsCsv(threads: Thread[], standalone: RawComment[] = []): string {
  function* rows() {
    for (const t of threads) for (const c of walk(t.comments)) yield commentRow(c);
    for (const c of standalone) yield commentRow(c);
  }
  return toCsv(COMMENT_COLUMNS, rows());
}
