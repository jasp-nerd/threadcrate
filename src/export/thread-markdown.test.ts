import { expect, test } from 'vitest';
import { makePost } from '../../tests/support/model';
import { postHeader, safeMarkdown } from './thread-markdown';

test.each([
  ['look <img src=x onerror=alert(1)> here', 'look &lt;img src=x onerror=alert(1)> here'],
  // Escaped backticks aren't code to a viewer: the HTML must still be escaped.
  ['\\`<img src=x onerror=alert(1)>\\`', '\\`&lt;img src=x onerror=alert(1)>\\`'],
  ['use `a < b`', 'use `a &lt; b`'],
  [
    '[click](javascript:alert(1)) [ok](https://example.org)',
    '[click](unsafe:blocked) [ok](https://example.org)',
  ],
  ['[e](&#106;avascript:alert(1))', '[e](unsafe:blocked)'],
  ['[x]: javascript:alert(1)', '[x]: unsafe:blocked'],
  ['![img](data:image/svg+xml;base64,AAAA)', '![img](unsafe:blocked)'],
  ['> a quote\n- a list', '> a quote\n- a list'],
])('%j', (input, output) => {
  expect(safeMarkdown(input)).toBe(output);
});

test('fenced code is left exactly as written', () => {
  const md = 'before <b>\n```js\nif (a < b) {}\n```\nafter <i>';
  expect(safeMarkdown(md)).toBe('before &lt;b>\n```js\nif (a < b) {}\n```\nafter &lt;i>');
  expect(safeMarkdown('```\nunclosed <x>')).toBe('```\nunclosed <x>');
});

test('a named whitespace entity does not sneak a script link through', () => {
  expect(safeMarkdown('[e](java&Tab;script:alert(1))')).toBe('[e](unsafe:blocked)');
  expect(safeMarkdown('[e](java&NewLine;script:alert(1))')).toBe('[e](unsafe:blocked)');
});

test('titles, flair and names are text: no links, images or code', () => {
  const header = postHeader(
    makePost({
      author: 'some_user',
      title: '[click me](javascript:alert(1)) ![x](https://tracker.example/p.png) `code`',
      link_flair_text: '[flair](javascript:x)',
    }),
  );
  expect(header).toContain(
    '# \\[click me\\](javascript:alert(1)) \\!\\[x\\](https://tracker.example/p.png) \\`code\\`',
  );
  expect(header).toContain('Flair: \\[flair\\](javascript:x)');
  // Names keep their underscores as they are.
  expect(header).toContain('some_user');
});
