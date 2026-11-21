// The landing page: the hero demo, and the ZIP filling in as you scroll past it.
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fill(svg: Element | null, p: number) {
  const dots = svg?.querySelectorAll('.dot') ?? [];
  const on = Math.round(p * dots.length);
  dots.forEach((d, i) => d.classList.toggle('on', i < on));
}

/** A row with a check in front, built from text (never parsed as HTML). */
function item(text: string): HTMLLIElement {
  const li = document.createElement('li');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-check');
  svg.append(use);
  const span = document.createElement('span');
  span.textContent = text;
  li.append(svg, span);
  return li;
}

// Hero: a cursor presses Export 100 posts in the popup, and the subreddit saves. The titles and
// numbers are the invented r/BalconyGardens from the extension's own screenshots.
const TITLES = [
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
];
const DONE = ['posts.csv and comments.csv', 'A Markdown file per thread', 'data.json, with every comment tree'];
const POSTS = 100;
const COMMENTS = 1820;

const stage = document.querySelector<HTMLElement>('[data-stage]');
let run = 0;
async function demo() {
  if (!stage) return;
  const card = stage.querySelector<HTMLElement>('.export-card')!;
  const cursor = stage.querySelector<SVGElement>('.cursor');
  const ring = stage.querySelector('[data-ring="hero"]');
  const replay = document.querySelector<HTMLButtonElement>('[data-replay]')!;
  const el = (name: string) => stage.querySelector<HTMLElement>(`[data-${name}]`)!;
  const id = ++run;
  const set = (done: number) => {
    const p = done / POSTS;
    fill(ring, p);
    el('pct').textContent = `${Math.round(p * 100)}%`;
    el('count').textContent = `Post ${done} of ${POSTS}, ${Math.round(p * COMMENTS).toLocaleString('en-US')} comments so far`;
    el('bar').style.width = `${p * 100}%`;
  };
  const finish = () => {
    set(POSTS);
    card.classList.add('shown', 'done');
    stage.classList.add('carded');
    el('count').textContent = '100 posts, 1,820 comments, in one ZIP';
    el('recent').replaceChildren(...DONE.map(item));
    replay.hidden = false;
  };
  stage.classList.add('demo-ready');
  stage.classList.remove('carded');
  card.classList.remove('shown', 'done');
  replay.hidden = true;
  el('recent').replaceChildren();
  set(0);
  if (reduced) return finish();

  const target = stage.querySelector('.target')!.getBoundingClientRect();
  const box = stage.querySelector('.window')!.getBoundingClientRect();
  if (cursor) {
    cursor.style.left = '30%';
    cursor.style.top = '70%';
    await wait(450);
    if (id !== run) return;
    cursor.style.left = `${target.left - box.left + target.width * 0.5}px`;
    cursor.style.top = `${target.top - box.top + target.height * 0.5}px`;
    await wait(1200);
    if (id !== run) return;
    cursor.classList.add('click');
    await wait(160);
    cursor.classList.remove('click');
  }
  await wait(220);
  card.classList.add('shown');
  stage.classList.add('carded');
  for (let done = 1; done <= POSTS; done++) {
    await wait(done < 6 ? 120 : 34);
    if (id !== run) return;
    set(done);
    if (done % 4 === 0) {
      const list = el('recent');
      list.prepend(item(TITLES[(done / 4) % TITLES.length]!));
      while (list.children.length > 3) list.lastElementChild!.remove();
    }
  }
  await wait(250);
  if (id === run) finish();
}
if (stage) {
  document.querySelector('[data-replay]')!.addEventListener('click', () => void demo());
  stage.querySelector('.target')!.addEventListener('click', () => void demo());
  // Start when the stage is on screen, once.
  new IntersectionObserver((entries, io) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    io.disconnect();
    void demo();
  }).observe(stage);
}

// What you get: pick a kind, and while the section is on screen the ring fills and the ZIP
// fills in, row by row.
const ev = document.querySelector<HTMLElement>('[data-everything]');
if (ev) {
  // The ring beside the text, and on phones the one in the bar that stays on top of the tree.
  const rings = ev.querySelectorAll('[data-ring="everything"]');
  const statuses = ev.querySelectorAll<HTMLElement>('[data-ev-pct]');
  let progress = reduced ? 1 : 0;
  const rows = () =>
    [...ev.querySelectorAll<HTMLElement>('[data-tree]:not([hidden]) [data-row]')].filter(
      (r) => r.getClientRects().length > 0,
    );
  const paint = () => {
    rings.forEach((ring) => fill(ring, progress));
    const list = rows();
    const shown = Math.round(progress * list.length);
    list.forEach((r, i) => r.classList.toggle('pending', i >= shown));
    const text = progress >= 1 ? 'Saved' : `${Math.round(progress * 100)}%`;
    statuses.forEach((s) => (s.textContent = text));
  };
  for (const input of ev.querySelectorAll<HTMLInputElement>('input[name="kind"]')) {
    input.addEventListener('change', () => {
      for (const panel of ev.querySelectorAll<HTMLElement>('[data-kind]'))
        panel.hidden = panel.dataset.kind !== input.value;
      paint();
    });
  }
  if (!reduced) {
    // Progress follows the section through the screen: empty as it enters, full by the middle.
    const update = () => {
      const r = ev.getBoundingClientRect();
      const p = (innerHeight * 0.85 - r.top) / (r.height * 0.6);
      progress = Math.min(1, Math.max(0, p));
      paint();
    };
    addEventListener('scroll', update, { passive: true });
    addEventListener('resize', update);
    update();
  } else {
    paint();
  }
}
