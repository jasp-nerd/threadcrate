import { createShadowRootUi, defineContentScript } from '#imports';
import { mount, unmount } from 'svelte';
import { browser } from 'wxt/browser';
import { onMessage, sendMessage, type PageInfo } from '../../messaging';
import { REDDIT } from '../../reddit/model';
import { loadSettings } from '../../storage/settings';
import { parseTarget, type Target } from '../../reddit/target';
import PageButton from './PageButton.svelte';
import { relayAbort, relayFetch } from './relay';
import { looks, type Look } from './state.svelte';

/**
 * Where an Export button goes among Reddit's own buttons (see docs/how-it-works.md,
 * "The Export button"). When Reddit's markup moves on, the anchor isn't found and
 * the button simply isn't there: the toolbar icon still works.
 */
interface Place {
  name: string;
  /** The page kind it belongs on. */
  kind: Target['kind'];
  /** The Reddit element it sits beside. */
  anchor: () => Element | null;
  append: 'after' | 'before';
  /** Reddit buttons whose look it borrows, best first: the first one that's visible wins. */
  lookFrom: string[];
  /** Text on the page whose colour an outline button takes when no button's look will do. */
  textFrom: string[];
}

const PLACES: Place[] = [
  {
    name: 'post',
    kind: 'post',
    // The thread's own post (not the ones in lists below it): its action row is a
    // flex row in the post's open shadow root, and Share is the slot named share-button.
    anchor: () =>
      document
        .querySelector('main#main-content > shreddit-post')
        ?.shadowRoot?.querySelector('.shreddit-post-container > slot[name="share-button"]') ?? null,
    append: 'after',
    lookFrom: [
      'main#main-content > shreddit-post > rpl-dropdown[slot="ssr-share-button"] button',
      'main#main-content > shreddit-post [slot="share-button"] button',
    ],
    textFrom: ['main#main-content > shreddit-post [slot="title"]', 'main#main-content h1'],
  },
  {
    name: 'subreddit',
    kind: 'subreddit',
    // Between Create Post and Join.
    anchor: () => document.querySelector('.masthead shreddit-subreddit-header-buttons'),
    append: 'before',
    lookFrom: [
      '.masthead create-post-entry-point-wrapper button',
      '.masthead create-post-entry-point-wrapper a',
    ],
    textFrom: ['.masthead h1', '.masthead'],
  },
];

type Rgba = [number, number, number, number];

function rgba(css: string): Rgba | null {
  const m = /rgba?\(([^)]+)\)/.exec(css);
  if (!m) return null;
  const [r, g, b, a = 1] = m[1]!
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  return [r!, g!, b!, a];
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

