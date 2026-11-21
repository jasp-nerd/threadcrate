// The export choices people made last time, so the export form opens with them.
// Storage key "settings" is a public contract: changing its shape needs a migration.
import { browser } from 'wxt/browser';
import { DEFAULT_OPTIONS, type BackendChoice, type Formats } from '../engine/options';
import { COMMENT_SORTS, type CommentSort } from '../reddit/target';

export interface Settings {
  maxPosts: number;
  includeComments: boolean;
  commentSort: CommentSort;
  /** For listings (subreddits, searches, profiles); null means every comment. */
  maxComments: number | null;
  /** For a single post, remembered apart: one post usually means all of it. */
  postMaxComments: number | null;
  includeMedia: boolean;
  formats: Formats;
  backend: BackendChoice;
  speed: 'normal' | 'fast';
  deep: boolean;
  /** The Export button on Reddit pages; off, only the toolbar button exports. */
  showPageButton: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  maxPosts: DEFAULT_OPTIONS.maxPosts,
  includeComments: DEFAULT_OPTIONS.includeComments,
  commentSort: DEFAULT_OPTIONS.commentSort,
  // Listings default to the top comments: one request per post, the fast choice.
  maxComments: 25,
  postMaxComments: null,
  includeMedia: DEFAULT_OPTIONS.includeMedia,
  formats: { ...DEFAULT_OPTIONS.formats },
  backend: DEFAULT_OPTIONS.backend,
  speed: DEFAULT_OPTIONS.speed,
  deep: DEFAULT_OPTIONS.deep,
  showPageButton: true,
};

/** Fills in anything missing or malformed, so old or hand-edited storage never breaks the form. */
export function normalizeSettings(raw: unknown): Settings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  const d = DEFAULT_SETTINGS;
  const formats = {
    ...d.formats,
    ...(s.formats && typeof s.formats === 'object' ? s.formats : {}),
  };
  if (!formats.json && !formats.csv && !formats.markdown) formats.json = true;
  return {
    maxPosts:
      typeof s.maxPosts === 'number' && s.maxPosts >= 1
        ? Math.min(Math.floor(s.maxPosts), 1000)
        : d.maxPosts,
    includeComments: typeof s.includeComments === 'boolean' ? s.includeComments : d.includeComments,
    commentSort: (COMMENT_SORTS as readonly string[]).includes(s.commentSort as string)
      ? (s.commentSort as CommentSort)
      : d.commentSort,
    maxComments:
      s.maxComments === null
        ? null
        : typeof s.maxComments === 'number' && s.maxComments >= 1
          ? Math.floor(s.maxComments)
          : d.maxComments,
    postMaxComments:
      typeof s.postMaxComments === 'number' && s.postMaxComments >= 1
        ? Math.floor(s.postMaxComments)
        : null,
    includeMedia: typeof s.includeMedia === 'boolean' ? s.includeMedia : d.includeMedia,
    formats,
    backend: s.backend === 'json' || s.backend === 'html' ? s.backend : 'auto',
    speed: s.speed === 'fast' ? 'fast' : 'normal',
    deep: typeof s.deep === 'boolean' ? s.deep : false,
    showPageButton: typeof s.showPageButton === 'boolean' ? s.showPageButton : true,
  };
}

export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get('settings');
  return normalizeSettings(stored.settings);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ settings: normalizeSettings(settings) });
}
