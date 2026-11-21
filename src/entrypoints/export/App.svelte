<script lang="ts">
  // The export tab: runs one export, shows it at work and how it ended, and hosts
  // the pages that need a tab of their own (welcome, export form, connection check).
  import { onDestroy, untrack } from 'svelte';
  import { browser } from 'wxt/browser';
  import { diagnosticsReport } from '../../engine/diagnostics';
  import { SteadyEta } from '../../engine/eta';
  import { loadJob, markJob } from '../../engine/jobs';
  import { parseOptions, type ExportOptions } from '../../engine/options';
  import {
    overallFraction,
    pause,
    phaseNote,
    plural,
    position,
    timeShare,
    type LogEntry,
  } from '../../engine/progress-view';
  import { resultCounts, type ExportResult } from '../../engine/result';
  import { runExport, type Progress } from '../../engine/run';
  import { saveZip } from '../../engine/save';
  import { createTabFetch } from '../../engine/tab-fetch';
  import { createWorkerSleep } from '../../engine/worker-sleep';
  import { archiveName, buildPackage } from '../../export/package';
  import { threadMarkdown } from '../../export/thread-markdown';
  import { popupView } from '../../app/popup-view';
  import { HOST_PERMISSIONS, REDDIT_TABS } from '../../hosts';
  import { sendMessage, type StartExportRequest } from '../../messaging';
  import { describeTarget } from '../../reddit/target';
  import { saveActivity, type Activity } from '../../storage/activity';
  import AppIcon from '../../ui/AppIcon.svelte';
  import { NAME } from '../../ui/brand';
  import ExportForm from '../../ui/ExportForm.svelte';
  import CheckConnection from './CheckConnection.svelte';
  import Receipt from './Receipt.svelte';
  import Running from './Running.svelte';
  import { clearBadge, resetIcon, showEnd, showProgress } from './toolbar';

  type View = 'loading' | 'new' | 'check' | 'missing' | 'permission' | 'again' | 'running' | 'done';

  const manifest = browser.runtime.getManifest();
  const tool = {
    name: manifest.name,
    version: manifest.version,
    homepage: (manifest as { homepage_url?: string }).homepage_url ?? '',
  };

  let view = $state<View>('loading');
  let options = $state<ExportOptions | null>(null);
  let sourceUrl = $state('');
  let progress = $state<Progress | null>(null);
  let result = $state<ExportResult | null>(null);
  let fileName = $state('');
  let downloadId = $state<number | null>(null);
  let saveError = $state('');
  let now = $state(Date.now());
  let controller: AbortController | null = null;
  let sourceTabId: number | undefined;
  let hasAccess = $state(true);
  let denied = $state(false);
  /** Set once the export has ended, so the progress badge can't come back over the final one. */
  let finishing = false;
  let checkSub = $state('AskReddit');
  let newUrl = $state('');
  let myTabId: number | null = null;
  const jobId = location.hash.slice(1);

  const tick = setInterval(() => (now = Date.now()), 1000);
  onDestroy(() => clearInterval(tick));

  async function init() {
    // Firefox grants host access only when asked; Chrome grants it at install.
    hasAccess = await browser.permissions.contains({ origins: HOST_PERMISSIONS.slice(0, 2) });
    // The welcome page has its own address now; this one may still be bookmarked.
    if (!jobId || jobId === 'about') {
      location.replace(browser.runtime.getURL('/welcome.html'));
      return;
    }
    // The export form, when the toolbar popup couldn't open (the page's Export button).
    if (jobId.startsWith('new')) {
      newUrl = new URLSearchParams(jobId.slice(3)).get('url') ?? '';
      view = 'new';
      return;
    }
    if (jobId.startsWith('check')) {
      checkSub = new URLSearchParams(jobId.slice(5)).get('r') ?? 'AskReddit';
      view = 'check';
      return;
    }
    const job = await loadJob(jobId);
    options = job ? parseOptions(job.options, job.url) : null;
    if (!job || !options) {
      view = 'missing';
      return;
    }
    sourceUrl = job.url;
    sourceTabId = job.tabId;
    if (!hasAccess) {
      view = 'permission';
      return;
    }
    // A reload, a duplicated tab or a restored one: ask before doing it all again.
    if (job.state) {
      view = 'again';
      return;
    }
    void start();
  }

  async function grant() {
    // The request must come first in the click handler, or Firefox refuses it.
    const ok = await browser.permissions.request({ origins: HOST_PERMISSIONS });
    denied = !ok;
    hasAccess = ok;
    if (ok && options) void start();
  }

  async function start() {
    if (!options) return;
    view = 'running';
    controller = new AbortController();
    await markJob(jobId, 'started').catch(() => undefined);
    // Chrome may discard background tabs to save memory, which would lose the export.
    const tab = await browser.tabs.getCurrent().catch(() => undefined);
    myTabId = tab?.id ?? null;
    if (tab?.id !== undefined)
      await browser.tabs.update(tab.id, { autoDiscardable: false }).catch(() => undefined);
    const locks = navigator.locks;
    const relay = createTabFetch({ preferredTabId: sourceTabId });
    const run = () =>
      runExport(options!, {
        fetch: relay.fetch,
        signal: controller!.signal,
        sleep: createWorkerSleep(),
        onProgress: (p) => (progress = p),
        onNote: (text) => note(text),
        // Two exports at once still send Reddit one request at a time between them,
        // per budget: the web pages and the API are rationed separately.
        exclusive: locks
          ? (job, signal, lane) =>
              locks.request(
                lane === 'api' ? 'threadcrate-requests-api' : 'threadcrate-requests',
                signal ? { signal } : {},
                job,
              )
          : undefined,
      });
    // Closing the tab stops the export: ask first.
    const leaving = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', leaving);
    try {
      // A held Web Lock keeps Chrome from freezing this tab while it sits in the background.
      const res: ExportResult = locks
        ? await locks.request(`threadcrate-tab-${crypto.randomUUID()}`, run)
        : await run();
      result = res;
      await save(res);
    } catch (e) {
      // runExport keeps its own errors in the result; this is for anything around it.
      saveError = e instanceof Error ? e.message : String(e);
    } finally {
      finishing = true;
      resetIcon();
      window.removeEventListener('beforeunload', leaving);
      await finished(tab?.id);
      await relay.close();
      await markJob(jobId, 'done').catch(() => undefined);
      if (tab?.id !== undefined)
        await browser.tabs.update(tab.id, { autoDiscardable: true }).catch(() => undefined);
      view = 'done';
      const r = result;
      announcement =
        !r || saveError
          ? 'Not saved'
          : r.status === 'complete'
            ? `Saved: ${resultCounts(r).posts} posts`
            : 'Stopped. What was collected is saved.';
    }
  }

  /** Badge, and a notification when the export ended while the person was elsewhere. */
  async function finished(tabId: number | undefined) {
    const r = result;
    const ok = r?.status === 'complete';
    await showEnd(ok);
    if (document.visibilityState === 'hidden' && tabId !== undefined) {
      const { posts, comments } = r ? resultCounts(r) : { posts: 0, comments: 0 };
      await browser.notifications
        .create(`threadcrate:${tabId}`, {
          type: 'basic',
          iconUrl: browser.runtime.getURL('/icons/icon-128.png'),
          title: saveError ? 'Export not saved' : ok ? 'Export finished' : 'Export stopped early',
          message: `${title}: ${posts} post${posts === 1 ? '' : 's'}, ${comments} comment${comments === 1 ? '' : 's'}${downloadId !== null && !saveError ? ' saved to your downloads' : ''}.`,
        })
        .catch(() => undefined);
    }
  }

  // Once the finished export has been seen, the badge has done its job.
  $effect(() => {
    if (view !== 'done') return;
    const clear = () => {
      if (document.visibilityState === 'visible') setTimeout(clearBadge, 4000);
    };
    clear();
    document.addEventListener('visibilitychange', clear);
    return () => document.removeEventListener('visibilitychange', clear);
  });

  async function save(r: ExportResult) {
    if (resultCounts(r).empty) return;
    const when = new Date();
    fileName = archiveName(r.options.target, when, r.threads[0]?.post ?? r.posts[0]);
    try {
      downloadId = await saveZip(buildPackage(r, tool, sourceUrl), fileName, when);
      saveError = '';
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e);
    }
  }

  function stop() {
    controller?.abort(new DOMException('Stopped', 'AbortError'));
  }

  async function copyMarkdown() {
    const t = result?.threads[0];
    if (t) await navigator.clipboard.writeText(threadMarkdown(t));
  }

  /** The run's decisions and failed answers, for a bug report. */
  async function copyDiagnostics() {
    if (!result) return;
    await navigator.clipboard.writeText(
      diagnosticsReport(result, `${tool.name} ${tool.version}`, navigator.userAgent),
    );
  }

  /** The check-connection page for this export's subreddit, in a new tab. */
  function openCheck() {
    const sub = options?.target.kind === 'subreddit' ? options.target.name : 'AskReddit';
    void browser.tabs.create({
      url: browser.runtime.getURL(`/export.html#check?r=${encodeURIComponent(sub)}`),
    });
  }

  /** From the export form on this page: the export gets a tab of its own, this one closes. */
  async function exportFromHere(request: StartExportRequest) {
    const tab = await browser.tabs.getCurrent().catch(() => undefined);
    const [reddit] = await browser.tabs.query({ url: REDDIT_TABS });
    await sendMessage('startExport', { ...request, tabId: reddit?.id });
    if (tab?.id !== undefined) await browser.tabs.remove(tab.id);
  }

  // Time left as shown: steadied, and only once there's enough to go on.
  const steady = new SteadyEta();
  let eta = $state<number | null>(null);
  let bar = $state(0);
  let log = $state<LogEntry[]>([]);
  let announcement = $state('');
  let lastPhase = '';
  let lastPause: string | null = null;

  const note = (text: string, announce = false) => {
    log = [...log, { at: Date.now(), text }].slice(-200);
    if (announce) announcement = text;
  };

  $effect(() => {
    // Runs on new progress and on the clock tick only: what it writes (eta, bar,
    // log) is read untracked, so it never sets itself off again.
    const p = progress;
    const t = now;
    if (!p || !options) return;
    untrack(() => follow(p, t, options!));
  });

  function follow(p: Progress, t: number, o: ExportOptions) {
    // Hide the estimate until the size of the job is known well enough: while
    // posts are still being found, only once a page of them is in.
    const settled =
      p.etaSeconds !== null &&
      p.rate.requests >= 2 &&
      (p.phase !== 'listing' || p.postsListed >= 25) &&
      t - p.startedAt >= 5_000;
    const paused = pause(p, t);
    // The model's estimate, counted down since it was made.
    const fresh = p.etaSeconds === null ? null : Math.max(0, p.etaSeconds - (t - p.etaAt) / 1000);
    const shown = settled ? steady.update(fresh, t, paused !== null && lastPause === null) : null;
    eta = shown;
    const share = timeShare({ ...p, etaSeconds: shown }, t, overallFraction(p, o) * 0.5);
    if (share > bar) bar = share;

    // The activity log, and what screen readers hear (phase changes and pauses only).
    if (p.phase !== lastPhase) {
      lastPhase = p.phase;
      note(phaseNote(p.phase, o), true);
    }
    const pauseKey = paused ? `${p.rate.reason}:${p.rate.waitingUntil}` : null;
    if (pauseKey !== lastPause) {
      if (paused) note(paused.title, true);
      else if (lastPause) note('Carrying on', true);
      lastPause = pauseKey;
    }
  }

  // A single post is named by its title once Reddit has told us what it is.
  const title = $derived(
    !options
      ? NAME
      : options.target.kind === 'post'
        ? result?.threads[0]?.post.title ||
          progress?.current?.title ||
          describeTarget(options.target)
        : describeTarget(options.target),
  );

  // The tab title and the toolbar badge, for following along from other tabs.
  $effect(() => {
    const pct = Math.round(bar * 100);
    const paused = progress ? pause(progress, now) : null;
    document.title =
      view === 'running'
        ? `${paused ? 'Paused:' : `${pct}%`} ${title}`
        : view === 'done'
          ? `${result?.status === 'complete' ? 'Done:' : 'Stopped:'} ${title}`
          : NAME;
    shareActivity();
    if (view === 'running' && !finishing) showProgress(bar, !!paused);
  });

  // What the toolbar popup shows about this export: at most once a second.
  let sharedAt = 0;
  function shareActivity() {
    if (view !== 'running' && view !== 'done') return;
    const t = Date.now();
    if (view === 'running' && t - sharedAt < 1000) return;
    sharedAt = t;
    const r = result;
    const counts = r && resultCounts(r);
    const paused = progress ? pause(progress, now) : null;
    const status: Activity['status'] =
      view === 'running'
        ? paused
          ? 'paused'
          : 'running'
        : !r || !counts || saveError || counts.empty
          ? 'failed'
          : r.status === 'complete'
            ? counts.missing
              ? 'partial'
              : 'done'
            : 'stopped';
    const line =
      view === 'running'
        ? `${progress && options ? position(progress, options) : 'Starting…'}${eta !== null ? `, about ${Math.max(1, Math.round(eta / 60))} min left` : ''}`
        : counts
          ? `${plural(counts.posts, 'post')}, ${plural(counts.comments, 'comment')}`
          : '';
    void saveActivity({
      jobId,
      tabId: myTabId,
      title,
      status,
      fraction: view === 'done' ? 1 : bar,
      line,
      downloadId,
      updatedAt: t,
    }).catch(() => undefined);
  }

  void init();
