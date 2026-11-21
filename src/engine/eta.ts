// How long an export still takes.
//
// Most progress bars extrapolate from recent speed, and are wrong exactly when
// waits happen. An export's speed is set by Reddit's request budget, which we can
// see, and by our own pacing rules, which we wrote. So the estimate is a model:
//
//   1. how many requests are left: listing pages, plus for every post still to
//      load its reported comment count times "requests per comment", which starts
//      from measured values and is calibrated on the threads already done;
//   2. how long those requests take: the client's pacing rules played forward
//      against Reddit's current budget, so a coming pause for the budget to reset
//      is in the estimate before it happens;
//   3. media files, which have their own hosts and budget, at the measured time
//      per file.
//
// Everything here is pure, so tests can check estimates against simulated runs.

import type { BackendName } from '../reddit/backend';
import { delayAfter, isBudgetWait, NORMAL, reserveFor, type PacingRules } from '../reddit/pacing';

/** Reddit's two budgets: its web pages, and its API (logged in only). */
export type Lane = 'web' | 'api';

/** What is left to do, as the engine knows it. */
export interface WorkLeft {
  /** Listing pages still to fetch (an upper bound: listings can end early). */
  listingPages: number;
  /**
   * Posts whose page or comments are still to load, each with the number of
   * comments Reddit reported for it (already capped at the comment limit), or
   * null when unknown.
   */
  threads: (number | null)[];
  /**
   * The threads being loaded now (one per lane), with the requests each has made
   * beyond its first page.
   */
  inFlight: { expected: number | null; loaded: number; requests?: number }[];
  mediaFiles: number;
}

/** What finished threads taught us. */
export interface Calibration {
  /** Comments beyond each thread's first page, summed over finished threads. */
  comments: number;
  /** Requests those threads needed beyond their first page. */
  requests: number;
  /** Seconds per media file so far (moving average), null before the first. */
  mediaSeconds: number | null;
}

export interface Pace {
  now: number;
  /** Reddit's budget, as the last answer reported it. */
  remaining: number | null;
  limit: number | null;
  resetAt: number | null;
  /** A wait in progress (for the budget, after a 429, before a retry). */
  waitingUntil: number | null;
  minIntervalMs: number;
  latencyMs: number | null;
}

/** Comments the first page of a thread brings. */
export const FIRST_PAGE: Record<BackendName, number> = { html: 25, json: 200 };
/**
 * Requests per comment beyond the first page, before any calibration. Measured
 * on reddit.com in November 2026: logged out, a 740-comment thread took 159
 * requests (about 0.2 per comment, "more replies" bring a few comments at a
 * time); logged in, "load more" brings up to 100. On 16 November, with the first
 * "more comments" asking for about 100, the same thread took 200 requests for 694
 * comments (0.3): more threads are needed before changing this.
 */
const PER_COMMENT: Record<BackendName, number> = { html: 0.2, json: 0.03 };
/**
 * How much the prior counts against observations, in comments: little, since every
 * community differs and one finished thread already says more than the prior. With
 * more weight, a wrong prior kept the count high long enough to predict a wait for
 * the next window that never came.
 */
const PRIOR_WEIGHT = 5;
/** A thread with an unknown size counts as this many comments. */
const UNKNOWN_THREAD = 30;
/** Reddit's rate-limit window: ten minutes. */
const WINDOW_MS = 600_000;
const DEFAULT_LATENCY_MS = 700;
const DEFAULT_MEDIA_SECONDS = 2;

function perComment(backend: BackendName, cal: Calibration): number {
  return (PRIOR_WEIGHT * PER_COMMENT[backend] + cal.requests) / (PRIOR_WEIGHT + cal.comments);
}

/** Requests still needed, by the model above. */
export function requestsLeft(
  work: WorkLeft,
  backend: BackendName,
  cal: Calibration,
  /** For the threads in flight: what finished threads say (their own pace misleads). */
  inFlightCal: Calibration = cal,
): number {
  const rate = perComment(backend, cal);
  const ownRate = perComment(backend, inFlightCal);
  const first = FIRST_PAGE[backend];
  let n = work.listingPages;
  for (const reported of work.threads) {
    n += 1 + rate * Math.max(0, (reported ?? UNKNOWN_THREAD) - first);
  }
  for (const cur of work.inFlight) {
    const expected = cur.expected ?? cur.loaded + UNKNOWN_THREAD;
    // Its first page is still to come.
    if (cur.loaded === 0) n += 1;
    // A thread's comments come front-loaded (the first "more comments" pages bring
    // about 100 each, reply buttons a few), so its own pace so far says little about
    // the rest. What the whole thread should cost, less what it has cost so far; but
    // never less than the comments still missing at the usual rate.
    const whole = ownRate * Math.max(0, expected - first);
    const missing = rate * Math.max(0, expected - Math.max(cur.loaded, first));
    n += Math.max(missing, whole - (cur.requests ?? 0));
  }
  return Math.ceil(n);
}

/**
 * Milliseconds for `n` requests, replaying the client's pacing rules (pacing.ts)
 * request by request: each request uses one from the budget when sent and takes
 * `latency` to answer; the rules then say when the next may go (counted from the
 * send, or from the answer for a wait for the reset).
 */
