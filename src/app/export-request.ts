// From the remembered settings and the page's target to the export's options:
// one place, so the popup and the fallback page export exactly the same way.
import { DEFAULT_OPTIONS, MAX_LISTING, type ExportOptions } from '../engine/options';
import type { Target } from '../reddit/target';
import type { Settings } from '../storage/settings';

export function optionsFor(settings: Settings, target: Target): ExportOptions {
  const single = target.kind === 'post';
  return {
    ...DEFAULT_OPTIONS,
    target,
    maxPosts: settings.maxPosts,
    includeComments: settings.includeComments,
    commentSort: settings.commentSort,
    maxComments: (single ? settings.postMaxComments : settings.maxComments) ?? Infinity,
    includeMedia: settings.includeMedia,
    formats: settings.formats,
    backend: settings.backend,
    speed: settings.speed,
    deep: settings.deep && settings.maxPosts === MAX_LISTING && target.kind === 'subreddit',
  };
}

/** The popup's choices for how many posts: few, and each with its time. */
export const POST_CHOICES = [25, 100, MAX_LISTING] as const;

/** The post-count choice a remembered setting falls under (older versions offered 250 and 500). */
export function postChoice(maxPosts: number): (typeof POST_CHOICES)[number] {
  return maxPosts <= 25 ? 25 : maxPosts <= 100 ? 100 : MAX_LISTING;
}

export type CommentDepth = 'none' | 'top' | '100' | 'all';

/** The comment choices, as export options. "Top" is what a post's own page shows: one request per post. */
export function depthOptions(depth: CommentDepth): {
  includeComments: boolean;
  maxComments: number;
} {
  switch (depth) {
    case 'none':
      return { includeComments: false, maxComments: Infinity };
    case 'top':
      return { includeComments: true, maxComments: 25 };
    case '100':
      return { includeComments: true, maxComments: 100 };
    case 'all':
      return { includeComments: true, maxComments: Infinity };
  }
}

function depthOf(includeComments: boolean, maxComments: number | null): CommentDepth {
  if (!includeComments) return 'none';
  if (maxComments === null) return 'all';
  if (maxComments <= 25) return 'top';
  if (maxComments <= 100) return '100';
  return 'all';
}

/** The comment choices for a target: a single post always has comments. */
export function depthChoices(target: Target): CommentDepth[] {
  return target.kind === 'post' ? ['top', '100', 'all'] : ['none', 'top', 'all'];
}

export const DEPTH_LABEL: Record<CommentDepth, string> = {
  none: 'None',
  top: 'Top',
  '100': 'Top 100',
  all: 'All',
};

export function currentDepth(settings: Settings, target: Target): CommentDepth {
  return target.kind === 'post'
    ? depthOf(true, settings.postMaxComments)
    : depthOf(settings.includeComments, settings.maxComments);
}

/** The settings after choosing a comment depth for this kind of target. */
export function withDepth(settings: Settings, target: Target, depth: CommentDepth): Settings {
  const o = depthOptions(depth);
  const max = Number.isFinite(o.maxComments) ? o.maxComments : null;
  return target.kind === 'post'
    ? { ...settings, postMaxComments: max }
    : { ...settings, includeComments: o.includeComments, maxComments: max };
}

/** "JSON, CSV, Markdown, plus images and videos": the settings that aren't choices in the popup, in a line. */
export function summaryLine(settings: Settings): string {
  const files = [
    settings.formats.json && 'JSON',
    settings.formats.csv && 'CSV',
    settings.formats.markdown && 'Markdown',
  ].filter(Boolean);
  const extras = [
    settings.includeMedia && 'images and videos',
    settings.speed === 'fast' && 'fast',
  ].filter(Boolean);
  return extras.length ? `${files.join(', ')}, plus ${extras.join(' and ')}` : files.join(', ');
}
