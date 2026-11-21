// One export, from a Reddit page to a set of files. Runs in the export tab.
//
// Nothing here throws away work: when Reddit blocks us, the user stops the export,
// or something unexpected breaks, the result still holds everything collected so
// far, marked as partial with the reason.
//
// Logged in, two lanes load threads at once, one per Reddit budget: the web pages
// (which also find the posts) and the API. Both take posts from one pool, and the
// files come out in listing order.

import {
  finishThread,
  PartialThreadError,
  type Backend,
  type BackendName,
} from '../reddit/backend';
import {
  createRedditClient,
  type ClientOptions,
  type RateStatus,
  type RedditClient,
} from '../reddit/client';
import {
  describeError,
  errorSummary,
  isAborted,
  isFatal,
  RedditError,
  refusesApi,
} from '../reddit/errors';
import { createHtmlBackend, resolveShareLink } from '../reddit/html-api';
import type { ParseHtml } from '../reddit/html-parse';
import { createJsonBackend } from '../reddit/json-api';
import { REDDIT, type Post, type Thread } from '../reddit/model';
import { FAST, NORMAL } from '../reddit/pacing';
import type { Target } from '../reddit/target';
import { CommentTree } from '../reddit/tree';
import { pickBackend, withFallback } from './backend-choice';
import { createDiagnostics } from './diagnostics';
import type { Lane } from './eta';
import { listingSize, readListing } from './listing';
import { createMediaQueue, MEDIA_WORKERS } from './media-download';
import type { ExportOptions } from './options';
import type { ExportResult } from './result';
import {
  capComments,
  estimateRun,
  learnFrom,
  loadsThreads,
  needsNoRequest,
  type QueuedPost,
  type RunState,
} from './run-estimate';

export type Phase = 'starting' | 'listing' | 'comments' | 'media' | 'done' | 'stopped' | 'failed';

export interface Progress {
  phase: Phase;
  backend: BackendName | null;
  /** Posts found so far (listing) and threads loaded. */
  postsListed: number;
  postsTarget: number;
  threadsDone: number;
  threadsTotal: number;
  /** The thread being loaded (the latest, when two load at once). */
  current: { title: string; loaded: number; expected: number | null } | null;
  /** Comments loaded so far of every thread still loading. */
  loadingComments: number;
  commentsTotal: number;
  mediaDone: number;
  mediaTotal: number;
  /** Reddit's budget for its web pages (and the export's waits). */
  rate: RateStatus;
  /** Reddit's separate budget for its API, when the API is in use. */
  apiRate: RateStatus | null;
  startedAt: number;
  /** Seconds left by the model in eta.ts; null until there's enough to go on. */
  etaSeconds: number | null;
  /** When etaSeconds was worked out (it counts down from then). */
  etaAt: number;
  /** Requests the model expects are still needed. */
  requestsLeft: number;
  /** Comments Reddit reported for the threads done and being done (for "x of ~y"). */
  commentsExpected: number;
  /** Finding more than 1000 posts: which of the lists is being read. */
  list: { label: string; index: number; total: number } | null;
  /** Posts read from lists, repeats included (postsListed counts each post once). */
  listedRaw: number;
}

export interface RunDeps {
  fetch?: typeof fetch;
  signal?: AbortSignal;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  parse?: ParseHtml;
  onProgress?: (p: Progress) => void;
  /** Gap between requests while Reddit's budget is healthy. */
  minIntervalMs?: number;
  /** A decision or problem worth showing in the activity log as it happens. */
  onNote?: (text: string) => void;
  /**
   * Runs each request exclusively across export tabs (a Web Lock in the browser),
   * one lock per budget: the web pages and the API are rationed separately.
   */
  exclusive?: <T>(job: () => Promise<T>, signal: AbortSignal | undefined, lane: Lane) => Promise<T>;
}

/** Posts in a row that may fail before the export stops. */
const MAX_FAILURES_IN_A_ROW = 8;

/** The next post for a lane: the API takes the biggest threads, the web pages the smallest. */
function takeNext(s: RunState, lane: Lane): QueuedPost {
  // Alone, the web pages go in listing order (a fair sample for the estimate).
  if (lane === 'web' && !s.apiLane) return s.pool.shift()!;
  const size = (i: QueuedPost) => capComments(i.post.num_comments, s.options) ?? 0;
  let at = 0;
  for (let i = 1; i < s.pool.length; i++) {
    const better =
      lane === 'api' ? size(s.pool[i]!) > size(s.pool[at]!) : size(s.pool[i]!) < size(s.pool[at]!);
    if (better) at = i;
  }
  return s.pool.splice(at, 1)[0]!;
}

