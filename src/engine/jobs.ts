// Export jobs waiting for their tab. Kept in session storage (memory only, gone
// when the browser closes), keyed by a random id in the tab's URL.
import { browser } from 'wxt/browser';

export interface Job {
  url: string;
  options: string;
  createdAt: number;
  /** The Reddit tab the export was started from: its requests go through it. */
  tabId?: number;
  /**
   * Set once the export tab starts the job. Reloading or restoring the tab then
   * asks before running everything again.
   */
  state?: 'started' | 'done';
}

const key = (id: string) => `job:${id}`;

export async function saveJob(job: Job): Promise<string> {
  const id = crypto.randomUUID();
  await browser.storage.session.set({ [key(id)]: job });
  return id;
}

export async function loadJob(id: string): Promise<Job | null> {
  const stored = await browser.storage.session.get(key(id));
  return (stored[key(id)] as Job | undefined) ?? null;
}

export async function markJob(id: string, state: NonNullable<Job['state']>): Promise<void> {
  const job = await loadJob(id);
  if (job) await browser.storage.session.set({ [key(id)]: { ...job, state } });
}
