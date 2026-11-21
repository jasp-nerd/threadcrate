// What the web-page parser reads from invented pages in reddit.com's markup.
import { describe, expect, test } from 'vitest';
import {
  blockedCommunityPage,
  closedPoll,
  commentEl,
  commentMeta,
  deletedPlaceholder,
  gallery,
  gonePlaceholder,
  missingCommunityPage,
  moreButton,
  moreLink,
  openPoll,
  page,
  player,
  postEl,
} from '../../tests/support/shreddit';
import {
  blockedCommunity,
  canonicalUrl,
  commentsOnPage,
  moreJobs,
  parsePage,
  postFromElement,
  repliesCursor,
} from './html-parse';
import { walk } from './model';
import { CommentTree } from './tree';

const P = 'p1';

function postOf(html: string) {
  const doc = parsePage(page(html));
  return postFromElement(doc.querySelector('shreddit-post')!, doc);
}

function commentsOf(streamed: string) {
  return commentsOnPage(parsePage(page('', streamed)), `t3_${P}`, 'A title');
}

describe('posts', () => {
  test('gallery originals are i.redd.it/<media id>, without the title slug', () => {
    const post = postOf(
      postEl({
        id: 'g1',
        sub: 'testsub',
        title: 'An invented title',
        type: 'gallery',
        href: 'https://www.reddit.com/gallery/g1',
        inner: gallery([{ id: 'abc123', caption: 'First', w: 2000, h: 1500 }, { id: 'def456' }]),
      }),
    );
    expect(post.media_type).toBe('gallery');
    expect(post.media.map((m) => [m.url, m.width, m.height, m.caption])).toEqual([
      ['https://i.redd.it/abc123.jpeg', 2000, 1500, 'First'],
      ['https://i.redd.it/def456.jpeg', 800, 600, null],
    ]);
  });

  test('a GIF post is an image post whose file is the .gif (media_type changed from video)', () => {
    const post = postOf(
      postEl({
        id: 'gif1',
        sub: 'testsub',
        title: 'A gif',
        type: 'gif',
        href: 'https://i.redd.it/xyz789.gif',
        inner: player({
          id: 'none',
          gif: 'https://preview.redd.it/xyz789.gif?width=1080&amp;format=mp4&amp;s=sig',
          poster: 'https://preview.redd.it/a-gif-v0-xyz789.gif?width=640&format=png8&s=sig',
        }),
      }),
    );
    expect(post.media_type).toBe('image');
    expect(post.media).toEqual([
      {
        type: 'gif',
        url: 'https://i.redd.it/xyz789.gif',
        width: null,
        height: null,
        caption: null,
        duration: null,
        hls_url: null,
        dash_url: null,
      },
    ]);
    expect(post.thumbnail).toBe(
      'https://preview.redd.it/a-gif-v0-xyz789.gif?width=640&format=png8&s=sig',
    );
  });

  test('a multi_media post is a text post with the images in its body (media_type changed from gallery)', () => {
    const post = postOf(
      postEl({
        id: 'mm1',
        sub: 'testsub',
        title: 'Text with pictures',
        type: 'multi_media',
        body: 'Look: </p><figure><a href="https://i.redd.it/inline1.png"><img src="https://preview.redd.it/inline1.png?width=640&amp;s=sig"></a><figcaption>One</figcaption></figure><p>and',
      }),
    );
    expect(post.media_type).toBe('text');
    expect(post.is_self).toBe(true);
    expect(post.media.map((m) => [m.type, m.url, m.caption])).toEqual([
      ['image', 'https://i.redd.it/inline1.png', 'One'],
    ]);
  });

  test('a video keeps its length and the playlists that do not expire', () => {
    const post = postOf(
      postEl({
        id: 'v2',
        sub: 'testsub',
        title: 'A video',
        type: 'video',
        href: 'https://v.redd.it/vid42',
        inner: player({
          id: 'vid42',
          duration: 39,
          poster: 'https://preview.redd.it/vid42-poster.png?s=sig',
          mp4s: [
            {
              url: 'https://packaged-media.redd.it/vid42/pb/m2-res_480p.mp4?e=1&s=a',
              bitrate: 300,
              w: 270,
              h: 480,
            },
            {
              url: 'https://packaged-media.redd.it/vid42/pb/m2-res_720p.mp4?e=1&s=b',
              bitrate: 900,
              w: 405,
              h: 720,
            },
          ],
        }),
      }),
    );
    expect(post.media).toEqual([
      {
        type: 'video',
        url: 'https://packaged-media.redd.it/vid42/pb/m2-res_720p.mp4?e=1&s=b',
        width: 405,
        height: 720,
        caption: null,
        duration: 39,
        hls_url: 'https://v.redd.it/vid42/HLSPlaylist.m3u8',
        dash_url: 'https://v.redd.it/vid42/DASHPlaylist.mpd',
      },
    ]);
    expect(post.thumbnail).toBe('https://preview.redd.it/vid42-poster.png?s=sig');
  });

  test('a feed thumbnail comes from the thumbnail slot', () => {
    const post = postOf(
      postEl({
        id: 'l1',
        sub: 'testsub',
        title: 'A link',
        type: 'link',
        href: 'https://example.org/story',
        inner:
          '<div slot="thumbnail"><a href="https://example.org/story"><img src="https://external-preview.redd.it/thumb.jpeg?width=140&amp;s=sig"></a></div>',
      }),
    );
    expect(post.thumbnail).toBe('https://external-preview.redd.it/thumb.jpeg?width=140&s=sig');
    expect(post.media).toEqual([]);
  });

  test('a crosspost: absolute url, the parent fullname, the card, and the original media type', () => {
    const card =
      '<div slot="post-media-container"><a href="/r/origin/comments/orig1/the_original/"><faceplate-screen-reader-content>The original</faceplate-screen-reader-content></a>' +
      '<div><a href="/r/origin/">r/origin</a><faceplate-timeago ts="2026-11-14T10:00:00.000000+0000"></faceplate-timeago></div>' +
      '<zoomable-img><img src="https://preview.redd.it/the-original-v0-pic987.jpeg?width=1080&amp;s=sig"></zoomable-img>' +
      '<div><faceplate-number number="1200"></faceplate-number> upvotes <faceplate-number number="85"></faceplate-number> comments</div></div>';
    const post = postOf(
      postEl({
        id: 'x1',
        sub: 'testsub',
        title: 'Crossposted',
        type: 'crosspost',
        href: '/r/origin/comments/orig1/the_original/',
        extra: 'is-crosspost',
        inner: card,
      }),
    );
    expect(post.url).toBe('https://www.reddit.com/r/origin/comments/orig1/the_original/');
    expect(post.crosspost_parent).toBe('t3_orig1');
    expect(post.crosspost).toEqual({
      name: 't3_orig1',
      permalink: 'https://www.reddit.com/r/origin/comments/orig1/the_original/',
      subreddit: 'origin',
      title: 'The original',
      score: 1200,
      num_comments: 85,
      created_utc: '2026-11-14T10:00:00.000Z',
    });
    expect(post.media_type).toBe('image');
    expect(post.media.map((m) => m.url)).toEqual(['https://i.redd.it/pic987.jpeg']);
  });

  test('a crosspost card in another language: counts unknown, never wrong', () => {
    const card =
      '<div slot="post-media-container"><a href="/r/origin/comments/orig1/x/"><faceplate-screen-reader-content>Het origineel</faceplate-screen-reader-content></a>' +
      '<div><faceplate-number number="1200"></faceplate-number> stemmen <faceplate-number number="85"></faceplate-number> reacties</div></div>';
    const post = postOf(
      postEl({
        id: 'x2',
        sub: 'testsub',
        title: 'Crossposted',
        type: 'crosspost',
        href: '/r/origin/comments/orig1/x/',
        inner: card,
      }),
    );
    expect(post.crosspost).toMatchObject({
      title: 'Het origineel',
      score: null,
      num_comments: null,
    });
  });

  test('an open poll and a closed one', () => {
    const open = postOf(
      postEl({
        id: 'po1',
        sub: 'testsub',
        title: 'Which?',
        type: 'poll',
        inner: openPoll(
          [
            { id: '101', text: 'This one' },
            { id: '102', text: 'That one' },
          ],
          '2026-11-20T20:00:00.000000+0000',
          341,
        ),
      }),
    );
    expect(open.media_type).toBe('poll');
    expect(open.poll).toEqual({
      total_votes: 341,
      ends_at: '2026-11-20T20:00:00.000Z',
      is_closed: false,
      options: [
        { id: '101', text: 'This one', votes: null },
        { id: '102', text: 'That one', votes: null },
      ],
    });
    const closed = postOf(
      postEl({
        id: 'po2',
        sub: 'testsub',
        title: 'Which?',
        type: 'poll',
        inner: closedPoll(
          [
            { text: 'yes', votes: 70 },
            { text: 'no', votes: 30 },
          ],
          100,
        ),
      }),
    );
    expect(closed.poll).toEqual({
      total_votes: 100,
      ends_at: null,
      is_closed: true,
      options: [
        { id: null, text: 'yes', votes: 70 },
        { id: null, text: 'no', votes: 30 },
      ],
    });
    expect(postOf(postEl({ id: 't1', sub: 'testsub', title: 'Text' })).poll).toBeNull();
  });

  test('removed and deleted posts', () => {
    const banner = (words: string) => `<div slot="post-removed-banner">${words}</div>`;
    const status = (extra: string, inner = '', author?: string) =>
      postOf(postEl({ id: 'r1', sub: 'testsub', title: 'T', extra, inner, author })).removal_status;
    expect(status('item-state="REMOVED"')).toBe('removed');
    expect(status('', banner('Removed by the moderators of r/testsub'))).toBe('removed');
    // In any language, a banner means it's gone; only English says it was the author.
    expect(status('', banner('Verwijderd door de moderators'))).toBe('removed');
    expect(
      status('', banner('Sorry, this post was deleted by the person who originally posted it.')),
    ).toBe('deleted');
    expect(status('', '', '[deleted]')).toBe('deleted');
    expect(status('')).toBeNull();
  });
});