/**
 * Reddit's budget as the page shows it. One lane waiting while another works is
 * not a pause of the export: a wait shows only when every lane at work is
 * waiting, and then the soonest.
 */
function shownRate(s: RunState): RateStatus {
  const { progress } = s;
  const active: RateStatus[] = [];
  if (progress.phase === 'listing' || s.inFlight.has('web')) active.push(progress.rate);
  if (progress.apiRate && s.apiLane && (progress.phase === 'listing' || s.inFlight.has('api')))
    active.push(progress.apiRate);
  if (!active.length || (active.length === 1 && active[0] === progress.rate)) return progress.rate;
  const waits = active.filter((r) => r.waitingUntil !== null);
  const soonest = waits.sort((a, b) => a.waitingUntil! - b.waitingUntil!)[0];
  return waits.length === active.length && soonest
    ? {
        ...progress.rate,
        waitingUntil: soonest.waitingUntil,
        reason: soonest.reason,
        waitingSince: soonest.waitingSince,
      }
    : { ...progress.rate, waitingUntil: null, reason: null, waitingSince: null };
}

export async function runExport(options: ExportOptions, deps: RunDeps = {}): Promise<ExportResult> {
  const now = deps.now ?? Date.now;
  const started = now();
  const idleRate = (): RateStatus => ({
    remaining: null,
    limit: null,
    resetAt: null,
    waitingUntil: null,
    reason: null,
    requests: 0,
    throttles: 0,
    latencyMs: null,
    minIntervalMs: deps.minIntervalMs ?? 1_000,
    inFlightSince: null,
    waitingSince: null,
  });
  const progress: Progress = {
    phase: 'starting',
    backend: null,
    postsListed: 0,
    postsTarget: options.target.kind === 'post' ? 1 : listingSize(options),
    threadsDone: 0,
    threadsTotal: options.target.kind === 'post' ? 1 : 0,
    current: null,
    loadingComments: 0,
    commentsTotal: 0,
    mediaDone: 0,
    mediaTotal: 0,
    rate: idleRate(),
    apiRate: null,
    startedAt: started,
    etaSeconds: null,
    etaAt: started,
    requestsLeft: 0,
    commentsExpected: 0,
    list: null,
    listedRaw: 0,
  };
  const state: RunState = {
    options,
    rules: options.speed === 'fast' ? FAST : NORMAL,
    progress,
    pool: [],
    listedComments: [],
    inFlight: new Map(),
    apiLane: false,
    listingLane: 'web',
    cal: {
      web: { comments: 0, requests: 0, mediaSeconds: null },
      api: { comments: 0, requests: 0, mediaSeconds: null },
    },
    requests: (lane) => clients[lane].status.requests,
  };
  const { pool, inFlight } = state;
  const capped = (n: number | null) => capComments(n, options);

  const emit = () => {
    if (progress.backend) {
      const e = estimateRun(state, now(), idleRate());
      progress.etaSeconds = e.seconds;
      progress.etaAt = now();
      progress.requestsLeft = e.requests;
    }
    progress.loadingComments = [...inFlight.values()].reduce((n, c) => n + c.loaded, 0);
    deps.onProgress?.({
      ...progress,
      current: progress.current && { ...progress.current },
      rate: shownRate(state),
    });
  };

  // A stop of the whole export: by the user, or by an error no lane can carry on from.
  const stop = new AbortController();
  const onUserStop = () => stop.abort();
  deps.signal?.addEventListener('abort', onUserStop, { once: true });
  if (deps.signal?.aborted) stop.abort();

  const diagnostics = createDiagnostics(now, deps.onNote);
  const note = diagnostics.note;

  const client = (o: ClientOptions) =>
    createRedditClient({
      fetch: deps.fetch,
      signal: stop.signal,
      now: deps.now,
      sleep: deps.sleep,
      ...o,
    });
  /** Reddit's web pages and its API each have their own budget, so each has a client. */
  const laneClient = (lane: Lane) =>
    client({
      rules: state.rules,
      minIntervalMs: deps.minIntervalMs,
      // The same figures the estimate uses, so the pace and the time shown agree.
      workLeft: () => (progress.backend ? estimateRun(state, now(), idleRate())[lane] : null),
      exclusive: deps.exclusive && ((job, signal) => deps.exclusive!(job, signal, lane)),
      onStatus: (rate) => {
        if (lane === 'web') progress.rate = rate;
        else progress.apiRate = rate;
        emit();
      },
      onAnswer: diagnostics.answer,
    });
  const clients: Record<Lane, RedditClient> = { web: laneClient('web'), api: laneClient('api') };

  const result: ExportResult = {
    options,
    backend: null,
    startedAt: new Date(started).toISOString(),
    finishedAt: '',
    status: 'complete',
    error: null,
    errorKind: null,
    errorUrl: null,
    threads: [],
    posts: [],
    standaloneComments: [],
    postFailures: [],
    media: [],
    mediaFailures: [],
    requests: 0,
    throttles: 0,
    diagnostics: diagnostics.entries,
  };

  // Media: files come from Reddit's and Imgur's media hosts, not from the pages
  // the budget counts, so a few download at once while the comments still load.
  const media = createMediaQueue({
    enabled: options.includeMedia,
    // Media hosts have their own budget; a lighter pace keeps big downloads moving.
    makeClient: () => client({ minIntervalMs: Math.min(250, deps.minIntervalMs ?? 250) }),
    signal: stop.signal,
    out: { files: result.media, failures: result.mediaFailures },
    now,
    onDone: (files, seconds) => {
      // Seconds per file, as a moving average; files download a few at a time.
      const per = seconds / Math.max(1, files) / MEDIA_WORKERS;
      const c = state.cal.web;
      c.mediaSeconds = c.mediaSeconds === null ? per : c.mediaSeconds * 0.7 + per * 0.3;
      state.cal.api.mediaSeconds = c.mediaSeconds;
      progress.mediaDone += files;
      emit();
    },
  });
  /** Queues a finished post's media, and counts it for the progress. */
  const addMedia = (post: Post) => {
    if (!options.includeMedia) return;
    progress.mediaTotal += post.media.length;
    media.add(post);
  };

  const threadOptions = (
    lane: Lane,
    post: { title: string; subreddit: string | null; permalink?: string | null },
  ) => ({
    sort: options.commentSort,
    maxComments: options.maxComments,
    subreddit: post.subreddit,
    permalink: post.permalink ?? null,
    onProgress: (loaded: number, expected: number | null, read: Post) => {
      // A single post's media is known from its first page: count it in the progress now.
      if (options.includeMedia && options.target.kind === 'post')
        progress.mediaTotal = read.media.length;
      // With a comment limit, the limit is what "done" means.
      const goal = expected === null ? null : Math.min(expected, options.maxComments);
      const cur = inFlight.get(lane);
      if (cur) Object.assign(cur, { title: read.title || post.title, loaded, expected: goal });
      progress.current = { title: read.title || post.title, loaded, expected: goal };
      emit();
    },
  });

  const htmlBackend = createHtmlBackend(clients.web, deps.parse);
  const jsonBackend = createJsonBackend(clients.api);
  // Even when the API was chosen: if Reddit refuses it, the web pages beat failing.
  const json = withFallback(jsonBackend, htmlBackend, (what) => {
    note(
      what === 'listings'
        ? 'Reddit refused its API for listings: finding posts through its web pages'
        : 'Reddit refused its API for comments: loading them through its web pages',
    );
    if (what === 'listings') state.listingLane = 'web';
    else state.apiLane = false;
    result.backend = progress.backend = json.name;
    emit();
  });

  /** The first error that ends the export (the user stopping it included). */
  let fatal: Error | null = null;
  const fail = (error: unknown) => {
    fatal ??=
      error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'stopped');
    stop.abort();
  };

  /** One post and its comments. */
  async function exportPost(target: Extract<Target, { kind: 'post' }>, backend: Backend) {
    progress.phase = 'comments';
    emit();
    const lane: Lane = state.apiLane ? 'api' : 'web';
    let thread;
    // In progress from the start, so the estimate never sees "nothing left" before
    // the post's first page arrives.
    inFlight.set(lane, {
      title: '',
      loaded: 0,
      expected: null,
      startRequests: clients[lane].status.requests,
    });
    progress.current = { title: '', loaded: 0, expected: null };
    try {
      let post: { id: string; subreddit: string | null; permalink?: string | null } = target;
      // A share link: one request to Reddit says which post it is.
      if (target.share) post = await resolveShareLink(clients.web, target.share, deps.parse);
      thread = await backend.thread(
        post.id,
        threadOptions(lane, { title: '', subreddit: post.subreddit, permalink: post.permalink }),
      );
    } catch (error) {
      // Stopped or blocked partway: keep the comments loaded so far.
      if (error instanceof PartialThreadError) {
        result.threads.push(error.thread);
        throw error.cause;
      }
      throw error;
    } finally {
      inFlight.delete(lane);
    }
    result.threads.push(thread);
    progress.threadsDone = 1;
    progress.postsListed = 1;
    progress.commentsExpected = capped(thread.post.num_comments) ?? thread.comment_count;
    progress.commentsTotal = thread.comment_count;
    progress.current = null;
    addMedia(thread.post);
  }

  /** A listing's posts, with their threads when asked for, loaded by both lanes while listing goes on. */
  async function exportListing(target: Exclude<Target, { kind: 'post' }>, backend: Backend) {
    progress.phase = 'listing';
    emit();
    /** Threads and posts as they finish, put back in listing order at the end. */
    const doneThreads: { index: number; thread: Thread }[] = [];
    const donePosts: { index: number; post: Post }[] = [];
    let listingDone = false;
    const waiting: (() => void)[] = [];
    const wake = () => {
      for (const w of waiting.splice(0)) w();
    };
    stop.signal.addEventListener('abort', wake, { once: true });
    let failedInARow = 0;
    /** Threads the API loaded, for which way the export says it read Reddit. */
    let apiThreads = 0;

    const next = async (lane: Lane): Promise<QueuedPost | null> => {
      for (;;) {
        if (stop.signal.aborted) return null;
        if (pool.length) return takeNext(state, lane);
        if (listingDone) return null;
        await new Promise<void>((resolve) => waiting.push(resolve));
      }
    };

    /** Loads one thread; false when the lane should stop (the API refused, or the export ended). */
    const load = async (lane: Lane, item: QueuedPost): Promise<boolean> => {
      const post = item.post;
      if (needsNoRequest(item, options)) {
        doneThreads.push({
          index: item.index,
          thread: finishThread(post, new CommentTree(post.name), [], options.maxComments),
        });
        progress.threadsDone++;
        addMedia(post);
        emit();
        return true;
      }
      const requestsBefore = clients[lane].status.requests;
      const expected = options.includeComments ? capped(post.num_comments) : 0;
      inFlight.set(lane, { title: post.title, loaded: 0, expected, startRequests: requestsBefore });
      // Current from the start (not from its first page), so its title shows at once.
      progress.current = { title: post.title, loaded: 0, expected };
      emit();
      try {
        const opts = {
          ...threadOptions(lane, post),
          // Search results on the web pages need their post page for the post's own data.
          maxComments: options.includeComments ? options.maxComments : 0,
        };
        const thread = await (lane === 'api' ? jsonBackend : htmlBackend).thread(post.id, opts);
        if (lane === 'api') apiThreads++;
        if (!options.includeComments) {
          donePosts.push({ index: item.index, post: thread.post });
        } else {
          doneThreads.push({ index: item.index, thread });
          progress.commentsTotal += thread.comment_count;
          progress.commentsExpected += capped(thread.post.num_comments) ?? thread.comment_count;
          learnFrom(state, lane, thread, clients[lane].status.requests - requestsBefore);
        }
        addMedia(thread.post);
        failedInARow = 0;
      } catch (error) {
        const partial = error instanceof PartialThreadError ? error : null;
        const cause = partial ? partial.cause : error;
        // The API refusing (or rationing) comments: the web pages take this post and the rest.
        if (lane === 'api' && !stop.signal.aborted && (refusesApi(cause) || isFatal(cause))) {
          pool.push(item);
          state.apiLane = false;
          // Nothing came through the API after all: the export is the web pages'.
          if (!apiThreads) result.backend = progress.backend = 'html';
          note(
            `Reddit stopped answering its API for comments (${errorSummary(cause)}): the web pages load the rest`,
          );
          wake();
          return false;
        }
        if (partial || isFatal(error) || stop.signal.aborted) {
          // Keep this thread as far as it got.
          if (partial && options.includeComments)
            doneThreads.push({ index: item.index, thread: partial.thread });
          else donePosts.push({ index: item.index, post: partial ? partial.thread.post : post });
          fail(cause);
          return false;
        }
        donePosts.push({ index: item.index, post });
        result.postFailures.push({
          post_id: post.id,
          title: post.title,
          reason: error instanceof Error ? error.message : String(error),
        });
        // Post after post refused: Reddit is refusing us, not these posts. Stop asking.
        if (++failedInARow >= MAX_FAILURES_IN_A_ROW) {
          fail(
            new Error(
              `Reddit refused ${MAX_FAILURES_IN_A_ROW} posts in a row (the last: ${result.postFailures.at(-1)!.reason}). Try again later.`,
              { cause: error },
            ),
          );
          return false;
        }
      } finally {
        inFlight.delete(lane);
        if (!inFlight.size) progress.current = null;
      }
      progress.threadsDone++;
      emit();
      return true;
    };

    const worker = async (lane: Lane) => {
      for (;;) {
        if (lane === 'api' && !state.apiLane) return;
        const item = await next(lane);
        if (!item) return;
        if (!(await load(lane, item))) return;
      }
    };

    // The API starts on comments while the web pages are still finding posts.
    let apiWorker: Promise<void> = Promise.resolve();
    const startApi = () => {
      if (state.apiLane && loadsThreads(options)) apiWorker = worker('api');
    };

    let index = 0;
    let listed = false;
    try {
      for await (const item of readListing(backend, target, options, progress, emit)) {
        if (item.kind === 'post') {
          state.listedComments.push(item.post.num_comments ?? 0);
          const entry = { post: item.post, complete: item.complete, index: index++ };
          if (options.includeComments || !item.complete) {
            pool.push(entry);
            progress.threadsTotal++;
            wake();
          } else {
            donePosts.push({ index: entry.index, post: item.post });
            addMedia(item.post);
          }
        } else result.standaloneComments.push(item.comment);
        progress.postsListed = index + result.standaloneComments.length;
        // The listing lane is known once the first page came: start the API on comments.
        if (!listed) {
          listed = true;
          if (state.listingLane === 'web') startApi();
        }
        emit();
      }
    } catch (error) {
      fail(error);
    }
    listingDone = true;
    progress.list = null;
    if (!fatal) {
      progress.phase = 'comments';
      emit();
      // Profiles are listed by the API: it starts on comments only now.
      if (!listed || state.listingLane === 'api') startApi();
      wake();
      await Promise.all([apiWorker, worker('web')]);
      // The API gave up after the web pages had finished: they take what it left.
      if (!fatal && pool.length) await worker('web');
    } else {
      wake();
      await apiWorker;
    }
    // Stopped between two posts: no request failed, but it's a stop all the same.
    if (stop.signal.aborted && !fatal) fail(new RedditError('aborted', ''));
    // Everything not loaded keeps the listing's summary of it.
    for (const item of pool.splice(0)) donePosts.push({ index: item.index, post: item.post });
    doneThreads.sort((a, b) => a.index - b.index);
    donePosts.sort((a, b) => a.index - b.index);
    result.threads.push(...doneThreads.map((d) => d.thread));
    result.posts.push(...donePosts.map((d) => d.post));
  }

  try {
    emit();
    const backend = await pickBackend(
      options.backend,
      json,
      htmlBackend,
      () => clients.api.json(`${REDDIT}/api/me.json?raw_json=1`),
      note,
    );
    result.backend = progress.backend = backend.name;
    state.apiLane = backend === json;
    if (state.apiLane) state.listingLane = 'api';

    if (options.target.kind === 'post') await exportPost(options.target, backend);
    else await exportListing(options.target, backend);
    // Set from inside the lanes, where TypeScript's narrowing can't follow it.
    const reason = fatal as Error | null;
    if (reason) throw reason;

    if (options.includeMedia) {
      progress.phase = 'media';
      emit();
      await media.finish();
    }
    progress.phase = 'done';
  } catch (error) {
    // The user stopping is the reason, whatever error it caused on the way.
    const cause = deps.signal?.aborted ? new RedditError('aborted', '') : (fatal ?? error);
    const aborted = isAborted(cause);
    result.status = aborted ? 'stopped' : 'failed';
    progress.phase = aborted ? 'stopped' : 'failed';
    result.error = describeError(cause);
    result.errorKind = cause instanceof RedditError ? cause.kind : 'unexpected';
    // Which request failed, so a bug report can say where Reddit refused.
    result.errorUrl = cause instanceof RedditError && cause.url ? cause.url : null;
    stop.abort();
    await media.finish().catch(() => undefined);
  } finally {
    deps.signal?.removeEventListener('abort', onUserStop);
  }
  result.requestsByKind = diagnostics.requestsByKind();
  result.media.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  result.finishedAt = new Date(now()).toISOString();
  result.requests = clients.web.status.requests + clients.api.status.requests + media.requests();
  result.throttles =
    clients.web.status.throttles + clients.api.status.throttles + media.throttles();
  emit();
  return result;
}
