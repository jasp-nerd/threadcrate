// A polite HTTP client for Reddit: one request at a time, paced by Reddit's own
// rate-limit headers, with backoff when Reddit asks us to slow down.
//
// Reddit sends x-ratelimit-remaining / -used / -reset (seconds until the window
// resets) on its JSON API and on the web app's own /svc/shreddit endpoints. A
// logged-out browser gets roughly 225 requests per 10 minutes, a logged-in one
// more. The pacing rules are in pacing.ts: full speed when what's left fits in the
// window's budget, an even pace over the window otherwise, a reserve never spent,
// and a wait for the reset when only the reserve is left.
// A 429 waits for Retry-After (or the reset, or an exponential backoff with
// jitter, whichever is longest) and retries; repeated 429s give up. Pages that
// mean "you're blocked", "log in" or "prove you're human" stop the export at once:
// retrying those only makes things worse.

import { classifyPage, NOT_JSON, RedditError } from './errors';
import { delayAfter, isBudgetWait, NORMAL, type PacingRules } from './pacing';

export type WaitReason = 'pace' | 'budget' | 'throttled' | 'retry';

export interface RateStatus {
  /** Requests Reddit says are left in this window; null when it didn't say. */
  remaining: number | null;
  /** Window size (used + remaining), when known. */
  limit: number | null;
  /** When the window resets, ms since epoch. */
  resetAt: number | null;
  /** Set while we're holding off, until when (ms since epoch). */
  waitingUntil: number | null;
  reason: WaitReason | null;
  requests: number;
  throttles: number;
  /** Typical time from sending a request to having its whole answer (moving average). */
  latencyMs: number | null;
  /** The gap between requests while the budget is healthy. */
  minIntervalMs: number;
  /** When the request now out was sent, or null when none is. */
  inFlightSince: number | null;
  /** When the current wait began (see waitingUntil). */
  waitingSince: number | null;
}

export interface Reply {
  status: number;
  /** Final URL after redirects. */
  url: string;
  headers: Headers;
  text: string;
  /** The body as bytes, for `expect: 'bytes'`. */
  bytes?: Uint8Array;
}

/** One answer from Reddit, as the diagnostics report records it. */
export interface AnswerInfo {
  at: number;
  method: string;
  url: string;
  status: number;
  /** "tab" when it went through a Reddit tab (tab-fetch.ts), else "direct". */
  via: string;
  ms: number;
  contentType: string | null;
  rateLimit: { remaining: string | null; used: string | null; reset: string | null };
  /** For anything but a success: the start of the answer, tags stripped. */
  preview?: string;
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
  /**
   * The page the request is made from, as the browser's own Referer. Browsers only
   * send it for a same-origin page, so it counts through a Reddit tab (tab-fetch.ts);
   * from the extension's own page it is left out.
   */
  referrer?: string;
  /**
   * At least this long after the previous request was sent before this one goes,
   * whatever the pace (Reddit refuses some kinds of request that come too soon).
   */
  minGapMs?: number;
  /** 'json' fails unless Reddit answered with JSON; 'html' accepts any 200 text; 'bytes' is for media. */
  expect: 'json' | 'html' | 'bytes';
  /** For 'bytes': refuse bodies larger than this. */
  maxBytes?: number;
}

export interface ClientOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  random?: () => number;
  signal?: AbortSignal;
  /** Pacing rules (pacing.ts); NORMAL by default. */
  rules?: PacingRules;
  /** Overrides the rules' shortest gap (tests use 0). */
  minIntervalMs?: number;
  /** Requests the caller still expects to need, so a job that fits can finish at full speed. */
  workLeft?: () => number | null;
  /** Called whenever what we know about the rate limit changes. */
  onStatus?: (status: RateStatus) => void;
  /** Every answer, for the diagnostics report (no bodies of successful answers). */
  onAnswer?: (answer: AnswerInfo) => void;
  /**
   * Runs each request (with its waits) exclusively. Export tabs pass a Web Lock, so
   * two exports at once still send Reddit one request at a time between them. It
   * must give up waiting when `signal` aborts.
   */
  exclusive?: <T>(job: () => Promise<T>, signal?: AbortSignal) => Promise<T>;
}

