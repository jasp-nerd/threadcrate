// Chrome for Testing with the built extension loaded, and Chrome's downloads
// going to a temporary folder we can read. Branded Chrome ignores
// --load-extension since version 137, so this is the browser for extension tests.
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const BUILD = path.resolve('.output/chrome-mv3');

export interface ExtensionBrowser {
  context: BrowserContext;
  extensionId: string;
  downloadsDir: string;
  close(): Promise<void>;
}

/**
 * The id Chrome gives an unpacked extension: the first 32 hex digits of the
 * SHA-256 of its folder's path, written with the letters a–p. (Waiting for the
 * service worker instead misses one that started before we connected.)
 */
export function unpackedExtensionId(dir: string): string {
  return createHash('sha256')
    .update(path.resolve(dir))
    .digest('hex')
    .slice(0, 32)
    .replace(/./g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer().listen(0, () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

/** Stops a Chrome still using this profile (after a failed test) and waits for it to let go. */
async function releaseProfile(profile: string): Promise<void> {
  // The profile path followed by the end of the argument: `.profile` must not also
  // match `.profile-anon`. pgrep and pkill take an extended regular expression.
  const pattern = `user-data-dir=${profile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`;
  const running = () => {
    try {
      execFileSync('pgrep', ['-f', pattern]);
      return true;
    } catch {
      return false;
    }
  };
  if (running()) {
    try {
      execFileSync('pkill', ['-f', pattern]);
    } catch {
      // Gone meanwhile.
    }
    // Chrome hands a second start on a profile in use to the first one, which is
    // shutting down: wait for it to be gone.
    for (let i = 0; i < 100 && running(); i++) await new Promise((r) => setTimeout(r, 200));
    if (running()) execFileSync('pkill', ['-9', '-f', pattern]);
  }
  // The profile's lock (SingletonLock on Linux; SingletonSocket and SingletonCookie
  // on macOS), left by a Chrome that was killed.
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    rmSync(path.join(profile, name), { force: true });
  }
}

/**
 * A visible Chrome for Testing that stays out of the way on macOS: started with
 * `open -g` (no focus taken), its window off-screen. To Reddit it's an ordinary
 * visible browser, which matters: Reddit shows headless Chrome a bot check.
 */
async function launchInBackground(
  profile: string,
  args: string[],
): Promise<BrowserContext & { _kill: () => void }> {
  await releaseProfile(profile);
  const port = await freePort();
  const exe = chromium.executablePath();
  const app = exe.slice(0, exe.indexOf('.app') + 4);
  execFileSync('open', [
    '-g',
    '-n',
    '-a',
    app,
    '--args',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    '--window-position=-3000,-3000',
    '--window-size=1280,860',
    '--no-first-run',
    '--no-default-browser-check',
    ...args,
    'about:blank',
  ]);
  let lastError: unknown;
  for (let i = 0; i < 300; i++) {
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
        timeout: 10_000,
      });
      const context = browser.contexts()[0]!;
      return Object.assign(context, {
        _kill: () => {
          try {
            execFileSync('pkill', ['-f', `remote-debugging-port=${port}`]);
          } catch {
            // Already gone.
          }
        },
      });
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`Chrome for Testing did not start: ${String(lastError)}`);
}

export async function launchWithExtension(options: {
  profileDir?: string;
  headless?: boolean;
  /** macOS: a visible browser that opens without focus, off-screen (for the live tests). */
  background?: boolean;
  /** Chrome's "Block third-party cookies" setting, which keeps cookies from extension requests. */
  blockThirdPartyCookies?: boolean;
  args?: string[];
}): Promise<ExtensionBrowser> {
  if (!existsSync(BUILD)) throw new Error('No build: run `pnpm build` first.');
  const profile =
    options.profileDir ?? mkdtempSync(path.join(os.tmpdir(), 'reddit-export-profile-'));
  const downloadsDir = mkdtempSync(path.join(os.tmpdir(), 'reddit-export-downloads-'));
  // A Chrome left running on this profile would take over the new start.
  if (options.profileDir) await releaseProfile(profile);
  mkdirSync(path.join(profile, 'Default'), { recursive: true });
  // Chrome's own download settings, so chrome.downloads saves without asking.
  writeFileSync(
    path.join(profile, 'Default', 'Preferences'),
    JSON.stringify({
      download: {
        default_directory: downloadsDir,
        prompt_for_download: false,
        directory_upgrade: true,
      },
      // A fresh window each time: no restored tabs (old exports, old Reddit pages)
      // slowing the start, and no "restore pages?" prompt after a killed run.
      session: { restore_on_startup: 5 },
      ...(options.blockThirdPartyCookies && {
        profile: { cookie_controls_mode: 1, block_third_party_cookies: true },
      }),
    }),
  );
  const args = [
    `--disable-extensions-except=${BUILD}`,
    `--load-extension=${BUILD}`,
    ...(options.args ?? []),
  ];
  const background = options.background && process.platform === 'darwin' && !process.env.HEADED;
  const context = background
    ? await launchInBackground(profile, args)
    : await chromium.launchPersistentContext(profile, {
        channel: 'chromium',
        headless: options.headless ?? true,
        viewport: { width: 1280, height: 860 },
        acceptDownloads: true,
        args,
      });
  // Playwright takes over downloads by default; give them back to Chrome so the folder above applies.
  const setup = await context.newPage();
  const cdp = await context.newCDPSession(setup);
  await cdp.send('Browser.setDownloadBehavior', {
    behavior: 'default',
    downloadPath: downloadsDir,
  });
  await setup.close();
  const extensionId = unpackedExtensionId(BUILD);
  return {
    context,
    extensionId,
    downloadsDir,
    close: async () => {
      if ('_kill' in context) {
        await context
          .browser()
          ?.close()
          .catch(() => undefined);
        (context as { _kill: () => void })._kill();
        await releaseProfile(profile);
      } else await context.close();
    },
  };
}

