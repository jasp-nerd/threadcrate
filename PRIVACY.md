# Privacy policy

**Last updated:** 17 November 2026 (version 0.1)

Threadcrate for Reddit ("Threadcrate") is a free, open-source browser extension for Chrome, Edge, Firefox and other Chromium browsers. This policy says what it does with data. It applies to every store the extension is published in.

## In short

**Threadcrate does not collect, send or share any data.** It has no server, no analytics, no tracking and no telemetry. Nothing about you or what you export is ever sent to the developer or anyone else.

## What it reads, and where that goes

- **The Reddit pages you export.** When you press Export, Threadcrate reads the posts, comments, usernames, links, images and videos of the Reddit page you chose, from `www.reddit.com`, Reddit's media hosts (`*.redd.it`) and, for images people linked there, `i.imgur.com`. This happens in your browser, and only when you start an export. The result goes into one ZIP file in your Downloads folder, and nowhere else.
- **Your Reddit session.** Requests to Reddit go out from your browser like Reddit's own pages do: an open reddit.com tab makes them, and if none is open, the export opens one in the background. Reddit sees them as your browsing, and its own [privacy policy](https://www.reddit.com/policies/privacy-policy) applies to them. Threadcrate never asks for your password and never reads or stores your login cookies or tokens.
- **Whether you're logged in.** Each export asks Reddit (`/api/me.json`) whether you are logged in, to decide how to read Reddit. Only the yes or no is used. Your username is not stored or exported.

## What is stored on your computer

| What | Where | Why | How long |
| --- | --- | --- | --- |
| Your choices in the export panel and the settings | Extension storage | So the panel opens with them next time | Until you uninstall |
| The export you just started (the page address and your choices) | Session storage | To hand it from the Reddit tab to the export tab | Until the browser closes |
| The progress of running and recent exports | Session storage | To show it in the toolbar popup | Until the browser closes |
| Whether the cloud-version card is switched off, and how often it showed | Extension storage | So the Settings switch sticks, and the card changes its wording | Until you uninstall |
| The ZIP file | Your Downloads folder | It's what you asked for | It's your file: Threadcrate never reads it again |

Uninstalling the extension removes everything except the ZIP files.

## Store declarations

- **Chrome Web Store and Microsoft Edge Add-ons:** Threadcrate declares that it collects no user data. The Reddit pages you export are read and turned into files only on your device; nothing is sent to the developer or anyone else. Its handling of data complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.
- **Firefox Add-ons:** Threadcrate declares that it collects no data (`data_collection_permissions: none`).

## Permissions

| Permission | Why |
| --- | --- |
| `www.reddit.com`, `*.redd.it`, `i.imgur.com` | To add the Export button on Reddit pages, read the pages you export, and download their images and videos when you ask for them. The button also shows on `old`, `new` and `sh.reddit.com` |
| `downloads` | To save the ZIP, and to show it in its folder |
| `notifications` | To tell you when an export running in a background tab is done |
| `storage` | To remember your choices, pass an export to its tab, and show its progress in the popup |

## Children

Threadcrate is not directed at children and collects no data from anyone.

## What you export

The ZIP contains what Reddit shows you: posts, comments, usernames and media written by other people. You are responsible for how you use it. Please respect Reddit's [User Agreement](https://redditinc.com/policies/user-agreement) and the people who wrote the content.

## Changes

Changes to this policy are listed in the [changelog](CHANGELOG.md), and the date above changes. If Threadcrate ever needs to send data anywhere, this policy will say so before that version is released, and the stores' data declarations will change with it.

## Contact

Open an issue on [GitHub](https://github.com/jasp-nerd/threadcrate/issues), or report a security problem privately through [security advisories](https://github.com/jasp-nerd/threadcrate/security/advisories/new).

Threadcrate is independent and not affiliated with or endorsed by Reddit, Inc. Reddit is a trademark of Reddit, Inc.
