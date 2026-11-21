// What Reddit's web pages say, as our model: pure functions of a parsed page, no
// requests (html-api.ts makes those). When Reddit changes its markup, this is the
// file to update.
//
// What we rely on (seen on reddit.com in November 2026):
//  - Each post is a <shreddit-post> with its data in attributes.
//  - A post page holds the post and the first comments as <shreddit-comment> elements,
//    streamed inside <template> chunks that the page's scripts move into place.
//  - "More replies" buttons are <faceplate-partial> elements with a cursor; below a
//    fixed depth a "continue this thread" link goes to the comment's own page instead,
//    and the same "more replies" request is built for it (repliesRequest).
//  - Attributes over words: the page is in the person's own Reddit language, so
//    counts come from faceplate-number[number], times from faceplate-timeago[ts], and
//    what only words say (removal reasons, crosspost counts) is read in English only,
//    left unknown otherwise.
//  - Comment bodies are in #<t1_id>-comment-rtjson-content, post bodies in
//    #<t3_id>-post-rtjson-content, as rendered HTML.
// Structure comes from the comments' own attributes (thingid, parentid), never from
// where an element sits in the page, so streamed chunks can arrive in any order.

import { COMMUNITY_NOT_FOUND } from './errors';
import { htmlToMarkdown } from './markdown';
import { isDirectImage, originalImageUrl, vredditId, vredditStreams } from './media';
import {
  absolute,
  isoFromRedditTime,
  mediaItem,
  REDDIT,
  removalStatus,
  unixFromIso,
  type CrosspostParent,
  type MediaItem,
  type MediaType,
  type Poll,
  type PollOption,
  type Post,
  type RemovalStatus,
} from './model';
import type { RawComment } from './tree';

export type ParseHtml = (html: string) => Document;

export const defaultParse: ParseHtml = (html) => new DOMParser().parseFromString(html, 'text/html');

export const POST_FULLNAME = /^t3_[a-z0-9]{1,12}$/i;
const COMMENT_FULLNAME = /^t1_[a-z0-9]{1,16}$/i;
const POST_PAGE_PATH = /^\/r\/[^/]+\/comments\/[a-z0-9]+\//i;

/**
 * A link from Reddit's markup, made absolute and kept only when it points where
 * we expect on www.reddit.com: the extension sends cookies with these requests.
 */
