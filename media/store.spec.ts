// The store images, composed from the real screens (capture.spec.ts runs first): a big
// headline over one colour, the extension in a browser frame, as Canvas Course
// Downloader's are. Chrome and Edge get the composed images; Firefox wants the
// screens themselves, with the captions in its own fields.
//
//   pnpm media
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';

const SCREENS = path.resolve(process.env.CAPTURE_OUT ?? 'media/screens');
const OUT = path.resolve('media/store');
const BUILD = path.join(OUT, '.build');
const root = path.resolve('.');

const img = (file: string) => `file://${path.join(SCREENS, `${file}.png`)}`;
const kip = (pose: string) => `file://${root}/public/kip/${pose}.webp`;
const ICON = `file://${root}/media/brand/icon.svg`;

const FIELDS = {
  orange: { bg: '#ff4500', ink: '#ffffff' },
  ink: { bg: '#14202f', ink: '#ffffff' },
  sun: { bg: '#ffc43d', ink: '#14202f' },
  mist: { bg: '#eef1f5', ink: '#14202f' },
  mint: { bg: '#d9f2e4', ink: '#14202f' },
} as const;

const fonts = `
@font-face { font-family: Figtree; font-weight: 300 900; src: url('file://${root}/public/fonts/figtree-latin.woff2'); }
@font-face { font-family: Gabarito; font-weight: 400 900; src: url('file://${root}/public/fonts/gabarito-latin.woff2'); }
* { box-sizing: border-box; }
body { margin: 0; font-family: Figtree, sans-serif; -webkit-font-smoothing: antialiased; }
h1 { font-family: Gabarito, sans-serif; font-weight: 800; letter-spacing: -0.03em; line-height: 1; margin: 0; }
.frame { background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 30px 80px rgb(20 32 47 / 28%); }
.bar { height: 44px; background: #f1f3f6; display: flex; align-items: center; gap: 8px; padding: 0 16px; }
.dot { width: 12px; height: 12px; border-radius: 50%; background: #c9cfd8; }
.url { margin-left: 12px; height: 28px; flex: 1; max-width: 520px; border-radius: 999px; background: #fff; display: flex; align-items: center; padding: 0 14px; font: 500 14px Figtree; color: #4b5563; }
.tool { margin-left: auto; width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: #e3e7ed; }
.tool img { width: 20px; height: 20px; }
`;

/** An invented subreddit page, drawn in Reddit's general shape (no Reddit logo, no vote arrows). */
const BACKDROP = `
<div style="display:grid;grid-template-columns:220px 1fr;height:100%;background:#fff;font-family:Figtree">
  <div style="border-right:1px solid #e5e7eb;padding:20px 16px;display:grid;gap:12px;align-content:start;color:#4b5563;font-size:15px">
    <b style="color:#111827">Home</b><span>Popular</span><span>Explore</span><span style="margin-top:12px;font-size:12px">Communities</span><span>r/BalconyGardens</span><span>r/houseplants</span>
  </div>
  <div style="padding:0">
    <div style="height:90px;background:linear-gradient(90deg,#3f6f4f,#7aa36b)"></div>
    <div style="padding:14px 28px;display:flex;align-items:center;gap:14px">
      <span style="width:56px;height:56px;border-radius:50%;background:#7aa36b;border:4px solid #fff;margin-top:-34px"></span>
      <b style="font-size:24px;color:#111827">r/BalconyGardens</b>
    </div>
    <div style="padding:0 28px;display:grid;gap:12px">
      ${[
        ['First harvest from my 2 m² balcony this year', '1.8k', '213'],
        ['Tomatoes split after two days of rain. Still fine to eat?', '640', '87'],
        ['Self-watering pots: worth it or a gimmick?', '2.2k', '128'],
        ['How do you keep pigeons off the strawberries?', '312', '41'],
      ]
        .map(
          ([t, s, c]) =>
            `<div style="border:1px solid #e5e7eb;border-radius:14px;padding:14px 18px;display:grid;gap:8px"><span style="font-size:13px;color:#6b7280">r/BalconyGardens · 2 d</span><b style="font-size:18px;color:#111827">${t}</b><span style="font-size:13px;color:#4b5563">${s} points · ${c} comments</span></div>`,
        )
        .join('')}
    </div>
  </div>
</div>`;

/** A browser window: the page, and the toolbar popup open over it when given. */
function browser(content: string, opts: { popup?: string; url?: string; height: number }) {
  return `
<div class="frame" style="position:relative">
  <div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span>
    <span class="url">${opts.url ?? 'reddit.com/r/BalconyGardens/top/?t=month'}</span>
    <span class="tool"><img src="${ICON}" alt=""></span></div>
  <div style="height:${opts.height}px;overflow:hidden;position:relative">${content}</div>
  ${opts.popup ? `<img src="${img(opts.popup)}" style="position:absolute;top:50px;right:12px;width:360px;border-radius:12px;box-shadow:0 18px 50px rgb(20 32 47 / 30%)">` : ''}
</div>`;
}

function screenshot(field: keyof typeof FIELDS, headline: string, body: string) {
  const f = FIELDS[field];
  return `<html><head><style>${fonts}</style></head><body>
<div style="width:1280px;height:800px;background:${f.bg};color:${f.ink};padding:56px 64px 0;display:grid;grid-template-rows:auto 1fr;gap:40px;overflow:hidden">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:40px">
    <h1 style="font-size:64px;max-width:1000px">${headline}</h1>
    <img src="${ICON}" style="width:64px;height:64px;flex:none" alt="">
  </div>
  <div>${body}</div>
</div></body></html>`;
}

const pageShot = (file: string, url: string) =>
  browser(`<img src="${img(file)}" style="width:100%;display:block">`, { url, height: 620 });

