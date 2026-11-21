// The time left of a running export: what is still to do, and what finished
// threads taught about the cost of comments, fed to the model in eta.ts.
//
// The clients pace by the same figures (each lane's expected requests decide when
// it may go at full speed), so the time shown and the real pace agree. A change
// to the estimate is a change to the pace.

import type { BackendName } from '../reddit/backend';
import type { RateStatus } from '../reddit/client';
import type { Post, Thread } from '../reddit/model';
import type { PacingRules } from '../reddit/pacing';
import {
  estimateLanes,
  FIRST_PAGE,
  type Calibration,
  type Lane,
  type LaneEstimate,
  type WorkLeft,
} from './eta';
import type { ExportOptions } from './options';
import type { Progress } from './run';

/** A listed post waiting for its thread, with its place in the listing. */
export interface QueuedPost {
  post: Post;
  complete: boolean;
  index: number;
}

/** The thread a lane is loading. */
export interface ThreadInFlight {
  title: string;
  loaded: number;
  expected: number | null;
  /** The lane's request count when this thread started. */
  startRequests: number;
}

/** A running export's shared state: run.ts writes it, the estimate reads it. */
export interface RunState {
  options: ExportOptions;
  rules: PacingRules;
  progress: Progress;
  /** Posts listed and waiting for their thread to load (in listing order). */
  pool: QueuedPost[];
  /** Comments reported per listed post so far, to guess at posts not listed yet. */
  listedComments: number[];
  inFlight: Map<Lane, ThreadInFlight>;
  /** Whether the API loads threads too (the web pages always do), while Reddit allows it. */
  apiLane: boolean;
  /** Where the posts are found (the API for profiles, which only it can list). */
  listingLane: Lane;
  /** What finished threads taught, per lane. */
  cal: Record<Lane, Calibration>;
  /** Requests each lane's client has sent so far. */
  requests: (lane: Lane) => number;
}

const laneBackend = (lane: Lane): BackendName => (lane === 'api' ? 'json' : 'html');

/** A comment count, cut to the comment limit. */
export const capComments = (n: number | null, o: ExportOptions) =>
  n === null ? null : Math.min(n, o.maxComments);

/** Whether this export loads each post's page (for its comments, or a search result's data). */
export const loadsThreads = (o: ExportOptions) =>
  o.target.kind === 'post' || o.includeComments || o.target.kind === 'search';

/** The listing said everything about this post, and it has no comments to load. */
export const needsNoRequest = (item: QueuedPost, o: ExportOptions) =>
  item.complete && o.includeComments && item.post.num_comments === 0;

function workLeft(s: RunState): WorkLeft {
  const { options, progress } = s;
  const pageSize = s.listingLane === 'api' ? 100 : 25;
  const listing = progress.phase === 'listing' || progress.phase === 'starting';
  // Lists still to read, in posts; with several lists, part of them are repeats.
  const unread =
    listing && options.target.kind !== 'post' ? progress.postsTarget - progress.listedRaw : 0;
  // Several lists overlap; until a second one has been read, guess how much (as the
  // export form does: 8 lists of 1000 give about 3000 different posts).
  const unique =
    progress.list && progress.list.index === 0
      ? 0.4
      : progress.listedRaw
        ? progress.postsListed / progress.listedRaw
        : 1;
  const unlisted = Math.round(unread * unique);
  const typical = s.listedComments.length
    ? s.listedComments.reduce((a, b) => a + b, 0) / s.listedComments.length
    : null;
  const threads: (number | null)[] = [];
  if (loadsThreads(options)) {
    if (progress.phase === 'starting' && options.target.kind === 'post') threads.push(null);
    for (const item of s.pool)
      if (!needsNoRequest(item, options))
        threads.push(options.includeComments ? capComments(item.post.num_comments, options) : 0);
    // Posts not listed yet: as many without comments (needing no request) as so far.
    const quiet = s.listedComments.length
      ? s.listedComments.filter((n) => n === 0).length / s.listedComments.length
      : 0;
    const toLoad = options.includeComments ? Math.round(unlisted * (1 - quiet)) : unlisted;
    for (let i = 0; i < toLoad; i++)
      threads.push(options.includeComments ? capComments(typical, options) : 0);
  }
  return {
    listingPages: Math.ceil(unread / pageSize),
    threads,
    inFlight: [...s.inFlight.entries()].map(([lane, c]) => ({
      expected: c.expected,
      loaded: c.loaded,
      requests: Math.max(0, s.requests(lane) - c.startRequests - 1),
    })),
    mediaFiles: options.includeMedia ? Math.max(0, progress.mediaTotal - progress.mediaDone) : 0,
  };
}

/** What we know about requests per comment on a lane, its thread in flight included. */
function liveCalibration(s: RunState, lane: Lane): Calibration {
  // The thread being loaded counts as evidence too, so a big first thread
  // corrects the estimate for the others while it loads.
  const cur = s.inFlight.get(lane);
  const base = s.cal[lane];
  if (!cur) return base;
  const beyond = Math.max(0, cur.loaded - FIRST_PAGE[laneBackend(lane)]);
  if (beyond === 0) return base;
  return {
    ...base,
    comments: base.comments + beyond,
    requests: base.requests + Math.max(0, s.requests(lane) - cur.startRequests - 1),
  };
}

/** Time and requests left, and each lane's share of the requests. */
export function estimateRun(s: RunState, now: number, idle: RateStatus): LaneEstimate {
  const web = {
    backend: laneBackend('web'),
    cal: liveCalibration(s, 'web'),
    doneCal: s.cal.web,
    pace: { ...s.progress.rate, now },
    rules: s.rules,
  } as const;
  const api =
    s.apiLane || s.listingLane === 'api'
      ? {
          backend: laneBackend('api'),
          cal: liveCalibration(s, 'api'),
          doneCal: s.cal.api,
          pace: { ...(s.progress.apiRate ?? idle), now },
          rules: s.rules,
        }
      : null;
  // Only the API: everything is on its lane.
  if (s.listingLane === 'api' && !s.apiLane) {
    const e = estimateLanes(workLeft(s), api!, null);
    return { ...e, web: 0, api: e.requests };
  }
  return estimateLanes(workLeft(s), web, s.apiLane ? api : null);
}

/** Learns requests-per-comment from a finished thread, for the time estimate. */
export function learnFrom(s: RunState, lane: Lane, thread: Thread, requestsUsed: number): void {
  if (!s.options.includeComments && s.options.target.kind !== 'post') return;
  const reported = capComments(thread.post.num_comments, s.options) ?? thread.comment_count;
  s.cal[lane].comments += Math.max(0, reported - FIRST_PAGE[laneBackend(lane)]);
  s.cal[lane].requests += Math.max(0, requestsUsed - 1);
}
