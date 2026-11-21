# Promoting Reddit Scraper on Apify from Threadcrate

Decided 21 November 2026, after three cases were argued (a hero pitch, an upgrade path at the moment of need, developer and AI-agent first). The notes behind them are in the session's research, summarised here.

## What ships

| Where | What | Why |
| --- | --- | --- |
| README, before Install | Banner, one line ("does what Threadcrate does, on a server…"), two-step no-code path with the how-to screenshot, a one-line MCP command, curl folded | The top slot is the only one that converts: Sherlock's Apify section 100 lines down was ignored and removed (April 2026). Crawl4AI, ScrapeGraphAI and browser-use moved their cloud pitch up in 2026. GitHub visitors are developers (the only install path today is a build), so the MCP line sits in plain view |
| Website, after "How it works" | The same three paths (no code, AI agent, code), plus a quiet line under the install button | Same reasons; the site also reaches people who'll never open GitHub |
| Extension, beside a running export | A dark card ("From the maker of Threadcrate"), three rotating pitches for non-technical people, "Try it free", and a switch in Settings | People waiting are the ones who'd value "no tab to keep open". The owner's own product, so no "Ad" label; it's attributed to the maker, can be switched off in Settings (what Chrome's Ads policy asks of in-extension promotion), and the listing mentions it |
| Nowhere | Affiliate codes inside the extension | Chrome's affiliate policy (March 2025) bans affiliate links that give the user nothing; the extension uses plain UTM tags only |

Lead with what it buys, not the credit: "5,000 posts free every month" ($5 ÷ $0.99 per 1,000 = 5,050), with the $5 in small print as the reason. Every number is dated and sourced: $5 every month (apify.com/pricing, not "for signing up"), $0.99 / $0.49 per 1,000 posts / comments (live Store, Free plan), 100 posts in 3.4 s (the actor's benchmark, 17 Nov 2026).

## Measuring

Baseline on 21 November 2026: **6 users, 127 runs** (Apify Insights).

1. Apply to Apify's affiliate program (Console › Affiliate; terms §8.1 allow links in your own open-source GitHub repo). Once approved, replace the README and website links with your `?fpr=` link and add "Referral link" to the README's small print. Never in the extension.
2. UTM tags today: `utm_source=github` (README), `threadcrate-site` (website), `threadcrate` + `utm_content=pitch-N` (the extension card, to see which pitch works).
3. Apify Insights › Analytics: new users per week, and the actor's run origins (MCP, API, web).
4. GitHub › Insights › Traffic keeps only 14 days: export referrers weekly.
5. Change one placement at a time, so a jump can be traced to it.

## Distribution, beyond this repo

- **Official MCP Registry:** a remote `server.json` for `https://mcp.apify.com?tools=laptime/reddit-scraper` (namespace `io.github.jasp-nerd/…`).
- **Glama:** a connector entry, which awesome-remote-mcp-servers requires.
- **awesome-remote-mcp-servers:** it already lists 15 `mcp.apify.com/?tools=` entries; it asks submitters to star the repository.
- **apify/awesome-skills:** one skill per pull request, and you must disclose that it uses your own paid actor.
- **apify/agent-skills:** its Reddit entry is another actor; open an issue once yours shows a 95%+ success rate.
- **n8n templates:** through the n8n Creator portal. Reddit cuts off unregistered apps on 12 January 2027, which breaks the n8n Reddit node: a template that uses the actor instead fills that gap.
- **Skip awesome-web-scraping:** it doesn't accept web services or MCP and LLM tools.

Wording: "your code and AI agents", never "AI training data" (Reddit is suing over that).