</script>

<main data-view={view} class:wide={view === 'running' || view === 'done'}>
  <header class="top">
    <span class="brand"
      ><AppIcon size={32} /><span class="brand-name"
        >{NAME} <span class="descriptor">for Reddit</span></span
      ></span
    >
  </header>

  {#if view === 'loading'}
    <p class="small">Loading…</p>
  {:else if view === 'new'}
    {@const v = popupView(newUrl)}
    <section class="card narrow">
      {#if v.kind === 'target'}
        <ExportForm
          url={v.url}
          target={v.target}
          info={null}
          onexport={exportFromHere}
          onsettings={(section) =>
            void browser.tabs.create({
              url: browser.runtime.getURL(`/options.html${section ? `#${section}` : ''}`),
            })}
        />
      {:else}
        <h1 class="heading">Nothing to export on that page</h1>
        <p class="small">
          {#if v.kind === 'nothing' && v.reason}{v.reason}{:else}Open a post, a subreddit, a profile
            or a search, then press Export.{/if}
        </p>
      {/if}
    </section>
  {:else if view === 'check'}
    <CheckConnection subreddit={checkSub} />
  {:else if view === 'missing'}
    <section class="card narrow">
      <h1 class="heading">This export is gone</h1>
      <p class="small">
        Exports don't survive a browser restart. Go back to the Reddit page and export it again.
      </p>
    </section>
  {:else if view === 'permission'}
    <section class="card narrow">
      <h1 class="heading">Allow access to Reddit</h1>
      <p class="small">
        To export {title}, the extension needs permission to load pages from reddit.com and its
        image hosts.
      </p>
      <div>
        <button class="btn btn-primary" type="button" onclick={grant}>Allow and start</button>
      </div>
      {#if denied}<p class="notice notice-rose">
          Access wasn't given, so the export can't start.
        </p>{/if}
    </section>
  {:else if view === 'again'}
    <section class="card narrow">
      <h1 class="heading">{title}</h1>
      <p class="small">
        This export already ran in this tab. Run it again? That reads everything from Reddit once
        more.
      </p>
      <div><button class="btn btn-primary" type="button" onclick={start}>Export again</button></div>
    </section>
  {:else if view === 'running' && options}
    <Running {title} {progress} {options} {eta} {bar} {now} {log} onstop={stop} />
  {:else if view === 'done' && !result}
    <section class="card narrow">
      <h1 class="heading">{title}</h1>
      <p class="notice notice-rose">Something went wrong: {saveError}</p>
    </section>
  {:else if view === 'done' && result}
    <Receipt
      {result}
      {title}
      {fileName}
      {downloadId}
      {saveError}
      onsave={() => save(result!)}
      oncopymarkdown={result.threads.length === 1 && options?.target.kind === 'post'
        ? copyMarkdown
        : null}
      oncopydiagnostics={copyDiagnostics}
      oncheck={openCheck}
      ontryagain={start}
    />
  {/if}
  <!-- What screen readers announce: phase changes, pauses, the end. Never ticking numbers. -->
  <div class="sr-only" role="status" aria-live="polite">{announcement}</div>
</main>

<style>
  :global(body) {
    margin: 0;
    background: var(--mist);
    color: var(--ink);
    font: 15px/1.5 var(--font-ui);
  }
  main {
    max-width: 680px;
    margin: 0 auto;
    padding: 20px 20px 64px;
  }
  main.wide {
    max-width: 1180px;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 56px;
    margin-bottom: 12px;
  }
  .narrow {
    padding: 28px;
    display: grid;
    gap: 14px;
  }
</style>
