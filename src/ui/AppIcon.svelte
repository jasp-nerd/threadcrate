<script lang="ts">
  // The app icon: the logo in white on an orange rounded square, as in the
  // toolbar and the stores. The orange square says "a tool for Reddit"; the
  // stitched ring is ours (never Reddit's logo or the Snoo).
  import { arrowPath, geometryFor, stitchPath } from './logo';

  let { size = 32 }: { size?: number } = $props();
  const g = $derived(geometryFor(size));
  const scale = $derived(size <= 24 ? 0.86 : 0.78);
</script>

<svg class="app-icon" width={size} height={size} viewBox="0 0 128 128" aria-hidden="true">
  <rect width="128" height="128" rx={size <= 24 ? 30 : 28} fill="#ff4500" />
  <g
    transform="translate(64 64) scale({scale}) translate(-64 -64)"
    fill="none"
    stroke="#fff"
    stroke-width={g.weight}
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    {#each { length: g.stitches } as _, i (i)}<path d={stitchPath(g, i)} />{/each}
    <path d={arrowPath(g)} />
  </g>
</svg>

<style>
  .app-icon {
    flex: none;
    display: block;
  }
</style>
