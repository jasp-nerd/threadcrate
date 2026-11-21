// The posts of a subreddit, profile or search, each once. Reddit shows at most
// about 1000 posts per list; to find more in a subreddit, the export reads several
// lists and keeps each post once.

import type { Backend, ListingItem } from '../reddit/backend';
import type { Sort, Target, TimeFilter } from '../reddit/target';
import { MAX_LISTING, type ExportOptions } from './options';
import type { Progress } from './run';

/**
 * The lists read to find more than the ~1000 posts Reddit shows per list, in order: the
 * newest first, then the best of several time ranges, then the most argued over.
 */
const DEEP_LISTS: { label: string; sort: Sort; time: TimeFilter }[] = [
  { label: 'Newest', sort: 'new', time: 'all' },
  { label: 'Top of all time', sort: 'top', time: 'all' },
  { label: 'Top of the year', sort: 'top', time: 'year' },
  { label: 'Top of the month', sort: 'top', time: 'month' },
  { label: 'Top of the week', sort: 'top', time: 'week' },
  { label: 'Most controversial of all time', sort: 'controversial', time: 'all' },
  { label: 'Most controversial of the year', sort: 'controversial', time: 'year' },
  { label: 'Hot', sort: 'hot', time: 'day' },
];

/** Posts a listing may bring at most. */
export function listingSize(o: ExportOptions): number {
  return o.deep && o.target.kind === 'subreddit'
    ? DEEP_LISTS.length * MAX_LISTING
    : Math.min(o.maxPosts, MAX_LISTING);
}

/**
 * The listing's posts, each once, and its comments, as they come. Keeps the
 * progress's count of what's read and what may still come, and which list it is on.
 */
export async function* readListing(
  backend: Backend,
  target: Exclude<Target, { kind: 'post' }>,
  o: ExportOptions,
  progress: Progress,
  emit: () => void,
): AsyncGenerator<ListingItem> {
  const lists =
    o.deep && target.kind === 'subreddit'
      ? DEEP_LISTS.map((l) => ({ ...l, target: { ...target, sort: l.sort, time: l.time } }))
      : [{ label: '', target, sort: null as Sort | null, time: null as TimeFilter | null }];
  const seen = new Set<string>();
  for (const [i, list] of lists.entries()) {
    if (lists.length > 1) {
      progress.list = { label: list.label, index: i, total: lists.length };
      emit();
    }
    let read = 0;
    const before = seen.size;
    const limit = lists.length > 1 ? MAX_LISTING : progress.postsTarget;
    for await (const item of backend.listing(list.target, { limit })) {
      read++;
      progress.listedRaw++;
      if (item.kind === 'post') {
        if (seen.has(item.post.id)) continue;
        seen.add(item.post.id);
      }
      yield item;
    }
    // This list ended early: Reddit has no more for the rest of it.
    progress.postsTarget -= limit - read;
    if (lists.length > 1) {
      // The whole subreddit is in already when "newest" is clearly short of
      // Reddit's cap (moderated subreddits come up a little short of 1000 even
      // when they hold far more), or when the best of all time brings nothing new.
      const small = list.sort === 'new' && read < 250;
      const covered = list.sort === 'top' && list.time === 'all' && seen.size === before;
      if (small || covered) {
        progress.postsTarget = progress.listedRaw;
        return;
      }
    }
  }
}
