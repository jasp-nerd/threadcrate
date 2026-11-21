// Which way of reading Reddit an export uses: the JSON API when the browser is
// logged in, the web pages otherwise, and the web pages again for whatever the
// API refuses partway through.

import type { Backend } from '../reddit/backend';
import { errorSummary, isAborted, refusesApi } from '../reddit/errors';
import type { ExportOptions } from './options';

/**
 * The JSON API, switching to the web pages if Reddit refuses it, separately for
 * listings and for comment threads. In November 2026 Reddit refused listings
 * (`/r/<sub>/hot.json`) even to logged-in browsers while still answering other
 * API calls, so the cheap part (finding posts) can come from the web pages while
 * the expensive part (100 comments a request instead of about 10) stays on the
 * API, for as long as Reddit allows it.
 */
export function withFallback(
  json: Backend,
  html: Backend,
  onSwitch: (what: 'listings' | 'comments') => void,
): Backend {
  let listingsFromApi = true;
  let threadsFromApi = true;
  return {
    // The comments decide how fast an export goes, and the time estimate's rates.
    get name() {
      return threadsFromApi ? json.name : html.name;
    },
    async *listing(target, options) {
      if (listingsFromApi) {
        let yielded = 0;
        try {
          for await (const item of json.listing(target, options)) {
            yielded++;
            yield item;
          }
          return;
        } catch (error) {
          // Profiles need the JSON API; the web pages can't stand in for it there.
          if (yielded > 0 || !refusesApi(error) || target.kind === 'user') throw error;
          listingsFromApi = false;
          onSwitch('listings');
        }
      }
      yield* html.listing(target, options);
    },
    async thread(postId, options) {
      if (threadsFromApi) {
        try {
          return await json.thread(postId, options);
        } catch (error) {
          if (!refusesApi(error)) throw error;
          threadsFromApi = false;
          onSwitch('comments');
        }
      }
      return html.thread(postId, options);
    },
  };
}

/** The settings' choice, or, by default, the API when the browser is logged in (Reddit answers it only then). */
export async function pickBackend(
  choice: ExportOptions['backend'],
  json: Backend,
  html: Backend,
  whoAmI: () => Promise<unknown>,
  note: (text: string) => void,
): Promise<Backend> {
  if (choice === 'json') {
    note("Reading through Reddit's API, as chosen in the settings");
    return json;
  }
  if (choice === 'html') {
    note("Reading through Reddit's web pages, as chosen in the settings");
    return html;
  }
  try {
    const me = (await whoAmI()) as { name?: unknown; data?: { name?: unknown } };
    if (typeof me?.name === 'string' || typeof me?.data?.name === 'string') {
      note("Logged in (Reddit's /api/me answered): reading through Reddit's API");
      return json;
    }
    note("Reddit's /api/me answered without an account: reading through Reddit's web pages");
  } catch (error) {
    if (isAborted(error)) throw error;
    // Blocked, logged out or anything else: the web pages work without a login.
    note(`Reddit's /api/me refused (${errorSummary(error)}): reading through Reddit's web pages`);
  }
  return html;
}
