// End-to-end against the real reddit.com. Run by hand: `pnpm live` (or with
// LIVE_ONLY=post etc.). It runs a headed browser, kept off-screen, because
// Reddit shows headless browsers a "prove your humanity" page. Nothing it downloads leaves
// e2e/live/out/, which git ignores.
import { expect, test, type BrowserContext } from '@playwright/test';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  chooseComments,
  choosePosts,
  setSettings,
  launchWithExtension,
  readZip,
  startExport,
  waitForZip,
  type ExtensionBrowser,
} from '../browser';
import { checkTrees, parseCsv, type DataJson } from '../../tests/support/export-checks';

const OUT = path.resolve('e2e/live/out');
const ONLY = process.env.LIVE_ONLY?.split(',');
const POST_URL = process.env.LIVE_POST ?? 'https://www.reddit.com/comments/1xwkroy/';
const BIG_POST_URL = process.env.LIVE_BIG_POST ?? 'https://www.reddit.com/comments/1xsnr4k/';

let browser: ExtensionBrowser;
let context: BrowserContext;

test.beforeAll(async () => {
  mkdirSync(OUT, { recursive: true });
  browser = await launchWithExtension({
    profileDir: path.resolve('e2e/live/.profile'),
    background: true,
    headless: false,
  });
  context = browser.context;
});

test.afterAll(async () => {
  await browser?.close();
});

/** Every request the export tab makes, for the summary. */
function recordRequests(tab: import('@playwright/test').Page): string[] {
  const log: string[] = [];
  tab.on('response', (r) =>
    log.push(`${r.request().method()} ${r.status()} ${r.url().slice(0, 160)}`),
  );
  return log;
}

/**
 * What the export page says, every 5 seconds: to see afterwards how good the
 * time-left estimate was against when the export really ended.
 */
function watchEta(tab: import('@playwright/test').Page) {
  const samples: { at: number; headline: string; position: string }[] = [];
  const timer = setInterval(() => {
    void tab
      .evaluate(() => ({
        headline: document.querySelector('.headline')?.textContent?.trim() ?? '',
        position: document.querySelector('.position')?.textContent?.trim() ?? '',
      }))
      .then((s) => samples.push({ at: Date.now(), ...s }))
      .catch(() => undefined);
  }, 5_000);
  const started = Date.now();
  return {
    /** Each "About N minutes left" next to how long it really took from then. */
    report() {
      clearInterval(timer);
      const end = Date.now();
      const rows = samples.map((s) => {
        const m =
          /About (\d+) minutes?|About (\d+) hours?(?: (\d+) minutes)?|Less than a minute|About a minute/.exec(
            s.headline,
          );
        let said: number | null = null;
        if (m?.[1]) said = Number(m[1]) * 60;
        else if (m?.[2]) said = Number(m[2]) * 3600 + Number(m[3] ?? 0) * 60;
        else if (m?.[0] === 'Less than a minute') said = 30;
        else if (m?.[0] === 'About a minute') said = 60;
        const actual = (end - s.at) / 1000;
        return {
          elapsed: Math.round((s.at - started) / 1000),
          said: s.headline,
          actualLeft: Math.round(actual),
          error: said === null ? null : Math.round(((said - actual) / Math.max(actual, 60)) * 100),
        };
      });
      const errors = rows
        .filter((r) => r.error !== null && r.elapsed > (end - started) / 1000 / 5)
        .map((r) => Math.abs(r.error!));
      return {
        totalSeconds: Math.round((end - started) / 1000),
        medianAbsErrorPct: errors.length
          ? errors.sort((a, b) => a - b)[Math.floor(errors.length / 2)]
          : null,
        rows,
      };
    },
  };
}

function keep(zip: string, name: string) {
  copyFileSync(zip, path.join(OUT, `${name}.zip`));
}

function summary(name: string, value: unknown) {
  writeFileSync(path.join(OUT, `${name}.summary.json`), JSON.stringify(value, null, 2));
}

const run = (name: string) => (ONLY && !ONLY.includes(name) ? test.skip : test);
/** Only when asked for by name in LIVE_ONLY. */
const optIn = (name: string) => (ONLY?.includes(name) ? test : test.skip);

