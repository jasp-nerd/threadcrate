// Facts the pages repeat, in one place. Numbers are real and dated: update them, never round them up.

export const PRODUCT = 'Threadcrate for Reddit';
export const SHORT = 'Threadcrate';

/** Store listings. Empty means there is no listing yet: the install buttons then say
 * "Coming soon to the Chrome Web Store" and link nowhere. Chrome only for now. */
export const STORE = {
  chrome: '',
};

export const LINKS = {
  github: 'https://github.com/jasp-nerd/threadcrate',
  releases: 'https://github.com/jasp-nerd/threadcrate/releases',
  issues: 'https://github.com/jasp-nerd/threadcrate/issues/new/choose',
  sibling: 'https://coursedownloader.com',
};

/**
 * The maker's Reddit Scraper on Apify, for exports in the cloud, from code or from an AI agent.
 * The landing page shows only the fields that are set, and no section (and no hero line) at all
 * while `url` is empty, so nothing unverified ships. Each value is shown as written. Check the
 * numbers when they change and update `pricesAsOf`.
 */
export const APIFY = {
  url: 'https://apify.com/laptime/reddit-scraper?utm_source=threadcrate-site&utm_medium=website&utm_campaign=threadcrate',
  /** What the free plan buys, said as volume: the site leads with this, not with money. */
  freeVolume: '5,000 posts free every month',
  freeComments: 'or about 10,000 comments',
  /** The money, only as the explanation, in small print. */
  freeNote:
    "Free: Apify's Free plan includes $5 of credit every month (no credit card), about 5,000 posts or 10,000 comments at $0.99 / $0.49 per 1,000.",
  price: '$0.99 per 1,000 posts, $0.49 per 1,000 comments, no start fee',
  benchmark: '100 posts in 3.4 s (17 Nov 2026)',
  pricesAsOf: '21 November 2026',
  /** Adds the scraper to Claude Code as an MCP tool. */
  mcp: 'claude mcp add reddit "https://mcp.apify.com?tools=laptime/reddit-scraper" -t http',
};

/** A path inside the site, under the configured base. */
export function href(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}${path}`;
}

/** Phones can't run the extension, so their button writes the visitor an email with the link. */
export function mailToSelf(site: URL): string {
  const subject = encodeURIComponent(PRODUCT);
  const body = encodeURIComponent(`Install it on my computer: ${new URL(href('/'), site)}`);
  return `mailto:?subject=${subject}&body=${body}`;
}
