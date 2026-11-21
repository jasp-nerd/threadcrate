// The whole flow against a mock reddit.com: the button on the page, the export
// form, the export tab, Reddit's rate limits, and the ZIP in the downloads folder.
import { expect, test } from '@playwright/test';
import {
  chooseComments,
  choosePosts,
  launchWithExtension,
  openExportForm,
  readZip,
  setSettings,
  startExport,
  waitForZip,
  type ExtensionBrowser,
} from '../browser';
import { checkTrees, parseCsv, type DataJson } from '../../tests/support/export-checks';
import { HOSTS, startMockReddit, type MockReddit } from './server';

let mock: MockReddit;
let browser: ExtensionBrowser;

test.beforeEach(async () => {
  mock = await startMockReddit();
  browser = await launchWithExtension({
    headless: !process.env.HEADED,
    args: [
      `--host-resolver-rules=${HOSTS.map((h) => `MAP ${h} 127.0.0.1:${mock.port}`).join(', ')}`,
      '--ignore-certificate-errors',
    ],
  });
});

test.afterEach(async () => {
  await browser.close();
  await mock.close();
  expect(mock.unexpected).toEqual([]);
});

const POST_URL = 'https://www.reddit.com/r/testsub/comments/p1/an_invented_question/';

test('logged out: a post with every comment and its image, through a 429', async () => {
  mock.throttleNext = 1;
  const page = await browser.context.newPage();
  await page.goto(POST_URL);
  await setSettings(browser, { includeMedia: true });
  const tab = await startExport(browser, page, async (form) => {
    await expect(form.locator('.what')).toHaveText('A thread in r/testsub');
  });
  const zip = await waitForZip(tab, browser.downloadsDir, 60_000);
  await expect(tab.locator('h1')).toHaveText('An invented question');

  const files = readZip(zip);
  expect([...files.keys()].sort()).toEqual([
    'README.txt',
    'comments.csv',
    'data.json',
    'manifest.json',
    'media/testsub_p1_1.png',
    'posts.csv',
    'threads/testsub_p1_an-invented-question.md',
  ]);
  const data = JSON.parse(files.get('data.json')!.toString()) as DataJson;
  expect(checkTrees(data)).toBe(5);
  expect(parseCsv(files.get('comments.csv')!.toString())).toHaveLength(6);
  const manifest = JSON.parse(files.get('manifest.json')!.toString());
  expect(manifest).toMatchObject({
    status: 'complete',
    data_source: "Reddit's web pages",
    rate_limit_waits: 1,
  });

  // Reddit's data came through the Reddit tab, as the page's own requests.
  const dataRequests = mock.log.filter(
    (r) => r.host === 'www.reddit.com' && /^\/(svc|comments)\//.test(r.path),
  );
  expect(dataRequests.length).toBeGreaterThan(0);
  expect(new Set(dataRequests.map((r) => r.site))).toEqual(new Set(['same-origin']));
  // The 429 was retried, and nothing ran in parallel.
  expect(
    mock.log.filter((r) => r.path.startsWith('/svc/shreddit/more-comments/')).map((r) => r.status),
  ).toEqual([429, 200, 200]);
  // "More comments" comes from the post's page, as reddit.com's own requests do (Reddit
  // refuses them without that Origin and Referer since November 2026).
  for (const r of mock.log.filter((x) => x.path.startsWith('/svc/shreddit/more-comments/'))) {
    expect(r.origin).toBe('https://www.reddit.com');
    expect(r.referer).toMatch(/^https:\/\/www\.reddit\.com\/r\/testsub\/comments\/p1\//);
  }
  expect(mock.maxConcurrent).toBe(1);
});

test('logged in: the JSON API, with the session cookie', async () => {
  await browser.context.addCookies([
    {
      name: 'reddit_session',
      value: 'mock',
      domain: '.reddit.com',
      path: '/',
      secure: true,
      sameSite: 'None',
    },
  ]);
  const page = await browser.context.newPage();
  await page.goto(POST_URL);
  const tab = await startExport(browser, page);
  const files = readZip(await waitForZip(tab, browser.downloadsDir, 60_000));
  const data = JSON.parse(files.get('data.json')!.toString()) as DataJson;
  expect(checkTrees(data)).toBe(4);
  expect(JSON.parse(files.get('manifest.json')!.toString()).data_source).toBe(
    "Reddit's JSON API (logged in)",
  );
  expect(mock.log.map((r) => r.path.split('?')[0])).toEqual(
    expect.arrayContaining(['/api/me.json', '/comments/p1.json', '/api/morechildren.json']),
  );
});

test('a subreddit, with the comments of each post', async () => {
  const page = await browser.context.newPage();
  await page.goto('https://www.reddit.com/r/testsub/');
  const tab = await startExport(browser, page, async (form) => {
    await expect(form.locator('.what')).toHaveText('r/testsub: hot');
    await choosePosts(form, '25');
  });
  const files = readZip(await waitForZip(tab, browser.downloadsDir, 60_000));
  const data = JSON.parse(files.get('data.json')!.toString()) as DataJson;
  expect(data.posts.map((p) => p.id)).toEqual(['f1', 'f2']);
  expect(checkTrees(data)).toBe(2);
  expect([...files.keys()].filter((k) => k.startsWith('threads/'))).toHaveLength(2);
});

test('the export form remembers choices, and each shows how long it takes', async () => {
  const page = await browser.context.newPage();
  await page.goto('https://www.reddit.com/r/testsub/');
  const form = await openExportForm(browser, page);
  await choosePosts(form, 'All');
  await chooseComments(form, 'None');
  await form.reload();
  await expect(form.locator('[aria-labelledby="posts-label"] [aria-pressed="true"]')).toContainText(
    'All',
  );
  await expect(form.locator('[aria-labelledby="depth-label"] [aria-pressed="true"]')).toContainText(
    'None',
  );
  await expect(form.locator('[aria-labelledby="depth-label"] button').first()).toContainText(/min/);
  await expect(form.locator('.form .btn-primary')).toHaveText('Export all posts');
});

test('the welcome steps save which files to make', async () => {
  const page = await browser.context.newPage();
  await page.goto(`chrome-extension://${browser.extensionId}/welcome.html`);
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('checkbox', { name: /code or AI tools/ }).uncheck();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: "You're all set" })).toBeVisible();
  const stored = await page.evaluate(async () => {
    type Local = { get(key: string): Promise<{ settings: { formats: object } }> };
    const { chrome } = globalThis as unknown as { chrome: { storage: { local: Local } } };
    return (await chrome.storage.local.get('settings')).settings;
  });
  expect(stored.formats).toEqual({ json: false, csv: true, markdown: true });
  await setSettings(browser, { formats: { json: true, csv: true, markdown: true } });
});

