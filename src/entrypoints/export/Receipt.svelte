<script lang="ts">
  // How the export ended: what was saved and where, what's inside, what's
  // missing and why, and the likely fix when Reddit refused.
  import { browser } from 'wxt/browser';
  import { duration, plural } from '../../engine/progress-view';
  import { resultCounts, type ExportResult } from '../../engine/result';
  import Icon from '../../ui/Icon.svelte';

  interface Props {
    result: ExportResult;
    title: string;
    fileName: string;
    downloadId: number | null;
    saveError: string;
    onsave: () => void;
    oncopymarkdown: (() => Promise<void>) | null;
    oncopydiagnostics: () => Promise<void>;
    oncheck: () => void;
    ontryagain: () => void;
  }
  let {
    result,
    title,
    fileName,
    downloadId,
    saveError,
    onsave,
    oncopymarkdown,
    oncopydiagnostics,
    oncheck,
    ontryagain,
  }: Props = $props();

  const counts = $derived(resultCounts(result));
  const posts = $derived(counts.posts);
  const comments = $derived(counts.comments);
  const gaps = $derived(counts.gaps);
  const nothing = $derived(counts.empty);
  const missing = $derived(counts.missing);
  /** The band: green saved, yellow saved with parts missing or stopped, red not saved. */
  const tone = $derived(
    nothing || saveError ? 'rose' : result.status === 'complete' && missing === 0 ? 'mint' : 'sun',
  );
  const head = $derived(
    nothing
      ? 'Not saved'
      : saveError
        ? 'Collected, but not saved yet'
        : result.status === 'complete'
          ? missing
            ? 'Saved, some parts missing'
            : 'Saved'
          : result.status === 'stopped'
            ? 'Stopped, saved what it had'
            : 'Stopped early, saved what it had',
  );
  const took = $derived(duration(Date.parse(result.finishedAt) - Date.parse(result.startedAt)));
  const loggedOut = $derived(result.errorKind === 'login' || result.errorKind === 'forbidden');

  let copied = $state('');
  async function copy(what: string, action: () => Promise<void>) {
    await action();
    copied = what;
    setTimeout(() => (copied = ''), 2000);
  }
  // The outcome gets focus, so keyboard and screen-reader users land on it.
  let heading = $state<HTMLElement | null>(null);
  $effect(() => {
    heading?.focus();
  });
</script>

