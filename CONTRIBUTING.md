# Contributing

Thanks for helping. Bug reports, fixes and Reddit-changed-its-pages patches are all welcome.

## Setup

Node 22+ and pnpm 11 (`corepack enable` picks the right version).

```sh
pnpm install
pnpm dev        # Chrome with the extension, reloading on change
```

## Before you open a pull request

```sh
pnpm verify     # typecheck, lint, unit tests, e2e against the mock reddit.com
```

If you changed how Reddit is read (`src/reddit/`), also run `pnpm live` against the real reddit.com, or the part you touched (`LIVE_ONLY=post`). It opens a visible window and goes at Reddit's pace, so it takes several minutes. Say in the pull request what it printed.

## Ground rules

- **Be polite to Reddit.** Don't raise the request rate, add concurrency against reddit.com, or retry pages that say "blocked" or "log in". The pacing in `src/reddit/client.ts` is a feature.
- **Reddit's content is untrusted.** Never render it as HTML in the extension's pages. It goes into files, as text.
- **Test data is invented.** No real Reddit content (posts, comments, usernames) in unit tests or fixtures; `tests/support/shreddit.ts` builds pages in Reddit's markup from made-up content. Only `pnpm live` reads real pages, and its output stays in the git-ignored `e2e/live/out/`.
- **The export layout is a contract.** File names, column names and JSON keys in `src/export/` are what people's scripts read. Change them only with a good reason, a test, and a line in the changelog.
- **Permissions stay minimal.** A new host or permission makes Chrome disable the extension for existing users until they accept it.
- Ask in an issue before adding a dependency.
- Tests guard things that can really break: parsing Reddit, pacing and backoff, the export layout. Skip tests of UI copy and layout; a screenshot in the pull request is better.

## How it works

See [docs/how-it-works.md](docs/how-it-works.md): the endpoints, the rate limiting, and where the code lives.

## Releases

Releases are built and sent to the stores by GitHub Actions from a version tag; only the maintainer publishes. See [docs/releasing.md](docs/releasing.md). If a change touches permissions, `pnpm check:manifest` fails until `scripts/manifest.snapshot.json` is updated on purpose (`node scripts/check-manifest.mjs --update`), along with PRIVACY.md and the store listings in `docs/store/`.
