// What both ways of reading Reddit (json-api.ts, html-api.ts) promise, and the
// pieces they share.

import type { Gap, Post, Thread } from './model';
import type { CommentSort, Target } from './target';
import type { CommentTree, RawComment } from './tree';

export type ListingItem =
  /** `complete` is false when the listing only had a summary (search results on the web pages). */
  | { kind: 'post'; post: Post; complete: boolean }
  /** A comment on its own, as user pages list them. */
  | { kind: 'comment'; comment: RawComment };

export interface ThreadOptions {
  sort: CommentSort;
  /** Stop loading more comments after this many; Infinity for all. */
  maxComments: number;
  /** Known subreddit, saves a redirect on some backends. */
  subreddit?: string | null;
  /**
   * The post's full address, when a listing gave it. Reddit counts the redirect
   * from /comments/<id>/ against its budget, so this halves a small thread's cost.
   */
  permalink?: string | null;
  /** After each page of comments; `post` is the thread's post as read so far. */
  onProgress?: (loaded: number, expected: number | null, post: Post) => void;
}

export interface ListingOptions {
  /** Stop after this many items. */
  limit: number;
}

/** Reddit's JSON API (logged in only), or its web pages. */
export type BackendName = 'json' | 'html';

/** Where the data comes from. Both produce the same records. */
export interface Backend {
  readonly name: BackendName;
  listing(
    target: Exclude<Target, { kind: 'post' }>,
    options: ListingOptions,
  ): AsyncGenerator<ListingItem>;
  thread(postId: string, options: ThreadOptions): Promise<Thread>;
}

/**
 * A thread cut short by an error that stops the export (the user stopped it,
 * Reddit blocked us). Carries the comments loaded until then, so they're saved.
 */
export class PartialThreadError extends Error {
  constructor(
    readonly thread: Thread,
    override readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'PartialThreadError';
  }
}

/** The finished thread, cut to the comment limit, with every gap listed. */
export function finishThread(
  post: Post,
  tree: CommentTree,
  gaps: Gap[],
  maxComments: number,
): Thread {
  const finished = tree.finish(maxComments);
  return {
    post,
    comments: finished.comments,
    comment_count: finished.count,
    gaps: [...gaps, ...finished.gaps],
  };
}

/** Rethrows a fatal error with the thread loaded so far attached. */
export function stopWithPartial(
  error: unknown,
  post: Post,
  tree: CommentTree,
  gaps: Gap[],
  maxComments: number,
): never {
  const thread = finishThread(
    post,
    tree,
    [
      ...gaps,
      {
        parent_id: post.name,
        count: null,
        reason: 'export stopped before this thread was complete',
      },
    ],
    maxComments,
  );
  throw new PartialThreadError(thread, error);
}
