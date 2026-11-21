// Opens the live-test browser (its own profile, e2e/live/.profile) as a normal
// window on Reddit's login page, so a person can log in once by hand. The live
// tests then run logged in. Nothing here reads, copies or stores credentials:
// the login lives in that browser profile, as in any browser.
//
//   pnpm live:login
//
// It notices the login by itself (Reddit's settings page stops sending you to
// the login page), then closes the browser properly so Chrome writes the login
// to disk. Killing the window before that can lose it.
import path from 'node:path';
import { launchWithExtension } from '../browser.ts';

const browser = await launchWithExtension({
  profileDir: path.resolve('e2e/live/.profile'),
  headless: false,
});
const page = await browser.context.newPage();
await page.goto('https://www.reddit.com/login/');
console.log('Log in to Reddit in the window that opened. It closes by itself once you are in.');

async function loggedIn(): Promise<boolean> {
  const check = await browser.context.newPage();
  try {
    await check.goto('https://www.reddit.com/settings/', { waitUntil: 'domcontentloaded' });
    return !check.url().includes('/login');
  } finally {
    await check.close();
  }
}

let closed = false;
browser.context.on('close', () => (closed = true));
for (;;) {
  await new Promise((r) => setTimeout(r, 5000));
  if (closed) {
    console.log('The window was closed before the login was confirmed. Run it again.');
    process.exit(1);
  }
  // Only check once Reddit has moved on from the login page.
  if (page.url().includes('/login')) continue;
  if (await loggedIn().catch(() => false)) break;
}
// Give Chrome a moment to store the new cookies, then close it cleanly.
await new Promise((r) => setTimeout(r, 3000));
await browser.close();
console.log('Logged in and saved: the live tests will use this login.');
