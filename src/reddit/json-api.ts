// Reddit's JSON API on www.reddit.com (the `.json` pages), read with the user's
// own session. Since mid-2026 Reddit answers these only for logged-in users.
//
// Comment trees come back partial: deep or long threads end in "more" stubs.
// Two kinds exist:
//  - "load more" stubs list child ids, fetched 100 at a time from /api/morechildren
//    (one call at a time: Reddit refuses concurrent calls);
//  - "continue this thread" stubs (id "_", count 0) are fetched as
//    /comments/<post>/_/<parent comment>.
// Like PRAW's replace_more, the largest stub goes first, so a comment limit keeps
// the biggest discussions.

import type { Backend, ListingItem, ListingOptions, ThreadOptions } from './backend';
import { finishThread, stopWithPartial } from './backend';
import type { RedditClient } from './client';
import { isFatal, RedditError, refusesRoute } from './errors';
import {
  commentFromJson,
  postFromJson,
  type JsonComment,
  type JsonMore,
  type JsonPost,
  type Listing,
  type Thing,
} from './json-parse';
import { REDDIT, type Gap, type Thread } from './model';
import type { Target } from './target';
import { CommentTree } from './tree';

const PAGE_SIZE = 100;
const MORECHILDREN_BATCH = 100;

/** A "more" stub waiting to be loaded. */
interface Stub {
  parent_id: string;
  count: number;
  /** Child ids for "load more"; empty for "continue this thread". */
  children: string[];
}

export function listingUrl(
  target: Exclude<Target, { kind: 'post' }>,
  after: string | null,
): string {
  let url: URL;
  switch (target.kind) {
    case 'subreddit':
      url = new URL(`${REDDIT}/r/${target.name}/${target.sort}.json`);
      if (target.sort === 'top' || target.sort === 'controversial')
        url.searchParams.set('t', target.time);
      break;
    case 'user':
      url = new URL(`${REDDIT}/user/${target.name}/${target.section}.json`);
      url.searchParams.set('sort', target.sort);
      if (target.sort === 'top') url.searchParams.set('t', target.time);
      break;
    case 'search':
      url = new URL(
        target.subreddit ? `${REDDIT}/r/${target.subreddit}/search.json` : `${REDDIT}/search.json`,
      );
      url.searchParams.set('q', target.query);
      if (target.subreddit) url.searchParams.set('restrict_sr', '1');
      url.searchParams.set('sort', target.sort);
      url.searchParams.set('t', target.time);
      url.searchParams.set('type', 'link');
      break;
  }
  url.searchParams.set('limit', String(PAGE_SIZE));
  if (after) url.searchParams.set('after', after);
  url.searchParams.set('raw_json', '1');
  return url.toString();
}

