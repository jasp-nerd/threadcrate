<script lang="ts">
  // The ZIP you'll get, following the choices as they're made.
  import type { Formats } from '../../engine/options';
  import Icon from '../../ui/Icon.svelte';

  let { formats, includeMedia }: { formats: Formats; includeMedia: boolean } = $props();

  const rows = $derived([
    { name: 'posts.csv', icon: 'table', on: formats.csv },
    { name: 'comments.csv', icon: 'table', on: formats.csv },
    { name: 'threads/', icon: 'folder', on: formats.markdown, note: '.md per thread' },
    { name: 'data.json', icon: 'braces', on: formats.json },
    { name: 'media/', icon: 'folder', on: includeMedia, note: 'images, videos' },
    { name: 'README.txt', icon: 'fileText', on: true },
  ] as const);
</script>

<div class="zip" role="img" aria-label="The ZIP with the files you picked">
  <p class="name">
    <Icon name="folder" /><span>reddit_r-BalconyGardens_top-month.zip</span>
  </p>
  <ul>
    {#each rows as row (row.name)}
      <li class:off={!row.on}>
        <Icon name={row.icon} /><span class="file">{row.name}</span>
        {#if 'note' in row}<span class="note">{row.note}</span>{/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .zip {
    position: absolute;
    top: 44px;
    left: 40px;
    right: 40px;
    padding: 18px 20px;
    border-radius: 18px;
    background: #fff;
    color: #14202f;
    box-shadow: 0 16px 40px rgb(122 82 0 / 22%);
  }
  .name {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 10px;
    font: 700 15px/1.3 var(--font-ui);
    min-width: 0;
  }
  .name span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0 0 0 14px;
    border-left: 2px solid #eef1f5;
    display: grid;
    gap: 2px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 34px;
    padding: 0 10px;
    border-radius: 8px;
    font: 600 14px/1 var(--font-mono, ui-monospace, monospace);
    transition:
      opacity 0.2s,
      background-color 0.2s;
  }
  li:not(.off) {
    background: #fff4d6;
  }
  li.off {
    opacity: 0.32;
  }
  li :global(svg) {
    width: 18px;
    height: 18px;
    flex: none;
  }
  .note {
    margin-left: auto;
    font: 500 13px/1 var(--font-ui);
    color: #5f6978;
  }
  .name :global(svg) {
    width: 20px;
    height: 20px;
    flex: none;
  }
</style>
