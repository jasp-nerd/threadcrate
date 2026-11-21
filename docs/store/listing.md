# Store listings

Copy for the Chrome Web Store, Firefox Add-ons (AMO) and Edge Add-ons, written 17 November 2026 for 0.1.0 against `wxt.config.ts`, README.md, PRIVACY.md and the code, updated 21 November 2026.

**Launch plan: Chrome only.** Firefox and Edge follow if there's traction; their sections stay here, ready. Every block in a fenced box is meant to be pasted as it is. Character counts are Unicode characters, counted by script.

Rules this copy keeps:

- "Threadcrate" is the brand; "Reddit" is only a descriptor ("for Reddit", "Export Reddit …"). No Reddit logo, Snoo or OrangeRed bubble. Every description ends with "not affiliated with or endorsed by Reddit".
- It's an **exporter**, never a "scraper", and media is an option, not the headline (not a "video downloader").
- No speed superlatives ("fastest", "40% faster") or comparisons with other tools.
- "Whole comment tree" and "every 'load more' opened", not a bare "every comment": the description says that Reddit's counts include removed comments it no longer shows, and that the ZIP lists what couldn't be loaded.
- "Past the 1000-post limit" always comes with its mechanism: combining several of Reddit's own sorted lists. It never says "every post" or "bypass".
- Requests are described as what they are: the user's own browser reading the pages it can already see, at the pace Reddit's rate-limit headers allow. Never "passed bot check", "looks like the page", "get around" or "unblock".
- Free and open source (MIT). No Pro tier, no paid features.

---

## 0. The manifest name and summary

Chrome takes the **name** and **short description** from the manifest (`wxt.config.ts`); the dashboard can't edit them. Done, already in the build:

- Name (61 of 75): `Threadcrate for Reddit: Export Threads, Comments & Subreddits`
- Short description (128 of 132): `Save Reddit threads, subreddits past the 1000-post limit, profiles and searches as CSV, JSON and Markdown. Free and open source.`

---

## 1. Chrome Web Store

**Account:** the publisher that already has Canvas Course Downloader. New publishers get two published-item slots by default (Chrome blog, 20 August 2026), and Canvas Course Downloader uses one, so Threadcrate takes the second and last. Check Account › the item count before you start; anything else needs to be unpublished or wait for a higher limit.

### Store listing tab