const SHOTS: { name: string; caption: string; html: string }[] = [
  {
    name: '01-thread',
    caption: 'Save Reddit threads and subreddits from the toolbar',
    html: screenshot(
      'orange',
      'Save Reddit threads and subreddits',
      browser(BACKDROP, { popup: 'popup-subreddit', height: 620 }),
    ),
  },
  {
    name: '02-receipt',
    caption: 'A thread with all its comments as CSV, JSON and Markdown, in one ZIP',
    html: screenshot(
      'mist',
      'A whole thread, ready for Excel',
      pageShot('export-done-thread', 'Threadcrate'),
    ),
  },
  {
    name: '03-subreddit',
    caption: "Whole subreddits, even past Reddit's 1,000-post limit",
    html: screenshot(
      'ink',
      'Big subreddits, past 1,000 posts',
      browser(BACKDROP, { popup: 'popup-subreddit-all', height: 620 }),
    ),
  },
  {
    name: '04-progress',
    caption: 'Keep browsing while it saves, at the pace Reddit allows',
    html: screenshot(
      'sun',
      'Keep browsing while it saves',
      pageShot('export-running', 'Threadcrate'),
    ),
  },
  {
    name: '05-private',
    caption: 'Free and open source. Nothing is sent to us or anyone else',
    html: screenshot(
      'mint',
      'Free, open source, nothing sent to us',
      pageShot('welcome', 'Threadcrate'),
    ),
  },
];

const SMALL_TILE = `<html><head><style>${fonts}</style></head><body>
<div style="width:440px;height:280px;background:#ff4500;color:#fff;padding:30px 32px;position:relative;overflow:hidden">
  <div style="display:flex;align-items:center;gap:12px"><img src="${ICON}" style="width:44px;height:44px;border-radius:11px;box-shadow:0 0 0 2px rgb(255 255 255 / 55%)"><b style="font:800 30px Gabarito;letter-spacing:-0.02em">Threadcrate</b></div>
  <h1 style="font-size:32px;margin-top:26px;max-width:250px">Save whole Reddit threads</h1>
  <p style="margin:12px 0 0;font-size:15px;max-width:230px;opacity:.92">CSV, JSON and Markdown</p>
  <img src="${kip('carry')}" style="position:absolute;right:14px;bottom:-6px;height:190px">
</div></body></html>`;

const MARQUEE = `<html><head><style>${fonts}</style></head><body>
<div style="width:1400px;height:560px;background:#f4f6f9;color:#14202f;display:grid;grid-template-columns:520px 1fr;gap:20px;padding:0 0 0 72px;overflow:hidden;position:relative">
  <div style="display:grid;align-content:center;gap:20px">
    <div style="display:flex;align-items:center;gap:12px"><img src="${ICON}" style="width:44px;height:44px"><b style="font:750 22px Gabarito">Threadcrate <span style="font:500 18px Figtree;color:#5f6978">for Reddit</span></b></div>
    <h1 style="font-size:68px">Keep the whole thread</h1>
    <p style="margin:0;font-size:21px;color:#3f4a5a;max-width:440px">Posts, comments, subreddits and profiles to CSV, JSON and Markdown. Free and open source.</p>
  </div>
  <div style="padding-top:56px">${browser(`<img src="${img('export-done')}" style="width:100%;display:block">`, { url: 'Threadcrate', height: 560 })}</div>
</div></body></html>`;

test('store images', async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(BUILD, { recursive: true });
  for (const dir of ['chrome', 'edge', 'firefox'])
    mkdirSync(path.join(OUT, dir), { recursive: true });

  async function render(name: string, html: string, width: number, height: number, dirs: string[]) {
    const file = path.join(BUILD, `${name}.html`);
    writeFileSync(file, html);
    await page.setViewportSize({ width, height });
    await page.goto(`file://${file}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);
    const first = path.join(OUT, dirs[0]!, `${name}.png`);
    await page.screenshot({ path: first });
    for (const d of dirs.slice(1)) copyFileSync(first, path.join(OUT, d, `${name}.png`));
  }

  for (const s of SHOTS) await render(s.name, s.html, 1280, 800, ['chrome', 'edge']);
  await render('small-tile-440x280', SMALL_TILE, 440, 280, ['chrome', 'edge']);
  await render('marquee-1400x560', MARQUEE, 1400, 560, ['chrome', 'edge']);
  // The 128 px store icon comes from `pnpm icons` (with the padding the store asks for).
  await render(
    'logo-300',
    `<body style="margin:0;background:#fff"><img src="${ICON}" style="width:300px;height:300px;display:block"></body>`,
    300,
    300,
    ['edge'],
  );

  // Firefox: the real screens, captions beside them in the listing.
  const captions: string[] = [];
  for (const [i, [file, caption]] of (
    [
      ['popup-subreddit', SHOTS[0]!.caption],
      ['export-done', SHOTS[1]!.caption],
      ['export-running', SHOTS[3]!.caption],
      ['welcome', SHOTS[4]!.caption],
      ['settings', 'Choose the files: JSON, CSV, Markdown, and images and videos'],
    ] as const
  ).entries()) {
    const name = `${String(i + 1).padStart(2, '0')}-${file}.png`;
    copyFileSync(path.join(SCREENS, `${file}.png`), path.join(OUT, 'firefox', name));
    captions.push(`${name}: ${caption}`);
  }
  writeFileSync(path.join(OUT, 'firefox', 'captions.txt'), captions.join('\n') + '\n');
  writeFileSync(
    path.join(OUT, 'captions.txt'),
    SHOTS.map((s) => `${s.name}.png: ${s.caption}`).join('\n') + '\n',
  );
});
