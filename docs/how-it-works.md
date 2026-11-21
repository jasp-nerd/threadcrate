# How it works

How Threadcrate reads Reddit, and why. What's below about Reddit was observed on reddit.com in November 2026, not taken from any documentation. Reddit changes things; when it does, this is the page to update first.

## The parts

```
reddit.com tab                  background (service worker)        export tab (export.html)
───────────────                 ───────────────────────────        ────────────────────────
Toolbar popup (or the  ──msg──▶ saves the job in session    ──▶    runs the export:
Export button on Reddit) storage, opens the tab              client → backend → files
 shadow DOM)                                                        → ZIP → chrome.downloads
```

- The job runs in an **extension tab**, not the service worker: Chrome stops idle service workers after 30 seconds, and the web-page backend needs `DOMParser`, which service workers don't have. The tab also survives closing or navigating the Reddit tab.
- Reddit rations its web pages and its API separately (see Rate limits). Each has its own client, pacing and Web Lock, shared by every export tab, so Reddit sees at most one request at a time per budget. The export tab also asks Chrome not to discard it while it works, and a reloaded or restored tab asks before running the export again.
- Hidden tabs get their timers throttled to one per minute after five minutes in the background, so the waits between requests run on a timer in a Web Worker (`entrypoints/timer.ts`). The tab holds a Web Lock while it works, which keeps Chrome from freezing it.
- Requests to www.reddit.com go **through a Reddit tab**: the export tab asks the content script in the tab the export started from (or any www.reddit.com tab, or one it opens in the background) to make the request, so it is the page's own same-origin request with its cookies, exactly as the page would make it (`engine/tab-fetch.ts`, `reddit.content/relay.ts`). The relay only makes same-origin GETs and the "more comments" POST, and passes on a referrer only when it is a www.reddit.com address (the post's, for "more comments"; see below). Pacing stays in the export tab. Media hosts are fetched directly.
- Without a Reddit tab to use, requests go out from the extension's own origin with the browser's Reddit cookies. They can't carry a reddit.com Origin or Referer (browsers don't allow that, and changing request headers would need a new permission), so since 17 November 2026 Reddit refuses their "more comments" requests: the export then stops on that refusal, with what it loaded. The export tab opens a background Reddit tab to avoid this whenever it can. Chrome sends cookies on requests to hosts in `host_permissions` as if they were same-site (unless the person blocks third-party cookies; then Reddit sees a logged-out browser, and the web pages are used). Firefox support is experimental.

Code map:

| Path | What |
|---|---|
| `src/reddit/client.ts` | Rate-limited HTTP: pacing, 429 backoff, retries |
| `src/reddit/errors.ts` | Every kind of failure and what it means for an export (stop, switch to the web pages, try another endpoint), and block, check and login page detection |
| `src/reddit/json-api.ts`, `json-parse.ts` | Backend for logged-in users: Reddit's JSON API; the requests, and the answers read into our model |
| `src/reddit/html-api.ts`, `html-parse.ts` | Backend for everyone: the web pages reddit.com itself loads; the requests, and the markup read into our model |
| `src/reddit/tree.ts` | Builds comment trees from comments arriving in any order |
| `src/engine/run.ts` | One export: picks a backend (`backend-choice.ts`), lists (`listing.ts`), loads threads in two lanes, media (`media-download.ts`) |
| `src/engine/eta.ts`, `run-estimate.ts` | The time-left model, and what a running export feeds it |
| `src/export/` | CSV, Markdown, the ZIP layout and the manifest |
| `src/entrypoints/` | The toolbar popup, the content script (the Export button and the request relay), background, export tab, settings |

## The toolbar popup

The popup is the main way to export. It works out what to export from the tab's address alone (`src/app/popup-view.ts`: off Reddit, nothing to export, or a target), never from Reddit's markup, so a Reddit redesign can't break it. It asks the Reddit tab's content script for the post's title and the comment counts it shows (`pageInfo`, 400 ms at most) for the card and the time estimates. It offers at most two choices, each with its time; everything else is in Settings, summed up in one line. Pressing Export hands the job to the background, which opens the export tab: a popup closes as soon as you click away.

