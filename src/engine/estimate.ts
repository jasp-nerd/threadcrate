// How long an export will take, as the export form shows it before it starts.

import { FAST, NORMAL } from '../reddit/pacing';
import { requestsLeft, timeForRequests, type WorkLeft } from './eta';
import type { ExportOptions } from './options';

/** "about 4 minutes", "under a minute", "about 2 hours". */
export function humanDuration(seconds: number): string {
  if (seconds < 60) return 'under a minute';
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round((seconds / 3600) * 2) / 2;
  return `about ${hours} hours`;
}

/**
 * Seconds an export would take, before it starts: the model of eta.ts with a fresh
 * budget and the logged-out pace (the slower one, so it errs long). `typicalComments`
 * comes from the comment counts the page already shows.
 */
export function plannedSeconds(
  o: Pick<
    ExportOptions,
    'target' | 'maxPosts' | 'includeComments' | 'maxComments' | 'speed' | 'deep'
  >,
  typicalComments: number | null,
): number {
  const single = o.target.kind === 'post';
  const deep = o.deep && o.target.kind === 'subreddit';
  // Finding more than 1000 posts reads 8 lists of up to 1000; a big subreddit yields
  // roughly 3000 different posts from them (a rough guess: the lists overlap).
  const posts = single ? 1 : deep ? 3000 : o.maxPosts;
  const loadsThreads = single || o.includeComments || o.target.kind === 'search';
  const comments = Math.min(typicalComments ?? 30, o.maxComments);
  const work: WorkLeft = {
    listingPages: single ? 0 : deep ? 8 * 40 : Math.ceil(posts / 25),
    threads: loadsThreads
      ? Array.from({ length: posts }, () => (o.includeComments || single ? comments : 0))
      : [],
    inFlight: [],
    mediaFiles: 0,
  };
  const now = 0;
  return (
    timeForRequests(
      1 + requestsLeft(work, 'html', { comments: 0, requests: 0, mediaSeconds: null }),
      {
        now,
        remaining: 225,
        limit: 225,
        resetAt: now + 600_000,
        waitingUntil: null,
        minIntervalMs: 0,
        latencyMs: null,
      },
      o.speed === 'fast' ? FAST : NORMAL,
    ) / 1000
  );
}

/** "under a minute", "5 min", "1 h 20 min": short, for buttons. */
export function shortDuration(seconds: number): string {
  if (seconds < 60) return '< 1 min';
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  // Round the whole to 10 minutes first, so it never reads "1 h 60 min".
  const total = Math.round(m / 10) * 10;
  const h = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}
