import type { RelayRequest, RelayResponse } from '../../messaging';
import { REDDIT } from '../../reddit/model';

/** Headers the export tab needs: pacing, retry and content type. */
const KEEP = /^(x-ratelimit-|retry-after$|content-type$)/i;

/** Requests in flight, so the export tab can abort one it gave up on. */
const inFlight = new Map<string, AbortController>();

export function relayAbort(id: string): void {
  inFlight.get(id)?.abort();
  inFlight.delete(id);
}

/**
 * Fetches a www.reddit.com URL from this page. Only same-origin GET and the
 * form POST that "more replies" uses are allowed, so nothing else can use the
 * page's session through this.
 */
export async function relayFetch(req: RelayRequest): Promise<RelayResponse> {
  const url = new URL(req.url);
  if (url.origin !== REDDIT || location.origin !== REDDIT)
    throw new Error('not a www.reddit.com request');
  if (
    req.method !== 'GET' &&
    !(req.method === 'POST' && url.pathname.startsWith('/svc/shreddit/more-comments/'))
  )
    throw new Error('request not allowed');
  // Firefox runs content-script fetch with the extension's identity; `content.fetch`
  // is the page's own. Chrome's content-script fetch already is the page's.
  const content = (globalThis as { content?: { fetch?: typeof fetch } }).content;
  const pageFetch = content?.fetch ? content.fetch.bind(content) : fetch;
  // The page the request comes from, as reddit.com's own script sends it ("more
  // comments" from the post's page): only ever a www.reddit.com address.
  let referrer: string | undefined;
  try {
    if (req.referrer && new URL(req.referrer).origin === REDDIT) referrer = req.referrer;
  } catch {
    // Not an address: no referrer of ours, the page's own.
  }
  const controller = new AbortController();
  inFlight.set(req.id, controller);
  try {
    const res = await pageFetch(url.toString(), {
      method: req.method,
      credentials: 'include',
      headers: req.headers,
      body: req.body,
      ...(referrer ? { referrer } : {}),
      signal: controller.signal,
    });
    const headers: [string, string][] = [];
    res.headers.forEach((value, name) => {
      if (KEEP.test(name)) headers.push([name, value]);
    });
    return { status: res.status, url: res.url || url.toString(), headers, text: await res.text() };
  } finally {
    inFlight.delete(req.id);
  }
}
