import { expect, test } from 'vitest';
import { csvCell, toCsv } from './csv';

test.each([
  ['plain', 'plain'],
  ['a, b', '"a, b"'],
  ['say "hi"', '"say ""hi"""'],
  ['two\nlines', '"two\nlines"'],
  [' padded ', '" padded "'],
  // Spreadsheet formulas from strangers' comments must never run.
  ['=HYPERLINK("http://x","y")', '"\'=HYPERLINK(""http://x"",""y"")"'],
  ['+1 to this', "'+1 to this"],
  ['-5 points?', "'-5 points?"],
  ['@everyone', "'@everyone"],
  [-5, '-5'],
  [0.875, '0.875'],
  [true, 'true'],
  [null, ''],
  [undefined, ''],
  [Number.NaN, ''],
])('csvCell(%j) = %s', (value, expected) => {
  expect(csvCell(value)).toBe(expected);
});

test('toCsv starts with a byte-order mark and ends rows with CRLF', () => {
  expect(toCsv(['id', 'body'], [['a', 'x,y']])).toBe('\uFEFFid,body\r\na,"x,y"\r\n');
});

test.each([' =1+1', '　=1', '＝1+1', '＠x'])(
  'formula after spaces or in full width: %j',
  (value) => {
    expect(csvCell(value).replace(/^"/, '')[0]).toBe("'");
  },
);
