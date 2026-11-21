import { gfm } from '@joplin/turndown-plugin-gfm';
import TurndownService from 'turndown';
import { REDDIT } from './model';

let service: TurndownService | null = null;

function turndown(): TurndownService {
  if (service) return service;
  service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  });
  service.use(gfm);
  // Reddit's spoiler markup, back to Reddit's own >!spoiler!< syntax.
  service.addRule('spoiler', {
    filter: (node) => node.nodeName === 'SPAN' && node.classList.contains('md-spoiler-text'),
    replacement: (content) => `>!${content}!<`,
  });
  return service;
}

/** Reddit's rendered comment or post HTML back to Markdown. */
export function htmlToMarkdown(el: Element): string {
  // Reddit turns some phrases into links to its own search ("highlighted search
  // terms"). The author didn't write those links: keep just the words.
  for (const a of el.querySelectorAll('search-telemetry-tracker a[href^="/search/"]')) {
    a.replaceWith(el.ownerDocument.createTextNode(a.textContent ?? ''));
  }
  // Links inside Reddit's HTML are site-relative; make them absolute so they work offline.
  for (const a of el.querySelectorAll('a[href^="/"]:not([href^="//"])')) {
    a.setAttribute('href', `${REDDIT}${a.getAttribute('href')}`);
  }
  return turndown()
    .turndown(el as HTMLElement)
    .trim();
}
