# Ideas

Things that might be worth adding, changing or removing. Nothing here is decided; it's a list so nothing gets forgotten. Newest at the top of each section. When one is done or dropped, move it to the bottom with a line on why.

## Speed

- **`Accept: text/vnd.reddit.partial+html` on post pages too.** About 168 KB instead of 507 KB with the same data (Apify, Nov 2026); the extension sends it only for "more comments" and the comments partial. Check that the templates unwrap the same.
- **Global search through `/svc/shreddit/search/`**, the partial reddit.com's script loads: about a seventh of the `/search/` page, cursor paging. Whether it counts once against the budget (search pages count twice) is unmeasured.
- **"Skip deep reply chains" comment option.** The top-level "more comments" pages bring about 70 to 100 comments a request; reply buttons about 2.4. A mode that loads top-level comments with their first replies only would be about 13 times cheaper per comment (measured 16 Nov 2026). Apify's "max depth" option: on a 30-deep thread, depth ≤ 2 took 31 requests instead of 148. Needs a setting (the `settings` storage key is a contract).
- **RSS "text only" mode.** `/r/<sub>/comments/<id>/.rss?limit=500` gives about 500 comments for one request on Reddit's second budget, but without scores or reply structure.
- **Listings on the second budget when logged out.** Old-style `/r/<sub>+<sub>/new/?limit=100` pages give 100 posts a request on the 100-per-10-minutes budget, which logged-out exports don't use. Lacks post text, so only worth it when comments are loaded anyway.
- **Recently changed only.** Remember what an export saved and next time load only new posts and threads whose comment count grew (gallery-dl's archive idea; Canvas Course Downloader's "only what's new").
- **Recalibrate the time estimate** for web pages from more live threads: one thread measured 0.3 requests per comment with the new loading order, the model assumes 0.2.

## Data

