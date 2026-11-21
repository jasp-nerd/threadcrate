<script lang="ts">
  // Shown beside a running export: the author's cloud version, for people who'd rather not
  // wait in a tab. Plain words for people who've never heard of Apify; every number is the
  // actor's own dated benchmark or Apify's published Free plan. Like the sibling's coffee
  // card: one clear button. It can be switched off in Settings.
  import { onMount } from 'svelte';
  import { cloudTipUrl, loadCloudTip, saveCloudTip } from '../../app/cloud-tip';
  import { NAME } from '../../ui/brand';

  let visible = $state(false);
  let pitch = $state(0);
  let shown = 0;

  const PITCHES = [
    {
      heading: 'Skip the wait next time',
      text: 'Reddit Scraper does this in the cloud. Paste the link, press Start, and download Excel a few seconds later, even with your laptop closed.',
      fact: 'No code needed',
    },
    {
      heading: 'Done in seconds, not minutes',
      text: "On Apify's servers, Reddit Scraper fetched 100 posts in 3.4 seconds in its own test. You get the same kind of file: Excel, CSV or JSON.",
      fact: '100 posts in 3.4 s',
    },
    {
      heading: 'Need this every week?',
      text: 'Reddit Scraper can run on a schedule and hand you the new posts as a spreadsheet, without your browser.',
      fact: 'Runs on a schedule',
    },
  ];
  const current = $derived(PITCHES[pitch % PITCHES.length]!);

  onMount(async () => {
    const state = await loadCloudTip();
    if (state.hidden) return;
    shown = state.shown;
    pitch = shown % PITCHES.length;
    visible = true;
    void saveCloudTip({ hidden: false, shown: shown + 1 });
  });
</script>

{#if visible}
  <aside class="cloud" aria-labelledby="cloud-title">
    <p class="maker">From the maker of {NAME}</p>
    <div class="who">
      <img src="/apify/reddit-scraper.webp" alt="" width="44" height="44" />
      <span>
        <b>Reddit Scraper</b>
        <span class="on"
          >on <img src="/apify/apify-mark.svg" alt="" width="14" height="14" />Apify</span
        >
      </span>
    </div>
    <h2 class="heading" id="cloud-title">{current.heading}</h2>
    <p>{current.text}</p>
    <ul class="facts">
      <li class="hot">5,000 posts free every month</li>
      <li>{current.fact}</li>
    </ul>
    <div class="actions">
      <a class="try" href={cloudTipUrl(pitch)} target="_blank" rel="noopener"
        >Try it free<span class="sr-only"> on Apify (opens a new tab)</span></a
      >
    </div>
    <p class="fine">
      Free: Apify gives $5 of credit every month, no credit card. {NAME} itself stays free.
    </p>
  </aside>
{/if}

<style>
  /* Its own dark field in both themes, so it reads as a separate offer, not part of the export. */
  .cloud {
    display: grid;
    gap: 10px;
    padding: 20px 22px;
    border-radius: var(--r-card);
    background: #14202f;
    color: #fff;
  }
  .maker {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: #8593a6;
  }
  /* On the dark theme's dark cards, a bluer field and an edge keep it apart. */
  @media (prefers-color-scheme: dark) {
    .cloud {
      background: #1b2a40;
      box-shadow: inset 0 0 0 1px #2c3e58;
    }
  }
  .who {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .who > img {
    border-radius: 11px;
    flex: none;
  }
  .who b {
    display: block;
    font: 750 16px/1.2 var(--font-display);
  }
  .on {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 13px;
    color: #a9b6c7;
  }
  h2 {
    margin: 6px 0 0;
    color: #fff;
  }
  p {
    margin: 0;
    font-size: 14px;
    line-height: 1.5;
    color: #c9d2de;
    text-wrap: pretty;
  }
  .facts {
    list-style: none;
    margin: 2px 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .facts li {
    height: 28px;
    padding: 0 12px;
    border-radius: var(--r-pill);
    background: rgb(255 255 255 / 10%);
    display: inline-flex;
    align-items: center;
    font-size: 13px;
    font-weight: 700;
  }
  .facts li.hot {
    background: #ff5a1f;
    color: #fff;
  }
  .actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 16px;
    margin-top: 6px;
  }
  .try {
    display: inline-flex;
    align-items: center;
    height: 42px;
    padding: 0 20px;
    border-radius: var(--r-pill);
    background: #fff;
    color: #14202f;
    font: 750 15px/1 var(--font-display);
    text-decoration: none;
    box-shadow: 0 3px 0 #9fb0c6;
    transition: transform 0.12s var(--ease-out);
  }
  .try:active {
    transform: translateY(2px);
    box-shadow: 0 1px 0 #9fb0c6;
  }
  .try:focus-visible {
    outline: 3px solid #8ab4f8;
    outline-offset: 2px;
  }
  .fine {
    font-size: 12px;
    color: #8593a6;
  }
</style>
