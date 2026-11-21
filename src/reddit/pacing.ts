// When to send the next request: the pacing rules, shared by the client (which
// follows them) and the time-left estimate (which plays them forward).
//
// Reddit allows a budget of requests per 10-minute window and says, with every
// answer, how much is left and when the window resets. The rules:
//  - a reserve of the budget is never used, so the person's own Reddit tabs keep
//    working while an export runs;
//  - when everything still to do fits in what's left of this window, go at full
//    speed and finish;
//  - otherwise spend the budget evenly until the reset: big exports then never
//    stop for minutes at a time (long pauses feel worse than a steady pace, and
//    the total time is the same, since the budget is the limit either way);
//  - with only the reserve left, wait for the reset.

export interface PacingRules {
  /**
   * Shortest time from sending one request to sending the next. Counted from the
   * send, not the answer: a slow answer then uses up the gap instead of adding to
   * it, so the rate stays at most one request per gap either way.
   */
  minIntervalMs: number;
  /** Part of the budget never used. */
  reserveFraction: number;
  minReserve: number;
}

/** The default: leaves a tenth of Reddit's budget for your own browsing. */
export const NORMAL: PacingRules = { minIntervalMs: 1_000, reserveFraction: 0.1, minReserve: 3 };

/**
 * Faster: a smaller reserve and shorter gaps, still within Reddit's stated budget.
 * Reddit pages may load slowly in other tabs while it runs.
 */
export const FAST: PacingRules = { minIntervalMs: 250, reserveFraction: 0.03, minReserve: 3 };

export function reserveFor(limit: number, rules: PacingRules): number {
  return Math.max(rules.minReserve, Math.ceil(limit * rules.reserveFraction));
}

export interface Budget {
  remaining: number;
  /** Window size (used + remaining). */
  limit: number;
  /** Milliseconds until the window resets. */
  resetMs: number;
}

/**
 * When the next request may go: milliseconds after the last one was sent, or,
 * for a wait for the budget's reset (isBudgetWait), after its answer came.
 * `workLeft`: requests still needed, when known.
 */
export function delayAfter(budget: Budget, rules: PacingRules, workLeft: number | null): number {
  // Nothing left to do: don't hold anything back for a reset that doesn't matter.
  if (workLeft === 0) return rules.minIntervalMs;
  const reserve = reserveFor(budget.limit, rules);
  // Only the reserve is left: wait for the new window, a second past the reset.
  if (budget.remaining <= reserve) return Math.max(rules.minIntervalMs, budget.resetMs + 1_000);
  const usable = budget.remaining - reserve;
  // With a margin: the work left is an estimate, and running out a few requests
  // short means a wait for the next window right at the end.
  const fits =
    workLeft === null ? budget.remaining > budget.limit / 2 : workLeft * 1.1 + 2 <= usable;
  if (fits) return rules.minIntervalMs;
  return Math.max(rules.minIntervalMs, budget.resetMs / usable);
}

/** True when a wait of this length is for the budget, not ordinary pacing. */
export function isBudgetWait(budget: Budget, rules: PacingRules): boolean {
  return budget.remaining <= reserveFor(budget.limit, rules);
}
