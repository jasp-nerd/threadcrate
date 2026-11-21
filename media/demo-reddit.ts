// An invented community for screenshots: r/BalconyGardens, with posts and
// comments that read like a real one, so store images and the README show
// believable numbers and titles instead of test data. Same markup as the mock
// (tests/support/shreddit.ts); answers are slowed a little so a capture can
// catch an export mid-run. Nothing here is real Reddit content.
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import {
  commentEl,
  masthead,
  moreButton,
  page,
  postEl,
  threadPost,
} from '../tests/support/shreddit';
import { certs } from '../e2e/mock/server';

export const SUB = 'BalconyGardens';

const TOPICS = [
  "What's the easiest vegetable for a north-facing balcony?",
  'Tomatoes split after two days of rain. Still fine to eat?',
  'First harvest from my 2 m² balcony this year',
  'Self-watering pots: worth it or a gimmick?',
  'How do you keep pigeons off the strawberries?',
  'Chilli plants indoors over winter: what worked for you',
  'Is potting soil from last year still usable?',
  'Mint took over the whole planter. Lesson learned',
  'Best herbs for a windy 8th floor?',
  'Rate my lettuce tower (built from an old shoe rack)',
  'Aphids on the basil again. Soap spray or ladybirds?',
  'How deep does a pot need to be for carrots?',
  'Watering schedule while away for two weeks?',
  'Grew potatoes in a bag, here is the yield',
  'Which fertiliser for fruiting plants in containers?',
  'My landlord allows planters now. Where do I start?',
];
const AUTHORS = [
  'fernandleaf',
  'potbound',
  'eighthfloorgreens',
  'basil_barb',
  'compostcat',
  'rooftop_ruth',
  'seedswap_sam',
  'mulchmaster',
];
const COMMENTS = [
  'Lettuce and spinach do fine with three or four hours of light. Skip anything that fruits.',
  'Same here. I moved mine to the railing and it doubled the light they get.',
  'Split tomatoes are fine to eat if you pick them the same day. Just not for storing.',
  "Self-watering pots saved my peppers in July. Worth it if you're away a lot.",
  'Bird netting from the hardware store, clipped to the railing. Ugly but it works.',
  'Keep mint in its own pot. Always. It will escape otherwise.',
  'Thyme, rosemary and oregano handle wind best in my experience.',
  'Carrots want at least 30 cm. Short varieties like Paris Market do fine in less.',
  'A wine bottle upside down in the soil gets you about a week.',
  'Soap spray twice, three days apart. The ladybirds never stayed on my balcony.',
  'Tomato feed works for chillies and strawberries too, at half strength.',
  'Mix last year’s soil with fresh compost and it’s good again.',
];

interface DemoPost {
  id: string;
  title: string;
  author: string;
  comments: number;
  score: number;
}

/** 300 posts, the topics repeated with numbers, comment counts from a few to a few hundred. */
const POSTS: DemoPost[] = Array.from({ length: 300 }, (_, i) => {
  const topic = TOPICS[i % TOPICS.length]!;
  const round = Math.floor(i / TOPICS.length);
  return {
    id: `bg${(i + 101).toString(36)}`,
    title: round ? `${topic} (${2026 - round})` : topic,
    author: AUTHORS[i % AUTHORS.length]!,
    comments: [14, 87, 6, 213, 41, 9, 128, 33, 3, 58][i % 10]!,
    score: [312, 1840, 45, 96, 2210, 18, 640, 77][i % 8]!,
  };
});

export interface DemoReddit {
  port: number;
  /** Milliseconds each answer waits (to catch an export mid-run). */
  delayMs: number;
  close(): Promise<void>;
}

export async function startDemoReddit(): Promise<DemoReddit> {
  let used = 0;
  const started = Date.now();
  const demo: DemoReddit = {
    port: 0,
    delayMs: 120,
    close: () => new Promise((r) => server.close(() => r())),
  };

  const thread = (p: DemoPost) => {
    const shown = Math.min(p.comments, 25);
    const comments = Array.from({ length: shown }, (_, c) =>
      commentEl(p.id, {
        id: `${p.id}c${c}`,
        author: AUTHORS[(c + 3) % AUTHORS.length],
        body: COMMENTS[(c + p.comments) % COMMENTS.length],
      }),
    ).join('');
    const more =
      p.comments > shown
        ? moreButton(
            `/svc/shreddit/more-comments/${SUB}/t3_${p.id}?top-level=1&comments-remaining=75`,
            `${p.id}:${shown}`,
            `${p.comments - shown} more comments`,
          )
        : '';
    return page(
      threadPost({
        id: p.id,
        sub: SUB,
        title: p.title,
        author: p.author,
        comments: p.comments,
        score: p.score,
        body: COMMENTS[p.comments % COMMENTS.length],
      }),
      comments + more,
    );
  };

  const server = https.createServer(certs(), (req, res) => {
    const url = new URL(req.url ?? '/', 'https://www.reddit.com');
    const reply = (status: number, content: string) => {
      used++;
      setTimeout(() => {
        res.writeHead(status, {
          'content-type': 'text/html; charset=utf-8',
          'x-ratelimit-remaining': `${Math.max(0, 600 - used)}.0`,
          'x-ratelimit-used': String(used),
          'x-ratelimit-reset': String(Math.max(1, 600 - Math.round((Date.now() - started) / 1000))),
        });
        res.end(content);
      }, demo.delayMs);
    };
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      const p = url.pathname;
      if (p.endsWith('.json')) return reply(403, "You've been blocked by network security.");
      if (p === `/r/${SUB}/` || p.startsWith(`/r/${SUB}/top/`) || p === '/')
        return reply(200, page(masthead(SUB)));
      const feed = /^\/svc\/shreddit\/community-more-posts\/\w+\/$/.exec(p);
      if (feed) {
        const after = Number(url.searchParams.get('after') ?? 0);
        const slice = POSTS.slice(after, after + 25);
        const next =
          after + 25 < POSTS.length
            ? `<faceplate-partial slot="load-after" src="/svc/shreddit/community-more-posts/top/?name=${SUB}&amp;t=MONTH&amp;after=${after + 25}"></faceplate-partial>`
            : '';
        return reply(
          200,
          page(
            slice
              .map((x) =>
                postEl({
                  id: x.id,
                  sub: SUB,
                  title: x.title,
                  author: x.author,
                  comments: x.comments,
                  score: x.score,
                  body: COMMENTS[x.comments % COMMENTS.length],
                }),
              )
              .join('') + next,
          ),
        );
      }
      const post = /^\/(?:r\/\w+\/)?comments\/(\w+)\//.exec(p);
      const found = post && POSTS.find((x) => x.id === post[1]);
      if (found) return reply(200, thread(found));
      if (req.method === 'POST' && p.startsWith('/svc/shreddit/more-comments/')) {
        const [id, from] = (new URLSearchParams(body).get('cursor') ?? ':0').split(':') as [
          string,
          string,
        ];
        const x = POSTS.find((q) => q.id === id);
        if (!x) return reply(404, 'gone');
        const start = Number(from);
        const end = Math.min(x.comments, start + 99);
        const comments = Array.from({ length: end - start }, (_, c) =>
          commentEl(x.id, {
            id: `${x.id}c${start + c}`,
            author: AUTHORS[(c + 5) % AUTHORS.length],
            body: COMMENTS[(c + start) % COMMENTS.length],
          }),
        ).join('');
        return reply(200, page('', comments));
      }
      reply(404, 'not here');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  demo.port = (server.address() as AddressInfo).port;
  return demo;
}
