// The toolbar icon and badge, for following an export from other tabs: the logo's
// stitches fill and the badge shows the percentage while it runs, then how it ended.

import { browser } from 'wxt/browser';
import { drawIcon, geometryFor, ICON, stitchesFor } from '../../ui/logo';

/** The stitches and waiting state last drawn: the icon is redrawn only when a stitch changes. */
let drawn = '';

export function showProgress(fraction: number, waiting: boolean): void {
  drawProgressIcon(fraction, waiting);
  void browser.action
    .setBadgeText({ text: `${Math.round(fraction * 100)}%` })
    .catch(() => undefined);
  void browser.action
    .setBadgeBackgroundColor({ color: waiting ? ICON.badgeWaiting : ICON.badge })
    .catch(() => undefined);
}

function drawProgressIcon(fraction: number, waiting: boolean): void {
  const key = `${Math.round(fraction * 12)}:${waiting}`;
  if (key === drawn || typeof OffscreenCanvas === 'undefined') return;
  drawn = key;
  const imageData: Record<number, ImageData> = {};
  for (const px of [16, 32]) {
    const ctx = new OffscreenCanvas(px, px).getContext('2d');
    if (!ctx) return;
    drawIcon(ctx, px, stitchesFor(fraction, geometryFor(px).stitches), waiting);
    imageData[px] = ctx.getImageData(0, 0, px, px);
  }
  void browser.action.setIcon({ imageData }).catch(() => undefined);
}

/** Back to the plain icon once the export has ended. */
export function resetIcon(): void {
  drawn = '';
  void browser.action
    .setIcon({ path: { 16: '/icons/icon-16.png', 32: '/icons/icon-32.png' } })
    .catch(() => undefined);
}

/** A mark on the badge for how the export ended, until the person has seen it. */
export async function showEnd(ok: boolean): Promise<void> {
  await browser.action.setBadgeText({ text: ok ? '✓' : '!' }).catch(() => undefined);
  await browser.action
    .setBadgeBackgroundColor({ color: ok ? ICON.badgeDone : ICON.badgeWaiting })
    .catch(() => undefined);
}

export function clearBadge(): void {
  void browser.action.setBadgeText({ text: '' }).catch(() => undefined);
}
