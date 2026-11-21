import { defineUnlistedScript } from '#imports';

// A timer in a worker. Chrome throttles timers in tabs that have been hidden for
// a while to one wake-up a minute, which would turn a 3-second wait between
// Reddit requests into a minute. Workers aren't throttled that way.
export default defineUnlistedScript(() => {
  const scope = self as unknown as {
    onmessage: ((e: MessageEvent<{ id: number; ms: number }>) => void) | null;
    postMessage: (id: number) => void;
  };
  scope.onmessage = (e) => {
    setTimeout(() => scope.postMessage(e.data.id), e.data.ms);
  };
});
