// What the export page says about an export in progress. Kept apart from the page
// so the wording rules are tested. The choices follow research on waiting (see
// docs/progress.md): time left in rounded words leaning a little high, pauses
// explained with an exact countdown, a position ("post 21 of 250") over raw
// numbers, and a bar that tracks time, so it keeps moving through pauses.

import type { ExportOptions } from './options';
import type { Phase, Progress } from './run';

const nf = new Intl.NumberFormat('en-US');
export const count = (n: number) => nf.format(n);

/** "1 post", "1,340 comments". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${count(n)} ${n === 1 ? one : many}`;
}

/** "About 12 minutes left" and, for long exports, "done around 21:40". */
export function timeLeft(
  seconds: number | null,
  now: Date,
  locale?: string,
): { text: string; finish: string | null } {
  if (seconds === null) return { text: 'Estimating time…', finish: null };
  // A little high: finishing early pleases far more than finishing late annoys.
  const s = seconds * 1.05;
  let text: string;
  if (s < 50) text = 'Less than a minute left';
  else if (s < 100) text = 'About a minute left';
  else if (s < 10 * 60) text = `About ${Math.ceil(s / 60)} minutes left`;
  else if (s < 60 * 60) text = `About ${Math.ceil(s / 60 / 5) * 5} minutes left`;
  else {
    const totalMinutes = Math.ceil(s / 60 / 10) * 10;
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    text = `About ${plural(h, 'hour')}${m ? ` ${m} minutes` : ''} left`;
  }
  const finish =
    s >= 15 * 60
      ? `done around ${new Date(now.getTime() + s * 1000).toLocaleTimeString(locale ?? [], { hour: '2-digit', minute: '2-digit' })}`
      : null;
  return { text, finish };
}

/** What the activity log (and a screen reader) says as the export enters a phase. */
export function phaseNote(phase: Phase, o: ExportOptions): string {
  switch (phase) {
    case 'starting':
      return 'Connecting to Reddit';
    case 'listing':
      return 'Finding posts';
    case 'comments':
      return o.target.kind === 'post'
        ? 'Loading the post and its comments'
        : o.includeComments
          ? 'Loading posts and comments'
          : 'Loading each post';
    case 'media':
      return 'Downloading images and videos';
    case 'done':
      return 'Saving the export';
    case 'stopped':
      return 'Stopped';
    case 'failed':
      return 'Stopped early';
  }
}

/** "3:12", "42 s". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface LogEntry {
  at: number;
  text: string;
}

export interface Pause {
  title: string;
  detail: string;
  seconds: number;
}

/** A wait the person should know about, in plain words, or null. Ordinary pacing isn't one. */
export function pause(p: Progress, now: number): Pause | null {
  const r = p.rate;
  if (!r.waitingUntil || r.waitingUntil <= now || !r.reason) return null;
  const seconds = (r.waitingUntil - now) / 1000;
  switch (r.reason) {
    case 'pace':
      // The usual few seconds between requests aren't worth a word; a long gap,
      // near the end of a window with much left to do, is.
      if (r.waitingUntil - (r.waitingSince ?? now) < 10_000) return null;
      return {
        title: `Waiting for Reddit's limit, next step in ${clock(seconds)}`,
        detail:
          'Reddit allows a set amount every 10 minutes. The export spreads it out so it never has to stop for long.',
        seconds,
      };
    case 'budget':
      return {
        title: `Paused, resuming in ${clock(seconds)}`,
        detail:
          'Reddit limits how much can be read every 10 minutes. The export carries on by itself when the limit resets; nothing is lost.',
        seconds,
      };
    case 'throttled':
      return {
        title: `Reddit asked to slow down, trying again in ${clock(seconds)}`,
        detail:
          'This happens when Reddit is busy. The export waits as long as Reddit asks, then carries on.',
        seconds,
      };
    case 'retry':
      return {
        title: `Reddit didn't answer, trying again in ${clock(seconds)}`,
        detail:
          'A network hiccup or a slow moment at Reddit. It retries a few times before giving up.',
        seconds,
      };
  }
}

/** True while one request has been out for a long time. */
export function slowAnswer(p: Progress, now: number): boolean {
  return p.rate.inFlightSince !== null && now - p.rate.inFlightSince > 8_000;
}

/** While posts are still being found, the API may already be loading comments. */
function loadedAlready(p: Progress): string {
  return p.threadsDone > 0 ? `, comments of ${count(p.threadsDone)} loaded` : '';
}