test('stop and save keeps the comments loaded so far, and a reload asks before running again', async () => {
  mock.moreDelayMs = 5_000;
  const page = await browser.context.newPage();
  await page.goto(POST_URL);
  const tab = await startExport(browser, page);
  await expect(tab.locator('.position')).toContainText('comments');
  await tab.getByRole('button', { name: /Stop and save/ }).click();
  const files = readZip(await waitForZip(tab, browser.downloadsDir, 30_000));
  await expect(tab.locator('.band .chip')).toContainText('Stopped');
  const data = JSON.parse(files.get('data.json')!.toString()) as DataJson;
  // The post page's two comments, saved although the rest never came.
  expect(checkTrees(data)).toBe(2);
  expect(JSON.parse(files.get('manifest.json')!.toString()).status).toBe('stopped');

  const before = mock.log.length;
  await tab.reload();
  await expect(tab.locator('main')).toHaveAttribute('data-view', 'again');
  expect(mock.log.length).toBe(before);
});

test("the Export button sits among Reddit's buttons and opens the toolbar popup", async () => {
  const page = await browser.context.newPage();
  await page.goto('https://www.reddit.com/r/testsub/');
  // On a subreddit: between Create Post and Join.
  const inHeader = page.locator('.masthead threadcrate-ui');
  await expect(inHeader.locator('button')).toHaveText('Export');
  await expect(
    page.locator(
      'create-post-entry-point-wrapper + threadcrate-ui + shreddit-subreddit-header-buttons',
    ),
  ).toHaveCount(1);
  // On a thread: right after Share, in the post's own row.
  await page.goto(POST_URL);
  const button = page.locator(
    '.shreddit-post-container > slot[name="share-button"] + threadcrate-ui button',
  );
  await expect(button).toHaveText('Export');
  // It opens the toolbar popup (Playwright doesn't list extension popups as pages:
  // the browser's targets show it). The form inside is the one tested above.
  await button.click();
  const cdp = await browser.context.newCDPSession(page);
  await expect
    .poll(async () => {
      const { targetInfos } = await cdp.send('Target.getTargets');
      return targetInfos.some((t) => t.url.endsWith('/popup.html'));
    })
    .toBe(true);
  // Off in the settings: gone, without a reload.
  await setSettings(browser, { showPageButton: false });
  await expect(page.locator('threadcrate-ui')).toHaveCount(0);
  await setSettings(browser, { showPageButton: true });
});