describe('comments', () => {
  test('mod-removed comments read [removed], deleted ones [deleted]', () => {
    const gone = (id: string, words: string) =>
      commentEl(P, {
        id,
        author: '[deleted]',
        attrs: 'is-author-deleted',
        inner: gonePlaceholder(words),
      });
    const comments = commentsOf(
      gone('m', 'Comment removed by moderator') +
        gone('r', 'Comment removed by Reddit') +
        gone('d', 'Comment deleted by user') +
        // Another language: the author is gone, so it counts as deleted, as before.
        gone('x', 'Reactie verwijderd'),
    );
    expect(comments.map((c) => [c.id, c.author, c.body, c.removal_status])).toEqual([
      ['m', '[deleted]', '[removed]', 'removed'],
      ['r', '[deleted]', '[removed]', 'removed'],
      ['d', '[deleted]', '[deleted]', 'deleted'],
      ['x', '[deleted]', '[deleted]', 'deleted'],
    ]);
  });

  test("a reply's body never counts as its gone parent's placeholder", () => {
    const comments = commentsOf(
      commentEl(P, {
        id: 'gone',
        inner: commentEl(P, {
          id: 'reply',
          parent: 'gone',
          depth: 1,
          body: 'Comment removed by moderator',
        }),
      }),
    );
    expect(comments.find((c) => c.id === 'gone')).toMatchObject({ body: '', removal_status: null });
  });

  test('edit time, stickied, locked and author id, from attributes in any language', () => {
    const [c, plain] = commentsOf(
      commentEl(P, {
        id: 'a',
        body: 'Edited text',
        inner: commentMeta('a', {
          edited: '2026-11-15T10:30:00.000Z',
          badges: 'stickied locked distinguished-as="moderator"',
          userId: 't2_abc12',
        }),
      }) + commentEl(P, { id: 'b', body: 'Plain', inner: commentMeta('b') }),
    );
    expect(c).toMatchObject({
      edited_utc: '2026-11-15T10:30:00.000Z',
      stickied: true,
      locked: true,
      distinguished: 'moderator',
      author_fullname: 't2_abc12',
    });
    expect(plain).toMatchObject({
      edited_utc: null,
      stickied: false,
      locked: false,
      distinguished: null,
      author_fullname: null,
    });
  });

  test("a reply's badges are not its parent's", () => {
    const [parent] = commentsOf(
      commentEl(P, {
        id: 'a',
        body: 'Parent',
        inner: commentEl(P, {
          id: 'b',
          parent: 'a',
          depth: 1,
          body: 'Reply',
          inner: commentMeta('b', { badges: 'stickied', edited: '2026-11-15T11:00:00.000Z' }),
        }),
      }),
    );
    expect(parent).toMatchObject({ stickied: null, locked: null, edited_utc: null });
  });

  test('a deleted comment with replies is kept, so depth and path stay right', () => {
    const comments = commentsOf(
      commentEl(P, {
        id: 'top',
        body: 'Top',
        inner: deletedPlaceholder(
          'gone',
          commentEl(P, { id: 'kept', parent: 'gone', depth: 2, body: 'Still here' }),
          1,
        ).replace('is-comment-deleted', 'parentid="t1_top" is-comment-deleted'),
      }) + deletedPlaceholder('deleted'),
    );
    const tree = new CommentTree(`t3_${P}`);
    for (const c of comments) tree.add(c);
    const { comments: roots, gaps } = tree.finish();
    expect([...walk(roots)].map((c) => [c.path, c.depth, c.body, c.removal_status])).toEqual([
      ['top', 0, 'Top', null],
      ['top/gone', 1, '[deleted]', 'deleted'],
      ['top/gone/kept', 2, 'Still here', null],
    ]);
    expect(gaps).toEqual([]);
    expect(comments.find((c) => c.id === 'gone')?.permalink).toBe(
      'https://www.reddit.com/r/testsub/comments/p1/comment/gone/',
    );
  });
});