/** Where the export is, as a position: "Post 21 of 250, 1,340 comments so far". */
export function position(p: Progress, o: ExportOptions): string {
  const comments = p.commentsTotal + p.loadingComments;
  switch (p.phase) {
    case 'starting':
      return 'Connecting to Reddit…';
    case 'listing':
      return p.list
        ? `Finding posts: ${plural(p.postsListed, 'post')} so far, ${p.list.label} (list ${p.list.index + 1} of ${p.list.total})${loadedAlready(p)}`
        : `Finding posts: ${count(p.postsListed)} of up to ${count(p.postsTarget)}${loadedAlready(p)}`;
    case 'comments':
      if (o.target.kind === 'post') {
        const cur = p.current;
        if (!cur) return 'Loading the post…';
        return cur.expected !== null && cur.expected > 0
          ? `${count(cur.loaded)} of about ${plural(cur.expected, 'comment')}`
          : plural(cur.loaded, 'comment');
      }
      if (p.threadsTotal === 0) return 'Finishing…';
      return `Post ${count(Math.min(p.threadsDone + 1, p.threadsTotal))} of ${count(p.threadsTotal)}${
        o.includeComments ? `, ${plural(comments, 'comment')} so far` : ''
      }`;
    case 'media':
      if (p.mediaTotal === 0) return 'Finishing…';
      return `Media file ${count(Math.min(p.mediaDone + 1, p.mediaTotal))} of ${count(p.mediaTotal)}`;
    default:
      return 'Finishing…';
  }
}

/**
 * How far the whole export is, 0 to 1, weighing each phase by the requests it
 * roughly takes: a listing page brings 25 posts, a post's comments take a couple
 * of requests, a media file a fraction of one (its hosts are quicker).
 */
export function overallFraction(
  p: Progress,
  o: Pick<ExportOptions, 'target' | 'includeComments' | 'includeMedia'>,
): number {
  if (p.phase === 'done') return 1;
  const single = o.target.kind === 'post';
  const listing = single ? 0 : Math.max(1, Math.ceil(p.postsTarget / 25));
  const loadsThreads = single || o.includeComments || o.target.kind === 'search';
  const threads = loadsThreads ? (p.phase === 'listing' ? p.postsTarget : p.threadsTotal) * 2 : 0;
  const media = o.includeMedia ? p.mediaTotal * 0.5 : 0;
  const total = listing + threads + media;
  if (!total) return 0;

  const cur = p.current;
  const part = cur?.expected ? Math.min(1, cur.loaded / Math.max(cur.expected, 1)) : 0;
  let done = 0;
  if (p.phase === 'listing') done = p.postsTarget ? (p.postsListed / p.postsTarget) * listing : 0;
  else if (p.phase === 'comments') done = listing + (p.threadsDone + part) * 2;
  else if (p.phase === 'media') done = listing + threads + p.mediaDone * 0.5;
  return Math.max(0, Math.min(1, done / total));
}

/** The bar: the share of the time spent, once there's an estimate. */
export function timeShare(p: Progress, now: number, fallback: number): number {
  if (p.phase === 'done') return 1;
  // No estimate, or "nothing left" while not done (a moment between steps): the
  // time share would say 99%, and the bar never goes back.
  if (p.etaSeconds === null || p.etaSeconds <= 0) return fallback;
  const spent = (now - p.startedAt) / 1000;
  const total = spent + p.etaSeconds;
  return total > 0 ? Math.min(0.99, spent / total) : fallback;
}

/** What stopping now would keep, beside the Stop button: "Keeps 12 posts, 340 comments". */
export function keptSoFar(p: Progress | null): string {
  if (!p) return '';
  const posts = Math.max(p.threadsDone, p.phase === 'listing' ? p.postsListed : 0);
  const comments = p.commentsTotal + p.loadingComments;
  const parts = [
    posts ? plural(posts, 'post') : '',
    comments ? plural(comments, 'comment') : '',
  ].filter(Boolean);
  return parts.length ? `Keeps ${parts.join(', ')}` : '';
}

/** Finished in 23 minutes. */
export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return plural(s, 'second');
  const m = Math.round(s / 60);
  if (m < 60) return plural(m, 'minute');
  const h = Math.floor(m / 60);
  return `${plural(h, 'hour')}${m % 60 ? ` ${plural(m % 60, 'minute')}` : ''}`;
}
