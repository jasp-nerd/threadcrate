// A fake Reddit budget: a number of requests per 10-minute window, reported in
// x-ratelimit-* headers like Reddit does, and 429 when it's overspent. With the
// fake clock, answers can take time (`latencyMs`), to stand in for a slow network
// or a slow Reddit.
import type { FakeClock } from './fake';

export interface Budget {
  limit: number;
  windowMs: number;
  latencyMs: number;
  /** Requests answered 429 because the budget was spent. */
  overspent: number;
  requests: number;
}

export function budgetedFetch(
  clock: FakeClock,
  answer: (url: URL, init: RequestInit) => { body: string; type?: string; status?: number },
  options: Partial<Pick<Budget, 'limit' | 'windowMs' | 'latencyMs'>> = {},
): { fetch: typeof fetch; budget: Budget } {
  const budget: Budget = {
    limit: options.limit ?? 225,
    windowMs: options.windowMs ?? 600_000,
    latencyMs: options.latencyMs ?? 600,
    overspent: 0,
    requests: 0,
  };
  let windowStart = clock.now();
  let used = 0;
  const impl = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    while (clock.now() >= windowStart + budget.windowMs) {
      windowStart += budget.windowMs;
      used = 0;
    }
    budget.requests++;
    used++;
    const reset = Math.ceil((windowStart + budget.windowMs - clock.now()) / 1000);
    // The answer takes its time.
    await clock.sleep(budget.latencyMs);
    const headers = {
      'x-ratelimit-remaining': `${Math.max(0, budget.limit - used)}.0`,
      'x-ratelimit-used': String(used),
      'x-ratelimit-reset': String(reset),
    };
    if (used > budget.limit) {
      budget.overspent++;
      return new Response('Too Many Requests', {
        status: 429,
        headers: { ...headers, 'retry-after': String(reset) },
      });
    }
    const a = answer(url, init);
    const res = new Response(a.body, {
      status: a.status ?? 200,
      headers: { 'content-type': a.type ?? 'text/html; charset=utf-8', ...headers },
    });
    Object.defineProperty(res, 'url', { value: url.href });
    return res;
  };
  return { fetch: impl, budget };
}
