# Releasing

How a version goes from a tag to the stores. CI builds and drafts; only a person publishes. After the first launch there are three human steps per release: push the tag, publish the draft release, approve the store submission.

Marks: **[LOGIN]** needs your own login to a store, GitHub or Google, **[2FA]** a second factor, **[PAY]** costs money. Nothing in this repo contacts a store except `submit.yml`, after your approval.

## The workflows

| Workflow | Runs on | Does |
| --- | --- | --- |
| `ci.yml` | pull requests and pushes to `main` | `pnpm verify` (typecheck, lint and format, unit tests, e2e against the mock reddit.com), then `pnpm check:manifest` |
| `release.yml` | a `v*.*.*` tag (or by hand, as a dry run) | the same checks; checks the tag matches `package.json`, the commit is on `main` and `CHANGELOG.md` has a dated section; builds the Chrome and Firefox zips and the sources zip (with SOURCE_CODE_REVIEW.md added); rebuilds Chrome and Firefox from the sources zip without git and compares them; copies the Chrome zip as the Edge zip; attests the four zips; drafts a GitHub release with the changelog section as notes |
| `submit.yml` | publishing that draft (or by hand, dry run by default) | after approval on the `store-submit` environment, checks the checksums and attestations, then `wxt submit` to the Chrome Web Store (API v2, service account), Firefox Add-ons (with the release notes and `docs/store/reviewer-notes.txt`) and Edge Add-ons |

Every release has the same four files, so these links always point at the newest one:

- `https://github.com/jasp-nerd/threadcrate/releases/latest/download/threadcrate-chrome.zip`
- `…-edge.zip`, `…-firefox.zip`, `…-sources.zip`

The Edge zip is the Chrome build: `wxt.config.ts` targets `chrome` and `firefox` only, and WXT refuses `-b edge` until `'edge'` is added to `targetBrowsers`. The manifest and code are the same for both, so the stores get identical, attested files.

`scripts/check-manifest.mjs` compares the built manifests' permissions, host access, content-script matches, gecko id and Firefox data declaration with `scripts/manifest.snapshot.json`, and fails on any new permission that would show an install warning. A deliberate change: `pnpm build && pnpm build:firefox && node scripts/check-manifest.mjs --update`, then update PRIVACY.md, `docs/store/listing.md` and each store's privacy answers.

## Settings in GitHub

`sh scripts/github-store-setup.sh` does all of this from `~/.config/threadcrate/` and prints none of the values. It needs the store IDs, so run it after the first listings exist (step 12 below). **[LOGIN]** `gh` as jasp-nerd.

- **Environment `store-submit`:** required reviewer jasp; deployment branches and tags: `v*` only. Created first, so no secret is usable without the gate.
- **Private vulnerability reporting** (SECURITY.md links to it) and **immutable releases**. If the script says it couldn't, turn them on in Settings.

| Kind | Name | Where it comes from |
| --- | --- | --- |
| secret | `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL`, `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY` | `cws-key.json`: the Google Cloud service account already added to the Chrome Web Store publisher for Canvas Course Downloader (one per publisher, so the same file). The v1.1 API stopped working on 15 October 2026 |
| variable | `CHROME_EXTENSION_ID` | `cws.env`: Threadcrate's 32-letter item id, from the dashboard after the first upload |
| variable | `CHROME_PUBLISHER_ID` | `cws.env`: the same publisher id as the sibling |
| variable | `CHROME_PUBLISH_TYPE` (optional, not set) | `STAGED_PUBLISH` makes you press Publish after Google approves. Unset, Chrome publishes on approval, like Firefox and Edge |
| secret | `FIREFOX_JWT_ISSUER`, `FIREFOX_JWT_SECRET` | `amo.env`: addons.mozilla.org › Manage API keys. Per user, so the sibling's keys work |
| variable | `FIREFOX_EXTENSION_ID` | `threadcrate@jasp-nerd` (set by the script) |
| secret | `EDGE_CLIENT_ID`, `EDGE_API_KEY` | `edge.env`: Partner Center › Microsoft Edge › Publish API. Account-wide, so the sibling's work. The key expires (the current one on 13 January 2027): make a new one there and run both repos' setup scripts again |
| variable | `EDGE_PRODUCT_ID` | `edge.env`: Threadcrate's own product id (a GUID), from the Publish API page after the first upload |

`~/.config/threadcrate/` can hold copies of, or symlinks to, the files in `~/.config/canvas-downloader/`, with Threadcrate's own `CHROME_EXTENSION_ID` and `EDGE_PRODUCT_ID`. The shared keys mean a secret leaked from either repo can publish to both extensions; the `store-submit` approval in each repo is the guard.

## First launch

0.1.0 goes to each store by hand, because neither the Chrome nor the Edge API can create a listing. Firefox's can.

### Before the tag

1. **Decide** (see `docs/store/listing.md` section 6): the manifest name and summary, the Chrome data-usage answer, Firefox at launch with the experimental flag (or later), and the icon colour. A name or summary change goes into `wxt.config.ts` before the tag, since Chrome and Edge read them from the package.
2. **Reword** the source comments and UI strings listed in `docs/store/listing.md` section 5. AMO reviewers read the source.
3. **Check the Chrome Web Store slot.** **[LOGIN] [2FA]** Publishers get two published items by default, and Canvas Course Downloader uses one. Developer Dashboard › Account: confirm there's room for a second. If not, stop here: the extension can't be published publicly until a slot frees up.
4. **Make the repository public** **[LOGIN]**. The listings, reviewer notes, privacy policy URL and the extension's own "read the code on GitHub" link all point at `github.com/jasp-nerd/threadcrate`. This needs a first commit on `main`, which is yours to make.
5. **Date the changelog:** `## 0.1.0 (YYYY-MM-DD)` in `CHANGELOG.md`. Run `pnpm verify` and `pnpm check:manifest`. Run `pnpm live` too: the real reddit.com is what reviewers will test against.
6. Run `release.yml` by hand on `main` (Actions › Release › Run workflow) as a dry run. It builds, rebuilds from sources, compares, and drafts nothing.