{#snippet report()}
  <details class="report">
    <summary class="label">For a bug report</summary>
    {#if result.errorUrl}
      <p class="small">
        Refused request: <span class="mono">{new URL(result.errorUrl).pathname}</span>
      </p>
    {/if}
    <div class="actions">
      <button
        class="btn btn-light btn-sm"
        type="button"
        onclick={() => copy('diagnostics', oncopydiagnostics)}
        >{copied === 'diagnostics' ? 'Copied' : 'Copy diagnostics'}</button
      >
      <button class="btn btn-text btn-sm" type="button" onclick={oncheck}
        >Check the connection</button
      >
    </div>
    <p class="small">
      Diagnostics list what the export decided and what Reddit answered when something went wrong.
      No cookies, no account name.
    </p>
  </details>
{/snippet}

<section class="band band-{tone} arrive">
  <span class="chip chip-{tone}">
    <Icon name={tone === 'mint' ? 'check' : tone === 'rose' ? 'x' : 'alert'} />{head}
  </span>
  <h1 class="display" class:long={title.length > 60} dir="auto" tabindex="-1" bind:this={heading}>
    {title}
  </h1>
  {#if nothing}
    <p class="lead">{result.error ?? 'Nothing was collected, so nothing was saved.'}</p>
    <div class="actions">
      {#if loggedOut}
        <a class="btn btn-dark btn-lg" href="https://www.reddit.com/login/" target="_blank"
          >Open Reddit to log in</a
        >
      {/if}
      <button class="btn btn-primary btn-lg" type="button" onclick={ontryagain}>Try again</button>
    </div>
    {@render report()}
  {:else if saveError}
    <p class="lead">Saving the ZIP failed: {saveError}</p>
    <div class="actions">
      <button class="btn btn-primary btn-lg" type="button" onclick={onsave}>Try saving again</button
      >
    </div>
  {:else}
    <p class="lead">
      {plural(posts, 'post')}{comments ? `, ${plural(comments, 'comment')}` : ''}{result.media
        .length
        ? `, ${plural(result.media.length, 'file')}`
        : ''}. Saved as <span class="mono file">{fileName}.zip</span> in your downloads.
    </p>
    <div class="actions">
      {#if downloadId !== null}
        <button
          class="btn btn-dark btn-lg"
          type="button"
          onclick={() => downloadId !== null && browser.downloads.show(downloadId)}
          ><Icon name="folder" />Show in folder</button
        >
      {/if}
      {#if oncopymarkdown}
        <button
          class="btn btn-light btn-lg"
          type="button"
          onclick={() => oncopymarkdown && copy('markdown', oncopymarkdown)}
          >{copied === 'markdown' ? 'Copied' : 'Copy as Markdown'}</button
        >
      {/if}
    </div>
  {/if}
  <!-- No mascot when nothing was saved: a face there reads as a joke. -->
  <img
    class="kip"
    hidden={tone === 'rose'}
    src={tone === 'mint' ? '/kip/cheer.webp' : '/kip/float.webp'}
    alt=""
    width="170"
  />
</section>

<div class="below">
  {#if !nothing}
    <section class="card part">
      <h2 class="heading">What's inside</h2>
      <dl class="rows">
        <div>
          <dt><Icon name="check" class="ok" />Posts</dt>
          <dd class="num">{posts.toLocaleString()}</dd>
        </div>
        <div>
          <dt><Icon name="check" class="ok" />Comments</dt>
          <dd class="num">{comments.toLocaleString()}</dd>
        </div>
        {#if result.options.includeMedia}
          <div>
            <dt><Icon name="check" class="ok" />Images and videos</dt>
            <dd class="num">{result.media.length.toLocaleString()}</dd>
          </div>
        {/if}
      </dl>
      <p class="small">Took {took} and {result.requests.toLocaleString()} requests to Reddit</p>
    </section>

    <section class="card part">
      <h2 class="heading">Open it with</h2>
      <dl class="rows files">
        {#if result.options.formats.csv}
          <div>
            <dt class="mono">posts.csv, comments.csv</dt>
            <dd>Excel, Google Sheets, pandas</dd>
          </div>
        {/if}
        {#if result.options.formats.markdown}
          <div>
            <dt class="mono">threads/*.md</dt>
            <dd>Any text editor, Obsidian, an AI chat</dd>
          </div>
        {/if}
        {#if result.options.formats.json}
          <div>
            <dt class="mono">data.json</dt>
            <dd>Code, scripts and AI tools</dd>
          </div>
        {/if}
      </dl>
    </section>
  {/if}

  {#if !nothing && (missing || result.status !== 'complete')}
    <section class="card part wide">
      <h2 class="heading">What's missing</h2>
      <ul class="missing">
        {#if result.status !== 'complete' && result.error}<li>{result.error}</li>{/if}
        {#if gaps}<li>
            {plural(gaps, 'part')} of comment threads could not be loaded (Reddit hides some deep replies
            and removed comments).
          </li>{/if}
        {#if result.postFailures.length}<li>
            {plural(result.postFailures.length, 'post')} failed to load.
          </li>{/if}
        {#if result.mediaFailures.length}<li>
            {plural(result.mediaFailures.length, 'image or video')} not downloaded.
          </li>{/if}
      </ul>
      <p class="small">manifest.json in the ZIP lists each one with the reason.</p>
      {#if result.status === 'failed'}{@render report()}{/if}
    </section>
  {/if}
</div>

<style>
  .band {
    position: relative;
    border-radius: var(--r-field);
    padding: 36px 220px 40px 44px;
    display: grid;
    gap: 14px;
    justify-items: start;
    overflow: hidden;
  }
  .band-mint {
    background: var(--mint-wash);
  }
  .band-sun {
    background: var(--sun-wash);
  }
  .band-rose {
    background: var(--rose-wash);
    padding-right: 44px;
  }
  .band .chip {
    background: var(--paper);
  }
  .display {
    overflow-wrap: anywhere;
  }
  .lead {
    color: var(--ink-2);
  }
  .file {
    font-weight: 650;
    color: var(--ink);
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 6px;
  }
  .kip {
    position: absolute;
    right: 32px;
    bottom: 0;
    height: auto;
    pointer-events: none;
  }
  .display {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .display.long {
    font-size: 32px;
  }
  .display:focus {
    outline: none;
  }
  .below {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-top: 16px;
  }
  .part {
    padding: 22px 24px;
    display: grid;
    gap: 10px;
    align-content: start;
  }
  .wide {
    grid-column: 1 / -1;
  }
  .rows {
    margin: 0;
    display: grid;
  }
  .rows div {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    border-top: 1px solid var(--line);
  }
  .rows div:first-child {
    border-top: 0;
  }
  .rows dt {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .rows dd {
    margin: 0;
    font-weight: 700;
  }
  .files dd {
    font-weight: 500;
    color: var(--ink-2);
    text-align: right;
  }
  .missing {
    margin: 0;
    padding-left: 20px;
    display: grid;
    gap: 6px;
  }
  details {
    display: grid;
    gap: 10px;
  }
  .band .report {
    margin-top: 6px;
  }
  summary {
    cursor: pointer;
  }
  @media (max-width: 720px) {
    .band {
      padding: 28px 24px 0;
    }
    .display,
    .display.long {
      font-size: 30px;
      overflow-wrap: break-word;
    }
    .kip {
      position: static;
      width: 120px;
      justify-self: end;
      margin-top: -8px;
    }
    .below {
      grid-template-columns: 1fr;
    }
  }
</style>
