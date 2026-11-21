# Source code review

Notes for add-on store reviewers on how to build Threadcrate for Reddit from this source package and get the same files as the uploaded extension.

## Requirements

- Node.js 22 or later (released builds use Node 24 LTS)
- pnpm 11.13.0, the version pinned in `package.json` (`packageManager`). Install it with `npm install -g pnpm@11.13.0`, or with `corepack enable` on Node versions that still include Corepack (Node 25 and later don't).
- macOS, Linux or Windows. No other tools are needed, and no git checkout: the package builds as unzipped.

## Build

```bash
pnpm install --frozen-lockfile
pnpm build:firefox     # Firefox: output in .output/firefox-mv3/
pnpm build             # Chrome and Edge: output in .output/chrome-mv3/
```

`pnpm install --frozen-lockfile` installs exactly the versions in `pnpm-lock.yaml`. `pnpm-workspace.yaml` lets only esbuild run an install script, and holds back package versions younger than a week.

To compare with the uploaded package, unzip it and compare folders, for example `diff -r .output/firefox-mv3 path/to/unzipped-upload`. Every release is checked this way before it is uploaded: the release workflow (`.github/workflows/release.yml` in the repository) unzips this source package into an empty folder, builds it without git, and fails unless both outputs are identical to the uploaded packages.

The build uses [WXT](https://wxt.dev) 0.21 (Vite and Rolldown) to bundle TypeScript and Svelte from `src/` into plain JavaScript. Files in `public/` are copied unchanged.

## What is generated

Everything in the output folder comes from this package:

| Output | Source |
| --- | --- |
| `background.js` | `src/entrypoints/background.ts` |
| `content-scripts/reddit.js`, `content-scripts/reddit.css` | `src/entrypoints/reddit.content/` |
| `popup.html`, `options.html`, `export.html`, and `chunks/`, `assets/` | `src/entrypoints/popup/`, `options/`, `export/` |
| `timer.js` | `src/entrypoints/timer.ts` (a timer in a Web Worker, so waits between requests aren't throttled in background tabs) |
| `manifest.json` | `wxt.config.ts` |
| `icons/`, `fonts/` (Figtree and Gabarito, OFL), `kip/` (mascot images) | `public/` |

The bundles are minified. The third-party code in them comes from npm packages listed in `package.json`, at the versions in `pnpm-lock.yaml`: Svelte, client-zip, turndown, @joplin/turndown-plugin-gfm and @webext-core/messaging (exactly the `dependencies` in `package.json`). Nothing is downloaded or evaluated at runtime, and the extension doesn't use `eval` or remote code.

## What the extension does

When the user presses Export on a Reddit page, it reads that page's posts and comments from www.reddit.com (the web pages reddit.com itself loads, and Reddit's `.json` pages when the user is logged in) and saves them as one ZIP of JSON, CSV and Markdown to the user's Downloads folder, with images and videos from `*.redd.it` and `i.imgur.com` if the user turns media on.

- **Pacing:** requests follow Reddit's `x-ratelimit-*` headers, at most one at a time per Reddit rate limit, and always leave part of the allowance unused (`src/reddit/pacing.ts`, `src/reddit/client.ts`).
- **Where requests come from:** the export runs in an extension tab. Its www.reddit.com requests are made by the content script in a www.reddit.com tab, as ordinary same-origin requests; the relay allows only GET and the "more replies" POST that reddit.com's own page makes (`src/entrypoints/reddit.content/relay.ts`, `src/engine/tab-fetch.ts`). If no Reddit tab is open, the export opens one in the background.
- **Session:** requests carry the browser's normal Reddit session. The extension never reads cookies or tokens and never logs in for the user.
- **Reddit content is data:** HTML pages are parsed with `DOMParser` and written to files as text, never rendered as HTML in extension pages.
- **Nothing leaves the device** except those requests to Reddit, its media hosts and Imgur. No analytics, no server of ours. Firefox: `data_collection_permissions: none`.

See `PRIVACY.md` and `docs/how-it-works.md` in the repository (https://github.com/jasp-nerd/threadcrate) for details.
