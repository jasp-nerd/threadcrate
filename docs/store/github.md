# GitHub repository settings

Decided 21 November 2026, from the naming and search research (Google Trends, store and GitHub searches, November 2026).

## Name: `jasp-nerd/threadcrate`

The brand alone. Reddit's brand rules ask that "Reddit" isn't part of a product's own name, and a coined name that stands alone is the safest pattern (and nobody else uses it). The search words go in the description and topics instead, which GitHub search and Google both read.

## Description (shown in GitHub search, and as Google's title: "GitHub - jasp-nerd/threadcrate: …")

```
Free Reddit exporter: save threads with their full comment trees, subreddits, profiles and searches to CSV, JSON and Markdown. Chrome extension, no API key, no Python. Cloud and API version: Reddit Scraper on Apify.
```

Why: "Reddit exporter" first, because Google shows the first ~60 characters. "No API key, no Python" answers the most common question since Reddit stopped issuing self-service API keys (11 November 2025): the usual answers on Reddit point to Python tools that need one. The last sentence catches "reddit scraper" searches (about 25× the volume of the exporter phrases) and sends them to the paid cloud version, while the extension itself stays an "exporter".

## Website

```
https://threadcrate.jaspnerd.dev
```

## Topics (20, GitHub's maximum)

```
reddit reddit-exporter reddit-scraper reddit-comments reddit-data subreddit reddit-api-alternative export csv json markdown data-export chrome-extension browser-extension web-scraping apify mcp no-api-key wxt svelte
```

`reddit-scraper`, `web-scraping` and `apify` are there for discovery and describe the Apify version the README offers; the extension is described as an exporter everywhere else.

## Social preview (Settings › Social preview, 1280×640)

`media/store/chrome/marquee-1400x560.png` cropped, or a dedicated image later. It's what shows when the repository link is shared on X, LinkedIn, Slack or Discord.

## Setting it all in one go, once the repository exists

```sh
gh repo edit jasp-nerd/threadcrate \
  --description "Free Reddit exporter: save threads with their full comment trees, subreddits, profiles and searches to CSV, JSON and Markdown. Chrome extension, no API key, no Python. Cloud and API version: Reddit Scraper on Apify." \
  --homepage "https://threadcrate.jaspnerd.dev" \
  $(for t in reddit reddit-exporter reddit-scraper reddit-comments reddit-data subreddit reddit-api-alternative export csv json markdown data-export chrome-extension browser-extension web-scraping apify mcp no-api-key wxt svelte; do printf -- '--add-topic %s ' "$t"; done)
```
