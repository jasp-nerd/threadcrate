import type { Comment, Gap } from './model';

/** A comment as a backend reads it, before its place in the tree is known. */
export type RawComment = Omit<Comment, 'depth' | 'path' | 'root_comment_id' | 'replies'>;

/**
 * Builds a comment tree from comments that arrive in any order and possibly
 * twice (Reddit's "load more" pages overlap now and then). A reply whose parent
 * hasn't arrived yet waits until it does.
 */
export class CommentTree {
  private readonly byId = new Map<string, Comment>();
  private readonly waiting = new Map<string, Comment[]>();
  private readonly top: Comment[] = [];

  constructor(private readonly postFullname: string) {}

  get size(): number {
    return this.byId.size;
  }

  /** Top-level comments loaded so far. */
  get topLevelCount(): number {
    return this.top.length;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  get(id: string): Comment | undefined {
    return this.byId.get(id);
  }

  /** Adds a comment; false when it was already there. */
  add(raw: RawComment): boolean {
    if (this.byId.has(raw.id)) return false;
    const comment: Comment = {
      ...raw,
      depth: 0,
      path: raw.id,
      root_comment_id: raw.id,
      replies: [],
    };
    this.byId.set(raw.id, comment);

    if (raw.parent_id === this.postFullname || !raw.parent_id.startsWith('t1_')) {
      this.top.push(comment);
    } else {
      const parent = this.byId.get(raw.parent_id.slice(3));
      if (parent) parent.replies.push(comment);
      else {
        const list = this.waiting.get(raw.parent_id) ?? [];
        list.push(comment);
        this.waiting.set(raw.parent_id, list);
      }
    }
    // Replies that arrived before this comment.
    const early = this.waiting.get(comment.name);
    if (early) {
      comment.replies.push(...early);
      this.waiting.delete(comment.name);
    }
    return true;
  }

  /**
   * The finished tree, with depth, path and root filled in. Replies whose parent
   * never arrived go at the top level, each reported as a gap. With `max`, only the
   * first `max` comments in reading order are kept (a reply never without its parent).
   */
  finish(max = Infinity): { comments: Comment[]; gaps: Gap[]; count: number } {
    const gaps: Gap[] = [];
    const roots = [...this.top];
    for (const [parentId, orphans] of this.waiting) {
      gaps.push({ parent_id: parentId, count: null, reason: 'parent comment not loaded' });
      roots.push(...orphans);
    }
    // Iterative, not recursive: a counting thread can be thousands of replies deep.
    let kept = 0;
    let dropped = 0;
    const stack: { list: Comment[]; index: number; parent: Comment | null }[] = [
      { list: roots, index: 0, parent: null },
    ];
    while (stack.length) {
      const frame = stack[stack.length - 1]!;
      if (frame.index >= frame.list.length) {
        stack.pop();
        continue;
      }
      const c = frame.list[frame.index]!;
      if (kept >= max) {
        // Over the limit: this comment and everything after it in reading order goes.
        dropped += countAll(frame.list.splice(frame.index));
        continue;
      }
      frame.index++;
      kept++;
      const p = frame.parent;
      c.depth = p ? p.depth + 1 : 0;
      c.path = p ? `${p.path}/${c.id}` : c.id;
      c.root_comment_id = p ? p.root_comment_id : c.id;
      if (c.replies.length) stack.push({ list: c.replies, index: 0, parent: c });
    }
    if (dropped)
      gaps.push({ parent_id: this.postFullname, count: dropped, reason: 'comment limit' });
    return { comments: roots, gaps, count: kept };
  }
}

function countAll(list: Comment[]): number {
  let n = 0;
  const stack = [...list];
  while (stack.length) {
    n++;
    stack.push(...stack.pop()!.replies);
  }
  return n;
}
