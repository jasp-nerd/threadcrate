// What can go wrong when asking Reddit, and what each kind of failure means for
// an export. The policy is one table keyed by kind, so a new kind can't be
// handled in one place and forgotten in another.

export type RedditErrorKind =
  | 'blocked'
  | 'login'
  | 'challenge'
  | 'throttled'
  | 'transient'
  | 'notfound'
  | 'forbidden'
  | 'unexpected'
  | 'aborted';

export class RedditError extends Error {
  constructor(
    readonly kind: RedditErrorKind,
    readonly url: string,
    readonly status?: number,
    /** Reddit's own reason when it gave one, e.g. "private" or "quarantined". */
    readonly detail?: string,
  ) {
    super(
      `Reddit request ${kind}${status ? ` (${status})` : ''}${detail ? `: ${detail}` : ''}: ${url}`,
    );
    this.name = 'RedditError';
  }
}

/** The `detail` of an HTML answer where JSON was asked for. */
export const NOT_JSON = 'not JSON';

/** The `detail` of a subreddit Reddit says doesn't exist (html-parse.ts, blockedCommunity). */
export const COMMUNITY_NOT_FOUND = 'community not found';
/** Why Reddit hides a community, as blockedCommunity names it. */
const COMMUNITY_REASONS = ['banned', 'quarantined', 'private', 'premium only', 'restricted'];

interface Policy {
  /** Stops the whole export: carrying on would only fail the same way. */
  fatal: boolean;
  /** Reddit refusing its API as a whole: the web pages take over. */
  refusesApi: boolean;
  /** Reddit refusing one API endpoint: another may still bring the same comments. */
  refusesRoute: boolean;
  /** What went wrong, in words for the person exporting. */
  message: (error: RedditError) => string;
}

const POLICY: Record<RedditErrorKind, Policy> = {
  blocked: {
    fatal: true,
    refusesApi: true,
    refusesRoute: true,
    message: () =>
      'Reddit refused the request ("blocked by network security"). Open reddit.com in a tab, check that pages load, and try again; if you use a VPN, try without it.',
  },
  challenge: {
    fatal: true,
    refusesApi: true,
    refusesRoute: false,
    message: () =>
      'Reddit wants to check that you are human. Open reddit.com in a tab, let the page load (solve the check if one appears), then try again.',
  },
  login: {
    fatal: true,
    refusesApi: true,
    refusesRoute: false,
    message: (e) =>
      e.detail
        ? `${e.detail}. Log in to reddit.com in this browser and try again.`
        : 'Reddit asked to log in. Log in to reddit.com in this browser and try again.',
  },
  throttled: {
    fatal: true,
    refusesApi: false,
    refusesRoute: false,
    message: () =>
      'Reddit kept answering "too many requests" even after waiting. Wait a few minutes and try again.',
  },
  aborted: {
    fatal: true,
    refusesApi: false,
    refusesRoute: false,
    message: () => 'Stopped before the end.',
  },
  notfound: {
    fatal: false,
    refusesApi: false,
    refusesRoute: true,
    message: (e) =>
      e.detail === COMMUNITY_NOT_FOUND
        ? 'Reddit says this community does not exist. Check the name in the address.'
        : 'Reddit says this page does not exist (it may be deleted, or the link is wrong).',
  },
  forbidden: {
    fatal: false,
    refusesApi: false,
    refusesRoute: true,
    message: (e) =>
      e.detail && COMMUNITY_REASONS.includes(e.detail)
        ? `Reddit doesn't show this community's posts: it is ${e.detail}.`
        : `Reddit refused access${e.detail ? ` (${e.detail})` : ''}: the community may be private, quarantined or banned.`,
  },
  transient: {
    fatal: false,
    refusesApi: false,
    refusesRoute: false,
    message: () =>
      'Reddit did not answer (a network problem or a Reddit outage). Try again in a moment.',
  },
  unexpected: {
    fatal: false,
    refusesApi: false,
    refusesRoute: false,
    message: (e) =>
      `Reddit answered in a way this extension does not understand (${e.status ?? 'no status'}${e.detail ? `, ${e.detail}` : ''}). Reddit may have changed its pages; please report this.`,
  },
};

/** HTML instead of JSON: how Reddit refuses its API without saying so. */
function notJson(error: RedditError): boolean {
  return error.kind === 'unexpected' && error.detail === NOT_JSON;
}

/** Errors that stop the whole export. */
export function isFatal(error: unknown): boolean {
  return error instanceof RedditError && POLICY[error.kind].fatal;
}

/** The export was stopped (by the person, or because another part of it failed). */
export function isAborted(error: unknown): boolean {
  return error instanceof RedditError && error.kind === 'aborted';
}

/** Reddit refusing a whole kind of request, as opposed to one post failing. */
export function refusesApi(error: unknown): boolean {
  return error instanceof RedditError && (POLICY[error.kind].refusesApi || notJson(error));
}

/** Reddit refusing one endpoint (not the whole site, which the next request would show). */
export function refusesRoute(error: unknown): boolean {
  return error instanceof RedditError && (POLICY[error.kind].refusesRoute || notJson(error));
}

/** What went wrong, in words for the person exporting. */
export function describeError(error: unknown): string {
  if (error instanceof RedditError) return POLICY[error.kind].message(error);
  return `Something went wrong: ${error instanceof Error ? error.message : String(error)}`;
}

/** "blocked, 403", for the activity log. */
export function errorSummary(error: unknown): string {
  return error instanceof RedditError
    ? `${error.kind}, ${error.status ?? 'no status'}`
    : String(error);
}

/** Recognizes the pages Reddit serves instead of content. */
export function classifyPage(reply: {
  status: number;
  url: string;
  text: string;
}): RedditErrorKind | null {
  // Only error pages count as blocks: a comment may well quote these words.
  if (
    reply.status >= 400 &&
    /blocked by network security|whoa there, pardner|blocked due to a network policy/i.test(
      reply.text,
    )
  )
    return 'blocked';
  // Reddit's check page is titled exactly this; a post can be titled anything,
  // so a real page (with a post on it) never counts.
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(reply.text.slice(0, 20_000))?.[1] ?? '';
  if (
    /[?&]js_challenge=1/.test(reply.url) ||
    (/^\s*Reddit - Prove your humanity\s*$/i.test(title) && !/<shreddit-post[\s>]/.test(reply.text))
  )
    return 'challenge';
  try {
    const u = new URL(reply.url);
    if (/^\/(?:account\/)?login\/?$/.test(u.pathname)) return 'login';
  } catch {
    // Not a URL we can read; nothing to classify.
  }
  return null;
}
