// Is Threadcrate's Chrome Web Store listing live yet? Prints "live" or "pending".
// With --apply, once it's live, also links it in the README and on the website
// (website/src/data/site.ts). Run by .github/workflows/store-live.yml and by the
// server's one-off watcher (scripts/store-watch.sh), both every 12 hours until then.
//
// A listing still in review redirects to an "empty-title" page whose title is just
// "Chrome Web Store"; a live one carries the extension's name in its title.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ID = 'nhgjbajgfmnpgodnmikmobfogdodbdgn';
const STORE = `https://chromewebstore.google.com/detail/${ID}`;
const root = path.resolve(import.meta.dirname, '..');

const res = await fetch(STORE, { headers: { 'user-agent': 'Mozilla/5.0' } });
const title = /<title>([^<]*)<\/title>/.exec(await res.text())?.[1] ?? '';
const live = res.ok && title.includes('Threadcrate');
console.log(live ? 'live' : 'pending');

if (live && process.argv.includes('--apply')) {
  const readme = path.join(root, 'README.md');
  writeFileSync(
    readme,
    readFileSync(readme, 'utf8').replace(
      /<!-- chrome-store:start[^>]*-->[\s\S]*?<!-- chrome-store:end -->/,
      `<a href="${STORE}"><img src="media/readme/chrome.svg" width="48" height="48" alt=""><br><b>Chrome Web Store</b></a><br>\n      <sub>Chrome, Edge, Brave and other Chromium browsers</sub>`,
    ),
  );
  const site = path.join(root, 'website/src/data/site.ts');
  writeFileSync(site, readFileSync(site, 'utf8').replace(/chrome: '',/, `chrome: '${STORE}',`));
}
