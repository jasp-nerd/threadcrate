<script lang="ts">
  import type { Formats } from '../../engine/options';
  import Icon from '../../ui/Icon.svelte';

  let {
    formats = $bindable(),
    includeMedia = $bindable(),
  }: { formats: Formats; includeMedia: boolean } = $props();

  const USES = [
    {
      key: 'csv',
      icon: 'table',
      title: 'Sort and count in a spreadsheet',
      text: 'posts.csv and comments.csv, for Excel, Google Sheets or pandas.',
    },
    {
      key: 'markdown',
      icon: 'fileText',
      title: 'Read them later, or keep notes',
      text: 'One Markdown file per thread, for any text editor or Obsidian.',
    },
    {
      key: 'json',
      icon: 'braces',
      title: 'Use them in code or AI tools',
      text: 'data.json, with every field Reddit gives.',
    },
  ] as const;
</script>

<h1 class="display" tabindex="-1">What will you do with your exports?</h1>
<p class="lead">Pick all that fit. Each one adds its files to the ZIP.</p>
<fieldset class="uses">
  <legend class="sr-only">Files in the ZIP</legend>
  {#each USES as use (use.key)}
    <label class="use">
      <input type="checkbox" bind:checked={formats[use.key]} />
      <Icon name={use.icon} />
      <span><strong>{use.title}</strong><span class="small">{use.text}</span></span>
      <span class="tick" aria-hidden="true"></span>
    </label>
  {/each}
  <label class="use extra">
    <input type="checkbox" bind:checked={includeMedia} />
    <Icon name="image" />
    <span
      ><strong>Also save images and videos</strong><span class="small"
        >Bigger downloads, so it's off unless you want it.</span
      ></span
    >
    <span class="tick" aria-hidden="true"></span>
  </label>
</fieldset>
<p class="small">You can change this any time in Settings.</p>

<style>
  .uses {
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
    display: grid;
    gap: 10px;
  }
  .use {
    position: relative;
    display: grid;
    grid-template-columns: 26px 1fr 22px;
    align-items: center;
    gap: 14px;
    min-height: 68px;
    padding: 12px 16px 12px 18px;
    border-radius: var(--r-choice);
    background: var(--paper);
    box-shadow: inset 0 0 0 2px var(--line);
    cursor: pointer;
    transition:
      box-shadow 0.12s,
      background-color 0.12s;
  }
  .use.extra {
    margin-top: 6px;
  }
  @media (hover: hover) {
    .use:hover {
      box-shadow: inset 0 0 0 2px var(--control);
    }
  }
  .use > :global(svg) {
    width: 26px;
    height: 26px;
  }
  .use strong {
    display: block;
    font-size: 16px;
    line-height: 1.3;
  }
  .use .small {
    display: block;
    margin-top: 2px;
  }
  /* The real checkbox covers its whole card, so a click (or a test's check()) lands on it. */
  .use input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  .use:has(input:focus-visible) {
    outline: 3px solid var(--focus);
    outline-offset: 2px;
  }
  .tick {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    box-shadow: inset 0 0 0 2px var(--control-strong);
    display: grid;
    place-items: center;
  }
  .use:has(input:checked) {
    background: var(--brand-wash);
    box-shadow: inset 0 0 0 2px var(--brand);
  }
  .use:has(input:checked) .tick {
    background: var(--brand);
    box-shadow: none;
  }
  .use:has(input:checked) .tick::after {
    content: '';
    width: 10px;
    height: 6px;
    border: solid var(--paper);
    border-width: 0 0 2.5px 2.5px;
    transform: translateY(-1px) rotate(-45deg);
  }
</style>
