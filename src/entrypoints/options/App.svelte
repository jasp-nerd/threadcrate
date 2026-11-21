<script lang="ts">
  // Settings: what the popup summarizes in one line. Saved as you change them.
  import { onMount } from 'svelte';
  import { browser } from 'wxt/browser';
  import { COMMENT_SORTS, type CommentSort } from '../../reddit/target';
  import {
    DEFAULT_SETTINGS,
    loadSettings,
    saveSettings,
    type Settings,
  } from '../../storage/settings';
  import { loadCloudTip, saveCloudTip } from '../../app/cloud-tip';
  import AppIcon from '../../ui/AppIcon.svelte';
  import { FULL_NAME, NAME } from '../../ui/brand';

  let settings = $state<Settings>(structuredClone(DEFAULT_SETTINGS));
  let cloudTip = $state({ hidden: false, shown: 0 });
  let loaded = $state(false);
  let saved = $state(false);
  onMount(() => {
    void loadCloudTip().then((t) => (cloudTip = t));
    void loadSettings().then((s) => {
      settings = s;
      loaded = true;
      // Arrived from a "Change" link: show that section.
      document.getElementById(location.hash.slice(1))?.scrollIntoView();
    });
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  function persistCloudTip() {
    void saveCloudTip($state.snapshot(cloudTip)).then(() => {
      saved = true;
      clearTimeout(timer);
      timer = setTimeout(() => (saved = false), 1500);
    });
  }
  function persist() {
    void saveSettings($state.snapshot(settings)).then(() => {
      saved = true;
      clearTimeout(timer);
      timer = setTimeout(() => (saved = false), 1500);
    });
  }

  const SORT_LABEL: Record<CommentSort, string> = {
    confidence: 'Best',
    top: 'Top',
    new: 'New',
    old: 'Old',
    controversial: 'Controversial',
    qa: 'Q&A',
  };
  const noFormat = $derived(
    !settings.formats.json && !settings.formats.csv && !settings.formats.markdown,
  );
  const singleDepth = $derived(
    settings.postMaxComments === null ? 'all' : settings.postMaxComments <= 25 ? 'top' : '100',
  );
  const shortcutsUrl = navigator.userAgent.includes('Firefox')
    ? 'about:addons'
    : 'chrome://extensions/shortcuts';
</script>

<main>
  <header>
    <span class="brand"
      ><AppIcon size={36} /><span class="brand-name"
        >{NAME} <span class="descriptor">for Reddit</span></span
      ></span
    >
    <span class="small saved" aria-live="polite">{saved ? 'Saved' : ''}</span>
  </header>
  <h1 class="title">Settings</h1>

  {#if loaded}
    <section class="card" id="files">
      <h2 class="heading">Files in the ZIP</h2>
      <label class="check"
        ><input type="checkbox" bind:checked={settings.formats.json} onchange={persist} />
        <span><b>JSON</b> <span class="small">everything, for code and AI tools</span></span></label
      >
      <label class="check"
        ><input type="checkbox" bind:checked={settings.formats.csv} onchange={persist} />
        <span><b>CSV</b> <span class="small">for Excel, Sheets and pandas</span></span></label
      >
      <label class="check"
        ><input type="checkbox" bind:checked={settings.formats.markdown} onchange={persist} />
        <span><b>Markdown</b> <span class="small">one readable file per thread</span></span></label
      >
      <label class="check"
        ><input type="checkbox" bind:checked={settings.includeMedia} onchange={persist} />
        <span
          ><b>Images and videos</b>
          <span class="small">bigger, slower; up to 1.5 GB per export</span></span
        ></label
      >
      {#if noFormat}<p class="notice notice-sun">Pick at least one kind of file.</p>{/if}
    </section>

    <section class="card" id="comments">
      <h2 class="heading">Comments</h2>
      <label class="row"
        ><span>Order</span>
        <select bind:value={settings.commentSort} onchange={persist}>
          {#each COMMENT_SORTS as s (s)}<option value={s}>{SORT_LABEL[s]}</option>{/each}
        </select></label
      >
      <fieldset>
        <legend>On a single post</legend>
        <div class="radios">
          {#each [['top', 'Top', 25], ['100', 'Top 100', 100], ['all', 'All', null]] as const as [value, label, max] (value)}
            <label class="radio"
              ><input
                type="radio"
                name="single"
                checked={singleDepth === value}
                onchange={() => {
                  settings.postMaxComments = max;
                  persist();
                }}
              />{label}</label
            >
          {/each}
        </div>
      </fieldset>
    </section>

    <section class="card" id="subreddits">
      <h2 class="heading">Subreddits</h2>
      <label class="check"
        ><input type="checkbox" bind:checked={settings.deep} onchange={persist} />
        <span
          ><b>Find more than the 1,000 posts Reddit lists</b>
          <span class="small"
            >When you export "All": reads 8 lists (newest, top and controversial over several time
            ranges, hot) and keeps each post once. Finds several thousand posts on a big subreddit,
            though not every old one. Takes much longer.</span
          ></span
        ></label
      >
    </section>

    <section class="card" id="reddit">
      <h2 class="heading">On Reddit</h2>
      <label class="check"
        ><input type="checkbox" bind:checked={settings.showPageButton} onchange={persist} />
        <span
          ><b>Show Export beside Reddit's buttons</b>
          <span class="small"
            >Next to Share on a post and next to Join on a subreddit. Off, export with the toolbar
            button or Alt+Shift+E.</span
          ></span
        ></label
      >
      <label class="check"
        ><input
          type="checkbox"
          checked={!cloudTip.hidden}
          onchange={(e) => {
            cloudTip.hidden = !e.currentTarget.checked;
            persistCloudTip();
          }}
        />
        <span
          ><b>Show the cloud-version card while exporting</b>
          <span class="small"
            >About Reddit Scraper on Apify, a paid cloud service by the maker of {NAME}.</span
          ></span
        ></label
      >
      <p class="small">
        Change the keyboard shortcut in your browser's
        <a
          class="link"
          href={shortcutsUrl}
          onclick={(e) => {
            e.preventDefault();
            void browser.tabs.create({ url: shortcutsUrl });
          }}>extension shortcuts</a
        >.
      </p>
    </section>

    <details class="card" id="advanced">
      <summary class="heading">Advanced</summary>
      <fieldset>
        <legend>Speed</legend>
        <div class="radios">
          <label class="radio"
            ><input
              type="radio"
              name="speed"
              value="normal"
              bind:group={settings.speed}
              onchange={persist}
            />Normal</label
          >
          <label class="radio"
            ><input
              type="radio"
              name="speed"
              value="fast"
              bind:group={settings.speed}
              onchange={persist}
            />Fast</label
          >
        </div>
        <p class="small">
          {settings.speed === 'fast'
            ? 'Fast uses nearly all of what Reddit allows: Reddit may load slowly in your other tabs meanwhile. Biggest gain on exports under 10 minutes.'
            : 'Normal leaves a tenth of what Reddit allows for your own browsing.'}
        </p>
      </fieldset>
      <label class="row"
        ><span>Read from</span>
        <select bind:value={settings.backend} onchange={persist}>
          <option value="auto">Automatic</option>
          <option value="json">Reddit's API (logged in)</option>
          <option value="html">Reddit's web pages</option>
        </select></label
      >
      <p class="small">
        Something not working? <a class="link" href="/export.html#check"
          >Check the connection to Reddit</a
        >.
      </p>
    </details>
    <p class="small about">
      {FULL_NAME}
      Version {browser.runtime.getManifest().version}. Free and open source, not affiliated with
      Reddit.
    </p>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    background: var(--mist);
    color: var(--ink);
    font: 15px/1.5 var(--font-ui);
  }
  main {
    max-width: 640px;
    margin: 0 auto;
    padding: 28px 20px 64px;
    display: grid;
    gap: 16px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .title {
    margin: 8px 0 4px;
  }
  .card {
    padding: 20px 22px;
    display: grid;
    gap: 14px;
    scroll-margin-top: 16px;
  }
  .check {
    display: grid;
    grid-template-columns: 20px 1fr;
    gap: 12px;
    align-items: start;
    cursor: pointer;
  }
  .check .small {
    display: block;
  }
  input[type='checkbox'],
  input[type='radio'] {
    width: 18px;
    height: 18px;
    margin: 2px 0 0;
    accent-color: var(--brand);
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }
  select {
    font: 15px var(--font-ui);
    padding: 8px 10px;
    border: 1.5px solid var(--control);
    border-radius: var(--r-control);
    background: var(--paper);
    color: var(--ink);
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  legend {
    padding: 0;
    margin-bottom: 8px;
    font-weight: 650;
  }
  .radios {
    display: flex;
    flex-wrap: wrap;
    gap: 18px;
  }
  .radio {
    display: inline-flex;
    gap: 8px;
    align-items: center;
    cursor: pointer;
  }
  summary {
    cursor: pointer;
  }
  .about {
    text-align: center;
  }
  .saved {
    color: var(--mint-ink);
    font-weight: 650;
  }
</style>
