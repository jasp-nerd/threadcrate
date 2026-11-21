// Invented pages in the shape of reddit.com's web app (as seen in November 2026),
// for testing the web-page backend without real Reddit content. The markup
// keeps only what the parser reads, plus the quirks that matter: comments
// streamed inside <template> chunks, buttons as <faceplate-partial> with a
// cursor input, and fallback "more replies" links.

export interface FakePost {
  id: string;
  sub: string;
  title: string;
  author?: string;
  type?: string;
  body?: string;
  comments?: number;
  score?: number;
  href?: string;
  extra?: string;
  inner?: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function postEl(p: FakePost): string {
  const permalink = `/r/${p.sub}/comments/${p.id}/${p.title.toLowerCase().replace(/\W+/g, '_')}/`;
  const body = p.body
    ? `<div slot="text-body"><div id="t3_${p.id}-post-rtjson-content"><p>${p.body}</p></div></div>`
    : '';
  return `<shreddit-post permalink="${permalink}" content-href="${p.href ?? `https://www.reddit.com${permalink}`}" comment-count="${p.comments ?? 0}" created-timestamp="2026-11-15T08:48:17.197000+0000" domain="self.${p.sub}" id="t3_${p.id}" post-title="${esc(p.title)}" post-type="${p.type ?? 'text'}" score="${p.score ?? 5}" upvote-ratio="0.9" subreddit-id="t5_abc" subreddit-name="${p.sub}" author-id="t2_x" author="${p.author ?? 'poster'}" more-posts-cursor="${btoa(`t3_${p.id}`).replace(/=+$/, '')}" ${p.extra ?? ''}>${body}${p.inner ?? ''}</shreddit-post>`;
}

export interface FakeComment {
  id: string;
  parent?: string;
  depth?: number;
  author?: string;
  body?: string;
  attrs?: string;
  /** Markup inside the comment, after its body: replies, buttons, links. */
  inner?: string;
}

export function commentEl(postId: string, c: FakeComment): string {
  const parent = c.parent ? ` parentid="t1_${c.parent}"` : '';
  const body =
    c.body === undefined
      ? ''
      : `<div id="t1_${c.id}-comment-rtjson-content" slot="comment"><div><p>${c.body}</p></div></div>`;
  return `<shreddit-comment created="2026-11-15T09:00:00.000000+0000" author="${c.author ?? `user_${c.id}`}" thingid="t1_${c.id}" depth="${c.depth ?? 0}"${parent} permalink="/r/testsub/comments/${postId}/comment/${c.id}/" score="3" postid="t3_${postId}" ${c.attrs ?? ''}><details open><summary>meta</summary>${body}${c.inner ?? ''}</details></shreddit-comment>`;
}

export function moreButton(src: string, cursor: string, label = 'more replies'): string {
  return `<faceplate-partial class="more-comments-partial" loading="action" src="${esc(src)}" method="post"><input type="hidden" name="cursor" value="${cursor}"><button type="button">${label}</button></faceplate-partial>`;
}

export function moreLink(postId: string, commentId: string): string {
  return `<a slot="more-comments-permalink" href="/r/testsub/comments/${postId}/comment/${commentId}/?force-legacy-sct=1">More replies</a>`;
}

/** A whole page, with the comments streamed in a <template> the way reddit.com sends them. */
export function page(head: string, streamed = ''): string {
  return `<!doctype html><html><head><title>Reddit</title></head><body><shreddit-app>${head}<shreddit-comment-tree id="comment-tree"></shreddit-comment-tree></shreddit-app>${
    streamed ? `<template for="s_1"><template id="chunk">${streamed}</template></template>` : ''
  }</body></html>`;
}

/** A subreddit's header with Create Post and Join: the Export button goes between them. */
export function masthead(sub: string): string {
  return `<div class="masthead"><h1>r/${sub}</h1><div class="flex"><create-post-entry-point-wrapper><faceplate-tracker><button>Create Post</button></faceplate-tracker></create-post-entry-point-wrapper><shreddit-subreddit-header-buttons><button>Join</button></shreddit-subreddit-header-buttons></div></div>`;
}

/**
 * A thread's post as reddit.com places it: inside main#main-content, with its
 * action row in an open shadow root (declarative here) and the Share button
 * slotted into it. The Export button goes after the share-button slot.
 */
export function threadPost(p: FakePost): string {
  const row =
    '<template shadowrootmode="open"><slot></slot><div class="shreddit-post-container" style="display:flex;gap:12px;align-items:center"><button>5 points</button><slot name="share-button"><slot name="ssr-share-button"></slot></slot></div></template>';
  const share = '<rpl-dropdown slot="ssr-share-button"><button>Share</button></rpl-dropdown>';
  return `<main id="main-content">${postEl({ ...p, inner: row + (p.inner ?? '') + share })}</main>`;
}

/** A comment's meta line: its time link, badges, an edit time and the author's id. */
export function commentMeta(
  id: string,
  m: {
    created?: string;
    edited?: string;
    badges?: string;
    userId?: string;
  } = {},
): string {
  const created = m.created ?? '2026-11-15T09:00:00.000Z';
  return `<div slot="commentMeta"><div><a href="/user/x/">x</a><faceplate-tracker noun="comment_time"><a href="/r/testsub/comments/p1/comment/${id}/"><faceplate-timeago ts="${created}"><time>1h</time></faceplate-timeago></a></faceplate-tracker><shreddit-comment-badges thing-id="t1_${id}" ${m.badges ?? ''}></shreddit-comment-badges>${
    m.edited
      ? `<span>Bewerkt <faceplate-timeago ts="${m.edited}"><time>5m</time></faceplate-timeago></span>`
      : ''
  }</div>${m.userId ? `<div><author-flair-event-handler userid="${m.userId}" subredditid="t5_abc"></author-flair-event-handler></div>` : ''}</div>`;
}

/** A deleted comment that still has replies: no postid, no permalink, no body. */
export function deletedPlaceholder(id: string, inner = '', depth = 0): string {
  return `<shreddit-comment author="[deleted]" thingid="t1_${id}" depth="${depth}" is-comment-deleted><details open><summary>meta</summary><div><p>[deleted]</p></div>${inner}</details></shreddit-comment>`;
}

/** What Reddit shows in place of a gone comment's body. */
export function gonePlaceholder(words: string): string {
  return `<div><div><p class="text-neutral-content-weak">${words}</p></div></div>`;
}

/** A video player with packaged MP4s (with sound), as on video posts. */
export function player(o: {
  id: string;
  duration?: number;
  poster?: string;
  mp4s?: { url: string; bitrate: number; w: number; h: number }[];
  gif?: string;
}): string {
  const packaged = o.mp4s
    ? JSON.stringify({
        playbackMp4s: {
          duration: o.duration,
          permutations: o.mp4s.map((m) => ({
            source: { url: m.url, bitrateBps: m.bitrate, dimensions: { width: m.w, height: m.h } },
          })),
        },
      })
    : null;
  const src = o.gif ?? `https://v.redd.it/${o.id}/HLSPlaylist.m3u8?f=hd&amp;v=1&amp;a=signed`;
  return `<shreddit-player src="${src}"${o.gif ? ' gif' : ''}${o.poster ? ` poster="${esc(o.poster)}"` : ''}${packaged ? ` packaged-media-json="${esc(packaged)}"` : ''}></shreddit-player>`;
}

/** A gallery carousel: preview images named "<slug>-v0-<media id>", as Reddit names them. */
export function gallery(items: { id: string; caption?: string; w?: number; h?: number }[]): string {
  const li = items
    .map(
      (it, i) =>
        `<li slot="page-${i + 1}"><figure><img src="https://preview.redd.it/an-invented-title-v0-${it.id}.jpeg?width=640&amp;crop=smart&amp;s=sig" width="${it.w ?? 800}" height="${it.h ?? 600}">${it.caption ? `<figcaption>${it.caption}</figcaption>` : ''}</figure></li>`,
    )
    .join('');
  return `<div slot="post-media-container"><gallery-carousel><ul>${li}</ul></gallery-carousel></div>`;
}

/** An open poll: a radio input per option, the close time and the total. */
export function openPoll(options: { id: string; text: string }[], closes: string, total: number) {
  return `<shreddit-post-poll><div><span>Sluit <faceplate-timeago ts="${closes}"></faceplate-timeago></span><span><faceplate-number number="${total}"></faceplate-number> stemmen</span></div><div>${options
    .map(
      (o) =>
        `<faceplate-tracker noun="text"><faceplate-radio-input name="poll" value="${o.id}">${o.text}</faceplate-radio-input></faceplate-tracker>`,
    )
    .join('')}</div></shreddit-post-poll>`;
}

/** A closed poll: each option's text above a bar, with its votes in a faceplate-number. */
export function closedPoll(options: { text: string; votes: number }[], total: number) {
  return `<shreddit-post-poll><div><span>Gesloten</span><span><faceplate-number number="${total}"></faceplate-number></span></div><div>${options
    .map(
      (o) =>
        `<div><div><span>${o.text}</span></div><div><div><rpl-tooltip content="x"><div style="width: 50%"></div></rpl-tooltip></div><div><faceplate-number number="${o.votes}"></faceplate-number></div></div></div>`,
    )
    .join('')}</div></shreddit-post-poll>`;
}

/** A subreddit's page when Reddit won't show it: the guard modal with its reason code. */
export function blockedCommunityPage(reason: string): string {
  const ctx = esc(JSON.stringify({ action_info: { reason } }));
  return page(
    `<faceplate-tracker san="blocked_community_page__view__modal" data-faceplate-tracking-context="${ctx}"><div>…</div></faceplate-tracker>`,
  );
}

/** A subreddit's page when no such community exists. */
export function missingCommunityPage(): string {
  return page(
    '<faceplate-partial src="/svc/shreddit/community-not-found-modal?name=x"></faceplate-partial>',
  );
}