export function createJsonBackend(client: RedditClient): Backend {
  /**
   * How hidden comments ("load more") are loaded: /api/morechildren, else
   * /api/info by id (100 a request, the replies placed by parent_id), else one
   * comment with its replies at a time. Moves down once Reddit refuses a way.
   */
  let moreRoute: 'morechildren' | 'info' | 'focus' = 'morechildren';

  async function loadMore(linkName: string, ids: string[], sort: string): Promise<Thing[]> {
    if (moreRoute === 'info') {
      const url = new URL(`${REDDIT}/api/info.json`);
      url.searchParams.set('id', ids.map((id) => `t1_${id}`).join(','));
      url.searchParams.set('raw_json', '1');
      const res = await client.json<Listing>(url.toString());
      return res.data?.children ?? [];
    }
    const url = new URL(`${REDDIT}/api/morechildren.json`);
    url.searchParams.set('api_type', 'json');
    url.searchParams.set('link_id', linkName);
    url.searchParams.set('children', ids.join(','));
    url.searchParams.set('sort', sort);
    url.searchParams.set('limit_children', 'false');
    url.searchParams.set('raw_json', '1');
    const res = await client.json<{ json?: { data?: { things?: Thing[] } } }>(url.toString());
    return res.json?.data?.things ?? [];
  }

  async function* listing(
    target: Exclude<Target, { kind: 'post' }>,
    { limit }: ListingOptions,
  ): AsyncGenerator<ListingItem> {
    const seen = new Set<string>();
    let after: string | null = null;
    while (seen.size < limit) {
      const page: Listing = await client.json<Listing>(listingUrl(target, after));
      let fresh = 0;
      for (const child of page.data?.children ?? []) {
        const name = (child.data as { name?: string }).name ?? '';
        if (!name || seen.has(name)) continue;
        if (child.kind === 't3') {
          seen.add(name);
          fresh++;
          yield {
            kind: 'post',
            post: postFromJson(child.data as unknown as JsonPost),
            complete: true,
          };
        } else if (child.kind === 't1') {
          seen.add(name);
          fresh++;
          yield {
            kind: 'comment',
            comment: commentFromJson(child.data as unknown as JsonComment, null),
          };
        }
        if (seen.size >= limit) return;
      }
      after = page.data?.after ?? null;
      // No `after`, or a page of only repeats: Reddit's listing ends here (at most ~1000 items).
      if (!after || fresh === 0) return;
    }
  }

  async function thread(postId: string, options: ThreadOptions): Promise<Thread> {
    const base = `${REDDIT}/comments/${postId}`;
    const first = await client.json<[Listing, Listing]>(
      `${base}.json?limit=500&sort=${encodeURIComponent(options.sort)}&raw_json=1`,
    );
    const postThing = first[0]?.data?.children?.[0];
    if (!postThing || postThing.kind !== 't3') {
      throw new RedditError('unexpected', base, 200, 'no post in response');
    }
    const post = postFromJson(postThing.data as unknown as JsonPost);
    const tree = new CommentTree(post.name);
    const stubs: Stub[] = [];
    const gaps: Gap[] = [];

    const take = (things: Thing[]) => {
      for (const thing of things) {
        if (thing.kind === 't1') {
          const d = thing.data as unknown as JsonComment;
          tree.add(commentFromJson(d, post.title));
          if (d.replies && typeof d.replies === 'object') take(d.replies.data.children);
        } else if (thing.kind === 'more') {
          const m = thing.data as unknown as JsonMore;
          stubs.push({
            parent_id: m.parent_id,
            count: m.count ?? 0,
            children: m.id === '_' || !m.children?.length ? [] : m.children,
          });
        }
      }
    };
    take(first[1]?.data?.children ?? []);
    options.onProgress?.(tree.size, post.num_comments, post);

    const requested = new Set<string>();
    while (stubs.length) {
      if (tree.size >= options.maxComments) {
        for (const s of stubs)
          gaps.push({ parent_id: s.parent_id, count: s.count || null, reason: 'comment limit' });
        break;
      }
      // Largest first, as PRAW does.
      stubs.sort((a, b) => b.count - a.count);
      const stub = stubs.shift()!;
      // How many comments this one request was for, should it fail.
      let asked: number | null = stub.count || null;
      try {
        if (stub.children.length === 0) {
          // "Continue this thread": the parent comment with its replies.
          if (!stub.parent_id.startsWith('t1_')) continue;
          const parentId = stub.parent_id.slice(3);
          const key = `continue:${parentId}`;
          if (requested.has(key)) continue;
          requested.add(key);
          const res = await client.json<[Listing, Listing]>(
            `${base}/_/${encodeURIComponent(parentId)}.json?limit=500&sort=${encodeURIComponent(options.sort)}&raw_json=1`,
          );
          take(res[1]?.data?.children ?? []);
        } else {
          const ids = stub.children.filter((id) => !tree.has(id) && !requested.has(id));
          if (!ids.length) continue;
          if (moreRoute === 'focus') {
            // One comment (with its replies) per request: under a comment, the parent
            // brings all of the hidden replies at once; at the top, each one comes alone.
            const focus = stub.parent_id.startsWith('t1_') ? stub.parent_id.slice(3) : ids[0]!;
            const key = `continue:${focus}`;
            const rest = stub.parent_id.startsWith('t1_') ? [] : ids.slice(1);
            if (rest.length)
              stubs.push({ ...stub, children: rest, count: Math.max(0, stub.count - 1) });
            if (requested.has(key)) continue;
            requested.add(key);
            asked = stub.parent_id.startsWith('t1_') ? ids.length : 1;
            const res = await client.json<[Listing, Listing]>(
              `${base}/_/${encodeURIComponent(focus)}.json?limit=500&sort=${encodeURIComponent(options.sort)}&raw_json=1`,
            );
            take(res[1]?.data?.children ?? []);
            for (const id of ids.slice(0, asked)) requested.add(id);
          } else {
            // A stub bigger than one call goes back in line with the rest of its ids.
            const batch = ids.slice(0, MORECHILDREN_BATCH);
            const rest = ids.slice(MORECHILDREN_BATCH);
            if (rest.length)
              stubs.push({
                ...stub,
                children: rest,
                count: Math.max(0, stub.count - batch.length),
              });
            asked = batch.length;
            let things: Thing[];
            try {
              things = await loadMore(post.name, batch, options.sort);
            } catch (error) {
              // Reddit refusing this way of loading hidden comments (it refused
              // /api/morechildren in Nov 2026): try the next way, for this stub too.
              if (!refusesRoute(error)) throw error;
              moreRoute = moreRoute === 'morechildren' ? 'info' : 'focus';
              stubs.push({ ...stub, children: ids });
              continue;
            }
            for (const id of batch) requested.add(id);
            take(things);
          }
        }
      } catch (error) {
        if (isFatal(error)) stopWithPartial(error, post, tree, gaps, options.maxComments);
        gaps.push({
          parent_id: stub.parent_id,
          count: asked,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      options.onProgress?.(tree.size, post.num_comments, post);
    }

    return finishThread(post, tree, gaps, options.maxComments);
  }

  return { name: 'json', listing, thread };
}