| Field | Value |
| --- | --- |
| Name, summary | From the manifest (section 0) |
| Category | **Productivity › Tools** (the dashboard's list isn't public; if "Tools" isn't offered, pick the closest Productivity entry) |
| Language | English |
| Store icon | `media/store/chrome/icon-128.png` |
| Screenshots (1280×800, max 5) | `media/store/chrome/01-thread.png`, `02-receipt.png`, `03-subreddit.png`, `04-progress.png`, `05-private.png`, in that order |
| Small promo tile (440×280) | `media/store/chrome/small-tile-440x280.png` |
| Marquee (1400×560) | `media/store/chrome/marquee-1400x560.png` |
| Promo video | None yet |
| Official URL | `https://threadcrate.jaspnerd.dev` once it's verified in Google Search Console under your account (otherwise leave empty) |
| Homepage URL | `https://threadcrate.jaspnerd.dev/` |
| Support URL | `https://github.com/jasp-nerd/threadcrate/issues` |
| Mature content | Off (the extension shows no Reddit content itself) |

### Description (plain text, 3495 characters)

```
Threadcrate saves Reddit threads, subreddits, profiles and searches to your computer as one ZIP: CSV for spreadsheets, JSON for scripts and Markdown to read, plus images and videos if you want them. It's made for researchers, students, archivists and moderators who need a copy they can keep and work with.

Free and open source (MIT). No Pro tier, no caps, no sign-up. It runs in your browser and sends nothing to us.

HOW IT WORKS
1. Open a post, a subreddit, a profile or a search on reddit.com.
2. Click Threadcrate in the toolbar (or Export next to Share on a post, or press Alt+Shift+E).
3. Choose how many posts and comments. Each choice shows how long it will take. Press Export.
The export runs in its own tab. Keep browsing: a notification tells you when it's done, and the receipt has a Show in folder button.

WHAT YOU CAN EXPORT
- A thread with its whole comment tree: every "load more" and "continue this thread" is opened. The comment count on a post includes removed comments that nobody can see any more, so an export can have fewer comments than that number. The ZIP lists anything that couldn't be loaded, and why.
- A subreddit, in any sort and time range: up to the 1,000 posts a list shows, or past the 1000-post limit by combining eight of the site's own lists (newest, top and controversial over several time ranges, hot) and keeping each post once. That finds several thousand posts in a big community, though not every old one.
- Search results.
- A user's posts and comments (you need to be logged in for profiles).

WHAT'S IN THE ZIP
- posts.csv and comments.csv, which open in Excel or Google Sheets
- data.json, with comment trees nested under their posts
- One Markdown file per thread, for a notes app or an AI tool
- Images and videos, if you turn them on
- manifest.json: what was exported, and anything that wasn't, with the reason
Field names follow the site's own (id, parent_id, created_utc, score), times are in UTC, and deleted or removed comments stay in as [deleted] and [removed], so replies keep their place.

AT THE PACE REDDIT ALLOWS
Threadcrate reads the same pages you see, in your own browser. It follows the rate-limit headers the site sends, waits as long as it's asked to, and always leaves part of the allowance unused so your own tabs keep working. A big export takes minutes, and the estimate tells you how long before you start. It works logged out; logged in, it can also use the site's API.

PRIVATE
- Nothing about you or your exports is sent to the developer or anyone else. No analytics, no tracking.
- While an export runs, a small card from the developer suggests their paid cloud service (Reddit Scraper on Apify). It can be switched off in Settings.
- It connects only to reddit.com, its media hosts (redd.it) and i.imgur.com, for images linked in posts.
- It never asks for your password and never reads your login cookies.
- Read the code: https://github.com/jasp-nerd/threadcrate

WHY IT ASKS FOR ACCESS
- Your data on reddit.com, redd.it and i.imgur.com: to add the Export button, read the pages you export, and save their images and videos.
- Manage your downloads: to save the ZIP.
- Notifications: to tell you when an export in a background tab is done.

USE IT RESPONSIBLY
Export what you have a right to keep: your own posts, threads you take part in, research data you'll handle with care. Respect Reddit's User Agreement and the people who wrote the comments.

Questions or problems: https://github.com/jasp-nerd/threadcrate/issues

Threadcrate is an independent project, not affiliated with or endorsed by Reddit, Inc. Reddit is a trademark of Reddit, Inc.
```

Why it's built this way: the first paragraph says what it does and for whom, the second is the trust line, then three numbered steps, then what you get. The comment-count caveat and "not every old one" sit right next to the claims they qualify. "Reddit" appears 5 times as a word (Chrome's spam policy warns about repeating a keyword unnaturally), with "the site" and "posts, threads" for variety. It names no browser, so Edge can use it unchanged.

### Privacy tab

**Single purpose** (175 characters):

```
Exports the Reddit page the user is on (a post with its comments, a subreddit, a search or a user profile) to a ZIP of JSON, CSV and Markdown files on the user's own computer.
```

**Permission justifications:**

| Field | Text to paste |
| --- | --- |
| `downloads` | Saves the finished export (one ZIP file of JSON, CSV and Markdown, plus images and videos if the user asks for them) to the user's Downloads folder, and shows it in its folder when the user presses Show in folder. |
| `notifications` | An export can take minutes and runs in its own tab. When it finishes while that tab is in the background, one notification says it's done; clicking it brings the tab back. No other notifications are shown. |
| `storage` | Remembers the choices the user made in the export panel and settings (how many posts and comments, formats, media on or off), hands the export the user just started from the Reddit tab to the export tab, and keeps the running export's progress for the toolbar popup. It also remembers whether the user closed the card about the author's cloud version. The last two are session storage, cleared when the browser closes. Nothing is synced or sent anywhere. |
| Host permissions (`https://www.reddit.com/*`, `https://*.redd.it/*`, `https://i.imgur.com/*`, and the content script on `www`, `old`, `new` and `sh.reddit.com`) | The content script adds an Export button beside Reddit's own buttons (after Share on a post, beside Join on a subreddit), on each of Reddit's addresses. When the user starts an export, the extension reads that page's posts and comments from www.reddit.com, paced by Reddit's rate-limit headers. *.redd.it is where Reddit serves the images and videos in posts (i.redd.it, v.redd.it, preview.redd.it), and i.imgur.com hosts images people link in posts; those are fetched only when the user turns on images and videos. No other site is accessed. |
| Remote code | **No, I am not using remote code.** All JavaScript is in the package. No eval, no remotely hosted scripts. Reddit's pages are parsed as data and written to files as text. |

