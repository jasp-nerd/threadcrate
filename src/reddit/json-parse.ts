// Reddit's JSON API answers (`t3` posts, `t1` comments) as our model. Pure
// functions, no requests: json-api.ts makes those.

import { mediaFromJson, thumbnailFromJson, type JsonPostMedia } from './media';
import {
  absolute,
  isoFromUnix,
  removalStatus,
  type CrosspostParent,
  type Poll,
  type Post,
  type RemovalStatus,
} from './model';
import type { RawComment } from './tree';

export interface Thing<T = Record<string, unknown>> {
  kind: string;
  data: T;
}

export interface Listing {
  kind: 'Listing';
  data: { after: string | null; children: Thing[] };
}

export interface JsonPost extends JsonPostMedia {
  id: string;
  name: string;
  subreddit: string;
  subreddit_id?: string;
  author?: string;
  author_fullname?: string;
  title: string;
  selftext?: string;
  selftext_html?: string | null;
  domain?: string;
  permalink: string;
  created_utc?: number;
  edited?: number | boolean;
  score?: number;
  upvote_ratio?: number;
  num_comments?: number;
  link_flair_text?: string | null;
  author_flair_text?: string | null;
  over_18?: boolean;
  spoiler?: boolean;
  locked?: boolean;
  stickied?: boolean;
  archived?: boolean;
  distinguished?: string | null;
  removed_by_category?: string | null;
  crosspost_parent?: string;
  poll_data?: JsonPoll | null;
  crosspost_parent_list?: (JsonPostMedia & Partial<JsonPost>)[];
}

interface JsonPoll {
  total_vote_count?: number;
  /** Milliseconds since the epoch. */
  voting_end_timestamp?: number;
  options?: { id?: string; text?: string; vote_count?: number }[];
}

export interface JsonComment {
  id: string;
  name: string;
  link_id: string;
  link_title?: string;
  parent_id: string;
  author?: string;
  author_fullname?: string;
  is_submitter?: boolean;
  body?: string;
  body_html?: string | null;
  score?: number;
  score_hidden?: boolean;
  controversiality?: number;
  created_utc?: number;
  edited?: number | boolean;
  distinguished?: string | null;
  stickied?: boolean;
  locked?: boolean;
  subreddit: string;
  permalink: string;
  replies?: Listing | '';
}

export interface JsonMore {
  id: string;
  name?: string;
  parent_id: string;
  count: number;
  children: string[];
}

function editedIso(edited: number | boolean | undefined): string | null {
  return typeof edited === 'number' ? isoFromUnix(edited) : null;
}

/**
 * Reddit's removed_by_category: "deleted" and "author" mean the author deleted it;
 * the others ("moderator", "reddit", "automod_filtered", "anti_evil_ops", …) that
 * someone else removed it.
 */
function removalFromCategory(category: string): RemovalStatus {
  return category === 'deleted' || category === 'author' ? 'deleted' : 'removed';
}

function pollFromJson(p: JsonPoll | null | undefined, now: number): Poll | null {
  if (!p) return null;
  const ends = typeof p.voting_end_timestamp === 'number' ? p.voting_end_timestamp : null;
  return {
    total_votes: p.total_vote_count ?? null,
    ends_at: ends === null ? null : new Date(ends).toISOString(),
    is_closed: ends === null ? null : ends <= now,
    options: (p.options ?? []).map((o) => ({
      id: o.id ?? null,
      text: o.text ?? '',
      votes: o.vote_count ?? null,
    })),
  };
}

function crosspostFromJson(d: JsonPost): CrosspostParent | null {
  if (!d.crosspost_parent) return null;
  const p = d.crosspost_parent_list?.[0];
  return {
    name: d.crosspost_parent,
    permalink: absolute(p?.permalink ?? `/comments/${d.crosspost_parent.replace(/^t3_/, '')}/`),
    subreddit: p?.subreddit ?? null,
    title: p?.title ?? null,
    score: p?.score ?? null,
    num_comments: p?.num_comments ?? null,
    created_utc: isoFromUnix(p?.created_utc),
  };
}

export function postFromJson(d: JsonPost, now = Date.now()): Post {
  const media = mediaFromJson(d);
  const author = d.author ?? null;
  const selftext = d.selftext ?? '';
  return {
    kind: 'post',
    id: d.id,
    name: d.name ?? `t3_${d.id}`,
    subreddit: d.subreddit,
    subreddit_id: d.subreddit_id ?? null,
    author,
    author_fullname: d.author_fullname ?? null,
    title: d.title,
    selftext,
    selftext_html: d.selftext_html ?? null,
    // Crossposts point at the original with a site-relative path.
    url: absolute(d.url_overridden_by_dest ?? d.url ?? d.permalink),
    domain: d.domain ?? null,
    permalink: absolute(d.permalink),
    created_utc: isoFromUnix(d.created_utc),
    created_unix: d.created_utc ?? null,
    edited_utc: editedIso(d.edited),
    score: d.score ?? null,
    upvote_ratio: d.upvote_ratio ?? null,
    num_comments: d.num_comments ?? null,
    link_flair_text: d.link_flair_text ?? null,
    author_flair_text: d.author_flair_text ?? null,
    over_18: d.over_18 ?? null,
    spoiler: d.spoiler ?? null,
    locked: d.locked ?? null,
    stickied: d.stickied ?? null,
    archived: d.archived ?? null,
    is_self: d.is_self ?? null,
    distinguished: d.distinguished ?? null,
    removal_status: d.removed_by_category
      ? removalFromCategory(d.removed_by_category)
      : removalStatus(author, selftext),
    media_type: media.media_type,
    media: media.media,
    thumbnail: thumbnailFromJson(d),
    poll: pollFromJson(d.poll_data ?? d.crosspost_parent_list?.[0]?.poll_data, now),
    crosspost_parent: d.crosspost_parent ?? null,
    crosspost: crosspostFromJson(d),
  };
}

export function commentFromJson(d: JsonComment, linkTitle: string | null): RawComment {
  const author = d.author ?? null;
  const body = d.body ?? '';
  return {
    kind: 'comment',
    id: d.id,
    name: d.name ?? `t1_${d.id}`,
    link_id: d.link_id,
    link_title: d.link_title ?? linkTitle,
    parent_id: d.parent_id,
    author,
    author_fullname: d.author_fullname ?? null,
    is_submitter: d.is_submitter ?? null,
    body,
    body_html: d.body_html ?? null,
    score: d.score ?? null,
    score_hidden: d.score_hidden ?? null,
    controversiality: d.controversiality ?? null,
    created_utc: isoFromUnix(d.created_utc),
    created_unix: d.created_utc ?? null,
    edited_utc: editedIso(d.edited),
    distinguished: d.distinguished ?? null,
    stickied: d.stickied ?? null,
    locked: d.locked ?? null,
    removal_status: removalStatus(author, body),
    subreddit: d.subreddit,
    permalink: absolute(d.permalink),
  };
}
