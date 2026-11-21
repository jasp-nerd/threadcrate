// The answers for the link checker (components/LinkCheck.astro). What each kind of page exports
// and where to start it, as the extension does it (src/reddit/target.ts, README.md).
import type { Target } from '../../../src/reddit/target';

export const EXAMPLE = 'https://www.reddit.com/r/BalconyGardens/top/?t=month';

export interface Answer {
  kind: string;
  what: string;
  text: string;
  how: string;
}

const REDDIT = /^(?:[a-z]+\.)?reddit\.com$|^redd\.it$/i;

export function answer(
  url: string,
  target: Target | null,
  describe: (t: Target) => string,
): Answer {
  if (!target) {
    let host = '';
    try {
      host = url ? new URL(url).hostname : '';
    } catch {
      host = '';
    }
    if (!url)
      return {
        kind: 'Paste a link',
        what: 'A post, a subreddit, a profile or a search',
        text: 'Copy the address of a Reddit page and paste it above.',
        how: '',
      };
    if (!REDDIT.test(host))
      return {
        kind: 'Not a Reddit link',
        what: host || url,
        text: 'Threadcrate exports pages on reddit.com, including old.reddit.com and redd.it short links.',
        how: '',
      };
    return {
      kind: 'Not a page it exports',
      what: url.replace(/^https?:\/\//, ''),
      text: "Open a post, a subreddit, a profile or a search. The front page, Popular and multireddits (r/a+b) aren't exported.",
      how: '',
    };
  }
  // The extension's descriptions join parts with a middle dot; the site uses a colon.
  const what = describe(target).replace(/\s*·\s*/g, ': ');
  switch (target.kind) {
    case 'post':
      return {
        kind: 'A thread',
        what,
        text: 'The post with its whole comment tree, as posts.csv, comments.csv, data.json and one Markdown file.',
        how: 'Press Export next to Share on the post, or the Threadcrate icon in the toolbar.',
      };
    case 'subreddit':
      return {
        kind: 'A subreddit',
        what,
        text: 'Up to the roughly 1,000 posts Reddit lists in this order (a setting finds more by combining eight of its lists), with no comments, the top ones or all of them.',
        how: 'Press Export next to Join, or the Threadcrate icon in the toolbar.',
      };
    case 'user':
      return {
        kind: 'A profile',
        what,
        text: 'Their posts and comments, each comment with the title of its thread. Profiles need you logged in to Reddit.',
        how: 'Press the Threadcrate icon in the toolbar.',
      };
    case 'search':
      return {
        kind: 'A search',
        what,
        text: 'The posts the search finds, up to the roughly 1,000 Reddit lists, with their comments if you want them.',
        how: 'Press the Threadcrate icon in the toolbar.',
      };
  }
}
