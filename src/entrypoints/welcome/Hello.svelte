<script lang="ts">
  import { NAME } from '../../ui/brand';
  import Icon from '../../ui/Icon.svelte';

  interface Props {
    /** The browser has given access to Reddit (Firefox asks; Chrome grants it at install). */
    hasAccess: boolean;
    /** The person was asked and said no. */
    denied: boolean;
    ongrant: () => void;
  }
  let { hasAccess, denied, ongrant }: Props = $props();

  const PROMISES = [
    {
      icon: 'shield',
      title: 'Only what you can already see',
      text: 'It reads the Reddit pages you export, as your own browser, at the pace Reddit allows.',
    },
    {
      icon: 'laptop',
      title: 'Everything stays on this computer',
      text: 'Nothing is sent to us or anyone else. No account, no tracking.',
    },
    {
      icon: 'heart',
      title: 'Free and open source',
      text: 'No paid tier, no limits we invented. The code is on GitHub.',
    },
  ] as const;
</script>

<h1 class="display" tabindex="-1">Keep the whole thread</h1>
<p class="lead">
  Save Reddit posts with all their comments, whole subreddits, profiles and searches as CSV, JSON
  and Markdown.
</p>
<ul class="card promises">
  {#each PROMISES as promise (promise.title)}
    <li>
      <Icon name={promise.icon} />
      <span><strong>{promise.title}</strong><span class="small">{promise.text}</span></span>
    </li>
  {/each}
</ul>
<p class="small">An independent project, not affiliated with or endorsed by Reddit.</p>

{#if !hasAccess}
  <div class="notice notice-sun access">
    <Icon name="alert" />
    <span>
      This browser hasn't let {NAME} read Reddit yet.
      <button class="btn btn-dark btn-sm" type="button" onclick={ongrant}
        >Allow access to Reddit</button
      >
    </span>
  </div>
  {#if denied}<p class="notice notice-rose">
      Access wasn't given. The extension can't read Reddit without it.
    </p>{/if}
{/if}

<style>
  h1 {
    font-size: 52px;
  }
  .promises {
    list-style: none;
    margin: 0;
    padding: 4px 20px;
    display: grid;
  }
  .promises li {
    display: grid;
    grid-template-columns: 24px 1fr;
    gap: 14px;
    align-items: center;
    min-height: 64px;
    padding: 10px 0;
  }
  .promises li + li {
    border-top: 1px solid var(--line);
  }
  .promises li > :global(svg) {
    width: 24px;
    height: 24px;
    color: var(--mint-ink);
  }
  .promises strong {
    display: block;
    font-size: 15px;
    line-height: 1.4;
  }
  .promises .small {
    display: block;
  }
  .access span {
    display: grid;
    gap: 10px;
    justify-items: start;
  }
</style>
