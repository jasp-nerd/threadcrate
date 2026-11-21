// A mock reddit.com over HTTPS for the e2e tests. Chrome maps Reddit's hosts here
// with --host-resolver-rules, so the content script, the export tab and the
// downloads all talk to it. Its content is invented. Unknown paths answer 501 and
// are recorded in `unexpected`, and tests fail on those.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import https from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import {
  commentEl,
  masthead,
  moreButton,
  page,
  postEl,
  threadPost,
} from '../../tests/support/shreddit';

export const HOSTS = ['www.reddit.com', 'i.redd.it', 'v.redd.it', 'packaged-media.redd.it'];

export interface MockReddit {
  port: number;
  /** `site` is the Sec-Fetch-Site header: "same-origin" when a Reddit page made the request. */
  log: {
    method: string;
    host: string;
    path: string;
    status: number;
    site: string;
    referer: string;
    origin: string;
  }[];
  unexpected: string[];
  /** Highest number of requests handled at once. */
  maxConcurrent: number;
  /** Answer the next N "more comments" requests with 429 and Retry-After: 1. */
  throttleNext: number;
  /** Delay "more comments" answers by this many ms (to test stopping). */
  moreDelayMs: number;
  /** Logged in, yet Reddit refuses its JSON API (only /api/me.json answers). */
  jsonBlocked: boolean;
  /** Reddit's budget: requests per window (225 per 10 minutes on reddit.com). */
  budget: { limit: number; windowMs: number };
  close(): Promise<void>;
}

export function certs(): { key: Buffer; cert: Buffer } {
  const dir = path.resolve('e2e/.certs');
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  if (!existsSync(key)) {
    mkdirSync(dir, { recursive: true });
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '3650',
        '-keyout',
        key,
        '-out',
        cert,
        '-subj',
        '/CN=mock-reddit',
      ],
      {
        stdio: 'ignore',
      },
    );
  }
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

const P = 'p1';
const SLUG = `/r/testsub/comments/${P}/an_invented_question/`;
const MORE = '/svc/shreddit/more-comments/testsub/t3_p1';
// 1×1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

function postPage(): string {
  return page(
    threadPost({
      id: P,
      sub: 'testsub',
      title: 'An invented question',
      body: 'Why is it so?',
      comments: 5,
      type: 'image',
      href: 'https://i.redd.it/pic1.png',
    }),
    commentEl(P, {
      id: 'a',
      body: 'First answer',
      inner: commentEl(P, { id: 'b', parent: 'a', depth: 1, body: 'A reply' }),
    }) + moreButton(`${MORE}?top-level=1`, 'TOP1', '3 more comments'),
  );
}

function jsonThing(kind: string, data: Record<string, unknown>) {
  return { kind, data };
}

function jsonComment(id: string, parent: string, body: string) {
  return jsonThing('t1', {
    id,
    name: `t1_${id}`,
    link_id: 't3_p1',
    parent_id: parent,
    author: `user_${id}`,
    body,
    score: 2,
    created_utc: 1_794_000_000,
    subreddit: 'testsub',
    permalink: `/r/testsub/comments/p1/x/${id}/`,
    replies: '',
  });
}