/** The colour actually behind an element: its own, or the first opaque one around it. */
function backdrop(el: Element): Rgba {
  for (let n: Element | null = el; n;) {
    const c = rgba(getComputedStyle(n).backgroundColor);
    if (c && c[3] > 0.5) return c;
    n = n.parentElement ?? (n.getRootNode() as ShadowRoot).host ?? null;
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? [11, 20, 22, 1] : [255, 255, 255, 1];
}

/** Shown and readable: not a copy Reddit keeps hidden for another screen size or state. */
function visible(el: Element): boolean {
  const s = getComputedStyle(el);
  return (
    el.getClientRects().length > 0 &&
    s.visibility !== 'hidden' &&
    Number(s.opacity) > 0.6 &&
    !(el as HTMLButtonElement).disabled
  );
}

function first(selectors: string[], test: (el: Element) => boolean): Element | null {
  for (const sel of selectors)
    for (const el of document.querySelectorAll(sel)) if (test(el)) return el;
  return null;
}

/**
 * The look of the Reddit button beside the Export button, so it reads as part of the page in
 * any theme or community style. A copy is only used when it's visible and its text stands out
 * from what's behind it; otherwise an outline in the colour of the page's own text, which
 * always does.
 */
function lookFor(place: Place, anchor: Element): Look {
  const source = first(place.lookFrom, visible);
  if (source) {
    const s = getComputedStyle(source);
    const fg = rgba(s.color);
    const own = rgba(s.backgroundColor);
    const behind = own && own[3] > 0.5 ? own : backdrop(source);
    if (fg && contrast(fg, behind) >= 3)
      return {
        background: s.backgroundColor,
        color: s.color,
        border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
        radius: s.borderTopLeftRadius,
        height: s.height,
        font: s.fontFamily,
        size: s.fontSize,
      };
  }
  const text = first(place.textFrom, visible) ?? document.body;
  const t = getComputedStyle(text);
  const fg = rgba(t.color) ?? [26, 26, 27, 1];
  const behind = backdrop(anchor);
  // Text that doesn't stand out either (an unusual community style): black or white instead.
  const ink: Rgba =
    contrast(fg, behind) >= 4.5
      ? fg
      : luminance(behind) > 0.4
        ? [26, 26, 27, 1]
        : [255, 255, 255, 1];
  const [r, g, b] = ink;
  return {
    background: 'transparent',
    color: `rgb(${r}, ${g}, ${b})`,
    border: `1px solid rgba(${r}, ${g}, ${b}, 0.55)`,
    radius: '999px',
    height: source ? getComputedStyle(source).height : place.kind === 'post' ? '32px' : '40px',
    font: t.fontFamily,
    size: place.kind === 'post' ? '12px' : '14px',
  };
}

const same = (a: Look | null | undefined, b: Look | null) =>
  JSON.stringify(a ?? null) === JSON.stringify(b);

/** What the page shows about the post or listing, for the popup's card and time estimate. */
function pageInfo(): PageInfo {
  const posts = [...document.querySelectorAll('shreddit-post')];
  const count = (el: Element) => Number(el.getAttribute('comment-count'));
  const post = posts.length === 1 && /\/comments\//.test(location.pathname) ? posts[0]! : null;
  const counts = posts.map(count).filter(Number.isFinite);
  return {
    url: location.href,
    title: post?.getAttribute('post-title') ?? null,
    comments: post && Number.isFinite(count(post)) ? count(post) : null,
    typicalComments: counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : null,
  };
}

export default defineContentScript({
  matches: [
    'https://www.reddit.com/*',
    'https://old.reddit.com/*',
    'https://new.reddit.com/*',
    'https://sh.reddit.com/*',
  ],
  runAt: 'document_idle',
  cssInjectionMode: 'ui',
  async main(ctx) {
    onMessage('pageInfo', pageInfo);
    // The export tab sends its reddit.com requests through this page: they then go
    // out exactly like the page's own requests, with the page's cookies.
    onMessage('relayReady', () => location.origin === REDDIT);
    onMessage('relayFetch', ({ data }) => relayFetch(data));
    onMessage('relayAbort', ({ data }) => relayAbort(data));
    onMessage('pageText', () => ({
      url: location.href,
      text: (document.body?.innerText ?? '').slice(0, 400),
    }));

    // The Export button can be turned off in the settings, and back on, without a reload.
    let enabled = (await loadSettings()).showPageButton;
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.settings)
        void loadSettings().then((s) => {
          enabled = s.showPageButton;
          place();
        });
    });

    const uis = await Promise.all(
      PLACES.map(async (spot) => ({
        spot,
        ui: await createShadowRootUi(ctx, {
          name: 'threadcrate-ui',
          position: 'inline',
          anchor: spot.anchor,
          append: spot.append,
          onMount: (container) =>
            mount(PageButton, {
              target: container,
              props: {
                get look() {
                  return looks[spot.name] ?? null;
                },
                onopen: () => void sendMessage('openPopup', { url: location.href }),
              },
            }),
          onRemove: (app) => {
            if (app) void unmount(app);
          },
        }),
      })),
    );

    /** Puts each button beside its anchor, again after Reddit re-renders or changes page. */
    function place() {
      const kind = parseTarget(location.href)?.kind;
      for (const { spot, ui } of uis) {
        const anchor = enabled && kind === spot.kind ? spot.anchor() : null;
        const host = ui.shadowHost;
        const beside =
          spot.append === 'after' ? anchor?.nextElementSibling : anchor?.previousElementSibling;
        if (!anchor) {
          if (host.isConnected) ui.remove();
          continue;
        }
        if (beside !== host) {
          ui.remove();
          ui.mount();
          watch(anchor.getRootNode());
        }
        const look = lookFor(spot, anchor);
        if (!same(looks[spot.name], look)) looks[spot.name] = look;
      }
    }

    // Reddit renders and swaps pages without reloading: check again after changes,
    // at most once a frame. A post re-renders inside its own shadow root, which the
    // page's observer doesn't see, so that root is watched too.
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        place();
      });
    });
    const watched = new WeakSet<Node>();
    function watch(root: Node) {
      if (watched.has(root)) return;
      watched.add(root);
      observer.observe(root, { childList: true, subtree: true });
    }
    watch(document.body);
    place();

    // A theme change restyles Reddit's buttons without touching the page's elements:
    // read their look again, also once their colour transitions have ended.
    const restyle = () => {
      place();
      setTimeout(place, 400);
    };
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', restyle);
    new MutationObserver(restyle).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
    });
  },
});
