// A fake clock and a scripted fetch, so client and backend tests run instantly
// and see exactly what was requested and how long the client chose to wait.

export interface FakeClock {
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Every wait the code asked for, in ms. */
  waits: number[];
}

export function fakeClock(start = Date.UTC(2026, 10, 15, 12)): FakeClock {
  let t = start;
  const waits: number[] = [];
  return {
    now: () => t,
    waits,
    sleep: (ms, signal) => {
      if (signal?.aborted) return Promise.reject(signal.reason as Error);
      waits.push(ms);
      t += ms;
      return Promise.resolve();
    },
  };
}

/** The page Reddit answers with when it refuses a request outright. */
export const BLOCKED_PAGE = "<html>You've been blocked by network security.</html>";

export interface Answer {
  status?: number;
  body?: string | object;
  headers?: Record<string, string>;
  /** Final URL after redirects; defaults to the request's. */
  url?: string;
}

export type Route = (url: URL, init: RequestInit) => Answer | undefined;

export interface FakeFetch {
  fetch: typeof fetch;
  calls: { method: string; url: string; body?: string }[];
}

/** A fetch that answers from routes; an unknown URL fails the test loudly. */
export function fakeFetch(...routes: Route[]): FakeFetch {
  const calls: FakeFetch['calls'] = [];
  const impl = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    calls.push({
      method: init.method ?? 'GET',
      url: url.href,
      body: init.body as string | undefined,
    });
    for (const route of routes) {
      const a = route(url, init);
      if (!a) continue;
      const body = typeof a.body === 'string' ? a.body : JSON.stringify(a.body ?? {});
      const isJson = typeof a.body === 'object';
      const res = new Response(body, {
        status: a.status ?? 200,
        headers: {
          'content-type': isJson ? 'application/json; charset=UTF-8' : 'text/html; charset=utf-8',
          ...a.headers,
        },
      });
      Object.defineProperty(res, 'url', { value: a.url ?? url.href });
      return Promise.resolve(res);
    }
    return Promise.reject(new Error(`unexpected request: ${init.method ?? 'GET'} ${url.href}`));
  };
  return { fetch: impl, calls };
}

export function rateHeaders(
  remaining: number,
  used: number,
  reset: number,
): Record<string, string> {
  return {
    'x-ratelimit-remaining': `${remaining}.0`,
    'x-ratelimit-used': String(used),
    'x-ratelimit-reset': String(reset),
  };
}
