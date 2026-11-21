// What the export tabs are doing, for the toolbar popup: the running export's
// progress, and how the last one ended. Session storage: memory only, gone when
// the browser closes, like the jobs themselves.
import { browser } from 'wxt/browser';

export interface Activity {
  jobId: string;
  /** The export's tab, to bring it back. */
  tabId: number | null;
  /** "r/AskHistorians: top of the month". */
  title: string;
  status: 'running' | 'paused' | 'done' | 'partial' | 'failed' | 'stopped';
  /** 0 to 1. */
  fraction: number;
  /** "Post 42 of 100, about 3 min left", or the result: "100 posts, 2,315 comments". */
  line: string;
  /** The saved file's download id, for "Show in folder". */
  downloadId: number | null;
  updatedAt: number;
}

const KEY = 'activity';
/** How long a finished export stays in the popup. */
const SHOW_FINISHED_MS = 30 * 60_000;

export async function saveActivity(a: Activity): Promise<void> {
  const all = await loadAll();
  all[a.jobId] = a;
  // Only the newest few: older ones have no place in the popup.
  const kept = Object.values(all)
    .sort((x, y) => y.updatedAt - x.updatedAt)
    .slice(0, 5);
  await browser.storage.session.set({ [KEY]: Object.fromEntries(kept.map((x) => [x.jobId, x])) });
}

async function loadAll(): Promise<Record<string, Activity>> {
  const stored = await browser.storage.session.get(KEY);
  const value = stored[KEY];
  return value && typeof value === 'object' ? (value as Record<string, Activity>) : {};
}

/** The exports worth showing in the popup: every running one, then the latest finished. */
export function worthShowing(all: Activity[], now: number): Activity[] {
  const sorted = [...all].sort((a, b) => b.updatedAt - a.updatedAt);
  const running = sorted.filter((a) => a.status === 'running' || a.status === 'paused');
  const finished = sorted.find(
    (a) => a.status !== 'running' && a.status !== 'paused' && now - a.updatedAt < SHOW_FINISHED_MS,
  );
  return finished ? [...running, finished] : running;
}

export async function loadActivity(now = Date.now()): Promise<Activity[]> {
  return worthShowing(Object.values(await loadAll()), now);
}

export async function forgetActivity(jobId: string): Promise<void> {
  const all = await loadAll();
  delete all[jobId];
  await browser.storage.session.set({ [KEY]: all });
}
