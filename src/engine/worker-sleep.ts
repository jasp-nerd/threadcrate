import { browser } from 'wxt/browser';
import { abortableSleep } from '../reddit/client';

/** A sleep that keeps time in a worker (see entrypoints/timer.ts), or the plain one if workers fail. */
export function createWorkerSleep(): (ms: number, signal?: AbortSignal) => Promise<void> {
  let worker: Worker;
  try {
    worker = new Worker(browser.runtime.getURL('/timer.js'));
  } catch {
    return abortableSleep;
  }
  let next = 0;
  const waiting = new Map<number, () => void>();
  let broken = false;
  worker.onmessage = (e: MessageEvent<number>) => {
    waiting.get(e.data)?.();
    waiting.delete(e.data);
  };
  worker.onerror = () => {
    // A worker that fails to load would leave every wait hanging: release them.
    broken = true;
    for (const done of waiting.values()) done();
    waiting.clear();
  };
  return (ms, signal) => {
    if (broken) return abortableSleep(ms, signal);
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason as Error);
      const id = ++next;
      const onAbort = () => {
        waiting.delete(id);
        reject(signal!.reason as Error);
      };
      waiting.set(id, () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      worker.postMessage({ id, ms });
    });
  };
}
