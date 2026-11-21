// Reddit's own web pages, read the way reddit.com's scripts read them. This works
// without logging in, which the JSON API no longer does. This file decides what to
// ask for and in what order; html-parse.ts reads the answers.
//
// The requests (seen on reddit.com in November 2026):
//  - Subreddit feeds page through /svc/shreddit/community-more-posts/<sort>/?name=<sub>
//    with an `after` cursor.
//  - A post page brings the post and its first comments. Since 17 November some post
//    pages (the "seeker" variant) leave the comments out; reddit.com's script then
//    loads /svc/shreddit/comments/r/<sub>/t3_<id>, and so do we.
//  - POSTing a "more replies" button's cursor to its src returns the next comments
//    (about ten at a time). Reddit wants the post's address as the Referer.

import type { Backend, ListingItem, ListingOptions, ThreadOptions } from './backend';
import { finishThread, stopWithPartial } from './backend';
import type { RedditClient } from './client';
import { isFatal, RedditError } from './errors';
import {
  blockedCommunity,
  canonicalUrl,
  commentsOnPage,
  commentsPartialUrl,
  defaultParse,
  feedPage,
  moreJobs,
  parsePage,
  POST_FULLNAME,
  postOnPage,
  redditUrl,
  searchNext,
  searchResults,
  type MoreJob,
  type ParseHtml,
} from './html-parse';
import { REDDIT, type Gap, type Post, type Thread } from './model';
import { parseTarget, type CommentSort, type Target, type TimeFilter } from './target';
import { CommentTree } from './tree';

const TIME_PARAM: Record<TimeFilter, string> = {
  hour: 'HOUR',
  day: 'DAY',
  week: 'WEEK',
  month: 'MONTH',
  year: 'YEAR',
  all: 'ALL',
};

/**
 * A listing's post address, checked: a reddit.com post page for this very post
 * (/r/<sub>/comments/<id>/<slug>/), or null.
 */
