# Security

Please report security problems in Threadcrate for Reddit privately, through [GitHub's security advisories](https://github.com/jasp-nerd/threadcrate/security/advisories/new), not in a public issue.

The extension has no server: it runs in your browser and talks only to `www.reddit.com`, Reddit's media hosts (`*.redd.it`) and `i.imgur.com`. Its permissions are `downloads`, `notifications` and `storage`, plus access to those hosts and a content script on Reddit's pages. Problems worth reporting include:

- anything that sends data elsewhere, or uses more access than the [privacy policy](PRIVACY.md) describes;
- Reddit content rendered as HTML or run as code in the extension's pages;
- reading or storing login cookies or tokens;
- a web page using the Reddit-tab relay (`src/entrypoints/reddit.content/relay.ts`) to make requests the extension didn't ask for.

Store releases are built by GitHub Actions from a tagged commit, with build attestations; the zips and checksums are on each [release](https://github.com/jasp-nerd/threadcrate/releases).
