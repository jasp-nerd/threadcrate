<script lang="ts">
  // The export at work: the logo's stitches fill, a big percentage, the time
  // left, what it's loading now. Details (Reddit's limits, the log) fold away.
  import type { ExportOptions } from '../../engine/options';
  import {
    clock,
    count,
    pause,
    position,
    slowAnswer,
    keptSoFar,
    timeLeft,
    type LogEntry,
  } from '../../engine/progress-view';
  import type { Progress } from '../../engine/run';
  import Icon from '../../ui/Icon.svelte';
  import Logo from '../../ui/Logo.svelte';
  import CloudCard from './CloudCard.svelte';

  interface Props {
    title: string;
    progress: Progress | null;
    options: ExportOptions;
    /** Seconds left as shown (steadied); null while estimating. */
    eta: number | null;
    /** 0–1, never backwards. */
    bar: number;
    now: number;
    log: LogEntry[];
    onstop: () => void;
  }
  let { title, progress, options, eta, bar, now, log, onstop }: Props = $props();

  const DETAILS_KEY = 'threadcrate.details-open';
  let detailsOpen = $state(readDetails());
  function readDetails(): boolean {
    try {
      return localStorage.getItem(DETAILS_KEY) === '1';
    } catch {
      return false;
    }
  }
  $effect(() => {
    try {
      localStorage.setItem(DETAILS_KEY, detailsOpen ? '1' : '0');
    } catch {
      // Storage off: the section just starts closed next time.
    }
  });

  const paused = $derived(progress ? pause(progress, now) : null);
  const left = $derived(timeLeft(eta, new Date(now)));
  const where = $derived(progress ? position(progress, options) : 'Starting…');
  const pct = $derived(Math.round(bar * 100));
  const slow = $derived(progress ? slowAnswer(progress, now) : false);
  const time = (t: number) =>
    new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const current = $derived(
    progress?.current?.title && options.target.kind !== 'post' && progress.phase !== 'listing'
      ? progress.current.title
      : null,
  );
  const single = $derived(options.target.kind === 'post');
  /** What stopping now would keep: "Keeps 12 posts, 340 comments". */
  const kept = $derived(keptSoFar(progress));
  const comments = $derived((progress?.commentsTotal ?? 0) + (progress?.loadingComments ?? 0));
  const files = $derived(
    [
      options.formats.json && 'JSON',
      options.formats.csv && 'CSV',
      options.formats.markdown && 'Markdown',
      options.includeMedia && 'images and videos',
    ]
      .filter(Boolean)
      .join(', '),
  );
</script>

