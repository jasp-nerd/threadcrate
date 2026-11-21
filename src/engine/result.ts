// What an export produced: the records, what's missing, and how it went. The
// files (export/package.ts) and the end screen are made from this.

import type { BackendName } from '../reddit/backend';
import type { Gap, Post, Thread } from '../reddit/model';
import type { RawComment } from '../reddit/tree';
import type { Diagnostic } from './diagnostics';
import type { MediaFailure, MediaFile } from './media-download';
import type { ExportOptions } from './options';

export interface PostFailure {
  post_id: string;
  title: string;
  reason: string;
}

export interface ExportResult {
  options: ExportOptions;
  backend: BackendName | null;
  startedAt: string;
  finishedAt: string;
  /** "complete", or why the export ended early. */
  status: 'complete' | 'stopped' | 'failed';
  error: string | null;
  errorKind: string | null;
  errorUrl: string | null;
  threads: Thread[];
  /** Posts listed but whose comments weren't loaded (listing only, or the load failed). */
  posts: Post[];
  standaloneComments: RawComment[];
  postFailures: PostFailure[];
  media: MediaFile[];
  mediaFailures: MediaFailure[];
  requests: number;
  /** Requests to Reddit by kind (diagnostics.ts), media not included. */
  requestsByKind?: Record<string, number>;
  throttles: number;
  /** What happened, for the "Copy diagnostics" report: decisions and failed answers. */
  diagnostics: Diagnostic[];
}

/** The totals every summary of an export shows. */
export function resultCounts(r: ExportResult): {
  posts: number;
  comments: number;
  /** Parts of comment threads that couldn't be loaded (the comment limit's aren't counted). */
  gaps: number;
  /** Those gaps, failed posts and failed media files: what the person didn't choose to leave out. */
  missing: number;
  /** Nothing at all was collected. */
  empty: boolean;
} {
  const posts = r.threads.length + r.posts.length;
  const gaps = r.threads.reduce((n, t) => n + missingGaps(t.gaps).length, 0);
  return {
    posts,
    comments: r.threads.reduce((n, t) => n + t.comment_count, 0) + r.standaloneComments.length,
    gaps,
    missing: gaps + r.postFailures.length + r.mediaFailures.length,
    empty: posts + r.standaloneComments.length === 0,
  };
}

/** Gaps the person didn't choose: the comment limit leaves comments out on purpose. */
function missingGaps(gaps: readonly Gap[]): Gap[] {
  return gaps.filter((g) => g.reason !== 'comment limit');
}
