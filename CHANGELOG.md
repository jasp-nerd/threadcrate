# Changelog

## 0.1.0 (unreleased)

First version.

- Export a post with its whole comment tree, a subreddit (up to 1000 posts, with or without comments), search results, or a user's posts and comments.
- One ZIP with `data.json`, `posts.csv`, `comments.csv`, a Markdown file per thread, and optionally images and videos.
- Works logged out (through Reddit's web pages) and logged in (through Reddit's JSON API, faster and with user profiles).
- Follows Reddit's rate-limit headers, keeps a reserve for your own browsing, and waits as long as Reddit asks after "too many requests".
- Requests go out as ordinary requests from your Reddit tab. If Reddit refuses its JSON API while you're logged in, the export carries on through Reddit's web pages.
- Logged in, Reddit's web pages and its API are used at the same time, each within its own budget: the web pages find the posts and load small threads, the API loads the big ones. When Reddit refuses "load more comments" in its API, hidden comments are loaded by id instead.
- The toolbar popup is the main way to export: it reads what to export from the page's address, shows at most two choices with their times, and shows a running or just-finished export. Off Reddit it offers to open Reddit. An Export button beside Reddit's own buttons (after Share on a post, between Create Post and Join on a subreddit) opens it too; it borrows the look of the button next to it and can be turned off (`settings.showPageButton`, on by default).
- A settings page (files, comment order, going past 1000 posts, the Export button, speed, read from).
- A new look: Reddit orange for the one action, a stitched-ring logo that fills as an export runs (also on the toolbar icon), and Kip the otter on the welcome, progress and done screens.
- While an export runs, a card beside it offers the author's cloud version (Reddit Scraper on Apify) for people who'd rather not wait in a tab. It opens Apify's page only when clicked, sends nothing, and can be switched off in Settings.
- A welcome page after install, in three steps: what the extension reads and doesn't send, which files you want (saved to the settings), and how to pin it to the toolbar.
- `manifest.json` has `requests_by_kind`: how many requests went to post pages, "more comments", the API and so on.
- Speed: the pause between requests counts from when a request is sent; post pages are requested at their full address (Reddit counts the redirect from a short one); the first "more comments" asks for about 100 at once; posts with no comments need no request; media downloads in the background, a few files at a time.
- Choose comments per post (None, Top, Up to 100, All), each with its expected time before you start. A Fast speed setting.
- For subreddits, find more than the 1000 posts one list shows by combining eight of Reddit's lists and keeping each post once.
- A progress screen built on research about waiting: time left in rounded words from a model of Reddit's limit, pauses explained with a countdown, the post being loaded, a bar that never goes backwards, progress in the tab title and on the toolbar icon, a notification when done. Stop and save keeps everything loaded so far.
- Reddit's changes of 17 November 2026: "more comments" requests carry the post's address as their referrer, as reddit.com's own do (Reddit refuses them otherwise); post pages that leave the comments out ("seeker" pages) get them from the comments partial reddit.com loads.
- More of each thread's comments logged out: "continue this thread" links load as the same "more replies" request reddit.com's own script sends (a 20 KB fragment instead of a 550 KB page; the comment's page if Reddit refuses), fold links whose replies are already on the page are skipped, the biggest branches load first, other sort orders are read past 900 top-level comments, and a thread stops at a request cap instead of looping.
- Deleted comments that still have replies are kept (as `[deleted]`), so their replies keep the right `parent_id`, `depth` and `path`.
- Banned, quarantined, private and unknown subreddits say so on the export page and in `manifest.json` instead of saving an empty export. r/all, r/popular, share links and search tabs other than Posts no longer export the wrong thing: share links (`/r/<sub>/s/<code>`) export the post they lead to (one extra request), and the popup explains why r/all, r/popular and the Comments, Communities, People and Media search tabs can't be exported.
- Search pages wait at least 1.6 s after the previous request (Reddit refused sooner ones).
- Data fixes on the web-page route: gallery images link to their originals (`i.redd.it/<id>`; they were dead links, so gallery media failed to download), a crosspost's `url` is absolute and `crosspost_parent` is filled, comments removed by moderators read `[removed]` with `removal_status` "removed" (they were "deleted" or empty), removed posts are recognised by Reddit's banner too, and comments' `edited_utc`, `stickied` and `author_fullname` are filled. On the JSON API, posts the author deleted (`removed_by_category` "author") have `removal_status` "deleted" (was "removed").
- `media_type` changes: GIF posts are `image` with the `.gif` file (were `video`, with no media), text posts with inline images (`multi_media`) are `text` with those images (were `gallery`, with no media), and crossposts on the web-page route are named after the original's media (were `other`), as on the JSON API.
- New keys in `data.json` (the CSV files are unchanged): posts have `thumbnail`, `poll` (options, votes, close time) and `crosspost` (the original's title, subreddit, score, comments and date); comments have `locked`; media items have `duration`, `hls_url` and `dash_url` (a video's v.redd.it playlists, which don't expire like the MP4 links do).
- `manifest.json`'s `requests_by_kind` can list "comment trees", "subreddit pages" and "share links".