export function timeForRequests(n: number, pace: Pace, rules: PacingRules = NORMAL): number {
  const latency = pace.latencyMs ?? DEFAULT_LATENCY_MS;
  let t = Math.max(pace.now, pace.waitingUntil ?? 0);
  if (n <= 0) return t - pace.now;
  if (pace.remaining === null || pace.limit === null || pace.resetAt === null) {
    return t - pace.now + (n - 1) * Math.max(latency, rules.minIntervalMs) + latency;
  }
  const limit = pace.limit;
  let remaining = pace.remaining;
  let resetAt = pace.resetAt;
  // Replayed up to a bound; anything beyond goes at the steady rate of a full window.
  const replayed = Math.min(n, 50_000);
  const beyond = n - replayed;
  for (let left = replayed; left > 0; left--) {
    while (t >= resetAt) {
      remaining = limit;
      resetAt += WINDOW_MS;
    }
    remaining--;
    const sent = t;
    t += latency;
    if (left === 1) break;
    const budget = { remaining, limit, resetMs: Math.max(0, resetAt - t) };
    const delay = delayAfter(budget, rules, left - 1);
    t = isBudgetWait(budget, rules) ? t + delay : Math.max(t, sent + delay);
  }
  if (beyond > 0) {
    const perWindow = Math.max(1, limit - reserveFor(limit, rules));
    t += (beyond / perWindow) * WINDOW_MS;
  }
  return t - pace.now;
}

/** A lane, as the model sees it: how it reads Reddit, what it learned, its budget. */
export interface LaneModel {
  backend: BackendName;
  /** Requests per comment, the threads in flight included. */
  cal: Calibration;
  /** The same from finished threads only, for the threads in flight. */
  doneCal?: Calibration;
  pace: Pace;
  rules: PacingRules;
}

export interface LaneEstimate {
  /** Seconds left, media included. */
  seconds: number;
  /** Requests still needed, by the model. */
  requests: number;
  /** Requests each lane is expected to make: for the lanes' own pacing. */
  web: number;
  api: number;
}

/**
 * Two lanes at once: the web pages find the posts and then load threads; the API
 * (a separate budget) loads threads from the start. Each lane alone would need
 * T_web or T_api for all the threads; together they share them, so after the
 * listing (L) the threads take D where D/T_api + (D-L)/T_web = 1.
 */
export function estimateLanes(work: WorkLeft, web: LaneModel, api: LaneModel | null): LaneEstimate {
  const media =
    work.mediaFiles *
    ((api ?? web).cal.mediaSeconds ?? web.cal.mediaSeconds ?? DEFAULT_MEDIA_SECONDS);
  if (!api) {
    const requests = requestsLeft(work, web.backend, web.cal, web.doneCal);
    const ms = timeForRequests(requests, web.pace, web.rules);
    return { seconds: ms / 1000 + media, requests, web: requests, api: 0 };
  }
  const threads = { ...work, listingPages: 0 };
  const rWeb = requestsLeft(threads, web.backend, web.cal, web.doneCal);
  const rApi = requestsLeft(threads, api.backend, api.cal, api.doneCal);
  const listing = timeForRequests(work.listingPages, web.pace, web.rules);
  const tWeb = timeForRequests(rWeb, web.pace, web.rules);
  const tApi = timeForRequests(rApi, api.pace, api.rules);
  let d: number;
  if (rApi === 0 || tApi === 0) d = listing;
  else if (tWeb === 0) d = Math.max(listing, tApi);
  else d = Math.max(listing, (1 + listing / tWeb) / (1 / tApi + 1 / tWeb));
  const apiShare = tApi > 0 ? Math.min(1, d / tApi) : 1;
  const apiRequests = Math.ceil(apiShare * rApi);
  const webRequests = work.listingPages + Math.ceil((1 - apiShare) * rWeb);
  return {
    seconds: d / 1000 + media,
    requests: apiRequests + webRequests,
    web: webRequests,
    api: apiRequests,
  };
}

/**
 * A steadier number for the screen (after Firefox's download estimate). The shown
 * time counts down by itself; a new estimate far below it (less than half) is
 * taken at once, otherwise it moves toward the new one: 30% of the way when it
 * falls, 10% when it rises, so one slow answer doesn't make the time left leap.
 * Small differences (under 5 s or 5%) are ignored. `jump` takes the new estimate
 * as is: for news the model is sure of, like a pause Reddit just announced.
 */
export class SteadyEta {
  private shown: number | null = null;
  private shownAt = 0;

  update(seconds: number | null, now: number, jump = false): number | null {
    if (seconds === null) return this.current(now);
    const current = this.current(now);
    if (current === null || jump || seconds < current / 2) return this.set(seconds, now);
    const diff = seconds - current;
    if (Math.abs(diff) < Math.max(5, current * 0.05)) return current;
    return this.set(current + (diff < 0 ? 0.3 : 0.1) * diff, now);
  }

  current(now: number): number | null {
    if (this.shown === null) return null;
    return Math.max(0, this.shown - (now - this.shownAt) / 1000);
  }

  private set(seconds: number, now: number): number {
    this.shown = seconds;
    this.shownAt = now;
    return seconds;
  }
}
