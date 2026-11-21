import { expect, test } from 'vitest';
import { delayAfter, FAST, NORMAL, type PacingRules } from './pacing';

// Reddit's budget is 225 requests a window; NORMAL keeps 23 of them in reserve.
test.each<[string, PacingRules, number, number, number | null, number]>([
  // rules, budget left, seconds to the reset, requests still needed, expected delay (ms)
  ['work that fits in the budget goes at full speed', NORMAL, 150, 400, 100, 1_000],
  // 127 usable (150 - 23 reserve), 400 s left: about 3.15 s from one send to the next.
  ['work that does not fit is spread until the reset', NORMAL, 150, 400, 1000, 400_000 / 127],
  ['only the reserve left: wait for the reset', NORMAL, 20, 90, 1000, 91_000],
  ['nothing left to do: no wait for a reset that does not matter', NORMAL, 20, 500, 0, 1_000],
  ['fast keeps a smaller reserve and shorter gaps', FAST, 20, 90, 10, FAST.minIntervalMs],
  ['work unknown, over half the budget left: full speed', NORMAL, 200, 500, null, 1_000],
  // 37 usable (60 - 23 reserve), 300 s left: about 8.1 s apart.
  ['work unknown, under half left: spread until the reset', NORMAL, 60, 300, null, 300_000 / 37],
])('%s', (_name, rules, remaining, resetSeconds, workLeft, expected) => {
  expect(
    delayAfter({ remaining, limit: 225, resetMs: resetSeconds * 1000 }, rules, workLeft),
  ).toBeCloseTo(expected, 0);
});