export function redditUrl(href: string, path: RegExp): string | null {
  try {
    const u = new URL(href, REDDIT);
    return u.origin === REDDIT && path.test(u.pathname) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Parses a page and moves streamed <template> chunks into the document so selectors see them. */
export function parsePage(html: string, parse: ParseHtml = defaultParse): Document {
  const doc = parse(html);
  for (let t = doc.querySelector('template'); t; t = doc.querySelector('template')) {
    t.replaceWith(t.content);
  }
  return doc;
}

function attr(el: Element | null | undefined, name: string): string | null {
  const v = el?.getAttribute(name);
  return v === null || v === undefined || v === '' ? null : v;
}

function num(el: Element | null | undefined, name: string): number | null {
  const v = attr(el, name);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function has(el: Element, ...names: string[]): boolean {
  return names.some((n) => el.hasAttribute(n));
}

/** Whitespace-collapsed text of an element, or null when empty. */
function text(el: Element | null | undefined): string | null {
  const t = el?.textContent?.replace(/\s+/g, ' ').trim();
  return t ? t : null;
}

/** An https:// address from an attribute (image sources, posters), else null. */
function httpsUrl(v: string | null | undefined): string | null {
  return v && /^https:\/\//i.test(v) ? v : null;
}

function subredditFromPermalink(permalink: string): string {
  return /\/r\/([^/]+)\//.exec(permalink)?.[1] ?? '';
}

/** Reddit's post-type attribute to our media type. */
const MEDIA_TYPES: Record<string, MediaType> = {
  text: 'text',
  self: 'text',
  // Text posts with images or videos inline in their body.
  multi_media: 'text',
  image: 'image',
  // An i.redd.it GIF (which the page plays as an MP4): an image, as in Reddit's API.
  gif: 'image',
  gallery: 'gallery',
  video: 'video',
  link: 'link',
  poll: 'poll',
};

interface PackagedMedia {
  playbackMp4s?: {
    duration?: number;
    permutations?: {
      source?: {
        url?: string;
        bitrateBps?: number;
        dimensions?: { width?: number; height?: number };
      };
    }[];
  };
}

/** Elements inside this post that belong to it (not to a post nested in it). */
function own(post: Element, selector: string): Element[] {
  return [...post.querySelectorAll(selector)].filter((e) => e.closest('shreddit-post') === post);
}

function firstSrc(img: Element | null | undefined): string | null {
  return attr(img, 'src') ?? attr(img, 'data-lazy-src');
}

/**
 * A video player's file: the packaged MP4 with sound at the best bitrate, with its
 * length and the v.redd.it playlists (which don't expire, unlike the MP4 links).
 */
function videoFromPlayer(player: Element): MediaItem | null {
  const src = attr(player, 'src');
  const id = vredditId(src) ?? vredditId(attr(player, 'preview'));
  const streams = id ? vredditStreams(id) : { hls_url: null, dash_url: null };
  let duration: number | null = null;
  let best:
    | { url?: string; bitrateBps?: number; dimensions?: { width?: number; height?: number } }
    | undefined;
  const packed = attr(player, 'packaged-media-json');
  if (packed) {
    try {
      const data = JSON.parse(packed) as PackagedMedia;
      const d = data.playbackMp4s?.duration;
      duration = typeof d === 'number' && Number.isFinite(d) ? d : null;
      best = (data.playbackMp4s?.permutations ?? [])
        .map((p) => p.source)
        .filter((s): s is NonNullable<typeof s> => !!s?.url)
        .sort((a, b) => (b.bitrateBps ?? 0) - (a.bitrateBps ?? 0))[0];
    } catch {
      // Not the JSON we expected; fall back to the v.redd.it link below.
    }
  }
  const gif = has(player, 'gif');
  // Reddit's packaged MP4s carry the sound, unlike the DASH video tracks.
  const url = best?.url ?? (gif ? httpsUrl(src) : null) ?? (id ? `https://v.redd.it/${id}` : null);
  if (!url) return null;
  return mediaItem(gif ? 'gif' : 'video', url, {
    width: best?.dimensions?.width ?? null,
    height: best?.dimensions?.height ?? null,
    duration,
    ...streams,
  });
}

/** A gallery's images, in order, as originals (i.redd.it), with captions and sizes. */
function galleryItems(roots: Element[]): MediaItem[] {
  const items: MediaItem[] = [];
  const seen = new Set<string>();
  for (const li of roots.flatMap((r) => [...r.querySelectorAll('gallery-carousel li')])) {
    const img = li.querySelector('figure img') ?? li.querySelector('img');
    const src = firstSrc(img);
    const zoom = attr(li.querySelector('zoomable-img img'), 'src');
    const original = zoom ?? (src ? originalImageUrl(src) : null);
    if (!original || !/^https:\/\/(?:i|preview)\.redd\.it\//.test(original) || seen.has(original))
      continue;
    seen.add(original);
    items.push(
      mediaItem(/\.gif(?:$|\?)/i.test(original) ? 'gif' : 'image', original, {
        // The <img>'s width and height are the original's.
        width: num(img, 'width'),
        height: num(img, 'height'),
        caption: text(li.querySelector('figcaption')),
      }),
    );
  }
  return items;
}

/** Images and videos inside a post's body ("multi_media" posts). */
function inlineMedia(body: Element | null): MediaItem[] {
  if (!body) return [];
  const items: MediaItem[] = [];
  const seen = new Set<string>();
  for (const fig of body.querySelectorAll('figure, img')) {
    const isImg = fig.tagName.toLowerCase() === 'img';
    if (isImg && fig.closest('figure')) continue;
    const img = isImg ? fig : fig.querySelector('img');
    const href = attr(fig.querySelector('a[href]'), 'href');
    const src = firstSrc(img);
    const url = href && /^https:\/\/(?:i|preview)\.redd\.it\//.test(href) ? href : src;
    if (!url || !/^https:\/\/(?:i|preview)\.redd\.it\//.test(url)) continue;
    const original = originalImageUrl(url);
    if (seen.has(original)) continue;
    seen.add(original);
    items.push(
      mediaItem(/\.gif(?:$|\?)/i.test(original) ? 'gif' : 'image', original, {
        caption: text(fig.querySelector('figcaption')),
      }),
    );
  }
  for (const player of body.querySelectorAll('shreddit-player, shreddit-player-2')) {
    const v = videoFromPlayer(player);
    if (v) items.push(v);
  }
  return items;
}

function mediaFromPost(el: Element, type: MediaType, body: Element | null): MediaItem[] {
  const href = attr(el, 'content-href') ?? '';
  const containers = own(el, '[slot="post-media-container"]');
  // A gallery, or the original's gallery on a crosspost.
  const gallery = galleryItems(containers.length ? containers : [el]);
  if (gallery.length) return gallery;
  for (const player of own(el, 'shreddit-player, shreddit-player-2')) {
    if (player.closest('shreddit-comment')) continue;
    const v = videoFromPlayer(player);
    if (!v) continue;
    // An i.redd.it GIF plays as an MP4, but its file is the .gif.
    if (v.type === 'gif' && isDirectImage(href)) return [mediaItem('gif', href)];
    const id = vredditId(href);
    return [v.hls_url || !id ? v : { ...v, ...vredditStreams(id) }];
  }
  if (type === 'image' || type === 'other') {
    if (isDirectImage(href)) return [mediaItem(/\.gif$/i.test(href) ? 'gif' : 'image', href)];
    // Not a direct link (a crosspost's card, an image behind a viewer): the full-size image.
    const zoom = containers
      .flatMap((c) => [...c.querySelectorAll('zoomable-img img')])
      .map((i) => httpsUrl(attr(i, 'src')))
      .find((u): u is string => u !== null && /^https:\/\/(?:i|preview)\.redd\.it\//.test(u));
    if (zoom) {
      const url = originalImageUrl(zoom);
      return [mediaItem(/\.gif(?:$|\?)/i.test(url) ? 'gif' : 'image', url)];
    }
  }
  if (/^https:\/\/v\.redd\.it\/[a-z0-9]+\/?$/i.test(href)) {
    return [mediaItem('video', href.replace(/\/$/, ''), vredditStreams(vredditId(href)!))];
  }
  if (type === 'text') return inlineMedia(body);
  return [];
}

/**
 * A poll's options, close time and votes. Open polls have a radio input per option
 * (with Reddit's option id) and a close time; closed ones show the votes instead.
 */
function pollOf(el: Element): Poll | null {
  const poll = own(el, 'shreddit-post-poll')[0];
  if (!poll) return null;
  const head = poll.firstElementChild;
  const total = num(head?.querySelector('faceplate-number[number]'), 'number');
  const closes = isoFromRedditTime(attr(head?.querySelector('faceplate-timeago[ts]'), 'ts'));
  const radios = [...poll.querySelectorAll('faceplate-radio-input')];
  if (radios.length) {
    return {
      total_votes: total,
      ends_at: closes,
      is_closed: false,
      options: radios.map((r) => ({ id: attr(r, 'value'), text: text(r) ?? '', votes: null })),
    };
  }
  // The results: one block per option, its text first and its votes in a faceplate-number.
  const options: PollOption[] = [];
  for (const tip of poll.querySelectorAll('rpl-tooltip')) {
    const block = tip.parentElement?.parentElement?.parentElement;
    if (!block || block === poll) continue;
    const label = text(block.firstElementChild);
    if (label) {
      options.push({
        id: null,
        text: label,
        votes: num(block.querySelector('faceplate-number[number]'), 'number'),
      });
    }
  }
  // Results with a close time still to come: someone who voted sees an open poll's results.
  return { total_votes: total, ends_at: closes, is_closed: closes === null, options };
}

/** What a crosspost shows of the original post (its card holds a link to it). */
function crosspostOf(el: Element, permalink: string): CrosspostParent | null {
  const href = attr(el, 'content-href') ?? '';
  const m = /^(?:https:\/\/www\.reddit\.com)?\/r\/([^/]+)\/comments\/([a-z0-9]+)\//i.exec(href);
  if (!m || absolute(href) === permalink) return null;
  const box = own(el, '[slot="post-media-container"]')[0];
  const id = m[2]!.toLowerCase();
  const titleLink = box?.querySelector(
    `a[href*="/comments/${id}/"] faceplate-screen-reader-content`,
  );
  // The card's counts are labelled only in words ("<n> upvotes", "<n> comments"):
  // English is read, anything else stays unknown.
  const counts = box ? [...box.querySelectorAll('faceplate-number[number]')] : [];
  const after = (n: Element) => n.nextSibling?.textContent ?? '';
  const score = counts.find((n) => /^\s*(?:up)?votes?\b|^\s*points?\b/i.test(after(n)));
  const comments = counts.find((n) => /^\s*comments?\b/i.test(after(n)));
  return {
    name: `t3_${id}`,
    permalink: absolute(href),
    subreddit: m[1]!,
    title: text(titleLink),
    score: num(score, 'number'),
    num_comments: num(comments, 'number'),
    created_utc: isoFromRedditTime(attr(box?.querySelector('faceplate-timeago[ts]'), 'ts')),
  };
}

/**
 * Removed or deleted. `item-state="REMOVED"` says removed in any language; the
 * banner Reddit shows instead of the body says who, in words (English is read).
 */
function postRemoval(el: Element, author: string | null): RemovalStatus {
  const banner = text(own(el, '[slot="post-removed-banner"]')[0]) ?? '';
  const state = (attr(el, 'item-state') ?? '').toUpperCase();
  if (/deleted by (?:the person|the author|its author|the user|author)/i.test(banner))
    return 'deleted';
  if (banner || state === 'REMOVED') return 'removed';
  if (author === '[deleted]') return 'deleted';
  return null;
}

/** The post's own thumbnail: in feeds, its thumbnail slot; else a video poster or preview. */
function thumbnailOf(el: Element): string | null {
  const slot = httpsUrl(firstSrc(own(el, '[slot="thumbnail"] img')[0]));
  if (slot) return slot;
  for (const player of own(el, 'shreddit-player, shreddit-player-2')) {
    const poster = httpsUrl(attr(player, 'poster'));
    if (poster && !player.closest('shreddit-comment')) return poster;
  }
  const imgs = own(el, '[slot="post-media-container"] img');
  const primary =
    imgs.find((i) => i.hasAttribute('data-post-media-primary')) ??
    imgs.find((i) =>
      /^https:\/\/(?:preview|external-preview|i)\.redd\.it\//.test(firstSrc(i) ?? ''),
    );
  return httpsUrl(firstSrc(primary));
}

export function postFromElement(el: Element, doc: Document): Post {
  const name = el.id;
  const id = name.replace(/^t3_/, '');
  const permalink = absolute(attr(el, 'permalink') ?? `/comments/${id}/`);
  const created = isoFromRedditTime(attr(el, 'created-timestamp'));
  const postType = (attr(el, 'post-type') ?? '').toLowerCase();
  const kind = MEDIA_TYPES[postType] ?? 'other';
  const bodyEl = doc.getElementById(`${name}-post-rtjson-content`);
  const selftext = bodyEl ? htmlToMarkdown(bodyEl.cloneNode(true) as Element) : '';
  const author = attr(el, 'author');
  const flair = text(own(el, 'shreddit-post-flair')[0]);
  const subreddit = attr(el, 'subreddit-name') ?? subredditFromPermalink(permalink);
  const href = attr(el, 'content-href');
  const isCrosspost =
    postType === 'crosspost' || (has(el, 'is-crosspost') && attr(el, 'is-crosspost') !== 'false');
  const crosspost = isCrosspost ? crosspostOf(el, permalink) : null;
  const media = mediaFromPost(el, kind, bodyEl);
  // A crosspost shows the original's media: its type is what it holds (as on the JSON API).
  const type: MediaType = isCrosspost
    ? media.some((m) => m.type === 'video')
      ? 'video'
      : media.length > 1
        ? 'gallery'
        : media.length
          ? 'image'
          : 'link'
    : kind;
  return {
    kind: 'post',
    id,
    name,
    subreddit,
    subreddit_id: attr(el, 'subreddit-id'),
    author,
    author_fullname: attr(el, 'author-id'),
    title: attr(el, 'post-title') ?? '',
    selftext,
    selftext_html: bodyEl ? bodyEl.innerHTML.trim() : null,
    // A crosspost's content-href is the original's permalink, site-relative.
    url: href ? absolute(href) : permalink,
    domain: attr(el, 'domain'),
    permalink,
    created_utc: created,
    created_unix: unixFromIso(created),
    edited_utc: null,
    score: num(el, 'score'),
    upvote_ratio: num(el, 'upvote-ratio'),
    num_comments: num(el, 'comment-count'),
    link_flair_text: flair,
    author_flair_text: null,
    over_18: has(el, 'nsfw', 'is-nsfw'),
    spoiler: has(el, 'spoiler', 'is-spoiler'),
    locked: has(el, 'locked', 'is-locked'),
    stickied: has(el, 'stickied', 'is-stickied'),
    archived: has(el, 'archived', 'is-archived'),
    is_self: kind === 'text',
    distinguished: null,
    removal_status: postRemoval(el, author),
    media_type: type,
    media,
    thumbnail: thumbnailOf(el),
    poll: postType === 'poll' ? pollOf(el) : null,
    crosspost_parent: crosspost?.name ?? null,
    crosspost,
  };
}

/**
 * The words Reddit shows instead of a gone comment's body. Only English is read;
 * in other languages a gone comment by a deleted author counts as deleted, as before.
 */
const REMOVED_BODY =
  /^\s*(?:\[removed\]|comment removed by (?:moderator|reddit)|removed by (?:moderator|reddit))\s*$/i;
const DELETED_BODY = /^\s*(?:\[deleted\]|comment deleted by (?:user|author|the author))\s*$/i;

/** Elements inside this comment that belong to it, not to one of its replies. */
function ownOfComment(comment: Element, selector: string): Element[] {
  return [...comment.querySelectorAll(selector)].filter(
    (e) => e.closest('shreddit-comment') === comment,
  );
}

function commentFromElement(
  el: Element,
  doc: Document,
  linkTitle: string | null,
): RawComment | null {
  const name = attr(el, 'thingid');
  const postId = attr(el, 'postid');
  if (!name || !postId || !COMMENT_FULLNAME.test(name) || !POST_FULLNAME.test(postId)) return null;
  const permalink = absolute(attr(el, 'permalink') ?? '');
  const deletedAuthor =
    has(el, 'is-author-deleted', 'is-comment-deleted') || attr(el, 'author') === '[deleted]';
  const author = deletedAuthor ? '[deleted]' : attr(el, 'author');
  const bodyEl = doc.getElementById(`${name}-comment-rtjson-content`);
  let body = bodyEl ? htmlToMarkdown(bodyEl.cloneNode(true) as Element) : '';
  let removal: RemovalStatus = bodyEl ? removalStatus(author, body) : null;
  if (!bodyEl) {
    // No body: the comment is gone, and Reddit says why in its place.
    const said =
      ownOfComment(el, 'summary ~ div p')
        .map((p) => text(p))
        .find((t) => t !== null) ?? '';
    if (REMOVED_BODY.test(said)) {
      body = '[removed]';
      removal = 'removed';
    } else if (deletedAuthor || DELETED_BODY.test(said)) {
      body = '[deleted]';
      removal = 'deleted';
    }
  }
  const created = isoFromRedditTime(attr(el, 'created'));
  const meta = ownOfComment(el, '[slot="commentMeta"]');
  const inMeta = (selector: string) => meta.flatMap((m) => [...m.querySelectorAll(selector)]);
  // Badges carry the comment's id, so a reply's can't be mistaken for its parent's.
  const badges = el.querySelector(`shreddit-comment-badges[thing-id="${name}"]`);
  const distinguishedAs = (attr(badges, 'distinguished-as') ?? '').toLowerCase();
  // The comment's time sits in its "comment_time" link; another time beside it is
  // when it was edited (whatever the word for "edited" in the page's language).
  const edited = inMeta('faceplate-timeago[ts]')
    .filter((t) => !t.closest('[noun="comment_time"]'))
    .map((t) => isoFromRedditTime(attr(t, 'ts')))
    .find((t) => t !== null && t !== created);
  return {
    kind: 'comment',
    id: name.replace(/^t1_/, ''),
    name,
    link_id: postId,
    link_title: linkTitle,
    parent_id: attr(el, 'parentid') ?? postId,
    author,
    author_fullname: deletedAuthor
      ? null
      : (inMeta('author-flair-event-handler[userid]')
          .map((h) => attr(h, 'userid'))
          .find((u) => u !== null && /^t2_[a-z0-9]+$/i.test(u)) ?? null),
    is_submitter: has(el, 'is-op'),
    body,
    body_html: bodyEl ? bodyEl.innerHTML.trim() : null,
    score: num(el, 'score'),
    score_hidden: null,
    controversiality: null,
    created_utc: created,
    created_unix: unixFromIso(created),
    edited_utc: edited ?? null,
    distinguished:
      has(el, 'is-admin-distinguished') || distinguishedAs === 'admin'
        ? 'admin'
        : has(el, 'is-mod-distinguished') || distinguishedAs === 'moderator'
          ? 'moderator'
          : null,
    stickied: badges ? has(badges, 'stickied') : null,
    locked: badges ? has(badges, 'locked') : null,
    removal_status: removal,
    subreddit: subredditFromPermalink(permalink),
    permalink,
  };
}

/** A request that loads more comments. */
export interface MoreJob {
  key: string;
  url: string;
  /** POST body for "more replies" requests; absent for pages (comment pages, other sorts). */
  body?: string;
  /** Fullname of the comment whose replies these are, or the post's for top-level ones. */
  parent: string;
  count: number | null;
  /** For a comment's own page: that comment's fullname. */
  focus?: string;
  /** Loads more top-level comments (as opposed to replies). */
  topLevel?: boolean;
  /** Pages in a row along this chain that brought no new comments. */
  fruitless?: number;
  /** A "continue this thread" link loaded as a "more replies" request (see repliesRequest). */
  built?: boolean;
  /** For a built request: the comment's own page, for when Reddit refuses the request. */
  fallback?: string;
  /** Part of the top-level list in another sort order (past Reddit's per-sort cap). */
  chain?: string;
}

/**
 * How many comments a button or link stands for. Reddit puts the number in
 * <faceplate-number number="58"> (a script fills in its text, in the page's
 * language); older markup had "58 more replies" as text.
 */
function countFrom(el: Element): number | null {
  const n = Number(el.querySelector('faceplate-number[number]')?.getAttribute('number') ?? NaN);
  if (Number.isFinite(n)) return n;
  const m = /(\d[\d,.]*)\s*(k)?\s+more/i.exec(el.textContent ?? '');
  if (!m) return null;
  const v = Number(m[1]!.replace(/,/g, ''));
  return Number.isFinite(v) ? Math.round(m[2] ? v * 1000 : v) : null;
}

/**
 * The cursor a "more replies" button would carry for all replies of `comment`.
 * Reddit's cursors are base64 of `commenttree:<checksum>,::<depth>:d1:<parent
 * fullname>`, and Reddit doesn't check the checksum (November 2026).
 */
export function repliesCursor(comment: string, depth: number): string {
  return btoa(`commenttree:,::${depth}:d1:${comment}`);
}

/**
 * The "more replies" request for all replies of `comment`, made for a "continue this
 * thread" link, which has no button of its own. It is the same endpoint and the same
 * form POST that reddit.com's own script sends when someone presses "more replies";
 * only the cursor is built here instead of read from a button. The answer is a
 * fragment of about 20 KB, where the comment's own page is about 550 KB and mostly
 * repeats the thread: far less for Reddit to serve, and fewer requests in all.
 */
export function repliesRequest(
  subreddit: string,
  postFullname: string,
  comment: string,
  depth: number,
  sort: string | null,
): { url: string; body: string } {
  const url = new URL(
    `${REDDIT}/svc/shreddit/more-comments/${encodeURIComponent(subreddit)}/${postFullname}`,
  );
  if (sort) url.searchParams.set('sort', sort);
  url.searchParams.set('startingDepth', String(depth));
  url.searchParams.set('seeker-session', 'true');
  return {
    url: url.toString(),
    body: `cursor=${encodeURIComponent(repliesCursor(comment, depth))}`,
  };
}

/** The comments partial reddit.com's script loads after a post page, in one sort order. */
export function commentsPartialUrl(subreddit: string, postFullname: string, sort: string): string {
  const url = new URL(
    `${REDDIT}/svc/shreddit/comments/r/${encodeURIComponent(subreddit)}/${postFullname}`,
  );
  url.searchParams.set('seeker-session', 'true');
  // Always explicit: without it Reddit uses the subreddit's suggested sort.
  url.searchParams.set('sort', sort);
  return url.toString();
}

/**
 * The "more replies" buttons and "continue this thread" links in a parsed page or
 * fragment. `sort` is the comment order for requests built from links (Reddit's
 * spelling, e.g. "TOP"); the page's own buttons say it when they can.
 */
export function moreJobs(
  doc: Document,
  postFullname: string,
  fragmentParent = postFullname,
  opts: { sort?: string | null } = {},
): MoreJob[] {
  const jobs: MoreJob[] = [];
  const withButton = new Set<Element | null>();
  // The page's own buttons say which subreddit and sort the requests use.
  let subreddit: string | null = null;
  let sort: string | null = opts.sort ?? null;
  for (const partial of doc.querySelectorAll('faceplate-partial')) {
    const src = partial.getAttribute('src') ?? '';
    let url = redditUrl(src, /^\/svc\/shreddit\/more-comments\//);
    if (!url) continue;
    const cursor = partial.querySelector('input[name="cursor"]')?.getAttribute('value');
    if (!cursor) continue;
    const asked = new URL(url);
    subreddit ??= decodeURIComponent(asked.pathname.split('/')[4] ?? '') || null;
    sort = asked.searchParams.get('sort') ?? sort;
    const owner = partial.closest('shreddit-comment');
    withButton.add(owner);
    const topLevel = owner === null && /[?&]top-level=1/.test(src);
    // The first "more comments" button asks for 10; asked for more, Reddit sends
    // up to about 100 (comments with their first replies). Later buttons already do.
    if (topLevel && asked.searchParams.has('comments-remaining')) {
      asked.searchParams.set('comments-remaining', '500');
      url = asked.toString();
    }
    jobs.push({
      topLevel,
      // The cursor says where to continue; the same place reached from another
      // page has a different URL but the same cursor.
      key: `cursor:${cursor}`,
      url,
      body: `cursor=${encodeURIComponent(cursor)}`,
      // A button at the top of a loaded fragment continues what that fragment was for.
      parent: owner?.getAttribute('thingid') ?? (topLevel ? postFullname : fragmentParent),
      count: countFrom(partial),
    });
  }
  // Every comment with replies also has a link to its own page, shown when its
  // thread is folded. Only where its replies aren't on the page (below a fixed depth
  // there's no button, only the link: "continue this thread") is it worth following.
  const withReplies = new Set<string>();
  for (const c of doc.querySelectorAll('shreddit-comment')) {
    const parent = c.getAttribute('parentid');
    if (parent) withReplies.add(parent);
  }
  for (const a of doc.querySelectorAll('a[slot="more-comments-permalink"]')) {
    const owner = a.closest('shreddit-comment');
    if (!owner || withButton.has(owner)) continue;
    const focus = owner.getAttribute('thingid');
    if (!focus || !COMMENT_FULLNAME.test(focus) || withReplies.has(focus)) continue;
    const href = redditUrl(a.getAttribute('href') ?? '', POST_PAGE_PATH);
    if (!href) continue;
    const page = new URL(href);
    page.searchParams.delete('force-legacy-sct');
    const sub = subreddit ?? decodeURIComponent(page.pathname.split('/')[2] ?? '');
    const depth = Number(owner.getAttribute('depth'));
    const { url, body } = repliesRequest(
      sub,
      postFullname,
      focus,
      Number.isFinite(depth) ? depth + 1 : 1,
      sort,
    );
    jobs.push({
      key: `replies:${focus}`,
      url,
      body,
      parent: focus,
      count: countFrom(a),
      built: true,
      fallback: page.toString(),
    });
  }
  return jobs;
}

interface SearchContext {
  post?: { id?: string; title?: string; nsfw?: boolean; spoiler?: boolean };
  profile?: { id?: string; name?: string };
  subreddit?: { id?: string; name?: string };
}

/** Search results: post summaries from the tracking data Reddit attaches to each result. */
export function searchResults(doc: Document): Post[] {
  const posts = new Map<string, Post>();
  // Result markup differs between global and subreddit search; the title link and
  // the tracking data around it are the same in both.
  for (const link of doc.querySelectorAll('a[data-testid="post-title"]')) {
    const href = link.getAttribute('href');
    if (!href) continue;
    let ctx: SearchContext = {};
    for (
      let el = link.closest('[data-faceplate-tracking-context]');
      el;
      el = el.parentElement?.closest('[data-faceplate-tracking-context]') ?? null
    ) {
      try {
        const parsed = JSON.parse(
          el.getAttribute('data-faceplate-tracking-context') ?? '',
        ) as SearchContext;
        if (parsed.post?.id) {
          ctx = parsed;
          break;
        }
      } catch {
        // Ignore trackers we can't read.
      }
    }
    const idMatch = /\/comments\/([a-z0-9]+)/i.exec(href);
    const id = (ctx.post?.id?.replace(/^t3_/, '') ?? idMatch?.[1] ?? '').toLowerCase();
    const permalink = redditUrl(href, /^\/r\/[^/]+\/comments\/[a-z0-9]+\//i);
    if (!POST_FULLNAME.test(`t3_${id}`) || !permalink || posts.has(id)) continue;
    posts.set(id, {
      kind: 'post',
      id,
      name: `t3_${id}`,
      subreddit: ctx.subreddit?.name ?? subredditFromPermalink(permalink),
      subreddit_id: ctx.subreddit?.id ?? null,
      author: ctx.profile?.name ?? null,
      author_fullname: ctx.profile?.id ?? null,
      title: ctx.post?.title ?? link?.textContent?.trim() ?? '',
      selftext: '',
      selftext_html: null,
      url: permalink,
      domain: null,
      permalink,
      created_utc: null,
      created_unix: null,
      edited_utc: null,
      score: null,
      upvote_ratio: null,
      num_comments: null,
      link_flair_text: null,
      author_flair_text: null,
      over_18: ctx.post?.nsfw ?? null,
      spoiler: ctx.post?.spoiler ?? null,
      locked: null,
      stickied: null,
      archived: null,
      is_self: null,
      distinguished: null,
      removal_status: null,
      media_type: 'other',
      media: [],
      thumbnail: null,
      poll: null,
      crosspost_parent: null,
      crosspost: null,
    });
  }
  return [...posts.values()];
}

/** A page of a subreddit feed: its posts (promoted ones left out), and where the next page is. */
export function feedPage(doc: Document): {
  posts: Post[];
  /** The next page's address, from the page's "load more" element. */
  next: string | null;
  /** The last post's cursor, for when there's no such element. */
  cursor: string | null;
} {
  const posts: Post[] = [];
  let cursor: string | null = null;
  for (const el of doc.querySelectorAll('shreddit-post')) {
    if (!POST_FULLNAME.test(el.id) || has(el, 'promoted', 'is-promoted')) continue;
    cursor = attr(el, 'more-posts-cursor') ?? cursor;
    posts.push(postFromElement(el, doc));
  }
  const next = redditUrl(
    doc.querySelector('faceplate-partial[slot="load-after"]')?.getAttribute('src') ?? '',
    /^\/svc\/shreddit\/community-more-posts\//,
  );
  return { posts, next, cursor };
}

/** The post on its own page, with the comment count the page reports, or null. */
export function postOnPage(
  doc: Document,
  fullname: string,
): { post: Post; expected: number | null } | null {
  const el = doc.querySelector(`shreddit-post[id="${fullname}"]`);
  if (!el) return null;
  const post = postFromElement(el, doc);
  const expected =
    num(doc.querySelector('shreddit-comment-tree') ?? el, 'totalcomments') ?? post.num_comments;
  return { post, expected };
}

/** The comments of post `fullname` in a page or a fragment of one. */
export function commentsOnPage(page: Document, fullname: string, linkTitle: string): RawComment[] {
  const comments: RawComment[] = [];
  let subreddit: string | null | undefined;
  for (const el of page.querySelectorAll('shreddit-comment')) {
    if (el.getAttribute('postid') !== fullname) {
      // A deleted comment that still has replies is a "[deleted]" placeholder without
      // postid or permalink. Leaving it out would cut its replies off the tree
      // (thingid "t1_deleted" stands for nothing, though).
      const thing = el.getAttribute('thingid') ?? '';
      if (el.hasAttribute('postid') || !el.hasAttribute('is-comment-deleted')) continue;
      if (!COMMENT_FULLNAME.test(thing) || thing === 't1_deleted') continue;
      subreddit ??=
        /^\/r\/([^/]+)\//.exec(
          page
            .querySelector(`shreddit-comment[postid="${fullname}"][permalink]`)
            ?.getAttribute('permalink') ?? '',
        )?.[1] ?? null;
      el.setAttribute('postid', fullname);
      if (!el.hasAttribute('permalink')) {
        const where = subreddit ? `/r/${subreddit}` : '';
        el.setAttribute(
          'permalink',
          `${where}/comments/${fullname.slice(3)}/comment/${thing.slice(3)}/`,
        );
      }
    }
    const c = commentFromElement(el, page, linkTitle);
    if (c) comments.push(c);
  }
  return comments;
}

/** The next page of search results, or null. */
export function searchNext(doc: Document): string | null {
  return (
    [...doc.querySelectorAll('faceplate-partial')]
      .map((p) =>
        redditUrl(p.getAttribute('src') ?? '', /^\/(?:svc\/shreddit\/)?(?:r\/[^/]+\/)?search\/$/),
      )
      .find((u): u is string => u !== null && /[?&]cursor=/.test(u)) ?? null
  );
}

/**
 * Why a subreddit page shows no posts, when Reddit says why. Banned, quarantined,
 * private or premium-only communities show a guard modal whose tracking data names
 * the reason (a code, the same in every language); a name that doesn't exist loads
 * a "community not found" modal. Their feeds answer with no posts, the same as a
 * quiet feed, so only the subreddit's own page can tell them apart.
 */
export function blockedCommunity(
  doc: Document,
): { kind: 'forbidden' | 'notfound'; detail: string } | null {
  if (doc.querySelector('faceplate-partial[src*="community-not-found-modal"]')) {
    return { kind: 'notfound', detail: COMMUNITY_NOT_FOUND };
  }
  const known: Record<string, string> = {
    BANNED: 'banned',
    QUARANTINED: 'quarantined',
    PRIVATE: 'private',
    GOLD_ONLY: 'premium only',
  };
  for (const el of doc.querySelectorAll('[san="blocked_community_page__view__modal"]')) {
    try {
      const ctx = JSON.parse(el.getAttribute('data-faceplate-tracking-context') ?? '') as {
        action_info?: { reason?: unknown };
      };
      const reason = typeof ctx.action_info?.reason === 'string' ? ctx.action_info.reason : '';
      if (!reason) continue;
      const code = reason.toUpperCase();
      return {
        kind: 'forbidden',
        detail:
          known[code] ??
          code
            .toLowerCase()
            .replace(/[^a-z]+/g, ' ')
            .trim(),
      };
    } catch {
      // A tracker we can't read.
    }
  }
  if (doc.querySelector('guard-community-modal'))
    return { kind: 'forbidden', detail: 'restricted' };
  return null;
}

/** The post address a page says it is (where a /s/ share link led), or null. */
export function canonicalUrl(doc: Document): string | null {
  const v = doc.querySelector('#canonical-url-updater')?.getAttribute('value');
  const fromPage = v ? redditUrl(v, POST_PAGE_PATH) : null;
  if (fromPage) return fromPage;
  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href');
  return canonical ? redditUrl(canonical, POST_PAGE_PATH) : null;
}
