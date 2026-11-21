import { expect, test } from 'vitest';
import { DEFAULT_OPTIONS } from './options';
import { depthOptions } from '../app/export-request';
import { plannedSeconds, shortDuration } from './estimate';

const sub = { kind: 'subreddit', name: 's', sort: 'hot', time: 'day' } as const;

test('the panel estimate: fewer comments, faster; fast mode helps small exports', () => {
  const plan = (depth: 'none' | 'top' | '100' | 'all', speed: 'normal' | 'fast' = 'normal') =>
    plannedSeconds(
      { ...DEFAULT_OPTIONS, target: sub, maxPosts: 250, speed, ...depthOptions(depth) },
      120,
    );
  const [none, top, hundred, all] = [plan('none'), plan('top'), plan('100'), plan('all')];
  expect(none).toBeLessThan(top);
  expect(top).toBeLessThan(hundred);
  expect(hundred).toBeLessThan(all);
  // 250 posts with their top comments: one request each, a bit over one budget window.
  expect(top / 60).toBeGreaterThan(5);
  expect(top / 60).toBeLessThan(20);
  expect(plan('none', 'fast')).toBeLessThan(none);
});

test('short durations for the buttons', () => {
  expect(shortDuration(30)).toBe('< 1 min');
  expect(shortDuration(5 * 60)).toBe('5 min');
  expect(shortDuration(80 * 60)).toBe('1 h 20 min');
  expect(shortDuration(120 * 60)).toBe('2 h');
  expect(shortDuration(117 * 60)).toBe('2 h');
});