**Data usage.** Nothing ticked (decided 21 November 2026, as for Canvas Course Downloader, which passed review this way): pages are read and written to files only on the device, and nothing is collected or sent. Certify the three statements. PRIVACY.md's "Store declarations" says the same; keep the two matching if this changes.

**Privacy policy URL:** `httw` (live now, and doesn't depend on the repository being public).

### Test instructions (notes to the reviewer)

Optional on Chrome. Paste `docs/store/reviewer-notes.txt` with these changes, or leave it empty (no login is needed):

- `pnpm build:firefox` → `pnpm build`, and `.output/firefox-mv3/` → `.output/chrome-mv3/`
- Drop the sentence "Firefox asks for access to Reddit on first use; the export page has a button for it."
- `data_collection_permissions: none` → `the Privacy tab declares that no user data is collected`

### Distribution

Public, all regions. Free. Or **Unlisted** for a quiet first week, then Public (visibility can't be changed by the API).

---

## 2. Firefox Add-ons (AMO)

The first listed upload can create the whole listing from `docs/store/firefox-metadata.json` (see docs/releasing.md). These are the fields it sets; edit them later in the Developer Hub, not in the JSON (later releases send only release notes and reviewer notes).

### Name (50 of 50 characters)

```
Threadcrate for Reddit – Comment & Thread Exporter
```

AMO's search weights the name most (an exact match ×100, phrase ×8, term ×6, against ×3 for the summary), so the core phrase goes into it. AMO lets you edit the name, unlike Chrome and Edge. Unverified: whether a later upload resets it to the manifest `name`; check after the first update and, if it does, set it again in the Developer Hub or use the manifest name everywhere.

**Slug:** `threadcrate` → `addons.mozilla.org/firefox/addon/threadcrate/`

### Summary (243 of 250 characters, no URLs allowed)

```
Export a Reddit thread with its whole comment tree, a subreddit past the 1000-post limit, a profile or a search to one ZIP of CSV, JSON and Markdown, with images and videos if you want them. Free and open source (MIT). No sign-up, no tracking.
```

### Description (AMO HTML, 3800 characters)

AMO keeps line breaks and allows `<b>`, `<i>`, `<a>`, `<ul>`, `<ol>` and `<li>`, but no headings. Lists stay on one line because AMO turns a line break inside a list into an extra `<br>`. Differences from Chrome: Firefox asks for host access on first use, the "Good to know" list says Firefox support is newer (honest, and it matches the experimental flag), and links are real links.

```html
Threadcrate saves Reddit threads, subreddits, profiles and searches to your computer as one ZIP: CSV for spreadsheets, JSON for scripts and Markdown to read, plus images and videos if you want them. It's made for researchers, students, archivists and moderators who need a copy they can keep and work with.

Free and open source (MIT). No Pro tier, no caps, no sign-up. It runs in your browser and sends nothing to us.

<b>How it works</b>
<ol><li>Open a post, a subreddit, a profile or a search on reddit.com.</li><li>Click Threadcrate in the toolbar (or <i>Export</i> next to <i>Share</i> on a post, or press Alt+Shift+E).</li><li>Choose how many posts and comments. Each choice shows how long it will take. Press <i>Export</i>.</li></ol>
The export runs in its own tab. Keep browsing: a notification tells you when it's done. The first time, Firefox asks you to allow access to Reddit; the export page has a button for it.

<b>What you can export</b>
<ul><li>A thread with its whole comment tree: every "load more" and "continue this thread" is opened. The comment count on a post includes removed comments that nobody can see any more, so an export can have fewer comments than that number. The ZIP lists anything that couldn't be loaded, and why.</li><li>A subreddit, in any sort and time range: up to the 1,000 posts a list shows, or past the 1000-post limit by combining eight of the site's own lists (newest, top and controversial over several time ranges, hot) and keeping each post once. That finds several thousand posts in a big community, though not every old one.</li><li>Search results.</li><li>A user's posts and comments (you need to be logged in for profiles).</li></ul>
<b>What's in the ZIP</b>
<ul><li>posts.csv and comments.csv, which open in a spreadsheet</li><li>data.json, with comment trees nested under their posts</li><li>One Markdown file per thread, for a notes app or an AI tool</li><li>Images and videos, if you turn them on</li><li>manifest.json: what was exported, and anything that wasn't, with the reason</li></ul>
Field names follow the site's own (id, parent_id, created_utc, score), times are in UTC, and deleted or removed comments stay in as [deleted] and [removed], so replies keep their place.

<b>At the pace Reddit allows</b>
Threadcrate reads the same pages you see, in your own browser. It follows the rate-limit headers the site sends, waits as long as it's asked to, and always leaves part of the allowance unused so your own tabs keep working. A big export takes minutes, and the estimate tells you how long before you start. It works logged out; logged in, it can also use the site's API.

<b>Private</b>
<ul><li>Nothing about you or your exports is sent to the developer or anyone else. No analytics, no tracking.</li><li>While an export runs, a small card from the developer suggests their paid cloud service (Reddit Scraper on Apify). It can be switched off in Settings.</li><li>It connects only to reddit.com, its media hosts (redd.it) and i.imgur.com, for images linked in posts.</li><li>It never asks for your password and never reads your login cookies.</li><li>Open source under the MIT license: <a href="https://github.com/jasp-nerd/threadcrate">read the code</a>.</li></ul>
<b>Good to know</b>
<ul><li>Firefox support is newer than Chrome's: the automated tests run in Chromium. If something doesn't work, please <a href="https://github.com/jasp-nerd/threadcrate/issues">report it</a>.</li><li>Needs Firefox 140 or later.</li><li>Profiles need you logged in to Reddit.</li><li>Logged in, a video's picture and sound are saved as two files.</li></ul>
<b>Use it responsibly</b>
Export what you have a right to keep: your own posts, threads you take part in, research data you'll handle with care. Respect Reddit's User Agreement and the people who wrote the comments.

Threadcrate is an independent project, not affiliated with or endorsed by Reddit, Inc. Reddit is a trademark of Reddit, Inc.
```

### Other fields

| Field | Value |
| --- | --- |
| Categories (max 2) | **Download Management** (`download-management`), **Social & Communication** (`social-communication`) |
| Tags (fixed list) | `reddit`, `download` |
| Experimental | **On** (`is_experimental: true`): the automated tests run in Chromium only. Turn it off once Firefox is tested |
| Platforms | Firefox desktop only (`compatibility: ["firefox"]`); leave Android off, it's untested |
| License | MIT |
| Homepage | `https://github.com/jasp-nerd/threadcrate` |
| Support site | `https://github.com/jasp-nerd/threadcrate/issues`; support email empty |
| Privacy policy | Optional on AMO (no data leaves the device). Recommended anyway: paste PRIVACY.md in the Developer Hub (Edit Product Page › Privacy policy) |
| Data collection | In the manifest, not the listing: `data_collection_permissions: { required: ['none'] }` (needs Firefox 140, which `strict_min_version` sets) |
| Source code | Required (the code is minified): upload `threadcrate-sources.zip` from the release |
| Notes to reviewers | `docs/store/reviewer-notes.txt` (also in the metadata JSON as `approval_notes`, and sent with every later version by `submit.yml`). It points to SOURCE_CODE_REVIEW.md |

### Screenshots and captions

AMO has no limit and no promo tiles. Upload `media/store/firefox/` in this order, each with its caption from `media/store/firefox/captions.txt` (AMO wants the caption in the field, not on the image):

| File | Size | Caption |
| --- | --- | --- |
| `01-popup-subreddit.png` | 360×600 | Save Reddit threads and subreddits from the toolbar |
| `02-export-done.png` | 1280×860 | Posts and comments as CSV, JSON and Markdown, in one ZIP |
| `03-export-running.png` | 1280×860 | Keep browsing while it saves, at the pace Reddit allows |
| `04-welcome.png` | 1280×800 | Free and open source. Nothing is sent to us or anyone else |
| `05-settings.png` | 1280×1151 | Choose the files: JSON, CSV, Markdown, and images and videos |

AMO shows screenshots at 1.6:1 (1280×800 recommended). Only `04` has that ratio; the others will be letterboxed or cropped in the gallery, and `01`, a tall popup, will look small as the first image. Consider leading with `02` or rendering 1280×800 versions (a `media/` change).

---

## 3. Edge Add-ons

**Account:** the existing Partner Center account. The Publish API key is account-wide, so the sibling's key works; it expires (the current one on 13 January 2027).

| Field | Value |
| --- | --- |
| Name, short description | From the manifest (section 0), read-only |
| Description (250–10,000) | The Chrome description, unchanged (3495 characters). It mentions no other browser or store (Edge policy 1.1.2) |
| Category | **Productivity** |
| Extension logo (300×300) | `media/store/edge/logo-300.png` |
| Small promo tile (440×280) | `media/store/edge/small-tile-440x280.png` |
| Large promo tile (1400×560) | `media/store/edge/marquee-1400x560.png` |
| Screenshots (max 6) | `media/store/edge/01-thread.png` … `05-private.png`, in order (the same as Chrome's). A sixth slot is free |
| YouTube video | None |
| Website | `https://github.com/jasp-nerd/threadcrate` |
| Support contact | `https://github.com/jasp-nerd/threadcrate/issues` |
| Mature content | Off |
| Privacy: single purpose, permissions, remote code, data usage | Same text and answers as Chrome (section 1) |
| Privacy policy URL | `https://github.com/jasp-nerd/threadcrate/blob/main/PRIVACY.md` (browser-neutral, as Edge policy 1.5.2 wants) |
| Availability | Public, all markets |

### Search terms (7 terms, 19 of 21 words, each under 30 characters)

```
reddit exporter
export reddit comments
reddit to csv
reddit to json
reddit thread to markdown
subreddit export
reddit archive
```

"downloader" is left out on purpose: it brings video-download searches that install and uninstall.

### Notes for certification

`docs/store/reviewer-notes.txt` with the same changes as Chrome's test instructions (section 1), plus: "The same package is published on the Chrome Web Store by the same developer." Notes are private to reviewers, so naming Chrome there is fine. `submit.yml` doesn't send Edge notes; paste them by hand when a version needs them.

---

## 4. Opera: skipped

- Opera installs Chrome Web Store extensions itself ("Add to Opera" on the CWS page), so Opera users are covered by the Chrome listing. The README and release notes say so.
- Opera has no official upload API. The only automation (`wxt submit`'s Opera target) drives the dashboard with a logged-in session cookie, which this project won't put in CI.
- Its acceptance criteria ask for code that isn't minified, or a link to unminified source plus build steps, which goes to a slower queue. Reported reviews take weeks to over a month.
- If Opera is wanted later: submit by hand with the sources zip and SOURCE_CODE_REVIEW.md, category Productivity, two screenshots at 612×408.

---

## 5. Wording a reviewer could flag, outside docs/store/

Done on 21 November 2026: the code comments no longer mention a "bot check", the UI says "combines several of Reddit's lists to find more than 1,000 posts", and CHANGELOG.md says "whole comment tree" and "ordinary requests from your Reddit tab". The store image headlines were already changed.

---

## 6. For you to confirm

1. The Chrome Web Store slot: this is the publisher's second item.
2. The repository should be public before submitting: the description, the extension's "read the code on GitHub" link and the support URL point at it.
