import { expect, test } from 'vitest';
import { describeTarget, parseTarget, unsupportedReason } from './target';

test.each([
  [
    'https://www.reddit.com/r/HistoryTest/',
    { kind: 'subreddit', name: 'HistoryTest', sort: 'hot', time: 'day' },
  ],
  [
    'https://www.reddit.com/r/HistoryTest/top/?t=month',
    { kind: 'subreddit', name: 'HistoryTest', sort: 'top', time: 'month' },
  ],
  [
    'https://old.reddit.com/r/pics/new',
    { kind: 'subreddit', name: 'pics', sort: 'new', time: 'day' },
  ],
  [
    'https://www.reddit.com/r/pics/best/',
    { kind: 'subreddit', name: 'pics', sort: 'hot', time: 'day' },
  ],
  [
    'https://www.reddit.com/r/HistoryTest/comments/1abcde9/a_made_up_title/',
    { kind: 'post', id: '1abcde9', subreddit: 'HistoryTest' },
  ],
  [
    'https://www.reddit.com/r/HistoryTest/comments/1abcde9/a_made_up_title/comment/19zz00aa11bb2/',
    { kind: 'post', id: '1abcde9', subreddit: 'HistoryTest' },
  ],
  ['https://www.reddit.com/comments/1ABCDE9/', { kind: 'post', id: '1abcde9', subreddit: null }],
  ['https://redd.it/1abcde9', { kind: 'post', id: '1abcde9', subreddit: null }],
  // A subreddit called "comments" is not a post.
  [
    'https://www.reddit.com/r/comments/top/',
    { kind: 'subreddit', name: 'comments', sort: 'top', time: 'day' },
  ],
  // One of Reddit's first posts.
  [
    'https://www.reddit.com/r/reddit.com/comments/1/',
    { kind: 'post', id: '1', subreddit: 'reddit.com' },
  ],
  [
    'https://www.reddit.com/user/someone_123/comments/?sort=top&t=year',
    { kind: 'user', name: 'someone_123', section: 'comments', sort: 'top', time: 'year' },
  ],
  [
    'https://www.reddit.com/u/someone_123',
    { kind: 'user', name: 'someone_123', section: 'overview', sort: 'new', time: 'all' },
  ],
  [
    'https://www.reddit.com/search/?q=roman+empire&type=posts&sort=top&t=week',
    { kind: 'search', query: 'roman empire', subreddit: null, sort: 'top', time: 'week' },
  ],
  [
    'https://www.reddit.com/r/HistoryTest/search/?q=rome',
    { kind: 'search', query: 'rome', subreddit: 'HistoryTest', sort: 'relevance', time: 'all' },
  ],
  [
    'https://www.reddit.com/r/HistoryTest/search/?q=rome&restrict_sr=0',
    { kind: 'search', query: 'rome', subreddit: null, sort: 'relevance', time: 'all' },
  ],
])('%s', (url, expected) => {
  expect(parseTarget(url)).toEqual(expected);
});

test.each([
  'https://www.reddit.com/',
  'https://www.reddit.com/search/?q=',
  // Reddit's front page feeds: the community feed is empty for them.
  'https://www.reddit.com/r/all/',
  'https://www.reddit.com/r/popular/top/?t=week',
  'https://www.reddit.com/r/All/',
  // Search tabs other than posts.
  'https://www.reddit.com/search/?q=rome&type=comments',
  'https://www.reddit.com/search/?q=rome&type=communities',
  'https://www.reddit.com/r/HistoryTest/search/?q=rome&type=comments',
  'https://www.reddit.com/search/?q=rome&type=media',
  // Not a share link, and never the subreddit's feed.
  'https://www.reddit.com/r/HistoryTest/s/',
  'https://www.reddit.com/settings/',
  'https://example.com/r/pics/',
  'https://www.reddit.com.evil.example/r/pics/',
  'not a url',
])('nothing to export at %s', (url) => {
  expect(parseTarget(url)).toBeNull();
});

test('a stray % in the address does not break parsing', () => {
  expect(parseTarget('https://www.reddit.com/r/test/comments/abc12/100%_true/')).toEqual({
    kind: 'post',
    id: 'abc12',
    subreddit: 'test',
  });
});

test('a share link is a post that only Reddit can name, never the subreddit feed', () => {
  const t = parseTarget('https://www.reddit.com/r/HistoryTest/s/Ab12Cd34Ef/?utm_source=share');
  expect(t).toEqual({
    kind: 'post',
    id: '',
    subreddit: 'HistoryTest',
    share: 'https://www.reddit.com/r/HistoryTest/s/Ab12Cd34Ef',
  });
  expect(describeTarget(t!)).toBe('Shared post in r/HistoryTest');
});

test('post searches still count, with or without a type', () => {
  expect(parseTarget('https://www.reddit.com/search/?q=rome&type=posts')?.kind).toBe('search');
  expect(parseTarget('https://www.reddit.com/search/?q=rome&type=link')?.kind).toBe('search');
});

test('why a page that looks exportable is not', () => {
  expect(unsupportedReason('https://www.reddit.com/r/popular/')).toMatch(/front page/);
  expect(unsupportedReason('https://www.reddit.com/r/all/top/')).toMatch(/r\/all/);
  expect(unsupportedReason('https://www.reddit.com/search/?q=x&type=comments')).toMatch(
    /Posts tab/,
  );
  expect(unsupportedReason('https://www.reddit.com/settings/')).toBeNull();
  expect(unsupportedReason('https://www.reddit.com/r/pics/')).toBeNull();
});