The Export button on Reddit pages is a launcher for the popup, a fixed pill on `<body>` in its own shadow root. The background opens the popup (`action.openPopup()`); where a browser can't do that from a page (Firefox before 149, an unfocused window), it opens the same form in a tab (`export.html#new?url=…`). Settings can hide the button.

While an export runs, its tab saves a small snapshot every second to session storage (`src/storage/activity.ts`), so the popup can show it, and the finished export for half an hour. The toolbar icon's stitches fill as it goes.

## The Export button

The content script puts an Export button among Reddit's own buttons, in a shadow root, and borrows the computed look (background, colour, border, radius, height, font) of the Reddit button beside it, so it matches Reddit's light and dark themes. It only opens the toolbar popup. Where it goes, as reddit.com's markup was in November 2026:

| Page | Anchor | Placed |
|---|---|---|
| A thread | In the open shadow root of `main#main-content > shreddit-post`: `.shreddit-post-container > slot[name="share-button"]` (the action row is a flex row; Share is slotted there) | After the slot, as the next item in the row. Its look comes from the light-DOM `rpl-dropdown[slot="ssr-share-button"] button` |
| A subreddit | `.masthead shreddit-subreddit-header-buttons` (Join) | Before it, after Create Post |

A MutationObserver (at most once a frame), on the page and on the post's shadow root, puts the button back when Reddit re-renders or changes page. When an anchor isn't found, there's no button and nothing breaks: the toolbar popup does everything. Profiles and searches have no button. There is deliberately nothing floating over the page.

## Choosing a backend

At the start of each export, `GET /api/me.json`. A JSON answer with a `name` means the browser is logged in: use the JSON API. Anything else (Reddit answers logged-out browsers with a 403 "blocked by network security" page) means the web pages.

Logged in, an export runs **two lanes at once**, one per budget (`src/engine/run.ts`): the web pages find the posts (Reddit refuses listing `.json` even logged in since November 2026) and then load the smallest threads; the API starts on the biggest threads as soon as the first posts are listed, at up to 500 comments a request. Both take posts from one pool; the files come out in listing order. If the API refuses (blocked, a check page, HTML instead of JSON, or 429s it won't let up on), its lane stops and the web pages load the rest. User profiles can only be listed by the API. Settings › Advanced › "Read from" can force either. When an export fails, the export page and `manifest.json` (`failed_request`) name the request Reddit refused.

## JSON API (logged in)

Since May 2026 Reddit answers `.json` requests only for logged-in or authenticated users; logged out, they get a 403 HTML page. `old.reddit.com` redirects logged-out requests to `/login/?reason=lor2`.

- Listings: `/r/<sub>/<sort>.json`, `/user/<name>/<section>.json`, `/search.json` and `/r/<sub>/search.json?restrict_sr=1`, with `limit=100`, `after=<fullname>` and `raw_json=1` (without it, text comes back HTML-escaped). A listing ends when `after` is null; Reddit stops at about 1000 items.
- Threads: `/comments/<id>.json?limit=500&sort=<sort>`.
- Posts: `removed_by_category` "deleted" or "author" means the author deleted it, anything else that it was removed. Polls are `poll_data` (`options` with `id`, `text` and, once closed, `vote_count`; `voting_end_timestamp` in milliseconds); a crosspost's original is `crosspost_parent_list[0]`; the thumbnail is the `preview.images[0].resolutions` entry nearest 640 px wide (with `&amp;` unescaped), else `thumbnail` when it is a URL (not "self", "default", "nsfw"…); `reddit_video` has `hls_url`, `dash_url` (kept without their query) and `duration`.
- "Load more" stubs (`kind: "more"` with child ids, which list every hidden comment below the stub): `/api/morechildren.json?api_type=json&link_id=t3_<id>&children=<up to 100 ids>&sort=<sort>`. The answer is a flat list; the tree is rebuilt from `parent_id`. **Reddit refused this endpoint in November 2026** (403, while `/comments/<id>.json` still worked), so after one refusal the backend asks `/api/info.json?id=t1_<a>,t1_<b>,…` (100 at a time, also a flat list), and if that is refused too, loads each hidden comment's subtree as `/comments/<id>/_/<comment id>.json` (under a comment, its parent's page brings all of them at once).
- "Continue this thread" stubs (`id: "_"`, `count: 0`): `/comments/<id>/_/<parent comment id>.json`.
- The largest stub is loaded first, as PRAW's `replace_more` does, so a comment limit keeps the biggest discussions.