const MAX_THROTTLE_RETRIES = 6;
const MAX_TRANSIENT_RETRIES = 4;
/** How long to wait for Reddit to start answering. */
const TIMEOUT_MS = 45_000;
/** How long a download may go without receiving anything. Big videos may take minutes in total. */
const IDLE_MS = 60_000;
/** Waits shorter than this are normal pacing, not worth telling the user about. */
const QUIET_WAIT_MS = 2_500;

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason as Error);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason as Error);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Reads a body, failing when nothing arrives for `idleMs`, and refusing more than `maxBytes`. */
async function readBody(res: Response, idleMs: number, maxBytes?: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const idle = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('download stalled')), idleMs);
    });
    let step: ReadableStreamReadResult<Uint8Array>;
    try {
      step = await Promise.race([reader.read(), idle]);
    } catch (error) {
      void reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      clearTimeout(timer);
    }
    if (step.done) break;
    chunks.push(step.value);
    size += step.value.byteLength;
    if (maxBytes && size > maxBytes) {
      void reader.cancel().catch(() => undefined);
      throw new RedditError('unexpected', res.url, res.status, 'file too large');
    }
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function numberHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Seconds from a Retry-After header (delta seconds or an HTTP date). */
export function retryAfterSeconds(headers: Headers, now: number): number | null {
  const raw = headers.get('retry-after');
  if (!raw) return null;
  const n = Number(raw);
  if (Number.isFinite(n)) return Math.max(0, n);
  const date = Date.parse(raw);
  return Number.isNaN(date) ? null : Math.max(0, (date - now) / 1000);
}

