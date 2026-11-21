import { describe, expect, test } from 'vitest';
import { DEFAULT_SETTINGS } from '../storage/settings';
import { worthShowing, type Activity } from '../storage/activity';
import { optionsFor, postChoice, withDepth, currentDepth } from './export-request';
import { popupView } from './popup-view';

describe('what the popup shows', () => {
  test.each([
    [undefined, 'off-reddit'],
    ['chrome://extensions/', 'off-reddit'],
    ['https://example.com/r/pics/', 'off-reddit'],
    ['https://www.reddit.com/', 'nothing'],
    ['https://www.reddit.com/settings/', 'nothing'],
    ['https://www.reddit.com/r/AskHistorians/top/?t=month', 'target'],
    ['https://www.reddit.com/r/pics/comments/abc123/a_title/', 'target'],
    ['https://www.reddit.com/r/pics/s/Ab12Cd34Ef', 'target'],
    ['https://www.reddit.com/r/popular/', 'nothing'],
  ])('%s → %s', (url, kind) => {
    expect(popupView(url).kind).toBe(kind);
  });

  test("r/all, r/popular and comment searches say why they can't be exported", () => {
    expect(popupView('https://www.reddit.com/r/all/')).toMatchObject({
      kind: 'nothing',
      reason: expect.stringMatching(/front page/),
    });
    expect(popupView('https://www.reddit.com/search/?q=x&type=comments')).toMatchObject({
      kind: 'nothing',
      reason: expect.stringMatching(/post results/),
    });
    expect(popupView('https://www.reddit.com/settings/')).toMatchObject({ reason: null });
  });
});

describe('options from the remembered settings', () => {
  const sub = { kind: 'subreddit', name: 'pics', sort: 'hot', time: 'day' } as const;
  const post = { kind: 'post', id: 'abc123', subreddit: 'pics' } as const;

  test('a single post and a listing keep their own comment depth', () => {
    let s = withDepth(DEFAULT_SETTINGS, post, 'all');
    s = withDepth(s, sub, 'top');
    expect(optionsFor(s, post).maxComments).toBe(Infinity);
    expect(optionsFor(s, sub)).toMatchObject({ includeComments: true, maxComments: 25 });
    expect(currentDepth(s, post)).toBe('all');
    expect(withDepth(s, sub, 'none')).toMatchObject({ includeComments: false });
  });

  test('going past 1000 posts only for a whole subreddit', () => {
    const s = { ...DEFAULT_SETTINGS, deep: true, maxPosts: 1000 };
    expect(optionsFor(s, sub).deep).toBe(true);
    expect(optionsFor({ ...s, maxPosts: 100 }, sub).deep).toBe(false);
    expect(
      optionsFor(s, { kind: 'search', query: 'x', subreddit: null, sort: 'relevance', time: 'all' })
        .deep,
    ).toBe(false);
  });

  test('older remembered post counts fall under the nearest choice', () => {
    expect([10, 25, 50, 250, 500, 1000].map(postChoice)).toEqual([25, 25, 100, 1000, 1000, 1000]);
  });
});

test('the popup shows running exports and the last finished one, for half an hour', () => {
  const a = (jobId: string, status: Activity['status'], updatedAt: number): Activity => ({
    jobId,
    tabId: null,
    title: jobId,
    status,
    fraction: 0,
    line: '',
    downloadId: null,
    updatedAt,
  });
  const now = 10_000_000;
  const list = [
    a('old-done', 'done', now - 40 * 60_000),
    a('done', 'done', now - 5 * 60_000),
    a('older-done', 'failed', now - 10 * 60_000),
    a('running', 'running', now - 1000),
  ];
  expect(worthShowing(list, now).map((x) => x.jobId)).toEqual(['running', 'done']);
  expect(worthShowing([list[0]!], now)).toEqual([]);
});