export async function startMockReddit(): Promise<MockReddit> {
  let inFlight = 0;
  let windowStart = Date.now();
  let used = 0;
  /** Rate-limit headers like reddit.com's, counting this request. */
  const rate = () => {
    const { limit, windowMs } = mock.budget;
    while (Date.now() >= windowStart + windowMs) {
      windowStart += windowMs;
      used = 0;
    }
    used++;
    return {
      'x-ratelimit-remaining': `${Math.max(0, limit - used)}.0`,
      'x-ratelimit-used': String(used),
      'x-ratelimit-reset': String(Math.ceil((windowStart + windowMs - Date.now()) / 1000)),
    };
  };
  const mock: MockReddit = {
    port: 0,
    log: [],
    unexpected: [],
    maxConcurrent: 0,
    throttleNext: 0,
    moreDelayMs: 0,
    jsonBlocked: false,
    budget: { limit: 225, windowMs: 600_000 },
    close: () => new Promise((r) => server.close(() => r())),
  };

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const host = (req.headers.host ?? '').split(':')[0]!;
    const url = new URL(req.url ?? '/', `https://${host}`);
    const body = await new Promise<string>((r) => {
      let b = '';
      req.on('data', (c: Buffer) => (b += c.toString()));
      req.on('end', () => r(b));
    });
    const loggedIn = /reddit_session=/.test(req.headers.cookie ?? '');
    const send = (
      status: number,
      content: string | Buffer,
      type: string,
      headers: Record<string, string> = {},
    ) => {
      res.writeHead(status, { 'content-type': type, ...headers });
      res.end(content);
      mock.log.push({
        method: req.method ?? 'GET',
        host,
        path: url.pathname + url.search,
        status,
        site: String(req.headers['sec-fetch-site'] ?? ''),
        referer: String(req.headers.referer ?? ''),
        origin: String(req.headers.origin ?? ''),
      });
    };
    const html = (content: string, headers = {}) =>
      send(200, content, 'text/html; charset=utf-8', { ...rate(), ...headers });
    const json = (content: unknown) =>
      send(200, JSON.stringify(content), 'application/json; charset=UTF-8', rate());
    const blocked = () =>
      send(403, "<html><body>You've been blocked by network security.</body></html>", 'text/html');

    if (url.pathname === '/favicon.ico') return send(404, '', 'text/plain');
    if (host === 'i.redd.it' && url.pathname === '/pic1.png') return send(200, PNG, 'image/png');
    if (host !== 'www.reddit.com') return notFound();

    // Pages the person looks at (the content script runs on these).
    if (url.pathname === '/r/testsub/' || url.pathname === SLUG) {
      if (url.pathname === SLUG && url.searchParams.has('sort')) return html(postPage());
      return html(url.pathname === SLUG ? postPage() : page(masthead('testsub')));
    }
    if (url.pathname === `/comments/${P}/`) {
      return send(301, '', 'text/html', { location: `${SLUG}?${url.searchParams}` });
    }
    if (url.pathname === '/svc/shreddit/community-more-posts/hot/') {
      return html(
        page(
          ['f1', 'f2']
            // Listed with the one comment each post page holds.
            .map((id) => postEl({ id, sub: 'testsub', title: `Feed post ${id}`, comments: 1 }))
            .join(''),
        ),
      );
    }
    for (const id of ['f1', 'f2']) {
      if (url.pathname === `/comments/${id}/`)
        return send(301, '', 'text/html', {
          location: `/r/testsub/comments/${id}/feed_post/?${url.searchParams}`,
        });
      // At its full address, whatever the title part (the feed links feed_post_<id>).
      if (new RegExp(`^/r/testsub/comments/${id}/[^/]+/$`).test(url.pathname))
        return html(
          page(
            postEl({ id, sub: 'testsub', title: `Feed post ${id}`, comments: 1 }),
            commentEl(id, { id: `c${id}`, body: 'Only comment' }),
          ),
        );
    }
    if (req.method === 'POST' && url.pathname === MORE) {
      if (mock.moreDelayMs) await new Promise((r) => setTimeout(r, mock.moreDelayMs));
      if (mock.throttleNext > 0) {
        mock.throttleNext--;
        return send(429, 'Too Many Requests', 'text/plain', { 'retry-after': '1' });
      }
      const cursor = new URLSearchParams(body).get('cursor');
      if (cursor === 'TOP1')
        return html(
          page(
            '',
            commentEl(P, { id: 'c', body: 'Third' }) +
              commentEl(P, { id: 'd', body: 'Fourth' }) +
              moreButton(`${MORE}?top-level=1&offset=2`, 'TOP2'),
          ),
        );
      if (cursor === 'TOP2') return html(page('', commentEl(P, { id: 'e', body: 'Fifth' })));
      return notFound();
    }

    // Reddit's JSON API answers only logged-in sessions.
    if (url.pathname.endsWith('.json')) {
      if (!loggedIn) return blocked();
      if (url.pathname === '/api/me.json') return json({ name: 'mock_user' });
      if (mock.jsonBlocked) return blocked();
      if (url.pathname === `/comments/${P}.json`)
        return json([
          {
            kind: 'Listing',
            data: {
              children: [
                jsonThing('t3', {
                  id: P,
                  name: 't3_p1',
                  subreddit: 'testsub',
                  title: 'An invented question',
                  permalink: SLUG,
                  is_self: true,
                  selftext: 'Why is it so?',
                  num_comments: 4,
                }),
              ],
            },
          },
          {
            kind: 'Listing',
            data: {
              children: [
                jsonComment('a', 't3_p1', 'First answer'),
                jsonThing('more', {
                  id: 'm',
                  parent_id: 't3_p1',
                  count: 3,
                  children: ['x', 'y', 'z'],
                }),
              ],
            },
          },
        ]);
      if (url.pathname === '/api/morechildren.json')
        return json({
          json: {
            errors: [],
            data: {
              things: (url.searchParams.get('children') ?? '')
                .split(',')
                .map((id) => jsonComment(id, 't3_p1', `More ${id}`)),
            },
          },
        });
    }
    return notFound();

    function notFound() {
      mock.unexpected.push(`${req.method} ${host}${url.pathname}${url.search}`);
      send(501, 'not in the mock', 'text/plain');
    }
  }

  const server = https.createServer(certs(), (req, res) => {
    inFlight++;
    mock.maxConcurrent = Math.max(mock.maxConcurrent, inFlight);
    res.on('finish', () => inFlight--);
    void handle(req, res);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  mock.port = (server.address() as AddressInfo).port;
  return mock;
}