run('post')('a post with all its comments', async () => {
  const page = await context.newPage();
  await page.goto(POST_URL, { waitUntil: 'domcontentloaded' });
  // A single post always exports every comment: its form has no comment choice.
  const tab = await startExport(browser, page);
  const requests = recordRequests(tab);
  const zip = await waitForZip(tab, browser.downloadsDir, 20 * 60_000);
  keep(zip, 'post');
  const files = readZip(zip);
  expect([...files.keys()].sort()).toEqual(
    expect.arrayContaining(['README.txt', 'manifest.json', 'data.json', 'posts.csv']),
  );
  const data = JSON.parse(files.get('data.json')!.toString()) as DataJson;
  const manifest = JSON.parse(files.get('manifest.json')!.toString());
  const total = checkTrees(data);
  const csvRows = files.has('comments.csv')
    ? parseCsv(files.get('comments.csv')!.toString()).length - 1
    : 0;
  expect(csvRows).toBe(total);
  summary('post', {
    total,
    reported: data.posts[0]!.num_comments,
    manifest,
    requests,
  });
  expect(manifest.status).toBe('complete');
  await tab.screenshot({ path: path.join(OUT, 'post-done.png'), fullPage: true });
  await page.close();
});

run('big')('a big post with media', async () => {
  const page = await context.newPage();
  await page.goto(BIG_POST_URL, { waitUntil: 'domcontentloaded' });
  await setSettings(browser, { includeMedia: true });
  // A single post always exports every comment: its form has no comment choice.
  const tab = await startExport(browser, page);
  const eta = watchEta(tab);
  // Screenshot mid-run, to see the progress view.
  await tab.waitForTimeout(15_000);
  await tab.screenshot({ path: path.join(OUT, 'big-running.png'), fullPage: true });
  const zip = await waitForZip(tab, browser.downloadsDir, 25 * 60_000);
  keep(zip, 'big');
  const files = readZip(zip);
  const data = JSON.parse(files.get('data.json')!.toString()) as DataJson;
  const manifest = JSON.parse(files.get('manifest.json')!.toString());
  const total = checkTrees(data);
  const media = [...files.keys()].filter((k) => k.startsWith('media/'));
  summary('big', {
    total,
    reported: data.posts[0]!.num_comments,
    media,
    manifest,
    eta: eta.report(),
  });
  expect(media.length).toBeGreaterThan(0);
  expect(total).toBeGreaterThan((data.posts[0]!.num_comments ?? 0) * 0.8);
  await tab.screenshot({ path: path.join(OUT, 'big-done.png'), fullPage: true });
  await page.close();
});

run('subreddit')('a subreddit listing with comments', async () => {
  const page = await context.newPage();
  await page.goto('https://www.reddit.com/r/AskHistorians/top/?t=week', {
    waitUntil: 'domcontentloaded',
  });
  const tab = await startExport(browser, page, async (form) => {
    await choosePosts(form, '25');
    // The top comments of each post keep this to a reasonable time at Reddit's pace.
    await chooseComments(form, 'Top');
  });
  const eta = watchEta(tab);
  const zip = await waitForZip(tab, browser.downloadsDir, 50 * 60_000);
  keep(zip, 'subreddit');
  const files = readZip(zip);
  const data = JSON.parse(files.get('data.json')!.toString()) as DataJson;
  const manifest = JSON.parse(files.get('manifest.json')!.toString());
  const total = checkTrees(data);
  summary('subreddit', {
    posts: data.posts.length,
    total,
    manifest,
    eta: eta.report(),
  });
  expect(data.posts.every((p) => p.comment_count !== null && p.comment_count <= 100)).toBe(true);
  expect(data.posts.length).toBe(25);
  expect([...files.keys()].filter((k) => k.startsWith('threads/')).length).toBe(25);
  await page.close();
});

run('feed')('a subreddit listing without comments, past the first page', async () => {
  const page = await context.newPage();
  await page.goto('https://www.reddit.com/r/AskReddit/new/', { waitUntil: 'domcontentloaded' });
  const tab = await startExport(browser, page, async (form) => {
    await choosePosts(form, '100');
    await chooseComments(form, 'None');
  });
  const zip = await waitForZip(tab, browser.downloadsDir, 10 * 60_000);
  keep(zip, 'feed');
  const files = readZip(zip);
  const posts = parseCsv(files.get('posts.csv')!.toString());
  const ids = posts.slice(1).map((r) => r[0]);
  summary('feed', { rows: ids.length, unique: new Set(ids).size });
  expect(ids.length).toBe(100);
  expect(new Set(ids).size).toBe(100);
  await page.close();
});

