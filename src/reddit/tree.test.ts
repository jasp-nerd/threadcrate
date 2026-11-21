import { expect, test } from 'vitest';
import { walk } from './model';
import { CommentTree, type RawComment } from './tree';

const POST = 't3_post1';

function c(id: string, parent: string): RawComment {
  return {
    kind: 'comment',
    id,
    name: `t1_${id}`,
    link_id: POST,
    link_title: 'A post',
    parent_id: parent,
    author: 'someone',
    author_fullname: null,
    is_submitter: null,
    body: `comment ${id}`,
    body_html: null,
    score: 1,
    score_hidden: null,
    controversiality: null,
    created_utc: null,
    created_unix: null,
    edited_utc: null,
    distinguished: null,
    stickied: null,
    locked: null,
    removal_status: null,
    subreddit: 'test',
    permalink: `https://www.reddit.com/r/test/comments/post1/comment/${id}/`,
  };
}

test('builds the tree in arrival order, with depth, path and root', () => {
  const tree = new CommentTree(POST);
  tree.add(c('a', POST));
  tree.add(c('b', 't1_a'));
  tree.add(c('c', 't1_b'));
  tree.add(c('d', POST));
  tree.add(c('e', 't1_a'));
  const { comments, gaps } = tree.finish();
  expect(gaps).toEqual([]);
  expect([...walk(comments)].map((x) => [x.id, x.depth, x.path, x.root_comment_id])).toEqual([
    ['a', 0, 'a', 'a'],
    ['b', 1, 'a/b', 'a'],
    ['c', 2, 'a/b/c', 'a'],
    ['e', 1, 'a/e', 'a'],
    ['d', 0, 'd', 'd'],
  ]);
});

test('replies that arrive before their parent wait for it', () => {
  const tree = new CommentTree(POST);
  tree.add(c('child', 't1_parent'));
  tree.add(c('grandchild', 't1_child'));
  tree.add(c('parent', POST));
  const { comments, gaps } = tree.finish();
  expect(gaps).toEqual([]);
  expect([...walk(comments)].map((x) => x.path)).toEqual([
    'parent',
    'parent/child',
    'parent/child/grandchild',
  ]);
});

test('duplicates are dropped', () => {
  const tree = new CommentTree(POST);
  expect(tree.add(c('a', POST))).toBe(true);
  expect(tree.add(c('a', POST))).toBe(false);
  expect(tree.size).toBe(1);
});

test('replies whose parent never arrives are kept at the top level and reported', () => {
  const tree = new CommentTree(POST);
  tree.add(c('a', POST));
  tree.add(c('lost', 't1_gone'));
  const { comments, gaps } = tree.finish();
  expect(comments.map((x) => x.id)).toEqual(['a', 'lost']);
  expect(comments[1]!.parent_id).toBe('t1_gone');
  expect(gaps).toEqual([
    { parent_id: 't1_gone', count: null, reason: 'parent comment not loaded' },
  ]);
});

test('a reply chain thousands deep (counting threads) neither overflows nor loses comments', () => {
  const tree = new CommentTree(POST);
  tree.add(c('n0', POST));
  for (let i = 1; i < 20_000; i++) tree.add(c(`n${i}`, `t1_n${i - 1}`));
  const { comments, count } = tree.finish();
  expect(count).toBe(20_000);
  let last;
  for (last of walk(comments));
  expect(last?.depth).toBe(19_999);
});

test('a comment limit keeps the first comments in reading order, never a reply without its parent', () => {
  const tree = new CommentTree(POST);
  tree.add(c('a', POST));
  tree.add(c('b', 't1_a'));
  tree.add(c('c', 't1_b'));
  tree.add(c('d', POST));
  const { comments, count, gaps } = tree.finish(2);
  expect(count).toBe(2);
  expect([...walk(comments)].map((x) => x.path)).toEqual(['a', 'a/b']);
  expect(gaps).toEqual([{ parent_id: POST, count: 2, reason: 'comment limit' }]);
});
