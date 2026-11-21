// The icon and logo files, drawn from src/ui/logo.ts so they always match the
// extension: media/brand/*.svg and public/icons/*.png.
//
//   pnpm icons        (needs rsvg-convert and ImageMagick: brew install librsvg imagemagick)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { arrowPath, geometryFor, ICON, LOGO_SIZE, logoSvg, stitchPath } from '../src/ui/logo.ts';

/** The app icon: the mark in white on the orange rounded square. */
function iconSvg(px: number): string {
  const g = geometryFor(px);
  const small = px <= 24;
  const k = small ? 0.86 : 0.78;
  const stitches = Array.from({ length: g.stitches }, (_, i) => stitchPath(g, i)).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LOGO_SIZE} ${LOGO_SIZE}" width="${px}" height="${px}"><rect width="128" height="128" rx="${small ? 30 : 28}" fill="${ICON.tile}"/><g transform="translate(64 64) scale(${k}) translate(-64 -64)" fill="none" stroke="${ICON.mark}" stroke-width="${g.weight}" stroke-linecap="round" stroke-linejoin="round"><path d="${stitches}"/><path d="${arrowPath(g)}"/></g></svg>`;
}

mkdirSync('media/brand', { recursive: true });
writeFileSync('media/brand/icon.svg', iconSvg(128));
writeFileSync('media/brand/icon-small.svg', iconSvg(16));
writeFileSync('media/brand/logo.svg', logoSvg('#d93a00', 128));
// 128 px: 96 px of artwork with 16 px of transparent padding on every side, as the
// Chrome Web Store asks (it looks oversized edge to edge in the store and install dialog).
mkdirSync('media/store/chrome', { recursive: true });
execFileSync('rsvg-convert', [
  '-w',
  '96',
  '-h',
  '96',
  'media/brand/icon.svg',
  '-o',
  'media/brand/icon-96.png',
]);
for (const out of ['public/icons/icon-128.png', 'media/store/chrome/icon-128.png'])
  execFileSync('magick', [
    'media/brand/icon-96.png',
    '-background',
    'none',
    '-gravity',
    'center',
    '-extent',
    '128x128',
    out,
  ]);
for (const px of [16, 32, 48]) {
  execFileSync('rsvg-convert', [
    '-w',
    String(px),
    '-h',
    String(px),
    px <= 24 ? 'media/brand/icon-small.svg' : 'media/brand/icon.svg',
    '-o',
    `public/icons/icon-${px}.png`,
  ]);
}
console.log('media/brand/*.svg and public/icons/*.png written');