## Web pages (logged out)

These are the requests reddit.com's own scripts make (its "shreddit" front end):

- **Subreddit feeds:** `GET /svc/shreddit/community-more-posts/<sort>/?name=<sub>&t=<DAY|WEEK|…>`. Each post is a `<shreddit-post>` element with its data in attributes (`id`, `post-title`, `author`, `score`, `comment-count`, `created-timestamp`, `post-type`, `content-href`, …) and its text in `#t3_<id>-post-rtjson-content`. The next page is the `faceplate-partial[slot="load-after"]`'s `src`, or `after=<base64 of t3_<id>>` from the last post's `more-posts-cursor`.
- **Banned, quarantined, private and unknown subreddits:** their feed answers 200 with no posts, exactly like a quiet feed. So when the first feed page is empty, the backend loads `/r/<sub>/` once and reads why: an element with `san="blocked_community_page__view__modal"` whose `data-faceplate-tracking-context` JSON has `action_info.reason` (`BANNED`, `QUARANTINED`, `PRIVATE`, `GOLD_ONLY`: codes, the same in every language), a `faceplate-partial` whose `src` has `community-not-found-modal`, or a `guard-community-modal` (restricted). The export then fails with that reason on the export page and in `manifest.json` instead of saving an empty ZIP.
- **r/all and r/popular** are Reddit's front-page feeds; logged out, the community feed is empty for them (they're served by `/svc/shreddit/feeds/popular-feed`). They aren't export targets: the popup says so.
- **Share links** `/r/<sub>/s/<code>` (the mobile app's) redirect to a post. The export makes one GET of the link and takes the post from the address it ends at, else from the page's `#canonical-url-updater` value, else its `<shreddit-post>`. Before November 2026's fix they were read as the subreddit's feed.
- **Post pages:** `GET /r/<sub>/comments/<id>/<slug>/?sort=<sort>`, the address the listing gives. `/comments/<id>/` redirects there, and Reddit counts the redirect too: two units of the budget instead of one. Without a listing's address (a pasted link), and when the listing's address fails, the backend uses `/comments/<id>/`. (`/r/<sub>/comments/<id>/` without the title part serves an empty page that only redirects in a script.) Comments are `<shreddit-comment>` elements with `thingid`, `parentid`, `depth`, `author`, `score`, `created`; bodies are in `#t1_<id>-comment-rtjson-content`. They arrive **inside `<template>` chunks** that the page's scripts move into place, so the parser unwraps every template first, and builds the tree from `parentid`, never from where an element sits.
- **"Seeker" post pages (since 17 November 2026):** some post pages hold the post but no `<shreddit-comment>`; reddit.com's script then loads `GET /svc/shreddit/comments/r/<sub>/t3_<id>?seeker-session=true&sort=<sort>`. When a page has no comments and the post says it has some, the backend loads that partial (one request, `Accept: text/vnd.reddit.partial+html`). `sort` is always set: without it Reddit uses the subreddit's suggested sort. The partial ignores `limit` and `depth` and renders three reply levels.
- **What a comment's markup says:**
  - In its `[slot="commentMeta"]`, its own time is the `faceplate-timeago[ts]` inside `faceplate-tracker[noun="comment_time"]`; another `faceplate-timeago[ts]` beside it is the edit time (`edited_utc`). Read by position, not by the word "Edited", so it works in every language.
  - `shreddit-comment-badges[thing-id="t1_<id>"]` carries `stickied`, `locked` and `distinguished-as`; `author-flair-event-handler[userid]` the author's `t2_` id (not on every comment).
  - A gone comment has no body element. A deleted author is `is-author-deleted` with `author="[deleted]"`. Moderators' removals look the same, except for the words in place of the body ("Comment removed by moderator", "…by Reddit"), so only English pages tell removed from deleted; in other languages a gone comment by a deleted author counts as deleted.
  - A deleted comment that still has replies is a `<shreddit-comment is-comment-deleted>` **without `postid` or `permalink`**. The parser keeps it (giving it the post and a permalink), so its replies keep their parent, depth and path. `thingid="t1_deleted"` stands for nothing and is skipped.
- **Posts:** `item-state="REMOVED"` or a `[slot="post-removed-banner"]` means removed (the banner says "deleted by the person…" when the author deleted it; read in English only). `post-type="gif"` is an i.redd.it `.gif` the page plays as an MP4: exported as an image whose file is the `.gif`, as Reddit's API does. `post-type="multi_media"` is a text post with images or videos in its body, read from the body's `figure`/`img` and players. A crosspost (`post-type="crosspost"`, `is-crosspost`) has the original's site-relative permalink as `content-href` (made absolute for `url`; its id is `crosspost_parent`), and a card in `[slot="post-media-container"]` with the original's title (`faceplate-screen-reader-content`), date and media; its counts are labelled only in words, so they're read in English only. Polls are `shreddit-post-poll`: open ones have a `faceplate-radio-input` per option (`value` is Reddit's option id) and a close time; closed ones show each option's votes in a `faceplate-number[number]`. Feed posts have a `[slot="thumbnail"] img`; videos a `poster`.
- **More comments:** each "more replies" button is a `<faceplate-partial src="/svc/shreddit/more-comments/…">` holding `<input name="cursor">`. `POST` to the `src` with `cursor=<value>` returns about ten more comments, as HTML, with further buttons. No CSRF token is needed for this read. **Since about 22:20 UTC on 17 November 2026 Reddit refuses this POST ("blocked by network security") unless it carries `Origin: https://www.reddit.com` and the post's address as `Referer`**, as reddit.com's own script sends it from the post's page. Through the Reddit tab the browser sets the Origin itself, and the relay passes the post's permalink as the fetch's `referrer`. A button's count is in `<faceplate-number number="N">` (a script fills in its text, in the page's language; the button's text just says "more replies"). The first top-level button's `src` says `comments-remaining=75`; set to 500, Reddit sends up to about 100 comments (top-level ones with their first replies), and the later top-level buttons do so as served. Reply buttons bring about 2.4 comments each on average whatever the parameters: they are where long threads spend most of their requests. With `Accept: text/vnd.reddit.partial+html` the answer is the bare fragment, a third of the bytes.
- **"Continue this thread":** every comment with replies has an `a[slot="more-comments-permalink"]` to its own page (`/r/<sub>/comments/<id>/comment/<comment id>/`), shown when the thread is folded. Where the comment's replies are already on the page, the link is skipped (on a 1,063-comment thread this halved the requests for the same comments). Where they aren't (below a fixed depth there's no button, only the link), the backend **builds the "more replies" request reddit.com's script would send for that comment**: `POST /svc/shreddit/more-comments/<sub>/t3_<id>?sort=<SORT>&startingDepth=<d>&seeker-session=true` with `cursor=base64("commenttree:,::<d>:d1:t1_<comment id>")`, where `d` is the comment's depth plus one. Reddit's cursors are `commenttree:<checksum>,::<depth>:d1:<parent>` and Reddit doesn't check the checksum (November 2026). It is the same endpoint and request as pressing a "more replies" button; the answer is a fragment of about 20 KB, where the comment's page is about 550 KB and mostly repeats the thread, so it is far less load on Reddit and fewer requests. A job whose replies arrived meanwhile is skipped. If Reddit refuses built requests (3 refused, none accepted), the thread opens the comment pages instead. Those pages repeat the thread's other buttons with different cursors, so from a comment page the backend follows only one "more comments" chain per thread, and reply buttons for comments nobody has asked about yet. Since November 2026 comment pages are "seeker" views too (the thread's top comments, about 700 KB, with only the first reply of the linked comment), bringing about 0.2 new comments a request: they come last, and once 10 in a row bring nothing new, the thread stops opening them and records the rest as gaps.
- **Order:** the top-level lists first (about 100 comments a request), then reply buttons by their count, biggest first, then built requests (about 2 each), comment pages last. So a comment limit keeps the biggest discussions, as on the JSON API.
- **Past Reddit's per-sort cap:** the top-level "load more" chain stops after about 1,000 to 1,700 top-level comments per sort order, and each order reaches a different set. Once the first order has brought 900 top-level comments, the backend also reads the comments partial in the `new`, `old`, `controversial` and `confidence` orders (the chosen one left out) and follows their top-level chains, with replies only for comments they brought first. On an 8,969-comment thread this took the export from 6,969 comments to 8,481 (measured by the Apify actor that shares this code; `top` adds nothing).
- **A request cap per thread:** `20 + 2 × min(comment limit, max(Reddit's count, 100))` requests at most, a guard against Reddit answering in circles that the per-chain counters might miss. What's left becomes a gap.
- **Search:** `GET /search/?q=…&type=posts` (or `/r/<sub>/search/?q=…&restrict_sr=1`). Each result's title link is `a[data-testid="post-title"]`, inside a tracker whose `data-faceplate-tracking-context` JSON has the post's id, title, author and subreddit. The next page is a `faceplate-partial` whose `src` has a `cursor=`. Each result's post page is loaded too, for its text, flair, media, score and date (results now show a score, comment count and date too, labelled in words). A search page sent less than about 1.5 s after the previous request came back "blocked" on fresh logged-out sessions, so each search page waits at least 1.6 s after the previous request, whatever the pace. Only post results are exported: the Comments, Communities, People and Media tabs (`type=` anything else) aren't export targets, and the popup says so.
- **User profiles** show nothing to logged-out visitors.
- **Videos:** `<shreddit-player packaged-media-json="…">` lists MP4s *with sound* (`playbackMp4s.permutations`) and the length (`playbackMp4s.duration`); the backend picks the highest bitrate. Those MP4 links are signed and stop working after a few days, so each video also gets its v.redd.it playlists, `https://v.redd.it/<id>/HLSPlaylist.m3u8` and `…/DASHPlaylist.mpd`, which need no signature (the id comes from the player's `src`). Players inside comments are left out.
- **Galleries:** `gallery-carousel li` images are previews named `preview.redd.it/<title-slug>-v0-<media id>.jpeg`; the original is `i.redd.it/<media id>.jpeg` (`i.redd.it/<slug>-v0-<id>` answers 403). The `<img>`'s `width` and `height` are the original's; a `figcaption` is the caption.
- Reddit inserts links to its own search into some words in comments (`search-telemetry-tracker`); those become plain text again.

## Rate limits

Both backends get `x-ratelimit-remaining`, `x-ratelimit-used` and `x-ratelimit-reset` (seconds until the window resets). The window is fixed, not sliding. Measured in November 2026, Reddit keeps **two separate budgets**:

- the web pages and `/svc/shreddit/*`: 225 per 600 s logged out, 600 logged in;
- the older stack: every `.json` (the API), `.rss`, and pages still rendered the old way: 100 per 600 s. A `.json` refused with a 403 has no rate-limit headers but still counts.

Not counted: images and videos on the media hosts, static files. Search pages count twice; `/comments/<id>/` counts twice (the redirect); a share link counts as many times as it redirects. HEAD counts like GET. Opening a Reddit tab costs 3 to 10 units of the web-page budget (the page and the partials it loads).

The client (`src/reddit/client.ts`):

1. One request at a time per budget, also across export tabs (a Web Lock per budget).
2. The rules in `src/reddit/pacing.ts`, which the time estimate replays too: when everything the export still needs (the estimate's own count, `src/engine/run-estimate.ts`, so a change to the estimate changes the pace) fits in what's left of this window (with a 10% margin), one request per second, counted from one send to the next (a slow answer uses up the gap rather than adding to it); otherwise the window's budget spread evenly until the reset, so a big export never stops for minutes at a time; inside the 10% margin the pace slows in proportion, so a few requests more or less in the estimate never decide between finishing now and at the reset. Before the export knows how much is left, the first half of the window goes at one per second.
3. A reserve of 10% (at least 3) is never used, so the person's own Reddit tabs keep working. With only the reserve left, it waits for the reset, unless nothing is left to do.
4. Fast speed: a 3% reserve and 250 ms gaps. Search pages wait at least 1.6 s after the previous request at either speed.
5. On 429: wait for the longest of `Retry-After`, the reset, and an exponential backoff (10 s, 20 s, … up to 10 minutes, with jitter), then retry, up to 6 times.
6. On 5xx or network errors: up to 4 retries with backoff.
7. Pages that mean "blocked", "log in" or "prove you're human" stop the export at once and keep what was collected. Retrying those only makes things worse.

Media hosts (`i.redd.it`, `v.redd.it`, `packaged-media.redd.it`, `preview.redd.it`, `i.imgur.com`) don't count against Reddit's budgets. Media downloads run in the background while comments load, three posts at a time, each worker at a 250 ms pace.

Posts the listing says have no comments are not requested at all.

In live tests: a 740-comment thread took 159 requests and about 6 minutes with no 429s; 100 posts of a feed took under half a minute.

## Safety of the files

- Reddit content is never rendered as HTML by the extension. The Markdown files escape every `<` outside fenced code blocks and defuse links whose scheme isn't http(s) or mailto (after decoding entities), because some Markdown viewers render raw HTML. `data.json` and the CSV files keep the text exactly as Reddit had it.
- Links taken from Reddit's markup (buttons, next pages, media tracks) are followed only when they point at the expected paths on www.reddit.com or the media hosts.
- ZIP paths are built from validated ids and cleaned names, and no path segment can be `.` or `..`.

## Testing

- `pnpm test`: unit tests. The client, both backends and the engine run against scripted fakes with a fake clock (`tests/support/`). Web-page fixtures are invented and built by `tests/support/shreddit.ts`, in the markup described above.
- `pnpm e2e`: the built extension in Chrome for Testing, with `www.reddit.com` and the media hosts mapped to a local HTTPS mock (`e2e/mock/server.ts`). It covers both backends, a 429, the export form, the Export button and the ZIP.
- `pnpm live`: the same flow against the real reddit.com, in a visible window (headless Chrome gets a "prove your humanity" page). It writes ZIPs and summaries to `e2e/live/out/`, which git ignores. Use `LIVE_ONLY=post,feed` to run some of it.

When Reddit changes its pages, `pnpm live` is the first thing that will fail. Update the selectors in `html-parse.ts`, the fixtures in `tests/support/shreddit.ts`, and this page.

## Prior art

Ideas (not code) from: PRAW and prawcore (stub expansion order, rate-limit headers), gallery-dl and yt-dlp (`raw_json=1`, galleries, DASH audio), the Thread Exporter extension (jobs in their own tab), and commercial exporters such as Apify's Reddit actors and ExportComments (a `kind`-free but stable schema, `depth`/`path` columns, keeping deleted comments, a manifest of what's missing).
