import type { BackendName } from '../reddit/backend';
import { COMMENT_SORTS, parseTarget, type CommentSort, type Target } from '../reddit/target';

/** Settings › Advanced › "Read from": the API, the web pages, or whichever works. */
export type BackendChoice = 'auto' | BackendName;

export interface Formats {
  json: boolean;
  csv: boolean;
  markdown: boolean;
}

export interface ExportOptions {
  target: Target;
  /** For listings: how many posts (Reddit lists at most about 1000). */
  maxPosts: number;
  /** For listings: also load each post's comments. Single posts always do. */
  includeComments: boolean;
  commentSort: CommentSort;
  /** Per post; Infinity for every comment. */
  maxComments: number;
  includeMedia: boolean;
  formats: Formats;
  backend: BackendChoice;
  /** 'fast' uses more of Reddit's budget and shorter gaps (pacing.ts). */
  speed: 'normal' | 'fast';
  /**
   * Subreddits: find more than the ~1000 posts Reddit shows per list by reading several
   * lists (new, top and controversial over several time ranges, hot) and
   * keeping each post once.
   */
  deep: boolean;
}

export const MAX_LISTING = 1000;

export const DEFAULT_OPTIONS: Omit<ExportOptions, 'target'> = {
  maxPosts: 100,
  includeComments: true,
  commentSort: 'confidence',
  maxComments: Infinity,
  includeMedia: false,
  formats: { json: true, csv: true, markdown: true },
  backend: 'auto',
  speed: 'normal',
  deep: false,
};

/** Options travel as JSON between the page, the background and the export tab: Infinity doesn't. */
export function serializeOptions(o: ExportOptions): string {
  return JSON.stringify({
    ...o,
    maxComments: Number.isFinite(o.maxComments) ? o.maxComments : null,
  });
}

/**
 * Options for the export of `url`, from what the export form sent. The target is read
 * from the address again and every value is checked, so a malformed job can't
 * make the export tab request something it shouldn't.
 */
export function parseOptions(json: string, url: string): ExportOptions | null {
  const target = parseTarget(url);
  if (!target) return null;
  let raw: Partial<Record<keyof ExportOptions, unknown>> = {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === 'object') raw = parsed;
  } catch {
    // Defaults, then.
  }
  const d = DEFAULT_OPTIONS;
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  const f = (raw.formats && typeof raw.formats === 'object' ? raw.formats : {}) as Partial<Formats>;
  const formats = {
    json: bool(f.json, d.formats.json),
    csv: bool(f.csv, d.formats.csv),
    markdown: bool(f.markdown, d.formats.markdown),
  };
  if (!formats.json && !formats.csv && !formats.markdown) formats.json = true;
  const maxPosts =
    typeof raw.maxPosts === 'number' && raw.maxPosts >= 1 ? raw.maxPosts : d.maxPosts;
  const maxComments =
    typeof raw.maxComments === 'number' && raw.maxComments >= 1
      ? Math.floor(raw.maxComments)
      : Infinity;
  return {
    target,
    maxPosts: Math.min(Math.floor(maxPosts), MAX_LISTING),
    includeComments: bool(raw.includeComments, d.includeComments),
    commentSort: (COMMENT_SORTS as readonly string[]).includes(raw.commentSort as string)
      ? (raw.commentSort as CommentSort)
      : d.commentSort,
    maxComments,
    includeMedia: bool(raw.includeMedia, d.includeMedia),
    formats,
    backend: raw.backend === 'json' || raw.backend === 'html' ? raw.backend : 'auto',
    speed: raw.speed === 'fast' ? 'fast' : 'normal',
    deep: bool(raw.deep, false) && target.kind === 'subreddit',
  };
}