function postPageUrl(permalink: string, postId: string): URL | null {
  const href = redditUrl(permalink, /^\/r\/[A-Za-z0-9_]+\/comments\/[a-z0-9]+\/[^/?#]+\/?$/i);
  if (!href) return null;
  const url = new URL(href);
  if (url.pathname.split('/')[4]?.toLowerCase() !== postId.toLowerCase()) return null;
  url.search = '';
  url.hash = '';
  return url;
}

function feedUrl(target: Extract<Target, { kind: 'subreddit' }>, after?: string): string {
  const url = new URL(`${REDDIT}/svc/shreddit/community-more-posts/${target.sort}/`);
  url.searchParams.set('name', target.name);
  url.searchParams.set('t', TIME_PARAM[target.time]);
  if (after) url.searchParams.set('after', after);
  return url.toString();
}

function searchUrl(target: Extract<Target, { kind: 'search' }>): string {
  const url = new URL(
    target.subreddit ? `${REDDIT}/r/${target.subreddit}/search/` : `${REDDIT}/search/`,
  );
  url.searchParams.set('q', target.query);
  url.searchParams.set('type', 'posts');
  if (target.subreddit) url.searchParams.set('restrict_sr', '1');
  if (target.sort !== 'relevance') url.searchParams.set('sort', target.sort);
  if (target.time !== 'all') url.searchParams.set('t', target.time);
  return url.toString();
}

/** Requests in a row that brought no new comments before a thread stops following buttons. */
const MAX_FRUITLESS = 8;
/**
 * Comment pages ("continue this thread") in a row that brought nothing new, after
 * which a thread stops opening them. Measured on reddit.com in November 2026: they
 * bring about 0.2 new comments a request (the reply counts include deleted ones),
 * so a long thread spent a third of its requests on 2% of its comments.
 */
const MAX_EMPTY_PAGES = 10;
/**
 * Built "more replies" requests refused in a row, with none accepted, after which a
 * thread opens the comments' own pages instead (in case Reddit starts checking the
 * cursors it doesn't check today).
 */
const MAX_BUILT_REFUSED = 3;
/**
 * Reddit lists only about 1,000 to 1,700 top-level comments per sort order, and each
 * order reaches a different set. Past this many top-level comments in the first
 * order, the others are read too (measured on an 8,969-comment thread: 6,969
 * comments became 8,481). "top" adds nothing the others don't.
 */
const EXTRA_SORTS_AFTER = 900;
const EXTRA_SORTS: CommentSort[] = ['new', 'old', 'controversial', 'confidence'];
/** The bare fragment: the same comments in about a third of the bytes. */
const PARTIAL = 'text/vnd.reddit.partial+html, text/html;q=0.9';
/**
 * Search pages sent sooner than about 1.5 s after the previous request came back
 * "blocked" (measured on fresh logged-out sessions, November 2026): wait at least
 * this long before each.
 */
export const SEARCH_GAP_MS = 1_600;

/**
 * A thread never needs more requests than this: a guard against Reddit answering in
 * circles, which the per-chain counters might miss. Not a target.
 */
export function threadRequestCap(maxComments: number, expected: number | null): number {
  return 20 + 2 * Math.min(maxComments, Math.max(expected ?? 0, 100));
}

/**
 * The post a share link (/r/<sub>/s/<code>) leads to. One request: Reddit redirects
 * the link to the post's page, and the page names itself too.
 */
export async function resolveShareLink(
  client: RedditClient,
  url: string,
  parse: ParseHtml = defaultParse,
): Promise<{ id: string; subreddit: string | null; permalink: string | null }> {
  const reply = await client.request(url, { expect: 'html' });
  const doc = parsePage(reply.text, parse);
  for (const where of [reply.url, canonicalUrl(doc)]) {
    const t = where ? parseTarget(where) : null;
    if (t?.kind === 'post' && t.id)
      return { id: t.id, subreddit: t.subreddit, permalink: redditUrl(where!, /^\/r\//) };
  }
  const el = doc.querySelector('shreddit-post[id^="t3_"]');
  const id = el?.id.slice(3).toLowerCase();
  if (el && id && POST_FULLNAME.test(el.id))
    return { id, subreddit: el.getAttribute('subreddit-name'), permalink: null };
  throw new RedditError('notfound', url, reply.status, 'the share link led to no post');
}

export function createHtmlBackend(client: RedditClient, parse: ParseHtml = defaultParse): Backend {
  /** A listing's pages, until `limit` posts, a page with nothing new, or no next page. */
  async function* paginate(
    url: string | null,
    limit: number,
    read: (doc: Document) => { posts: Post[]; next: string | null },
    complete: boolean,
    options: { minGapMs?: number; onEmptyFirst?: () => Promise<void> } = {},
  ): AsyncGenerator<ListingItem> {
    const seen = new Set<string>();
    let first = true;
    while (url && seen.size < limit) {
      const page = read(parsePage(await client.html(url, { minGapMs: options.minGapMs }), parse));
      if (first && !page.posts.length) await options.onEmptyFirst?.();
      first = false;
      let fresh = 0;
      for (const post of page.posts) {
        if (seen.has(post.id)) continue;
        seen.add(post.id);
        fresh++;
        yield { kind: 'post', post, complete };
        if (seen.size >= limit) return;
      }
      if (fresh === 0) return;
      url = page.next;
    }
  }

  async function* listing(
    target: Exclude<Target, { kind: 'post' }>,
    { limit }: ListingOptions,
  ): AsyncGenerator<ListingItem> {
    if (target.kind === 'subreddit') {
      yield* paginate(
        feedUrl(target),
        limit,
        (doc) => {
          const page = feedPage(doc);
          return {
            posts: page.posts,
            next: page.next ?? (page.cursor ? feedUrl(target, page.cursor) : null),
          };
        },
        true,
        // A banned, quarantined, private or unknown subreddit's feed is empty, like a
        // quiet one's: its own page says which (one request, only then).
        { onEmptyFirst: () => checkCommunity(target.name) },
      );
    } else if (target.kind === 'search') {
      // Search results are summaries: each post's page is loaded for the rest.
      yield* paginate(
        searchUrl(target),
        limit,
        (doc) => ({ posts: searchResults(doc), next: searchNext(doc) }),
        false,
        { minGapMs: SEARCH_GAP_MS },
      );
    } else {
      throw new RedditError(
        'login',
        `${REDDIT}/user/${target.name}/`,
        undefined,
        'Reddit shows user profiles only to logged-in visitors',
      );
    }
  }

  /** Throws a notfound or forbidden error when the subreddit's page says it can't be read. */
  async function checkCommunity(name: string): Promise<void> {
    const url = `${REDDIT}/r/${encodeURIComponent(name)}/`;
    const blocked = blockedCommunity(parsePage(await client.html(url), parse));
    if (blocked) throw new RedditError(blocked.kind, url, 200, blocked.detail);
  }

  async function thread(postId: string, options: ThreadOptions): Promise<Thread> {
    const fullname = `t3_${postId}`;
    if (!POST_FULLNAME.test(fullname))
      throw new RedditError('notfound', postId, undefined, 'not a post id');
    // /comments/<id>/ redirects to the full address, and Reddit counts both
    // requests; the full address (from a listing) costs one. /r/<sub>/comments/<id>/
    // without the title part serves an empty page that only redirects in a script.
    const short = new URL(`${REDDIT}/comments/${postId}/`);
    const full = options.permalink ? postPageUrl(options.permalink, postId) : null;
    let pageUrl = full ?? short;
    pageUrl.searchParams.set('sort', options.sort);
    let doc: Document | null = null;
    try {
      doc = parsePage(await client.html(pageUrl.toString()), parse);
    } catch (error) {
      // A listing's address that has gone stale (a renamed subreddit): the short one.
      if (!full || !(error instanceof RedditError && error.kind === 'notfound')) throw error;
    }
    let found = doc && postOnPage(doc, fullname);
    if (full && !found) {
      pageUrl = short;
      pageUrl.searchParams.set('sort', options.sort);
      doc = parsePage(await client.html(pageUrl.toString()), parse);
      found = postOnPage(doc, fullname);
    }
    if (!doc || !found)
      throw new RedditError('notfound', pageUrl.toString(), 200, 'no post on the page');
    const { post, expected } = found;
    let requests = full && pageUrl === short ? 2 : 1;
    const subreddit = post.subreddit;
    // Logged-out "seeker" post pages leave the comments out; reddit.com's script loads
    // them afterwards from the comments partial.
    if (
      options.maxComments > 0 &&
      subreddit &&
      (expected ?? 1) > 0 &&
      !commentsOnPage(doc, fullname, post.title).length
    ) {
      requests++;
      doc = parsePage(
        await client.html(commentsPartialUrl(subreddit, fullname, options.sort), {
          headers: { Accept: PARTIAL },
        }),
        parse,
      );
    }

    const tree = new CommentTree(fullname);
    const gaps: Gap[] = [];
    const queue: MoreJob[] = [];
    const queued = new Set<string>();
    let topLevelChain = false;
    // Comments whose replies something already asked for.
    const repliesAsked = new Set<string>();
    /** Comment pages in a row that brought nothing new. */
    let emptyPages = 0;
    let builtOk = 0;
    let builtRefused = 0;
    const cap = threadRequestCap(options.maxComments, expected);
    const sortParam = options.sort.toUpperCase();
    let extraStarted = false;

    /** The comment's own page, for a built request Reddit refused. */
    const toPage = (job: MoreJob) => {
      const key = `page:${job.parent}`;
      if (queued.has(key) || !job.fallback) return;
      queued.add(key);
      queue.push({
        key,
        url: job.fallback,
        parent: job.parent,
        count: job.count,
        focus: job.parent,
      });
    };

    /** Once the first order may be capped, the other orders' top-level lists too. */
    const startExtraSorts = () => {
      if (extraStarted || !subreddit || tree.topLevelCount < EXTRA_SORTS_AFTER) return;
      if (tree.size >= options.maxComments) return;
      extraStarted = true;
      for (const sort of EXTRA_SORTS.filter((x) => x !== options.sort)) {
        queued.add(`sort:${sort}`);
        queue.push({
          key: `sort:${sort}`,
          url: commentsPartialUrl(subreddit, fullname, sort),
          parent: fullname,
          count: null,
          topLevel: true,
          chain: sort,
        });
      }
    };

    /**
     * Adds a page's comments, and queues its buttons and links. `from` is the job that
     * loaded the page (none for the post page).
     */
    const take = (page: Document, from?: MoreJob) => {
      let fresh = 0;
      const freshIds = new Set<string>();
      for (const c of commentsOnPage(page, fullname, post.title)) {
        if (tree.add(c)) {
          fresh++;
          freshIds.add(c.name);
        }
      }
      // A chain of pages that keep bringing nothing new is going in circles. Counted
      // per chain: empty answers elsewhere in the thread (removed replies) don't count.
      const fruitless = fresh ? 0 : (from?.fruitless ?? 0) + (from ? 1 : 0);
      const fromCommentPage = from?.focus !== undefined;
      let dropped = false;
      const sort = from?.chain ? from.chain.toUpperCase() : sortParam;
      for (const job of moreJobs(page, fullname, from?.parent ?? fullname, { sort })) {
        if (queued.has(job.key)) continue;
        if (fruitless >= MAX_FRUITLESS) {
          dropped = true;
          continue;
        }
        if (job.built && queued.has(`page:${job.parent}`)) continue;
        if (from?.chain) {
          // Another order's page: its top-level list goes on; replies only for the
          // comments it brought first (the others have their own buttons already).
          if (job.topLevel) job.chain = from.chain;
          else if (!freshIds.has(job.parent)) continue;
        } else if (job.topLevel) {
          // A comment's own page repeats the thread's other buttons, each with a cursor
          // of its own, so the same comments would load again from every such page.
          // From those pages, follow one "more comments" chain for the whole thread, the
          // page's own comment's buttons, and reply buttons for comments nobody asked
          // about yet. Buttons on the post page and in loaded fragments continue what
          // they belong to: always follow.
          if (fromCommentPage && topLevelChain) continue;
          topLevelChain = true;
        } else {
          const own = job.parent === from?.focus;
          if (fromCommentPage && !own && repliesAsked.has(job.parent)) continue;
          repliesAsked.add(job.parent);
        }
        queued.add(job.key);
        queue.push({ ...job, fruitless });
      }
      if (dropped)
        gaps.push({
          parent_id: from?.parent ?? fullname,
          count: null,
          reason: 'Reddit kept answering without new comments',
        });
      if (from?.topLevel && !from.chain) startExtraSorts();
    };
    take(doc);
    options.onProgress?.(tree.size, expected, post);

    /**
     * What a job is expected to bring, to load the richest first (so a comment limit
     * keeps the biggest discussions): the top-level lists about 100 comments, a reply
     * button its count, a built request about 2, a comment's page least of all.
     */
    const yieldOf = (j: MoreJob): number =>
      j.topLevel ? Infinity : j.focus !== undefined ? -1 : (j.count ?? (j.built ? 2 : 3));
    const next = (): MoreJob => {
      let best = 0;
      for (let i = 1; i < queue.length; i++)
        if (yieldOf(queue[i]!) > yieldOf(queue[best]!)) best = i;
      return queue.splice(best, 1)[0]!;
    };

    while (queue.length) {
      if (tree.size >= options.maxComments) {
        for (const j of queue)
          gaps.push({ parent_id: j.parent, count: j.count, reason: 'comment limit' });
        break;
      }
      const job = next();
      if (requests >= cap) {
        gaps.push({
          parent_id: job.parent,
          count: job.count,
          reason: 'request limit for this thread reached',
        });
        continue;
      }
      // Its replies came with another page in the meantime.
      if ((job.built || job.focus !== undefined) && tree.get(job.parent.slice(3))?.replies.length)
        continue;
      // Reddit stopped accepting built requests: the comments' own pages instead.
      if (job.built && builtRefused >= MAX_BUILT_REFUSED && builtOk === 0) {
        toPage(job);
        continue;
      }
      if (job.focus !== undefined && emptyPages >= MAX_EMPTY_PAGES) {
        gaps.push({
          parent_id: job.parent,
          count: job.count,
          reason: 'deep replies: their pages kept showing nothing new',
        });
        continue;
      }
      const before = tree.size;
      requests++;
      try {
        const html = job.body
          ? await client.html(job.url, {
              method: 'POST',
              body: job.body,
              headers: { Accept: PARTIAL },
              // reddit.com's own "more replies" requests come from the post's page;
              // since 17 November 2026 Reddit refuses them without that Referer.
              referrer: post.permalink,
            })
          : await client.html(job.url, job.chain ? { headers: { Accept: PARTIAL } } : {});
        take(parsePage(html, parse), job);
        if (job.built) builtOk++;
        if (job.focus !== undefined) emptyPages = tree.size > before ? 0 : emptyPages + 1;
      } catch (error) {
        if (isFatal(error)) stopWithPartial(error, post, tree, gaps, options.maxComments);
        // A built request refused: the comment's own page has the same replies.
        if (job.built && job.fallback) {
          builtRefused++;
          toPage(job);
          continue;
        }
        gaps.push({
          parent_id: job.parent,
          count: job.count,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      options.onProgress?.(tree.size, expected, post);
    }

    return finishThread(post, tree, gaps, options.maxComments);
  }

  return { name: 'html', listing, thread };
}
