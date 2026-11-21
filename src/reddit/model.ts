// The normalized shape of everything we export. Field names follow Reddit's own
// API (snake_case), so exports join cleanly with PRAW scripts and archive
// datasets. Every record has the same keys whichever backend produced it: a field
// a backend can't see is null, never missing.

export type RemovalStatus = 'deleted' | 'removed' | null;

export type MediaType = 'text' | 'image' | 'gallery' | 'video' | 'link' | 'poll' | 'other';

export interface MediaItem {
  type: 'image' | 'video' | 'audio' | 'gif';
  url: string;
  width: number | null;
  height: number | null;
  caption: string | null;
  /** Seconds, for videos. */
  duration: number | null;
  /**
   * A v.redd.it video's HLS and DASH playlists. Unlike the packaged MP4 links (signed,
   * they stop working after a few days), these stay valid as long as the video does.
   */
  hls_url: string | null;
  dash_url: string | null;
}

export interface PollOption {
  /** Reddit's id for the option, when it shows one (open polls). */
  id: string | null;
  text: string;
  /** Votes for this option, when Reddit shows them (closed polls). */
  votes: number | null;
}

export interface Poll {
  total_votes: number | null;
  /** When voting ends, for open polls. ISO 8601, UTC. */
  ends_at: string | null;
  /** Null when it can't be told. */
  is_closed: boolean | null;
  options: PollOption[];
}

/** The original post of a crosspost, as far as the crosspost shows it. */
export interface CrosspostParent {
  /** Fullname, "t3_...". */
  name: string;
  permalink: string;
  subreddit: string | null;
  title: string | null;
  score: number | null;
  num_comments: number | null;
  created_utc: string | null;
}

/** A media item with the fields only some kinds have left empty. */
export function mediaItem(
  type: MediaItem['type'],
  url: string,
  more: Partial<Omit<MediaItem, 'type' | 'url'>> = {},
): MediaItem {
  return {
    type,
    url,
    width: more.width ?? null,
    height: more.height ?? null,
    caption: more.caption ?? null,
    duration: more.duration ?? null,
    hls_url: more.hls_url ?? null,
    dash_url: more.dash_url ?? null,
  };
}

export interface Post {
  kind: 'post';
  /** Base-36 id, e.g. "1xtigbb". */
  id: string;
  /** Fullname, e.g. "t3_1xtigbb". */
  name: string;
  subreddit: string;
  subreddit_id: string | null;
  author: string | null;
  author_fullname: string | null;
  title: string;
  /** Markdown. Empty for link and media posts. */
  selftext: string;
  selftext_html: string | null;
  /** Where the post points: itself for text posts, the link or media otherwise. */
  url: string;
  domain: string | null;
  /** Absolute https://www.reddit.com/... URL. */
  permalink: string;
  /** ISO 8601, UTC. */
  created_utc: string | null;
  /** Unix seconds, for sorting and spreadsheets. */
  created_unix: number | null;
  edited_utc: string | null;
  score: number | null;
  upvote_ratio: number | null;
  num_comments: number | null;
  link_flair_text: string | null;
  author_flair_text: string | null;
  over_18: boolean | null;
  spoiler: boolean | null;
  locked: boolean | null;
  stickied: boolean | null;
  archived: boolean | null;
  is_self: boolean | null;
  distinguished: string | null;
  removal_status: RemovalStatus;
  media_type: MediaType;
  media: MediaItem[];
  /** A small preview image Reddit shows for the post (link previews, video posters). */
  thumbnail: string | null;
  /** For poll posts: the options, and the votes when Reddit shows them. */
  poll: Poll | null;
  /** Fullname of the original post when this is a crosspost. */
  crosspost_parent: string | null;
  /** What a crosspost shows of the original post. */
  crosspost: CrosspostParent | null;
}

export interface Comment {
  kind: 'comment';
  id: string;
  name: string;
  /** Fullname of the post, "t3_...". */
  link_id: string;
  /** Title of the post, so a comments spreadsheet reads on its own. */
  link_title: string | null;
  /** Fullname of the parent: the post ("t3_...") for top-level comments. */
  parent_id: string;
  /** Id of the top-level comment this one hangs under (its own id when top-level). */
  root_comment_id: string;
  /** 0 for top-level comments. Computed from the tree, never taken from Reddit. */
  depth: number;
  /** Ids from the top-level comment down to this one, joined by "/". */
  path: string;
  author: string | null;
  author_fullname: string | null;
  is_submitter: boolean | null;
  /** Markdown. "[deleted]" or "[removed]" when Reddit no longer shows it. */
  body: string;
  body_html: string | null;
  score: number | null;
  score_hidden: boolean | null;
  controversiality: number | null;
  created_utc: string | null;
  created_unix: number | null;
  edited_utc: string | null;
  distinguished: string | null;
  stickied: boolean | null;
  /** Replies are closed (a moderator locked the comment). */
  locked: boolean | null;
  removal_status: RemovalStatus;
  subreddit: string;
  permalink: string;
  replies: Comment[];
}

/** Comments Reddit reported but the export couldn't load. */
export interface Gap {
  parent_id: string;
  /** How many comments Reddit said were there, when it said. */
  count: number | null;
  reason: string;
}

export interface Thread {
  post: Post;
  /** Top-level comments with their replies nested. */
  comments: Comment[];
  /** Number of comments in `comments`, all levels. */
  comment_count: number;
  gaps: Gap[];
}

export const REDDIT = 'https://www.reddit.com';

/** A Reddit link made absolute: site-relative paths get https://www.reddit.com in front. */
export function absolute(link: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(link)) return link;
  if (link.startsWith('//')) return `https:${link}`;
  return REDDIT + (link.startsWith('/') ? link : `/${link}`);
}

export function isoFromUnix(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

/** "2026-11-15T08:48:17.197000+0000" (Reddit's web format) to an ISO string. */
export function isoFromRedditTime(value: string | null | undefined): string | null {
  if (!value) return null;
  // JavaScript's Date wants milliseconds and a colon in the offset.
  const normalized = value.replace(/(\.\d{3})\d+/, '$1').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export function unixFromIso(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/** Walks a comment tree depth-first in display order (iteratively: threads can be very deep). */
export function* walk(comments: Comment[]): Generator<Comment> {
  const stack: Comment[] = [...comments].reverse();
  while (stack.length) {
    const c = stack.pop()!;
    yield c;
    for (let i = c.replies.length - 1; i >= 0; i--) stack.push(c.replies[i]!);
  }
}

export function countComments(comments: Comment[]): number {
  let n = 0;
  for (const _ of walk(comments)) n++;
  return n;
}

export function removalStatus(author: string | null, body: string): RemovalStatus {
  if (body === '[removed]') return 'removed';
  if (body === '[deleted]' && (author === null || author === '[deleted]')) return 'deleted';
  return null;
}
