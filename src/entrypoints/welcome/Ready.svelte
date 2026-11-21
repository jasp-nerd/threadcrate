<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from 'wxt/browser';
  import AppIcon from '../../ui/AppIcon.svelte';
  import { NAME } from '../../ui/brand';
  import Glyph from '../../ui/Glyph.svelte';
  import Icon from '../../ui/Icon.svelte';

  let { saveError }: { saveError: string } = $props();

  // Chromium can tell whether the icon is on the toolbar; elsewhere the tip always shows.
  let pinned = $state(false);
  onMount(async () => {
    const action = browser.action as typeof browser.action & {
      getUserSettings?: () => Promise<{ isOnToolbar?: boolean }>;
    };
    if (action.getUserSettings)
      pinned =
        (await action.getUserSettings().catch(() => ({ isOnToolbar: false }))).isOnToolbar ?? false;
  });
</script>

<h1 class="display" tabindex="-1">You're all set</h1>
<p class="lead">
  Open a post, a subreddit, a profile or a search on Reddit, then click {NAME} in your browser's toolbar.
</p>

{#if !pinned}
  <div class="card pin">
    <p class="heading">Pin {NAME} so it's one click away</p>
    <ol>
      <li>
        <span class="key" aria-hidden="true"><Icon name="puzzle" /></span>
        <span>Click the puzzle piece next to the address bar.</span>
      </li>
      <li>
        <span class="key brand" aria-hidden="true"><Icon name="pin" /></span>
        <span>Click the pin beside {NAME}.</span>
      </li>
      <li>
        <span class="key" aria-hidden="true"><AppIcon size={22} /></span>
        <span>It stays in your toolbar.</span>
      </li>
    </ol>
  </div>
{/if}

<p class="inline">
  <span class="sample" aria-hidden="true"><Glyph size={13} />Export</span>
  <span class="small"
    >Also on the page: next to <b>Share</b> on a post, and next to <b>Join</b> on a subreddit. You can
    hide it in Settings.</span
  >
</p>

{#if saveError}
  <div class="notice notice-rose" role="alert">
    <Icon name="alert" />
    <span>Your choices couldn't be saved ({saveError}). You can set them in Settings.</span>
  </div>
{/if}

<style>
  .pin {
    padding: 18px 20px;
    display: grid;
    gap: 12px;
  }
  .pin ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 10px;
  }
  .pin li {
    display: grid;
    grid-template-columns: 36px 1fr;
    gap: 12px;
    align-items: center;
    font-size: 15px;
  }
  .key {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: var(--mist-2);
    color: var(--ink);
  }
  .key.brand {
    color: var(--brand);
  }
  .inline {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  /* Reddit's own grey button, as Export looks beside Share. */
  .sample {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 14px 0 12px;
    border-radius: var(--r-pill);
    background: var(--mist-2);
    color: var(--ink);
    font-size: 13px;
    font-weight: 600;
  }
  .inline b {
    color: var(--ink-2);
  }
</style>
