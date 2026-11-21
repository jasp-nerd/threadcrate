// Three kinds of export, each with the ZIP it really makes. Names follow src/export/package.ts
// (archive, threads/ and media/ names) and the counts come from exports of the invented
// r/BalconyGardens that the store screenshots use (media/demo-reddit.ts). Long folders are
// shortened to a count ("98 more").

export interface Node {
  name: string;
  note?: string;
  children?: Node[];
}

export interface Kind {
  id: 'thread' | 'subreddit' | 'profile';
  label: string;
  text: string;
  zip: string;
  tree: Node[];
  foot?: string;
}

const f = (name: string, children?: Node[], note?: string): Node => ({ name, children, note });

// The files every export starts with.
const head = [
  f('README.txt', undefined, 'what each file is'),
  f('manifest.json', undefined, "what's missing, and why"),
];

export const KINDS: Kind[] = [
  {
    id: 'thread',
    label: 'A thread',
    text: 'One post with its whole comment tree: every "load more" and "continue this thread" opened, replies in their place.',
    zip: 'reddit_BalconyGardens_bg2t_whats-the-easiest-vegetable-for-a-north_2026-11-17_1750.zip',
    tree: [
      ...head,
      f('data.json', undefined, 'the comment tree, nested'),
      f('posts.csv', undefined, '1 row'),
      f('comments.csv', undefined, '14 rows, with parent_id and depth'),
      f('threads', [f('BalconyGardens_bg2t_whats-the-easiest-vegetable-for-a-north-facing.md')]),
    ],
    foot: '1 post, 14 comments',
  },
  {
    id: 'subreddit',
    label: 'A subreddit',
    text: 'Any sort and time range, up to the 1,000 posts a list shows, with the top comments or all of them.',
    zip: 'reddit_r-BalconyGardens_top-month_2026-11-17_1750.zip',
    tree: [
      ...head,
      f('data.json', undefined, 'posts with their comments'),
      f('posts.csv', undefined, '100 rows'),
      f('comments.csv', undefined, '1,820 rows'),
      f('threads', [
        f('BalconyGardens_bg2v_first-harvest-from-my-2-m2-balcony-this-year.md'),
        f('BalconyGardens_bg2w_self-watering-pots-worth-it-or-a-gimmick.md'),
        f('98 more'),
      ]),
      f('media', [f('BalconyGardens_bg2v_1.jpg'), f('more images and videos')], 'if you turn it on'),
    ],
    foot: '100 posts, 1,820 comments',
  },
  {
    id: 'profile',
    label: 'A profile',
    text: "Someone's posts and comments, each comment with the title of its thread. Profiles need you logged in to Reddit.",
    zip: 'reddit_u-fernandleaf_overview_2026-11-17_1750.zip',
    tree: [
      ...head,
      f('data.json', undefined, 'posts and comments'),
      f('posts.csv', undefined, 'their posts'),
      f('comments.csv', undefined, 'their comments, with link_title'),
    ],
  },
];