<div class="layout" data-paused={paused ? 'true' : 'false'}>
  <section class="card main">
    <div class="hero">
      <Logo size={168} progress={bar} waiting={!!paused} />
      <div class="numbers">
        <p class="pct num" aria-hidden="true">{pct}%</p>
        <h1 class="title" dir="auto">{title}</h1>
        {#if paused}
          <p class="headline paused"><Icon name="clock" />{paused.title}</p>
          <p class="small explain">{paused.detail}</p>
        {:else}
          <p class="headline num">
            {left.text}{#if left.finish}<span class="finish">, {left.finish}</span>{/if}
          </p>
        {/if}
      </div>
    </div>

    <div
      class="bar"
      class:waiting={!!paused}
      role="progressbar"
      aria-label="Export progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext="{where}. {paused ? paused.title : left.text}"
    >
      <i style:--p={bar}></i>
    </div>
    <p class="position num">{where}</p>
    {#if current}
      <p class="now well"><Icon name="file" /><span dir="auto">{current}</span></p>
    {/if}
    {#if slow && !paused}
      <p class="small">Reddit is slow to answer right now…</p>
    {/if}

    <div class="foot">
      <div class="foot-text">
        <p class="notice notice-sun">
          <Icon name="alert" /><span
            ><b>Keep this tab open:</b> closing it stops the export. Browse anywhere else meanwhile; you'll
            get a notification when it's done.</span
          >
        </p>
        <div class="stop">
          <button class="btn btn-light" type="button" onclick={onstop}>Stop and save</button>
          <span class="small num">{kept}</span>
        </div>
      </div>
      <img class="kip" src="/kip/carry.webp" alt="" width="150" />
    </div>
  </section>

  <aside>
    <section class="card side">
      <h2 class="heading">In this export</h2>
      <dl class="counts">
        {#if !single}
          <div>
            <dt>Posts found</dt>
            <dd class="num">{count(progress?.postsListed ?? 0)}</dd>
          </div>
        {/if}
        {#if single || options.includeComments}
          <div>
            <dt>Comments</dt>
            <dd class="num">{count(comments)}</dd>
          </div>
        {/if}
        {#if options.includeMedia}
          <div>
            <dt>Images and videos</dt>
            <dd class="num">
              {count(progress?.mediaDone ?? 0)}{#if progress?.mediaTotal}<span class="of"
                  >&nbsp;of {count(progress.mediaTotal)}</span
                >{/if}
            </dd>
          </div>
        {/if}
      </dl>
    </section>

    <CloudCard />

    <section class="card side saving">
      <h2 class="heading">Saving to</h2>
      <p class="file"><Icon name="folder" /><span>Downloads, as one ZIP</span></p>
      <p class="small">{files}</p>
    </section>

    <details class="card side" bind:open={detailsOpen}>
      <summary class="heading">Details</summary>
      <dl class="details">
        {#if progress?.apiRate && progress.apiRate.remaining !== null}
          <div>
            <dt>Reddit's API limit</dt>
            <dd class="num">
              {count(Math.floor(progress.apiRate.remaining))} of {count(
                progress.apiRate.limit ?? 0,
              )} left{progress.apiRate.resetAt
                ? `, resets in ${clock((progress.apiRate.resetAt - now) / 1000)}`
                : ''}
            </dd>
          </div>
        {/if}
        {#if progress?.rate.remaining !== null && progress?.rate.remaining !== undefined}
          <div>
            <dt>
              {progress?.apiRate?.remaining != null ? "Reddit's web-page limit" : "Reddit's limit"}
            </dt>
            <dd class="num">
              {count(Math.floor(progress.rate.remaining))} of {count(progress.rate.limit ?? 0)} left{progress
                .rate.resetAt
                ? `, resets in ${clock((progress.rate.resetAt - now) / 1000)}`
                : ''}
            </dd>
          </div>
        {/if}
        <div>
          <dt>Requests</dt>
          <dd class="num">
            {count((progress?.rate.requests ?? 0) + (progress?.apiRate?.requests ?? 0))} made{progress &&
            progress.requestsLeft > 0
              ? `, about ${count(progress.requestsLeft)} to go`
              : ''}
          </dd>
        </div>
        <div>
          <dt>Reading from</dt>
          <dd>
            {progress?.backend === 'json'
              ? "Reddit's web pages and API"
              : progress?.backend === 'html'
                ? "Reddit's web pages"
                : '…'}
            at {options.speed === 'fast' ? 'fast' : 'normal'} speed
          </dd>
        </div>
        {#if progress}
          <div>
            <dt>Started</dt>
            <dd class="num">{time(progress.startedAt)}</dd>
          </div>
        {/if}
      </dl>
      {#if log.length}
        <ol class="log" aria-label="Activity">
          {#each log.slice(-12).reverse() as e (e.at + e.text)}
            <li><time class="num">{time(e.at)}</time> {e.text}</li>
          {/each}
        </ol>
      {/if}
    </details>
  </aside>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
    gap: 20px;
    align-items: start;
  }
  .main {
    border-radius: var(--r-field);
    padding: 32px 36px 0;
    display: grid;
    gap: 16px;
    overflow: hidden;
  }
  .hero {
    display: grid;
    grid-template-columns: 168px 1fr;
    gap: 28px;
    align-items: center;
  }
  .numbers {
    display: grid;
    gap: 8px;
    min-width: 0;
  }
  .pct {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 72px;
    line-height: 0.95;
    letter-spacing: -0.03em;
    color: var(--brand);
  }
  [data-paused='true'] .pct {
    color: var(--sun-ink);
  }
  .title {
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .headline {
    margin: 0;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    font-size: 17px;
    font-weight: 650;
    color: var(--ink-2);
  }
  .headline.paused {
    color: var(--sun-ink);
  }
  .finish {
    font-weight: 450;
    color: var(--ink-3);
  }
  .position {
    margin: -4px 0 0;
    font-weight: 600;
  }
  .now {
    margin: 0;
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 12px 16px;
    font-size: 14px;
    color: var(--ink-2);
    min-width: 0;
  }
  .now span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .foot {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 16px;
    align-items: end;
    margin-top: 4px;
  }
  .foot-text {
    display: grid;
    gap: 14px;
    padding-bottom: 28px;
  }
  .notice {
    margin: 0;
  }
  .stop {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
  }
  .kip {
    height: auto;
    margin: 0 -4px 20px 0;
    pointer-events: none;
  }
  aside {
    display: grid;
    gap: 16px;
  }
  .side {
    padding: 20px 22px;
    display: grid;
    gap: 10px;
  }
  .counts {
    margin: 0;
    display: grid;
  }
  .counts div {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    min-height: 40px;
    border-top: 1px solid var(--line);
  }
  .counts div:first-child {
    border-top: 0;
  }
  .counts dt {
    color: var(--ink-2);
  }
  .counts dd {
    margin: 0;
    font-weight: 700;
    font-size: 17px;
  }
  .of {
    font-weight: 500;
    color: var(--ink-3);
    font-size: 15px;
  }
  .saving {
    background: var(--mist);
    box-shadow: none;
  }
  .file {
    margin: 0;
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 12px 14px;
    border-radius: var(--r-choice);
    background: var(--paper);
    font-weight: 650;
  }
  .file :global(svg) {
    color: var(--ink-2);
  }
  summary {
    cursor: pointer;
  }
  .details {
    display: grid;
    gap: 8px;
    margin: 4px 0 0;
    font-size: 14px;
  }
  .details dt {
    color: var(--ink-3);
    font-size: 13px;
  }
  .details dd {
    margin: 0;
  }
  .log {
    list-style: none;
    margin: 4px 0 0;
    padding: 10px 12px;
    background: var(--mist);
    border-radius: var(--r-control);
    font-size: 13px;
    display: grid;
    gap: 4px;
    max-height: 220px;
    overflow: auto;
  }
  .log time {
    color: var(--ink-3);
    margin-right: 6px;
  }
  @media (max-width: 860px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 560px) {
    .main {
      padding: 22px 20px 0;
    }
    .hero {
      grid-template-columns: 1fr;
      justify-items: start;
    }
    .hero :global(.logo) {
      width: 96px;
      height: 96px;
    }
    .pct {
      font-size: 56px;
    }
    .kip {
      width: 110px;
    }
  }
</style>
