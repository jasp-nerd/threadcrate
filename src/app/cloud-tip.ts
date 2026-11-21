// The card that offers the author's cloud version (Reddit Scraper on Apify) while an
// export runs: the moment someone is waiting is when "it could run without your browser"
// means something. It rotates through a few pitches so it doesn't turn into wallpaper,
// and the switch in Settings turns it off. Nothing is tracked beyond this counter,
// which never leaves the browser.
import { browser } from 'wxt/browser';

export const APIFY_ACTOR = 'https://apify.com/laptime/reddit-scraper';

/** The actor's page, tagged so the author can see in Apify which pitch brought a visit. */
export function cloudTipUrl(pitch: number): string {
  const url = new URL(APIFY_ACTOR);
  url.searchParams.set('utm_source', 'threadcrate');
  url.searchParams.set('utm_medium', 'extension');
  url.searchParams.set('utm_campaign', 'waiting-card');
  url.searchParams.set('utm_content', `pitch-${pitch}`);
  return url.href;
}

interface CloudTipState {
  hidden: boolean;
  /** How many exports showed it: picks the pitch. */
  shown: number;
}

const KEY = 'cloudTip';

export async function loadCloudTip(): Promise<CloudTipState> {
  const all: Record<string, unknown> = await browser.storage.local.get(KEY).catch(() => ({}));
  const stored = all[KEY] as Partial<CloudTipState> | undefined;
  return { hidden: stored?.hidden === true, shown: Number(stored?.shown) || 0 };
}

export async function saveCloudTip(state: CloudTipState): Promise<void> {
  await browser.storage.local.set({ [KEY]: state });
}
