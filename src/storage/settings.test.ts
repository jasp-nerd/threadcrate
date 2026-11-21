import { expect, test } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings';

test('missing or malformed settings fall back to the defaults', () => {
  expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  expect(normalizeSettings('garbage')).toEqual(DEFAULT_SETTINGS);
  expect(
    normalizeSettings({
      maxPosts: -3,
      commentSort: 'sideways',
      backend: 'ftp',
      maxComments: 0,
      includeMedia: 'yes',
    }),
  ).toEqual(DEFAULT_SETTINGS);
});

test('valid settings are kept, and the post count is capped at what Reddit lists', () => {
  expect(
    normalizeSettings({ maxPosts: 5000, commentSort: 'new', maxComments: 500, backend: 'html' }),
  ).toMatchObject({
    maxPosts: 1000,
    commentSort: 'new',
    maxComments: 500,
    backend: 'html',
  });
});

test('at least one kind of file is always on', () => {
  expect(
    normalizeSettings({ formats: { json: false, csv: false, markdown: false } }).formats,
  ).toEqual({
    json: true,
    csv: false,
    markdown: false,
  });
});

test('the Export button on Reddit is on unless turned off, also for settings saved before it existed', () => {
  expect(normalizeSettings({ maxPosts: 100 }).showPageButton).toBe(true);
  expect(normalizeSettings({ showPageButton: false }).showPageButton).toBe(false);
  expect(normalizeSettings({ showPageButton: 'no' }).showPageButton).toBe(true);
});
