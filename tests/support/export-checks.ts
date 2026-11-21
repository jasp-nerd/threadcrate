// Integrity checks on an export ZIP, shared by the unit, mock and live tests.
import { expect } from '@playwright/test';

interface CommentNode {
  id: string;
  name: string;
  parent_id: string;
  link_id: string;
  depth: number;
  path: string;
  root_comment_id: string;
  replies: CommentNode[];
}

interface PostNode {
  id: string;
  name: string;
  num_comments: number | null;
  comment_count: number | null;
  comments_loaded: boolean;
  comments: CommentNode[];
}

export interface DataJson {
  posts: PostNode[];
  comments: unknown[];
}

/** Rows of a CSV file (RFC 4180, our own output). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && s[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Checks that every comment tree is well formed, and returns the comment count. */
export function checkTrees(data: DataJson): number {
  let total = 0;
  const ids = new Set<string>();
  for (const post of data.posts) {
    let count = 0;
    const visit = (list: CommentNode[], parent: CommentNode | null, depth: number) => {
      for (const c of list) {
        count++;
        expect(ids.has(c.name), `duplicate comment ${c.name}`).toBe(false);
        ids.add(c.name);
        expect(c.link_id).toBe(post.name);
        expect(c.depth).toBe(depth);
        if (parent) {
          expect(c.parent_id).toBe(parent.name);
          expect(c.path).toBe(`${parent.path}/${c.id}`);
          expect(c.root_comment_id).toBe(parent.root_comment_id);
        } else {
          expect(c.path).toBe(c.id);
          expect(c.root_comment_id).toBe(c.id);
        }
        visit(c.replies, c, depth + 1);
      }
    };
    visit(post.comments, null, 0);
    if (post.comments_loaded) expect(count).toBe(post.comment_count);
    else expect(post.comment_count).toBeNull();
    total += count;
  }
  return total;
}