/**
 * The export form for a Reddit page, as the page's Export button opens it when the
 * toolbar popup can't open: the same form as the popup, in a tab. The Reddit page
 * stays open, so the export's requests go through it.
 */
export async function openExportForm(browser: ExtensionBrowser, page: Page): Promise<Page> {
  const form = await browser.context.newPage();
  await form.goto(
    `chrome-extension://${browser.extensionId}/export.html#new?url=${encodeURIComponent(page.url())}`,
  );
  await form.locator('.form').waitFor();
  return form;
}

/** Opens the export form for a Reddit page, starts the export and returns the export tab. */
export async function startExport(
  browser: ExtensionBrowser,
  page: Page,
  configure?: (form: Page) => Promise<void>,
): Promise<Page> {
  const form = await openExportForm(browser, page);
  if (configure) await configure(form);
  const [exportTab] = await Promise.all([
    browser.context.waitForEvent('page', {
      predicate: (p) => /\/export\.html#[0-9a-f-]{36}$/.test(p.url()),
    }),
    form.locator('.form .btn-primary').click(),
  ]);
  return exportTab;
}

/** Changes settings directly in storage, as the settings page would. */
export async function setSettings(
  browser: ExtensionBrowser,
  patch: Record<string, unknown>,
): Promise<void> {
  const page = await browser.context.newPage();
  await page.goto(`chrome-extension://${browser.extensionId}/options.html`);
  await page.evaluate(async (p) => {
    type Storage = {
      get(key: string): Promise<{ settings?: object }>;
      set(items: object): Promise<void>;
    };
    const storage = (globalThis as unknown as { chrome: { storage: { local: Storage } } }).chrome
      .storage.local;
    const { settings } = await storage.get('settings');
    await storage.set({ settings: { ...settings, ...p } });
  }, patch);
  await page.close();
}

/** Waits for the export tab to finish and returns the saved ZIP's path. */
export async function waitForZip(
  exportTab: Page,
  downloadsDir: string,
  timeoutMs: number,
): Promise<string> {
  await exportTab.locator('main[data-view="done"]').waitFor({ timeout: timeoutMs });
  const deadline = Date.now() + 30_000;
  for (;;) {
    const zips = readdirSync(downloadsDir).filter((f) => f.endsWith('.zip'));
    if (zips.length) return path.join(downloadsDir, zips.sort().at(-1)!);
    if (Date.now() > deadline) throw new Error('No ZIP appeared in the downloads folder');
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** The files in a ZIP, by path. Uses the system unzip, which every dev machine and CI runner has. */
export function readZip(zipPath: string): Map<string, Buffer> {
  const list = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const files = new Map<string, Buffer>();
  for (const name of list) {
    if (name.endsWith('/')) continue;
    files.set(
      name,
      execFileSync('unzip', ['-p', zipPath, name], { maxBuffer: 1024 * 1024 * 1024 }),
    );
  }
  return files;
}

/** Picks the comment choice in the export form: "None", "Top", "Top 100" or "All". */
export async function chooseComments(form: Page, label: string): Promise<void> {
  await form.locator('[aria-labelledby="depth-label"] button', { hasText: label }).click();
}

/** Picks how many posts in the export form: 25, 100 or "All". */
export async function choosePosts(form: Page, label: string): Promise<void> {
  await form
    .locator('[aria-labelledby="posts-label"] button', { hasText: new RegExp(`^${label}`) })
    .click();
}
