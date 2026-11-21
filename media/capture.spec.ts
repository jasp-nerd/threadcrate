// Screenshots of every screen, from the real extension against an invented
// community (media/demo-reddit.ts): for the design review, the README and the
// store images.
//
//   pnpm media              (with the store images; CAPTURE_OUT=<dir> to save elsewhere)
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { test, type Page } from '@playwright/test';
import {
  choosePosts,
  launchWithExtension,
  setSettings,
  startExport,
  waitForZip,
} from '../e2e/browser';
import { HOSTS } from '../e2e/mock/server';
import { DEFAULT_SETTINGS } from '../src/storage/settings';
import { startDemoReddit, SUB } from './demo-reddit';

test('capture every screen', async () => {
  test.setTimeout(5 * 60_000);
  const out = path.resolve(process.env.CAPTURE_OUT ?? 'media/screens');
  mkdirSync(out, { recursive: true });

  const demo = await startDemoReddit();
  const browser = await launchWithExtension({
    headless: true,
    args: [
      `--host-resolver-rules=${HOSTS.map((h) => `MAP ${h} 127.0.0.1:${demo.port}`).join(', ')}`,
      '--ignore-certificate-errors',
    ],
  });
  const ext = `chrome-extension://${browser.extensionId}`;
  const LISTING = `https://www.reddit.com/r/${SUB}/top/?t=month`;
  const POST = `https://www.reddit.com/r/${SUB}/comments/bg2t/first_harvest/`;

  async function shot(page: Page, name: string, full = true) {
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: full });
  }

  async function popup(name: string, url: string, dark = false) {
    const page = await browser.context.newPage();
    await page.setViewportSize({ width: 360, height: 600 });
    if (dark) await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`${ext}/popup.html?url=${encodeURIComponent(url)}`);
    await page.locator('main').waitFor();
    await shot(page, name);
    await page.close();
  }

  try {
    const reddit = await browser.context.newPage();
    await reddit.goto(LISTING);

    await popup('popup-subreddit', LISTING);
    await popup('popup-subreddit-dark', LISTING, true);
    await popup('popup-post', POST);
    await popup('popup-home', 'https://www.reddit.com/');
    await popup('popup-off-reddit', 'https://www.google.com/');
    await popup('popup-off-reddit-dark', 'https://www.google.com/', true);
    // A whole subreddit, past the 1,000 Reddit lists (store image 3).
    await setSettings(browser, { maxPosts: 1000, deep: true });
    await popup('popup-subreddit-all', LISTING);
    await setSettings(browser, {
      maxPosts: DEFAULT_SETTINGS.maxPosts,
      deep: DEFAULT_SETTINGS.deep,
    });

    // 100 posts with their top comments, caught a little past a third.
    demo.delayMs = 350;
    const running = await startExport(browser, reddit, (form) => choosePosts(form, '100'));
    await running.setViewportSize({ width: 1280, height: 860 });
    await running
      .locator('.position')
      .filter({ hasText: /^Post (3[5-9]|4\d) of/ })
      .waitFor({ timeout: 120_000 });
    await shot(running, 'export-running', false);
    await popup('popup-running', LISTING);
    await running.emulateMedia({ colorScheme: 'dark' });
    await shot(running, 'export-running-dark', false);
    await running.emulateMedia({ colorScheme: 'light' });
    demo.delayMs = 0;
    await waitForZip(running, browser.downloadsDir, 120_000);
    await shot(running, 'export-done', false);
    await popup('popup-done', 'https://www.google.com/');
    await popup('popup-done-reddit', LISTING);
    await running.setViewportSize({ width: 390, height: 844 });
    await shot(running, 'export-done-phone', true);

    // One thread with all its comments.
    const post = await browser.context.newPage();
    await post.goto(POST);
    const thread = await startExport(browser, post);
    await thread.setViewportSize({ width: 1280, height: 860 });
    await waitForZip(thread, browser.downloadsDir, 120_000);
    await shot(thread, 'export-done-thread', false);

    // A post that's been deleted: nothing saved.
    const gone = await browser.context.newPage();
    await gone.goto(`https://www.reddit.com/r/${SUB}/comments/zz9/deleted/`);
    const failed = await startExport(browser, gone);
    await failed.setViewportSize({ width: 1280, height: 800 });
    await failed.locator('main[data-view="done"]').waitFor({ timeout: 60_000 });
    await shot(failed, 'export-failed', false);

    const options = await browser.context.newPage();
    await options.setViewportSize({ width: 1280, height: 900 });
    await options.goto(`${ext}/options.html`);
    await options.locator('#files').waitFor();
    await shot(options, 'settings');

    const about = await browser.context.newPage();
    await about.setViewportSize({ width: 1280, height: 800 });
    await about.goto(`${ext}/welcome.html`);
    await about.locator('h1').waitFor();
    await shot(about, 'welcome', false);
    await about.getByRole('button', { name: 'Get started' }).click();
    await shot(about, 'welcome-files', false);
    await about.getByRole('button', { name: 'Continue' }).click();
    await about.waitForTimeout(3_200); // the demo's popup is open from about 3 s in
    await shot(about, 'welcome-ready', false);
  } finally {
    await browser.close();
    await demo.close();
  }
});
