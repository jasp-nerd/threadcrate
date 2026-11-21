<script lang="ts">
  // The toolbar popup: the main way to export. It reads what to export from the
  // tab's address, shows any running or just-finished export, and hands the
  // export itself to a tab of its own (a popup closes when you click away).
  import { onMount } from 'svelte';
  import { browser } from 'wxt/browser';
  import { popupView, type PopupView } from '../../app/popup-view';
  import { REDDIT_TABS } from '../../hosts';
  import { sendMessage, type PageInfo, type StartExportRequest } from '../../messaging';
  import { REDDIT } from '../../reddit/model';
  import { loadActivity, forgetActivity, type Activity } from '../../storage/activity';
  import ActivityCard from '../../ui/ActivityCard.svelte';
  import ExportForm from '../../ui/ExportForm.svelte';
  import Icon from '../../ui/Icon.svelte';
  import { NAME } from '../../ui/brand';
  import AppIcon from '../../ui/AppIcon.svelte';

  let view = $state<PopupView | null>(null);
  let tabId = $state<number | undefined>(undefined);
  let info = $state<PageInfo | null>(null);
  let activity = $state<Activity[]>([]);
  let another = $state(false);
  const running = $derived(activity.some((a) => a.status === 'running' || a.status === 'paused'));

  /** The page's own facts (title, comment counts), if the Reddit tab answers quickly. */
  async function askPage(id: number): Promise<PageInfo | null> {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 400));
    return Promise.race([sendMessage('pageInfo', undefined, id).catch(() => null), timeout]);
  }

  onMount(() => {
    void (async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      tabId = tab?.id;
      // popup.html?url=… shows the popup for that page (screenshots, the docs).
      const next = popupView(new URLSearchParams(location.search).get('url') ?? tab?.url);
      // The page's own facts first (at most 400 ms), so the form doesn't shift once shown.
      if (next.kind === 'target' && tabId !== undefined) info = await askPage(tabId);
      view = next;
    })();
    void loadActivity().then((a) => (activity = a));
    // Seeing the result is reading the badge: clear it.
    void browser.action.setBadgeText({ text: '' }).catch(() => undefined);
  });

  async function exportPage(request: StartExportRequest) {
    await sendMessage('startExport', { ...request, tabId });
    window.close();
  }

  function openSettings(section?: string) {
    void browser.tabs.create({
      url: browser.runtime.getURL(`/options.html${section ? `#${section}` : ''}`),
    });
    window.close();
  }

  /** Back to Reddit: a tab already open on it, else a new one. */
  async function openReddit() {
    const [open] = await browser.tabs.query({ url: REDDIT_TABS });
    if (open?.id !== undefined) {
      await browser.tabs.update(open.id, { active: true });
      if (open.windowId !== undefined)
        await browser.windows.update(open.windowId, { focused: true });
    } else {
      await browser.tabs.create({ url: `${REDDIT}/` });
    }
    window.close();
  }
</script>

<main>
  <header>
    <span class="brand"><AppIcon size={28} /><span class="brand-name">{NAME}</span></span>
    <button class="btn btn-icon" type="button" aria-label="Settings" onclick={() => openSettings()}
      ><Icon name="settings" /></button
    >
  </header>

  {#each activity as a (a.jobId)}
    <ActivityCard
      activity={a}
      compact={view?.kind === 'target' && (!running || another)}
      ondismiss={() => {
        void forgetActivity(a.jobId);
        activity = activity.filter((x) => x.jobId !== a.jobId);
      }}
    />
  {/each}

  {#if view?.kind === 'target' && running && !another}
    <!-- A second export shares Reddit's allowance with the first: one press away, not the default. -->
    <button class="btn btn-light btn-block" type="button" onclick={() => (another = true)}
      >Export this page too</button
    >
  {:else if view?.kind === 'target'}
    <ExportForm
      url={view.url}
      target={view.target}
      {info}
      onexport={exportPage}
      onsettings={openSettings}
    />
  {:else if view?.kind === 'nothing'}
    <section class="empty">
      <img src="/kip/float.webp" alt="" width="132" />
      <h1 class="heading">Nothing to export on this page</h1>
      <p class="small">
        {#if view.reason}{view.reason}{:else}{NAME} exports a post, a subreddit, a profile or a search.
          Open one and click {NAME} again.{/if}
      </p>
    </section>
  {:else if view?.kind === 'off-reddit'}
    <section class="empty">
      <img src="/kip/wave.webp" alt="" width="104" />
      <h1 class="heading">You're not on Reddit</h1>
      <p class="small">Open a post, a subreddit, a profile or a search, then click {NAME}.</p>
      <button class="btn btn-light btn-block" type="button" onclick={openReddit}
        ><Icon name="external" />Open reddit.com</button
      >
    </section>
  {/if}

  {#if !activity.length}
    <!-- The trust line, until there's an export to show: then the popup needs the room. -->
    <footer class="small">Open source, not affiliated with Reddit</footer>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font: 15px/1.45 var(--font-ui);
  }
  main {
    width: 360px;
    box-sizing: border-box;
    padding: 14px 16px 18px;
    display: grid;
    gap: 14px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  footer {
    border-top: 1px solid var(--mist-2);
    padding-top: 12px;
    text-align: center;
  }
  .empty {
    display: grid;
    justify-items: center;
    gap: 8px;
    padding: 4px 6px 2px;
    text-align: center;
  }
  .empty img {
    height: auto;
    margin-bottom: 4px;
  }
  .empty .small {
    max-width: 290px;
    margin-bottom: 8px;
  }
</style>
