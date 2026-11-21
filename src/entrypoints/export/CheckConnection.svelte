<script lang="ts">
  import { untrack } from 'svelte';
  import { browser } from 'wxt/browser';
  import { runChecks, type CheckResult } from '../../engine/connection-check';

  interface Props {
    subreddit: string;
  }
  let { subreddit }: Props = $props();

  // Starts from the page it was opened for; then it's the person's to edit.
  let sub = $state(untrack(() => subreddit));
  let running = $state(false);
  let results = $state<CheckResult[]>([]);
  let copied = $state(false);

  async function run() {
    running = true;
    results = [];
    try {
      await runChecks(
        sub.replace(/^r\//, '').trim() || 'AskReddit',
        (r) => (results = [...results, r]),
      );
    } finally {
      running = false;
    }
  }

  async function copy() {
    const manifest = browser.runtime.getManifest();
    const report = {
      tool: `${manifest.name} ${manifest.version}`,
      browser: navigator.userAgent,
      at: new Date().toISOString(),
      results,
    };
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<section class="card">
  <p class="eyebrow">Check connection</p>
  <h1>Which ways of reading Reddit work here</h1>
  <p class="soft">
    Tries each way once (about ten requests) and shows what Reddit answers. Keep a reddit.com tab
    open; most checks go through it. Nothing is downloaded or kept.
  </p>
  <div class="row">
    <label>
      Subreddit
      <input bind:value={sub} placeholder="AskReddit" disabled={running} />
    </label>
    <button class="primary" type="button" onclick={run} disabled={running}>
      {running ? 'Checking…' : 'Check'}
    </button>
    {#if results.length && !running}
      <button class="secondary" type="button" onclick={copy}>
        {copied ? 'Copied' : 'Copy the results'}
      </button>
    {/if}
  </div>
  {#if results.length}
    <ol class="results">
      {#each results as r (r.name)}
        <li class:ok={r.ok}>
          <span class="mark" aria-hidden="true">{r.ok ? '✓' : '✗'}</span>
          <div>
            <p>
              <b>{r.name}</b>
              <span class="soft">({r.why})</span>
            </p>
            <p class="soft small">
              {r.ok ? 'Works' : "Doesn't work"}, {r.status ?? 'no status'}, {r.via === 'tab'
                ? 'through the Reddit tab'
                : r.via === 'page'
                  ? 'opened as a page'
                  : 'from the extension'}{r.rateLimit ? `, ${r.rateLimit}` : ''}
            </p>
            {#if !r.ok && r.preview}<p class="preview">{r.preview}</p>{/if}
          </div>
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  .card {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .eyebrow {
    margin: 0;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--brand);
  }
  h1 {
    margin: 0;
    font-size: 22px;
  }
  p {
    margin: 0;
  }
  .soft {
    color: var(--ink-3);
  }
  .small {
    font-size: 13px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 8px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--ink-3);
  }
  input {
    font: 15px var(--font-ui);
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--paper);
    color: var(--ink);
  }
  .primary,
  .secondary {
    border-radius: 10px;
    padding: 9px 14px;
    font-weight: 650;
    cursor: pointer;
  }
  .primary {
    border: 0;
    background: var(--brand);
    color: #fff;
  }
  .secondary {
    border: 1px solid var(--line);
    background: var(--paper);
    color: var(--ink);
  }
  .results {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  li {
    display: flex;
    gap: 10px;
  }
  .mark {
    flex: none;
    width: 1.2em;
    font-weight: 700;
    color: var(--rose-ink);
  }
  li.ok .mark {
    color: var(--mint-ink);
  }
  .preview {
    margin-top: 4px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink-3);
    overflow-wrap: anywhere;
  }
</style>