export function createRedditClient(options: ClientOptions = {}) {
  const doFetch = options.fetch ?? fetch.bind(globalThis);
  const sleep = options.sleep ?? abortableSleep;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const rules: PacingRules = {
    ...(options.rules ?? NORMAL),
    ...(options.minIntervalMs !== undefined ? { minIntervalMs: options.minIntervalMs } : {}),
  };
  const minInterval = rules.minIntervalMs;

  const status: RateStatus = {
    remaining: null,
    limit: null,
    resetAt: null,
    waitingUntil: null,
    reason: null,
    requests: 0,
    throttles: 0,
    latencyMs: null,
    minIntervalMs: minInterval,
    inFlightSince: null,
    waitingSince: null,
  };
  let nextAt = 0;
  /** When the last request was sent, for `minGapMs`. */
  let lastSentAt: number | null = null;
  let throttleStreak = 0;
  // One request at a time: the polite default, and Reddit's morechildren endpoint
  // refuses concurrent calls outright.
  let queue: Promise<unknown> = Promise.resolve();

  const emit = () => options.onStatus?.({ ...status });

  async function waitUntil(at: number, reason: WaitReason) {
    const ms = at - now();
    if (ms <= 0) return;
    const visible = ms >= QUIET_WAIT_MS || reason !== 'pace';
    if (visible) {
      status.waitingSince = now();
      status.waitingUntil = at;
      status.reason = reason;
      emit();
    }
    try {
      await sleep(ms, options.signal);
    } catch {
      throw new RedditError('aborted', '');
    } finally {
      if (visible) {
        status.waitingSince = null;
        status.waitingUntil = null;
        status.reason = null;
        emit();
      }
    }
  }

  /** Why the coming wait (until nextAt) happens: Reddit's budget, or ordinary pacing. */
  function waitReason(): WaitReason {
    const budget =
      status.remaining !== null &&
      status.limit !== null &&
      isBudgetWait({ remaining: status.remaining, limit: status.limit, resetMs: 0 }, rules);
    return budget ? 'budget' : 'pace';
  }

  /** Learns from the rate-limit headers and decides when the next request may start. */
  function learn(headers: Headers, sentAt: number) {
    const remaining = numberHeader(headers, 'x-ratelimit-remaining');
    const used = numberHeader(headers, 'x-ratelimit-used');
    const reset = numberHeader(headers, 'x-ratelimit-reset');
    const t = now();
    if (remaining === null || reset === null) {
      nextAt = Math.max(t, sentAt + minInterval);
      return;
    }
    const limit = used === null ? (status.limit ?? remaining) : Math.max(remaining + used, 1);
    status.remaining = remaining;
    status.limit = limit;
    status.resetAt = t + reset * 1000;
    const budget = { remaining, limit, resetMs: reset * 1000 };
    const delay = delayAfter(budget, rules, options.workLeft?.() ?? null);
    // Ordinary gaps count from the send; a wait for the reset from now.
    nextAt = isBudgetWait(budget, rules) ? t + delay : Math.max(t, sentAt + delay);
    emit();
  }

  function backoffMs(attempt: number, capSeconds: number, baseSeconds: number) {
    const seconds = Math.min(capSeconds, baseSeconds * 2 ** (attempt - 1));
    return seconds * (0.75 + random() / 2) * 1000;
  }

  async function attempt(url: string, opts: RequestOptions): Promise<Reply> {
    let throttles = 0;
    let transients = 0;
    let lastStatus: number | undefined;
    for (;;) {
      if (options.signal?.aborted) throw new RedditError('aborted', url);
      await waitUntil(
        opts.minGapMs && lastSentAt !== null
          ? Math.max(nextAt, lastSentAt + opts.minGapMs)
          : nextAt,
        waitReason(),
      );

      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
      const signal = options.signal
        ? AbortSignal.any([timeout.signal, options.signal])
        : timeout.signal;
      let reply: Reply;
      let headersArrived = false;
      let sentAt: number | undefined;
      try {
        status.requests++;
        sentAt = now();
        lastSentAt = sentAt;
        status.inFlightSince = sentAt;
        const res = await doFetch(url, {
          method: opts.method ?? 'GET',
          credentials: 'include',
          headers: {
            Accept:
              opts.expect === 'json'
                ? 'application/json'
                : opts.expect === 'html'
                  ? 'text/html,*/*'
                  : '*/*',
            ...(opts.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
            ...opts.headers,
          },
          body: opts.body,
          ...(opts.referrer ? { referrer: opts.referrer } : {}),
          signal,
        });
        // The time limit is for Reddit to start answering; after that, only stalls count.
        headersArrived = true;
        clearTimeout(timer);
        reply = { status: res.status, url: res.url || url, headers: res.headers, text: '' };
        if (opts.expect === 'bytes' && res.ok) {
          const declared = Number(res.headers.get('content-length') ?? 0);
          if (opts.maxBytes && declared > opts.maxBytes) {
            await res.body?.cancel();
            throw new RedditError('unexpected', url, res.status, 'file too large');
          }
          reply.bytes = await readBody(res, IDLE_MS, opts.maxBytes);
        } else {
          reply.text = new TextDecoder().decode(await readBody(res, IDLE_MS));
        }
      } catch (error) {
        if (error instanceof RedditError) throw error;
        if (options.signal?.aborted) throw new RedditError('aborted', url);
        // Network failure or timeout. A big file that stalled halfway isn't worth
        // downloading again and again.
        if (headersArrived && opts.expect === 'bytes') {
          throw new RedditError('transient', url, lastStatus, 'download stalled');
        }
        nextAt = Math.max(now(), (sentAt ?? now()) + minInterval);
        if (++transients > MAX_TRANSIENT_RETRIES)
          throw new RedditError('transient', url, lastStatus);
        await waitUntil(now() + backoffMs(transients, 30, 2), 'retry');
        continue;
      } finally {
        clearTimeout(timer);
        status.inFlightSince = null;
      }

      // A moving average of how long answers take, for the time-left estimate.
      const took = now() - (sentAt ?? now());
      status.latencyMs = status.latencyMs === null ? took : status.latencyMs * 0.8 + took * 0.2;
      if (options.onAnswer) {
        const failed = reply.status >= 400 || (opts.expect === 'json' && !isJson(reply));
        options.onAnswer({
          at: now(),
          method: opts.method ?? 'GET',
          url: reply.url,
          status: reply.status,
          via: reply.headers.get('x-threadcrate-via') ?? 'direct',
          ms: took,
          contentType: reply.headers.get('content-type'),
          rateLimit: {
            remaining: reply.headers.get('x-ratelimit-remaining'),
            used: reply.headers.get('x-ratelimit-used'),
            reset: reply.headers.get('x-ratelimit-reset'),
          },
          ...(failed && { preview: textPreview(reply.text, 300) }),
        });
      }
      learn(reply.headers, sentAt ?? now());

      if (reply.status === 429) {
        status.throttles++;
        throttleStreak++;
        if (++throttles > MAX_THROTTLE_RETRIES) throw new RedditError('throttled', url, 429);
        const retryAfter = retryAfterSeconds(reply.headers, now()) ?? 0;
        const reset = numberHeader(reply.headers, 'x-ratelimit-reset') ?? 0;
        // A second past the reset, so the retry lands in the new window.
        const wait = Math.max(
          retryAfter * 1000,
          reset > 0 ? reset * 1000 + 1_000 : 0,
          backoffMs(throttleStreak, 600, 10),
        );
        nextAt = now() + wait;
        await waitUntil(nextAt, 'throttled');
        continue;
      }

      // Any answer but "too many requests" ends a run of them.
      throttleStreak = 0;
      const page = classifyPage(reply);
      if (page) throw new RedditError(page, url, reply.status);

      if (reply.status >= 500) {
        lastStatus = reply.status;
        if (++transients > MAX_TRANSIENT_RETRIES)
          throw new RedditError('transient', url, reply.status);
        await waitUntil(now() + backoffMs(transients, 30, 2), 'retry');
        continue;
      }
      if (reply.status === 404) throw new RedditError('notfound', url, 404, jsonReason(reply.text));
      if (reply.status === 401 || reply.status === 403) {
        // Reddit's block page was caught above; any other refusal is about this one
        // thing (a private community, an expired media link) and not the whole export.
        throw new RedditError('forbidden', url, reply.status, jsonReason(reply.text));
      }
      if (reply.status >= 400) throw new RedditError('unexpected', url, reply.status);
      if (opts.expect === 'json' && !isJson(reply)) {
        throw new RedditError('unexpected', url, reply.status, NOT_JSON);
      }
      return reply;
    }
  }

  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const exclusive = options.exclusive;
    const guarded = exclusive
      ? () =>
          // Stopped before our turn came: don't start waiting for one.
          (options.signal?.aborted
            ? Promise.reject(new RedditError('aborted', ''))
            : Promise.resolve()
          )
            .then(() =>
              exclusive(async () => {
                try {
                  return await job();
                } finally {
                  // Keep the turn through the pause that follows, so two tabs together
                  // still go at Reddit's pace, not twice it.
                  await waitUntil(nextAt, waitReason()).catch(() => undefined);
                }
              }, options.signal),
            )
            .catch((error: unknown) => {
              // Stopped while waiting for the other tab's turn to end.
              if (options.signal?.aborted && !(error instanceof RedditError))
                throw new RedditError('aborted', '');
              throw error;
            })
      : job;
    const run = queue.then(guarded, guarded);
    queue = run.catch(() => undefined);
    return run;
  }

  return {
    request(url: string, opts: RequestOptions): Promise<Reply> {
      return enqueue(() => attempt(url, opts));
    },

    async json<T>(url: string, opts: Omit<RequestOptions, 'expect'> = {}): Promise<T> {
      const reply = await enqueue(() => attempt(url, { ...opts, expect: 'json' }));
      try {
        return JSON.parse(reply.text) as T;
      } catch {
        throw new RedditError('unexpected', url, reply.status, 'invalid JSON');
      }
    },

    async html(url: string, opts: Omit<RequestOptions, 'expect'> = {}): Promise<string> {
      return (await enqueue(() => attempt(url, { ...opts, expect: 'html' }))).text;
    },

    /** A media file. */
    async bytes(
      url: string,
      maxBytes?: number,
    ): Promise<{ data: Uint8Array; type: string | null; url: string }> {
      const reply = await enqueue(() => attempt(url, { expect: 'bytes', maxBytes }));
      return {
        data: reply.bytes ?? new Uint8Array(),
        type: reply.headers.get('content-type'),
        // Where it came from after redirects.
        url: reply.url,
      };
    },

    get status(): RateStatus {
      return { ...status };
    },
  };
}

export type RedditClient = ReturnType<typeof createRedditClient>;

function isJson(reply: Reply): boolean {
  const type = reply.headers.get('content-type') ?? '';
  if (type.includes('json')) return true;
  const start = reply.text.trimStart()[0];
  return (start === '{' || start === '[') && !type.includes('html');
}

function jsonReason(text: string): string | undefined {
  try {
    const body = JSON.parse(text) as { reason?: unknown; message?: unknown };
    if (typeof body.reason === 'string') return body.reason;
    if (typeof body.message === 'string') return body.message;
  } catch {
    // Not JSON.
  }
  return undefined;
}

/** The start of an answer as plain text, tags and scripts stripped: for diagnostics. */
export function textPreview(text: string, length: number): string {
  return text
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, length);
}