test('logged in, but Reddit refuses its JSON API: the export carries on through the web pages', async () => {
  mock.jsonBlocked = true;
  await browser.context.addCookies([
    {
      name: 'reddit_session',
      value: 'mock',
      domain: '.reddit.com',
      path: '/',
      secure: true,
      sameSite: 'None',
    },
  ]);
  const page = await browser.context.newPage();
  await page.goto('https://www.reddit.com/r/testsub/');
  const tab = await startExport(browser, page, async (form) => {
    await choosePosts(form, '25');
  });
  const files = readZip(await waitForZip(tab, browser.downloadsDir, 60_000));
  const manifest = JSON.parse(files.get('manifest.json')!.toString());
  expect(manifest).toMatchObject({ status: 'complete', data_source: "Reddit's web pages" });
  expect(manifest.counts.posts).toBe(2);
});

// A small budget, so the export has to pause for Reddit's limit within seconds.
test("a pause for Reddit's limit is explained, counted down, and the export carries on", async () => {
  mock.budget = { limit: 6, windowMs: 12_000 };
  const page = await browser.context.newPage();
  await page.goto(POST_URL);
  const tab = await startExport(browser, page);
  const headline = tab.locator('.headline');
  await expect(headline).toContainText(
    /(Paused, resuming|Waiting for Reddit's limit, next step) in \d+ s/,
    {
      timeout: 30_000,
    },
  );
  await expect(tab.locator('.explain')).toContainText('Reddit');
  await expect(tab).toHaveTitle(/^Paused: /);
  await waitForZip(tab, browser.downloadsDir, 90_000);
  await expect(tab.locator('main')).toHaveAttribute('data-view', 'done');
  await expect(tab.getByText(/Took \d/)).toBeVisible();
});

test('the export page on a phone-sized screen and in dark mode', async () => {
  mock.moreDelayMs = 3_000;
  const page = await browser.context.newPage();
  await page.goto(POST_URL);
  const tab = await startExport(browser, page);
  await expect(tab.locator('.position')).toContainText('comments');
  await tab.setViewportSize({ width: 380, height: 760 });
  await tab.emulateMedia({ colorScheme: 'dark' });
  await tab.locator('summary', { hasText: 'Details' }).click();
  // Nothing wider than the screen.
  const overflow = await tab.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await tab.getByRole('button', { name: /Stop and save/ }).click();
  await waitForZip(tab, browser.downloadsDir, 30_000);
});
