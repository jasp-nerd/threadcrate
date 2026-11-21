import { expect, test } from 'vitest';
import { duration, timeLeft } from './progress-view';

const at = new Date(2026, 10, 15, 20, 0, 0);

test.each([
  [null, 'Estimating time…', null],
  [20, 'Less than a minute left', null],
  [70, 'About a minute left', null],
  [130, 'About 3 minutes left', null],
  [9 * 60, 'About 10 minutes left', null],
  [22 * 60, 'About 25 minutes left', 'done around 20:23'],
  [65 * 60, 'About 1 hour 10 minutes left', 'done around 21:08'],
  [2 * 3600, 'About 2 hours 10 minutes left', 'done around 22:06'],
])('%s seconds: %s', (seconds, text, finish) => {
  const t = timeLeft(seconds, at, 'en-GB');
  expect(t.text).toBe(text);
  expect(t.finish?.replace(/\u202f/g, ' ') ?? null).toBe(finish);
});

test('durations', () => {
  expect(duration(42_000)).toBe('42 seconds');
  expect(duration(23 * 60_000)).toBe('23 minutes');
  expect(duration(83 * 60_000)).toBe('1 hour 23 minutes');
});
