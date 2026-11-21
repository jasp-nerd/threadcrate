// The logo: a ring of stitches around an arrow landing in a tray. Drawn from
// geometry, not traced, so the same numbers make the SVG on pages and the toolbar
// icon on a canvas, and the stitches can fill one by one as an export runs.

/** The drawing's coordinate space: a 128 × 128 square. */
export const LOGO_SIZE = 128;
const C = LOGO_SIZE / 2;

export interface LogoGeometry {
  stitches: number;
  /** Radius of the ring, to the middle of the stitch. */
  radius: number;
  /** Stroke width of stitches and the crate. */
  weight: number;
  /**
   * Share of each stitch's slot that is thread, for long and short stitches in
   * turn: a stitch, then a dot (0 draws just the round cap), as the sibling's ring
   * alternates big and small dots. Round caps would close a long-and-short-stitch
   * ring into a solid circle at 32 px; a dot keeps the gaps.
   */
  fill: readonly [long: number, short: number];
}

/** Full size, and the version for 16 px, where fewer, thicker stitches stay apart. */
const LOGO: LogoGeometry = { stitches: 12, radius: 52, weight: 11, fill: [0.6, 0] };
const LOGO_SMALL: LogoGeometry = { stitches: 8, radius: 50, weight: 15, fill: [0.62, 0] };

/** The geometry for an icon drawn at `px` pixels. */
export function geometryFor(px: number): LogoGeometry {
  return px <= 24 ? LOGO_SMALL : LOGO;
}

/** Stitch `i` as an arc: start and end angles in radians, clockwise from the top. */
function stitchArc(g: LogoGeometry, i: number): { from: number; to: number } {
  const slot = (2 * Math.PI) / g.stitches;
  const half = (slot * g.fill[i % 2]!) / 2;
  const mid = -Math.PI / 2 + slot * i + slot / 2;
  return { from: mid - half, to: mid + half };
}

/** The arc as an SVG path. */
export function stitchPath(g: LogoGeometry, i: number): string {
  const { from, to } = stitchArc(g, i);
  const p = (a: number) =>
    `${(C + g.radius * Math.cos(a)).toFixed(2)} ${(C + g.radius * Math.sin(a)).toFixed(2)}`;
  return `M${p(from)} A${g.radius} ${g.radius} 0 0 1 ${p(to)}`;
}

/** The arrow dropping into an open crate (with its hand-hole), as one stroked path. */
export function arrowPath(g: LogoGeometry): string {
  // At 16 px the hand-hole would only blur the crate: it's left out there.
  return g === LOGO_SMALL
    ? 'M64 28 V58 M50 45 L64 58 L78 45 M36 66 V86 Q36 96 46 96 H82 Q92 96 92 86 V66'
    : 'M64 26 V60 M52 48 L64 60 L76 48 M38 68 V90 Q38 98 46 98 H82 Q90 98 90 90 V68 M54 82 H74';
}

/** How many stitches a progress from 0 to 1 fills: none at 0, all only at 1. */
export function stitchesFor(progress: number, total: number): number {
  if (!Number.isFinite(progress) || progress <= 0) return 0;
  if (progress >= 1) return total;
  return Math.min(total - 1, Math.max(1, Math.round(progress * total)));
}

/** The parts of a 2D canvas context the toolbar icon needs. */
export interface IconCanvas {
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  beginPath(): void;
  arc(x: number, y: number, r: number, from: number, to: number): void;
  roundRect(x: number, y: number, w: number, h: number, r: number): void;
  fill(): void;
  stroke(path?: Path2D): void;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
}

/**
 * The toolbar icon at `px` pixels while an export runs: the orange square, its
 * first `filled` stitches white, the rest faint (yellow while Reddit makes it wait).
 */
export function drawIcon(
  ctx: IconCanvas,
  px: number,
  filled: number,
  waiting = false,
  makePath: (d: string) => Path2D = (d) => new Path2D(d),
): void {
  const g = geometryFor(px);
  const s = px / LOGO_SIZE;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.fillStyle = ICON.tile;
  ctx.beginPath();
  ctx.roundRect(0, 0, LOGO_SIZE, LOGO_SIZE, px <= 24 ? 30 : 28);
  ctx.fill();
  // The mark, scaled into the square around its centre.
  const k = px <= 24 ? 0.86 : 0.78;
  ctx.setTransform(s * k, 0, 0, s * k, s * C * (1 - k), s * C * (1 - k));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = g.weight;
  for (let i = 0; i < g.stitches; i++) {
    const { from, to } = stitchArc(g, i);
    ctx.strokeStyle = i < filled ? ICON.mark : waiting ? ICON.wait : ICON.empty;
    ctx.beginPath();
    ctx.arc(C, C, g.radius, from, to);
    ctx.stroke();
  }
  ctx.strokeStyle = ICON.mark;
  ctx.stroke(makePath(arrowPath(g)));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** The toolbar icon's colours: Reddit's classic orange tile, a white mark. */
export const ICON = {
  tile: '#ff4500',
  mark: '#ffffff',
  /** Stitches not filled yet. */
  empty: 'rgba(255,255,255,0.38)',
  /** Every stitch still to come, while Reddit makes the export wait. */
  wait: '#ffc43d',
  /** The badge behind the percentage. */
  badge: '#d93a00',
  badgeWaiting: '#7a5200',
  badgeDone: '#16704a',
} as const;

/** The logo as a standalone SVG file (icons, README, store images). */
export function logoSvg(color: string, px = 128): string {
  const g = geometryFor(px);
  const stitches = Array.from({ length: g.stitches }, (_, i) => stitchPath(g, i)).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LOGO_SIZE} ${LOGO_SIZE}" width="${px}" height="${px}"><g fill="none" stroke="${color}" stroke-width="${g.weight}" stroke-linecap="round" stroke-linejoin="round"><path d="${stitches}"/><path d="${arrowPath(g)}"/></g></svg>`;
}
