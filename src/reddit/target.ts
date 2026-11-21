// What a Reddit URL points at, and so what an export of that page contains.

const SORTS = ['hot', 'new', 'top', 'rising', 'controversial'] as const;
export type Sort = (typeof SORTS)[number];

const TIMES = ['hour', 'day', 'week', 'month', 'year', 'all'] as const;
export type TimeFilter = (typeof TIMES)[number];

export const COMMENT_SORTS = ['confidence', 'top', 'new', 'controversial', 'old', 'qa'] as const;
export type CommentSort = (typeof COMMENT_SORTS)[number];

const USER_SECTIONS = ['overview', 'submitted', 'comments', 'saved', 'upvoted'] as const;
type UserSection = (typeof USER_SECTIONS)[number];

const SEARCH_SORTS = ['relevance', 'hot', 'top', 'new', 'comments'] as const;
type SearchSort = (typeof SEARCH_SORTS)[number];

export type Target =
  | {
      kind: 'post';
      /** Empty for a share link until the export has followed it. */
      id: string;
      subreddit: string | null;
      /** A mobile-app share link (/r/<sub>/s/<code>): only Reddit knows which post it is. */
      share?: string;
    }
  | { kind: 'subreddit'; name: string; sort: Sort; time: TimeFilter }
  | {
      kind: 'user';
      name: string;
      section: UserSection;
      sort: 'new' | 'top' | 'hot';
      time: TimeFilter;
    }
  | {
      kind: 'search';
      query: string;
      subreddit: string | null;
      sort: SearchSort;
      time: TimeFilter;
    };

const REDDIT_HOST = /^(?:(?:www|old|new|np|m|sh|i)\.)?reddit\.com$/i;
const NAME = /^[A-Za-z0-9_-]{2,32}$/;
// Base 36; the oldest posts have ids of a single character.
const POST_ID = /^[a-z0-9]{1,12}$/i;

