<script lang="ts">
  // The Export button among Reddit's own buttons: after Share on a post, between
  // Create Post and Join on a subreddit (Reddit's rows space their buttons). It borrows the look of the button beside it, so it
  // reads as part of the page, in Reddit's light and dark themes alike. A
  // launcher for the toolbar popup, nothing more.
  import Glyph from '../../ui/Glyph.svelte';
  import type { Look } from './state.svelte';

  interface Props {
    look: Look | null;
    onopen: () => void;
  }
  let { look, onopen }: Props = $props();
</script>

<button
  class="export"
  type="button"
  title="Save this page with Threadcrate, as CSV, JSON and Markdown"
  style:background-color={look?.background}
  style:color={look?.color}
  style:border={look?.border}
  style:border-radius={look?.radius}
  style:height={look?.height}
  style:font-family={look?.font}
  style:font-size={look?.size}
  onclick={(e) => {
    // Only a person's click, never a script on the page.
    if (e.isTrusted) onopen();
  }}
>
  <Glyph size={15} />Export
</button>

<style>
  /* px, not rem: rem would follow Reddit's root font size. Until the neighbour's
     look is read, a neutral pill. */
  .export {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    margin: 0;
    padding: 0 14px 0 12px;
    border: 0;
    border-radius: 999px;
    background: rgb(127 127 127 / 14%);
    color: inherit;
    font:
      600 14px/1 system-ui,
      sans-serif;
    white-space: nowrap;
    cursor: pointer;
    vertical-align: middle;
  }
  /* Reddit darkens its buttons on hover; an overlay does the same on any colour. */
  @media (hover: hover) {
    .export:hover {
      box-shadow: inset 0 0 0 999px rgb(127 127 127 / 16%);
    }
  }
  .export:active {
    transform: scale(0.97);
  }
  .export:focus-visible {
    outline: 2px solid #1a73e8;
    outline-offset: 2px;
  }
</style>
