# Threadcrate for Reddit

Browser extension (Chrome, Firefox) that exports Reddit posts, subreddits, users and searches to a ZIP of JSON, CSV and Markdown. WXT + TypeScript + Svelte 5.

## Commands

- `pnpm verify`: typecheck, lint, unit tests, e2e against the mock reddit.com. Run before calling something done.
- `pnpm test` / `pnpm e2e`: unit tests / e2e only (`pnpm e2e` builds first).
- `pnpm live`: the real reddit.com in a visible Chrome for Testing window, slow. `LIVE_ONLY=post,big,subreddit,feed,search,user` picks tests (`deep` and `check` only run when named). Output in `e2e/live/out/` (git-ignored). Run it after changing anything in `src/reddit/`.

## Rules

1. Don't change tests or fixtures just to make something pass. Stop and explain.
2. Reddit content is untrusted: never rendered as HTML in extension pages (lint catches the common sinks), and escaped in the Markdown export.
3. Export file names, CSV columns, JSON keys and the `settings` storage key are public contracts: changing one needs a test and a changelog line.
4. Test data is invented. Real Reddit pages captured for research stay out of the repo.
5. Permissions in `wxt.config.ts` stay minimal; a new one disables the extension for existing users.
6. Never read session cookies or tokens (`token_v2`, `reddit_session`); requests just carry the browser's cookies.
7. Ask before adding a dependency.

## Where things are

`docs/how-it-works.md` documents every Reddit endpoint and markup detail the code relies on. Update it with any change to `src/reddit/`.