describe('more comments', () => {
  const doc = (streamed: string) => parsePage(page('', streamed));

  test('reply counts come from faceplate-number, in any language', () => {
    const jobs = moreJobs(
      doc(
        commentEl(P, {
          id: 'a',
          body: 'x',
          inner: moreButton(
            '/svc/shreddit/more-comments/testsub/t3_p1?sort=TOP',
            'C1',
            '<faceplate-number number="58"></faceplate-number> meer antwoorden',
          ),
        }) +
          commentEl(P, {
            id: 'b',
            body: 'x',
            inner: moreButton('/svc/shreddit/more-comments/testsub/t3_p1', 'C2', '12 more replies'),
          }),
      ),
      `t3_${P}`,
    );
    expect(jobs.map((j) => [j.parent, j.count])).toEqual([
      ['t1_a', 58],
      ['t1_b', 12],
    ]);
  });

  test('a "continue this thread" link becomes the "more replies" request for that comment', () => {
    const jobs = moreJobs(
      doc(
        commentEl(P, {
          id: 'deep',
          depth: 7,
          body: 'x',
          inner: moreLink(P, 'deep').replace(
            'More replies',
            '<faceplate-number number="4"></faceplate-number> more',
          ),
        }),
      ),
      `t3_${P}`,
      `t3_${P}`,
      { sort: 'NEW' },
    );
    expect(jobs).toHaveLength(1);
    const [job] = jobs;
    expect(job).toMatchObject({ key: 'replies:t1_deep', parent: 't1_deep', count: 4, built: true });
    const url = new URL(job!.url);
    expect(url.pathname).toBe('/svc/shreddit/more-comments/testsub/t3_p1');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      sort: 'NEW',
      startingDepth: '8',
      'seeker-session': 'true',
    });
    expect(atob(new URLSearchParams(job!.body).get('cursor')!)).toBe('commenttree:,::8:d1:t1_deep');
    expect(repliesCursor('t1_deep', 8)).toBe(new URLSearchParams(job!.body).get('cursor'));
    expect(job!.fallback).toBe('https://www.reddit.com/r/testsub/comments/p1/comment/deep/');
  });

  test("a fold link is skipped when the comment's replies are already on the page", () => {
    const jobs = moreJobs(
      doc(
        commentEl(P, {
          id: 'a',
          body: 'x',
          inner: moreLink(P, 'a') + commentEl(P, { id: 'b', parent: 'a', depth: 1, body: 'y' }),
        }) + commentEl(P, { id: 'c', body: 'z', inner: moreLink(P, 'c') }),
      ),
      `t3_${P}`,
    );
    expect(jobs.map((j) => j.parent)).toEqual(['t1_c']);
  });
});