### The tag and the files

7. `git tag v0.1.0 && git push origin v0.1.0`. `release.yml` drafts the release. Download the four zips from the draft (or the run's `release` artifact), and use these exact files everywhere so the stores get the attested builds.
8. **Don't let `submit.yml` send 0.1.0.** Publishing the draft starts `submit.yml`, which would upload a duplicate while the stores are still reviewing (and it fails anyway until the store IDs are set). When you publish the 0.1.0 release, **reject** the `store-submit` deployment.

### The stores

9. **Chrome Web Store** **[LOGIN] [2FA]**: Developer Dashboard › Add new item › upload `threadcrate-chrome.zip`. Fill the Store listing, Privacy and Distribution tabs from `docs/store/listing.md` section 1 (images from `media/store/chrome/`). Submit for review with "publish automatically after approval" on. Copy the **item id** into `~/.config/threadcrate/cws.env` as `CHROME_EXTENSION_ID=`. Review takes a few days, up to a few weeks.
10. **Edge Add-ons** **[LOGIN]**: Partner Center › Microsoft Edge › Create new extension › upload `threadcrate-edge.zip`. Availability, Properties, Privacy, Store listing (images from `media/store/edge/`, the 7 search terms) and Notes for certification from section 3. Publish. Copy the **Product ID** into `~/.config/threadcrate/edge.env` as `EDGE_PRODUCT_ID=`, and, once live, the CRX id for links. Review takes up to seven business days.
11. **Firefox Add-ons** **[LOGIN] [2FA]**, or the API keys. Either:
    - From the command line, which creates the listing from `docs/store/firefox-metadata.json` (name, summary, description, categories, tags, links, the experimental flag, license, release notes and reviewer notes). From the repo root, with the release files in `dist/`:

      ```sh
      mkdir -p /tmp/threadcrate-firefox && unzip -q dist/threadcrate-firefox.zip -d /tmp/threadcrate-firefox
      . ~/.config/threadcrate/amo.env
      npx --yes web-ext@10.8.0 sign --channel listed \
        --source-dir /tmp/threadcrate-firefox \
        --amo-metadata docs/store/firefox-metadata.json \
        --upload-source-code dist/threadcrate-sources.zip \
        --api-key "$FIREFOX_JWT_ISSUER" --api-secret "$FIREFOX_JWT_SECRET"
      ```

      `web-ext` runs through `npx` and isn't added to `package.json`. It repackages the unzipped files, so the uploaded zip has the same contents as the attested one but isn't byte-identical. Then, in the Developer Hub: the five screenshots with their captions (`media/store/firefox/captions.txt`), and optionally the privacy policy (paste PRIVACY.md).
    - Or by hand: Developer Hub › Submit a New Add-on › On this site › upload `threadcrate-firefox.zip` › source code: yes, `threadcrate-sources.zip` › fill the fields from section 2 › paste `docs/store/reviewer-notes.txt` as notes to reviewers.

    A listed version is usually signed and live within minutes after automated checks; a person may review it later. After that, `wxt submit` can update it: it looks the add-on up first, which is why it fails until this step is done.

### After the stores

12. Run `scripts/github-store-setup.sh` **[LOGIN]** (`gh`), then `submit.yml` by hand with `tag: v0.1.0` and `dry_run` on. It checks the attestations and finds each item through its API, and submits nothing.
13. Once each store has approved: fill in `STORES` in `scripts/release-notes.ts`, and ask whoever edits README.md to add the store links and badges.
14. Optional, later: a domain **[PAY]** verified in Google Search Console **[LOGIN]**, for the Chrome Web Store's Official URL and a privacy-policy address that doesn't depend on GitHub. A GitHub social preview (1280×640) in Settings › General **[LOGIN]**.

## A release, step by step

1. Bump `version` in `package.json`. In `CHANGELOG.md`, rename `## X.Y.Z (unreleased)` to `## X.Y.Z (YYYY-MM-DD)`. Run `pnpm verify` and `pnpm check:manifest`, and `pnpm live` if `src/reddit/` changed.
2. Merge to `main`, then `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. Read the draft release and its files on GitHub, then publish it.
4. Approve `store-submit` **[LOGIN]**. Each store publishes by itself once its review passes. AMO gets the changelog section as release notes and `docs/store/reviewer-notes.txt` as notes to reviewers.

## What stays manual

- Listing text, images and privacy answers on Chrome and Edge (no API edits them). The name and summary change only through `wxt.config.ts` and a release.
- The AMO listing after creation: edit it in the Developer Hub. Releases send only per-version notes, so they never overwrite it.
- Renewing the Edge API key before it expires, then rerunning both repos' setup scripts.
- The version bump, the changelog, the tag, publishing the draft, approving the submission, and answering reviewers.
- Opera: not listed; Opera installs from the Chrome Web Store (`docs/store/listing.md` section 4).