run('search')('search results', async () => {
  const page = await context.newPage();
  await page.goto('https://www.reddit.com/r/AskHistorians/search/?q=rome', {
    waitUntil: 'domcontentloaded',
  });
  const tab = await startExport(browser, page, async (form) => {
    await choosePosts(form, '25');
    await chooseComments(form, 'None');
  });
  const zip = await waitForZip(tab, browser.downloadsDir, 10 * 60_000);
  keep(zip, 'search');
  const files = readZip(zip);
  const data = JSON.parse(files.get('data.json')!.toString()) as {
    posts: { score: number | null; created_utc: string | null }[];
  };
  summary('search', { posts: data.posts.length, sample: data.posts.slice(0, 2) });
  expect(data.posts.length).toBeGreaterThan(10);
  // Search results are filled in from each post's page.
  expect(data.posts.every((p) => p.score !== null && p.created_utc !== null)).toBe(true);
  await page.close();
});

run('user')('a user profile logged out explains that Reddit needs a login', async () => {
  const page = await context.newPage();
  await page.goto('https://www.reddit.com/user/AutoModerator/', { waitUntil: 'domcontentloaded' });
  const tab = await startExport(browser, page);
  await tab.locator('main[data-view="done"]').waitFor({ timeout: 5 * 60_000 });
  await expect(tab.locator('.problem')).toContainText('logged-in');
  await tab.screenshot({ path: path.join(OUT, 'user-done.png'), fullPage: true });
  await page.close();
});

// The setup that broke exports in a real browser: with third-party cookies blocked,
// requests from the extension's own page reach Reddit without its cookies and get
// "blocked by network security". Requests through the Reddit tab still work.
run('thirdparty')('third-party cookies blocked: a subreddit export still works', async () => {
  const b = await launchWithExtension({
    background: true,
    headless: false,
    blockThirdPartyCookies: true,
  });
  try {
    const page = await b.context.newPage();
    await page.goto(process.env.LIVE_SUB ?? 'https://www.reddit.com/r/Rentbusters/', {
      waitUntil: 'domcontentloaded',
    });
    // Let Reddit's own check run in the tab, as it does for a person.
    await page.waitForTimeout(6000);
    const tab = await startExport(b, page, async (form) => {
      await choosePosts(form, '25');
      await chooseComments(form, 'None');
    });
    const zip = await waitForZip(tab, b.downloadsDir, 10 * 60_000);
    keep(zip, 'thirdparty');
    const files = readZip(zip);
    const manifest = JSON.parse(files.get('manifest.json')!.toString());
    summary('thirdparty', manifest);
    expect(manifest.status).toBe('complete');
    expect(manifest.counts.posts).toBeGreaterThan(0);
  } finally {
    await b.close();
  }
});

// Going past the 1000-post limit on a big subreddit. Long (hundreds of requests),
// so only when asked for: LIVE_ONLY=deep.
optIn('deep')('past the 1000-post limit', async () => {
  test.setTimeout(3 * 60 * 60_000);
  const page = await context.newPage();
  await page.goto(process.env.LIVE_DEEP_SUB ?? 'https://www.reddit.com/r/AskHistorians/', {
    waitUntil: 'domcontentloaded',
  });
  await setSettings(browser, { deep: true });
  const tab = await startExport(browser, page, async (form) => {
    await choosePosts(form, 'All');
    await chooseComments(form, 'None');
  });
  const eta = watchEta(tab);
  const zip = await waitForZip(tab, browser.downloadsDir, 3 * 60 * 60_000);
  keep(zip, 'deep');
  const files = readZip(zip);
  const ids = parseCsv(files.get('posts.csv')!.toString())
    .slice(1)
    .map((r) => r[0]);
  summary('deep', { posts: ids.length, unique: new Set(ids).size, eta: eta.report() });
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.length).toBeGreaterThan(1000);
  await page.close();
});

// The "Check connection" page: LIVE_ONLY=check.
optIn('check')('check connection', async () => {
  const reddit = await context.newPage();
  await reddit.goto('https://www.reddit.com/r/AskReddit/', { waitUntil: 'domcontentloaded' });
  await reddit.waitForTimeout(4000);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${browser.extensionId}/export.html#check?r=AskReddit`);
  await page.getByRole('button', { name: 'Check' }).click();
  await page.getByRole('button', { name: 'Copy the results' }).waitFor({ timeout: 240_000 });
  for (const li of await page.locator('.results li').all())
    console.log((await li.innerText()).replace(/\s+/g, ' '));
  await page.screenshot({ path: path.join(OUT, 'check.png'), fullPage: true });
  await page.close();
  await reddit.close();
});
