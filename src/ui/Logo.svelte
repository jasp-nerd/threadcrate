<script lang="ts">
  import { arrowPath, geometryFor, LOGO_SIZE, stitchesFor, stitchPath } from './logo';

  let {
    size = 32,
    progress,
    waiting = false,
    label,
    looping = false,
  }: {
    size?: number;
    /** 0 to 1: the stitches fill clockwise. Leave out for the plain logo. */
    progress?: number;
    /** Reddit asked to wait: the stitches still to come show yellow. */
    waiting?: boolean;
    /** Accessible name; without one the logo is decoration. */
    label?: string;
    /** Fill, hold and empty on a loop, for "working on it" without a number. */
    looping?: boolean;
  } = $props();

  const g = $derived(geometryFor(size));
  const filled = $derived(progress === undefined ? g.stitches : stitchesFor(progress, g.stitches));
</script>

<svg
  class="logo"
  class:looping
  width={size}
  height={size}
  viewBox="0 0 {LOGO_SIZE} {LOGO_SIZE}"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
>
  <g fill="none" stroke-width={g.weight} stroke-linecap="round" stroke-linejoin="round">
    {#each { length: g.stitches } as _, i (i)}
      <path
        d={stitchPath(g, i)}
        class={looping ? 'stitch' : i < filled ? 'on' : waiting ? 'wait' : 'off'}
        style:animation-delay={looping ? `${(i * 0.08).toFixed(2)}s` : undefined}
      />
    {/each}
    <path d={arrowPath(g)} class="on" />
  </g>
</svg>

<style>
  .logo {
    flex: none;
    display: block;
  }
  path {
    transition: stroke 0.25s;
  }
  .on {
    stroke: var(--brand, #d93a00);
  }
  .off {
    stroke: var(--brand-pale, #ffd3c2);
  }
  .wait {
    stroke: var(--sun, #ffc43d);
  }
  .stitch {
    stroke: var(--brand-pale, #ffd3c2);
    animation: fill-stitches 4s linear infinite;
  }
  @keyframes fill-stitches {
    0% {
      stroke: var(--brand-pale, #ffd3c2);
    }
    4%,
    80% {
      stroke: var(--brand, #d93a00);
    }
    84%,
    100% {
      stroke: var(--brand-pale, #ffd3c2);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .stitch {
      animation: none;
      stroke: var(--brand, #d93a00);
    }
    path {
      transition: none;
    }
  }
</style>
