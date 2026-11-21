<script lang="ts">
  // The logo's arrow into a crate, without the stitched ring, which turns to
  // noise at button size. For the Export button on Reddit pages.
  import { arrowPath, geometryFor } from './logo';

  let { size = 20 }: { size?: number } = $props();
  const d = arrowPath(geometryFor(128));
</script>

<svg class="glyph" width={size} height={size * 1.1} viewBox="30 20 68 84" aria-hidden="true"
  ><path {d} /></svg
>

<style>
  .glyph {
    flex: none;
    display: block;
    fill: none;
    stroke: currentColor;
    stroke-width: 12;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
