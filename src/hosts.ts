// The hosts the extension may read, in one place: wxt.config.ts declares them as
// host permissions (a public contract, see there), and the export page asks for
// them where the browser makes them optional (Firefox).

import { REDDIT } from './reddit/model';

/** www.reddit.com: its tabs, and the requests made through them. */
export const REDDIT_TABS = `${REDDIT}/*`;

/** Reddit's pages and API, and the hosts its images and videos come from. */
export const HOST_PERMISSIONS: string[] = [
  REDDIT_TABS,
  'https://*.redd.it/*',
  'https://i.imgur.com/*',
];
