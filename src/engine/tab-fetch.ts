// Sends the export's www.reddit.com requests through a Reddit tab.
//
// Requests from the extension's own page carry reddit.com's cookies only when the
// browser allows third-party cookies for extensions. Without them (Brave, Arc,
// Chrome with third-party cookies blocked), Reddit gets a request without the
// person's cookies and answers "blocked by network security". A request made
// by the content script in a reddit.com tab is the page's own, same-origin
// request, with its cookies, so it gets what the page gets. The pacing stays here,
// in the client; the tab only carries out each request.

import { browser } from 'wxt/browser';
import { REDDIT_TABS } from '../hosts';
import { sendMessage, type RelayResponse } from '../messaging';
import { REDDIT } from '../reddit/model';
const READY_TIMEOUT_MS = 30_000;

export interface TabFetch {
  fetch: typeof fetch;
  /** Closes the Reddit tab this opened, if it opened one. */
  close(): Promise<void>;
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

/** How long a tab may take to say it's ready; a frozen or discarded tab never does. */
const READY_ANSWER_MS = 5_000;
/** A tab that relayed this recently is taken as still ready, without asking. */
const FRESH_MS = 30_000;

async function ready(tabId: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      sendMessage('relayReady', undefined, tabId).then((ok) => ok === true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), READY_ANSWER_MS);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function createTabFetch(options: {
  preferredTabId?: number;
  direct?: typeof fetch;
}): TabFetch {
  const direct = options.direct ?? fetch.bind(globalThis);
  let tabId: number | null = null;
  let opened: number | null = null;
  /** When the relay tab last answered a request. */
  let lastRelayed = 0;

  /** A www.reddit.com tab with our content script in it, opening one if there's none. */
  async function relayTab(): Promise<number | null> {
    if (tabId !== null && Date.now() - lastRelayed < FRESH_MS) return tabId;
    if (tabId !== null && (await ready(tabId))) return tabId;
    tabId = null;
    const candidates: number[] = [];
    if (options.preferredTabId !== undefined) candidates.push(options.preferredTabId);
    for (const tab of await browser.tabs.query({ url: REDDIT_TABS })) {
      if (tab.id !== undefined && !candidates.includes(tab.id)) candidates.push(tab.id);
    }
    for (const id of candidates) {
      if (await ready(id)) return (tabId = id);
    }
    // None open (or the one we opened isn't ready yet): open one in the background,
    // once, and wait for its page (and Reddit's check, if it shows one) to load.
    if (opened === null) {
      const tab = await browser.tabs.create({ url: `${REDDIT}/`, active: false });
      if (tab.id === undefined) return null;
      opened = tab.id;
    }
    if (await waitUntilReady(opened)) return (tabId = opened);
    return null;
  }

  /**
   * Waits for a tab's content script, checking each time the tab finishes loading
   * and every few seconds (tab events aren't throttled in a hidden page; timers are).
   */
  async function waitUntilReady(id: number): Promise<boolean> {
    if (await ready(id)) return true;
    return new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        browser.tabs.onUpdated.removeListener(onUpdated);
        clearInterval(poll);
        clearTimeout(timeout);
        resolve(ok);
      };
      const check = () => void ready(id).then((ok) => ok && finish(true));
      const onUpdated = (updated: number, info: { status?: string }) => {
        if (updated === id && info.status === 'complete') check();
      };
      browser.tabs.onUpdated.addListener(onUpdated);
      const poll = setInterval(check, 2_000);
      const timeout = setTimeout(() => finish(false), READY_TIMEOUT_MS);
    });
  }

  async function viaTab(url: string, init: RequestInit): Promise<Response> {
    const signal = init.signal ?? undefined;
    if (signal?.aborted) throw abortError();
    const id = await relayTab();
    // No Reddit tab to be had: the direct request is the best left.
    if (id === null) return direct(url, init);
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, name) => (headers[name] = value));
    const requestId = crypto.randomUUID();
    let reply: RelayResponse;
    try {
      reply = await new Promise<RelayResponse>((resolve, reject) => {
        const onAbort = () => {
          // Stop it in the tab too, so it can't overlap the retry.
          void sendMessage('relayAbort', requestId, id).catch(() => undefined);
          reject(abortError());
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        sendMessage(
          'relayFetch',
          {
            id: requestId,
            url,
            method: init.method === 'POST' ? 'POST' : 'GET',
            body: typeof init.body === 'string' ? init.body : undefined,
            headers,
            referrer: typeof init.referrer === 'string' ? init.referrer : undefined,
          },
          id,
        )
          .then(resolve, reject)
          .finally(() => signal?.removeEventListener('abort', onAbort));
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      // The tab closed or left Reddit mid-request. A network-style error makes the
      // client retry, and the retry finds another tab.
      tabId = null;
      lastRelayed = 0;
      throw new TypeError(
        `Reddit tab unavailable: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    lastRelayed = Date.now();
    const status = reply.status >= 200 && reply.status <= 599 ? reply.status : 502;
    const res = new Response(status === 204 || status === 304 ? null : reply.text, {
      status,
      // Marked, so the diagnostics report says the request went through the Reddit tab.
      headers: [...reply.headers, ['x-threadcrate-via', `tab ${id}`]],
    });
    Object.defineProperty(res, 'url', { value: reply.url });
    return res;
  }

  const tabFetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return new URL(url).origin === REDDIT ? viaTab(url, init) : direct(input, init);
  }) as typeof fetch;

  return {
    fetch: tabFetch,
    async close() {
      if (opened !== null) await browser.tabs.remove(opened).catch(() => undefined);
      opened = null;
    },
  };
}