function oneOf<T extends string>(
  value: string | null | undefined,
  list: readonly T[],
  fallback: T,
): T {
  const v = (value ?? '').toLowerCase();
  return (list as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function isRedditUrl(url: string | URL): boolean {
  try {
    const u = typeof url === 'string' ? new URL(url) : url;
    return REDDIT_HOST.test(u.hostname) || /^redd\.it$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/**
 * A mobile-app share link (https://www.reddit.com/r/<sub>/s/<code>), normalized, or
 * null. Reddit redirects it to a post; only a request can tell which one.
 */
export function shareLink(input: string | URL): string | null {
  try {
    const url = typeof input === 'string' ? new URL(input) : input;
    if (!REDDIT_HOST.test(url.hostname)) return null;
    const m = /^\/r\/([A-Za-z0-9_]{2,32})\/s\/([A-Za-z0-9]{4,20})\/?$/.exec(url.pathname);
    return m ? `https://www.reddit.com/r/${m[1]}/s/${m[2]}` : null;
  } catch {
    return null;
  }
}

/** Search tabs other than posts (comments, communities, people, media). */
function searchType(q: URLSearchParams): string {
  return (q.get('type') ?? '').toLowerCase();
}
const POST_SEARCH_TYPES = ['', 'posts', 'link'];

/** r/all and r/popular are Reddit's front-page feeds, not communities. */
const FRONT_FEEDS = /^(?:all|popular)$/i;

/**
 * Why a Reddit page that looks exportable isn't, in words for the popup; null when
 * there's nothing to say (either it is exportable, or it's simply not a page of a
 * post, subreddit, profile or search).
 */
export function unsupportedReason(input: string | URL): string | null {
  let url: URL;
  try {
    url = typeof input === 'string' ? new URL(input) : input;
  } catch {
    return null;
  }
  if (!REDDIT_HOST.test(url.hostname)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const first = parts[0]?.toLowerCase();
  if (first === 'r' && parts[1] && FRONT_FEEDS.test(parts[1]))
    return `r/${parts[1].toLowerCase()} is Reddit's front page, not a community, and can't be exported. Open a subreddit, a post or a search instead.`;
  const isSearch = first === 'search' || (first === 'r' && parts[2]?.toLowerCase() === 'search');
  if (isSearch && !POST_SEARCH_TYPES.includes(searchType(url.searchParams)))
    return 'Only post results of a search can be exported. Switch to the Posts tab of the search.';
  return null;
}

/** The export target for a Reddit page URL, or null when the page isn't one we can export. */
export function parseTarget(input: string | URL): Target | null {
  let url: URL;
  try {
    url = typeof input === 'string' ? new URL(input) : input;
  } catch {
    return null;
  }
  // redd.it/<id> short links.
  if (/^redd\.it$/i.test(url.hostname)) {
    const id = url.pathname.split('/').filter(Boolean)[0];
    return id && POST_ID.test(id) ? { kind: 'post', id: id.toLowerCase(), subreddit: null } : null;
  }
  if (!REDDIT_HOST.test(url.hostname)) return null;

  const parts = url.pathname
    .split('/')
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        // A stray % in a title part; the raw text is fine for our purposes.
        return p;
      }
    });
  const q = url.searchParams;
  const time = oneOf(q.get('t'), TIMES, 'day');

  // /comments/<id>/... and /r/<sub>/comments/<id>/...
  // "comments" right at the start, or after r/<sub> or user/<name>, never a subreddit called that.
  const first = parts[0]?.toLowerCase();
  const ci =
    parts[0] === 'comments'
      ? 0
      : (first === 'r' || first === 'user' || first === 'u') && parts[2] === 'comments'
        ? 2
        : -1;
  if (ci !== -1 && parts[ci + 1] && POST_ID.test(parts[ci + 1]!)) {
    const sub = parts[0]?.toLowerCase() === 'r' && ci === 2 ? parts[1]! : null;
    return { kind: 'post', id: parts[ci + 1]!.toLowerCase(), subreddit: sub };
  }

  if (parts[0]?.toLowerCase() === 'search') {
    const query = q.get('q')?.trim();
    if (!query || !POST_SEARCH_TYPES.includes(searchType(q))) return null;
    return {
      kind: 'search',
      query,
      subreddit: null,
      sort: oneOf(q.get('sort'), SEARCH_SORTS, 'relevance'),
      time: oneOf(q.get('t'), TIMES, 'all'),
    };
  }

  if (parts[0]?.toLowerCase() === 'r' && parts[1] && NAME.test(parts[1])) {
    const name = parts[1];
    // Multireddits (r/a+b) and the front page feeds (r/all, r/popular) are left out
    // on purpose: Reddit's community feed is empty for them.
    if (FRONT_FEEDS.test(name)) return null;
    // A share link is a post, but which one only Reddit can say: never the feed.
    const share = shareLink(url);
    if (share) return { kind: 'post', id: '', subreddit: name, share };
    if (parts[2]?.toLowerCase() === 's') return null;
    if (parts[2]?.toLowerCase() === 'search') {
      const query = q.get('q')?.trim();
      if (!query || !POST_SEARCH_TYPES.includes(searchType(q))) return null;
      return {
        kind: 'search',
        query,
        subreddit: q.get('restrict_sr') === '0' ? null : name,
        sort: oneOf(q.get('sort'), SEARCH_SORTS, 'relevance'),
        time: oneOf(q.get('t'), TIMES, 'all'),
      };
    }
    const sort = oneOf(parts[2], SORTS, 'hot');
    return { kind: 'subreddit', name, sort, time };
  }

  if ((parts[0]?.toLowerCase() === 'user' || parts[0]?.toLowerCase() === 'u') && parts[1]) {
    const name = parts[1];
    if (!NAME.test(name)) return null;
    const section = oneOf(parts[2], USER_SECTIONS, 'overview');
    const sort = oneOf(q.get('sort'), ['new', 'top', 'hot'] as const, 'new');
    return { kind: 'user', name, section, sort, time: oneOf(q.get('t'), TIMES, 'all') };
  }

  return null;
}

/** Short human description, e.g. "r/AskHistorians: top of the month". */
export function describeTarget(t: Target): string {
  switch (t.kind) {
    case 'post':
      if (t.share) return `Shared post in r/${t.subreddit ?? ''}`;
      return t.subreddit ? `Post ${t.id} in r/${t.subreddit}` : `Post ${t.id}`;
    case 'subreddit':
      return `r/${t.name}: ${sortLabel(t.sort, t.time)}`;
    case 'user':
      return `u/${t.name}: ${t.section === 'overview' ? 'posts and comments' : t.section}`;
    case 'search':
      return `Search “${t.query}”${t.subreddit ? ` in r/${t.subreddit}` : ''}`;
  }
}

export function sortLabel(sort: Sort, time: TimeFilter): string {
  if (sort !== 'top' && sort !== 'controversial') return sort;
  const span = {
    hour: 'the hour',
    day: 'today',
    week: 'the week',
    month: 'the month',
    year: 'the year',
    all: 'all time',
  }[time];
  return time === 'day' ? `${sort} today` : `${sort} of ${span}`;
}