- **Export comment search results** (the Comments tab, `type=comments`, now refused in the popup): `/svc/shreddit/search/?q=…&type=comments` (or `/svc/shreddit/r/<sub>/search/?…&restrict_sr=1`) works logged out, about 10 results a page with cursor paging, `sort=top|new` honoured, `t=` ignored (filter dates locally). Each result's tracking JSON has the comment, parent and post ids; the body is in `#search-comment-<t1_id>-post-rtjson-content`. They would go to `comments.csv` as standalone comments; needs its own target kind and archive name (a contract).
- **r/all and r/popular** (now refused in the popup) through `/svc/shreddit/feeds/popular-feed?sort=HOT|TOP|…&t=<T>`, next page from its `load-after` partial.
- **Multireddits (`r/a+b+c`), `/gallery/<id>` and `v.redd.it/<id>` links** as targets: read each subreddit and keep each post once; a gallery link is a post; `GET /video/<id>` leads to a video's post.
- **Search results' own score, comment count and date** (`search-counter-row` `faceplate-number`s, `faceplate-timeago[ts]`, labelled in words): would fill rows whose post page fails and feed the time estimate before the pages load.
- **Per-thread completeness in `manifest.json`**: expected, loaded, ratio, requests, empty and failed requests (Apify's `stats`).
- **Fields skipped as low value for now** (each would be a new JSON key): comment `collapsed`, `award_count`, `author_icon_url`, `author_is_bot`, `author_badge`, image comments' `content_type` and `media_urls`; post flair colours, `embed` (YouTube and the like, `shreddit-embed`), award fields, `language`, Reddit's raw `post_type`, `author_icon_url`, `removed_by` (moderator, reddit or author), `is_original_content`; gallery `outbound_url`; media `preview_url` and `captions_url` (WebVTT); the subreddit header on post pages (subscribers, description, type); synthetic `is_placeholder` rows for replies whose parent never arrived (they go to the top level now, with a gap).
- **`stickied` on post pages** is `false` for a pinned post opened on its own (Reddit marks pins only in feeds); null, or the feed's value, would be more honest.
- **Removed or deleted in other languages:** only English pages say a gone comment was removed by moderators; elsewhere it counts as deleted. A captured non-English page would show whether any attribute tells them apart.
- **Arctic Shift as an opt-in source** to go past Reddit's 1000-post cap: whole subreddits by date range, a whole thread in one request. Caveats: shows deleted users' content, scores are days old, likely ends with Reddit's API in March 2027. Apify measured it (Nov 2026): it adds 0 to 5% of a thread's comments beyond what the web pages bring, and a whole thread takes one request in about 5 s. Needs an optional host permission, privacy-policy changes and a `data_source` per row.
- **"Latest comments of a subreddit" export** from `/r/<sub>/comments/?limit=100` (100 comments a request, no reply structure).
- **`manifest.json` doesn't record** the deep, speed or "read from" choices.

## Product

- **Back up a subreddit's wiki, rules and sidebar** with its posts (a moderator's ask in the first user review, 17 Nov 2026).
- **A data dictionary in every ZIP**: each CSV column and JSON field, types, UTC times, how deleted and removed items appear (a data journalist's ask). README.txt covers part of it today.
- **Resume a failed or stopped export** instead of starting over (asked by two reviewers).

- **Store screenshots and promo tiles generated from the real UI** (Canvas Course Downloader's `media/store/src/capture.ts` approach).
- **A website** like coursedownloader.com, once the name is settled.
- **Settings page** with the few things people change, the rest under Advanced.

- **Export beside Reddit's buttons on profiles and searches** (now only posts and subreddits), if a stable spot exists. Never floating over the page.
- **Check the inline Export button's anchors in `pnpm live`**, so a Reddit markup change shows up as a failing test.

## Testing

- **Canary checks in `pnpm live`**: "load more" is not refused (a big thread brings more than its first page), a banned subreddit is reported as banned, gallery originals answer 200, a seeker page still gets its comments, every feed post has a score, date and comment count.
- **When "load more" is refused,** read every sort order's first page (25 different top-level comments each, with first replies) instead of stopping: Apify recovered 11 to 31% of a thread that way. It carries on after a "blocked" answer, so it needs the owner's decision (the export stops on blocks today). The same goes for a "blocked" answer to a built "continue this thread" request: falling back to the comment pages would carry on after a block.
- **Direct mode (no Reddit tab)** can't send a reddit.com Origin or Referer, so Reddit refuses its "more comments" since 17 Nov 2026 and the export stops. Rare (a background tab is opened when none is there); a clearer message for that case would help.
- **Time estimate for the new comment requests**: the seeker partial, built "continue this thread" requests and the extra sort orders past 900 top-level comments change requests per comment; the per-thread calibration learns it as it goes, but the model's starting figure (0.2 a comment) may need recalibrating from live runs.

- **Live suite records requests through the Reddit tab** (it only sees the export tab's own requests).
- **Chrome for Testing renderer crash on macOS 27** (`AperitifCheckInitialized` abort) kills long live runs now and then.
- **Early estimate on mixed threads**: the simulation "100 posts, mixed threads" is 32% off at the early check (bound 25%); fix the estimate, not the bound.
- **knip in CI** to catch unused exports and files (needs a dev dependency: ask first).
- **Dark-mode check in e2e**: the phone and dark test only checks for horizontal overflow; add a contrast check if dark mode regresses.

## Done or dropped

- **Mod-removed comments logged out exported with an empty body or as deleted** (21 Nov 2026): "Comment removed by moderator" / "…by Reddit" now read as `[removed]` (English pages; see "Removed or deleted in other languages").
- **`edited_utc` and `crosspost_parent` always empty on the web-page route** (21 Nov 2026): comments' edit time is read from their meta line, crossposts name their original. Posts' edit time isn't shown to logged-out visitors, so it stays empty there.
- **Lessons from the Apify Reddit actors** (21 Nov 2026): gallery originals without the title slug, share links, GIF and multi_media posts, removed vs deleted, `[deleted]` comments that have replies, button counts from `faceplate-number`, the Origin/Referer requirement, seeker pages, built "more replies" requests for "continue this thread", skipping fold links, other sort orders past 900 top-level comments, biggest branches first, a per-thread request cap, blocked subreddits explained, r/all, r/popular and non-post searches refused with a reason, a 1.6 s gap before search pages, and thumbnails, polls, crosspost details, video length and playlists, comment `locked`, stickied and author id.