describe('pages', () => {
  test('banned, quarantined, private and unknown subreddits say so', () => {
    const read = (html: string) => blockedCommunity(parsePage(html));
    expect(read(blockedCommunityPage('BANNED'))).toEqual({ kind: 'forbidden', detail: 'banned' });
    expect(read(blockedCommunityPage('QUARANTINED'))).toEqual({
      kind: 'forbidden',
      detail: 'quarantined',
    });
    expect(read(blockedCommunityPage('PRIVATE'))).toEqual({ kind: 'forbidden', detail: 'private' });
    expect(read(missingCommunityPage())).toEqual({
      kind: 'notfound',
      detail: 'community not found',
    });
    expect(read(page(postEl({ id: 'ok1', sub: 'testsub', title: 'Fine' })))).toBeNull();
  });

  test('the post a page says it is', () => {
    const html = page(
      '<input id="canonical-url-updater" type="hidden" value="https://www.reddit.com/r/testsub/comments/sh1/shared_post/">',
    );
    expect(canonicalUrl(parsePage(html))).toBe(
      'https://www.reddit.com/r/testsub/comments/sh1/shared_post/',
    );
    expect(
      canonicalUrl(
        parsePage(
          page('<input id="canonical-url-updater" value="https://evil.example/r/x/comments/a/">'),
        ),
      ),
    ).toBeNull();
  });
});
