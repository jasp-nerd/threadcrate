<script lang="ts">
  // The page a new install opens on, in three steps: what Threadcrate is and
  // promises, which files you want, and where the Export button is. The question
  // is on the left; a colour field with Kip shows what it means on the right.
  import { onMount, tick } from 'svelte';
  import { browser } from 'wxt/browser';
  import { HOST_PERMISSIONS } from '../../hosts';
  import type { Formats } from '../../engine/options';
  import { loadSettings, saveSettings } from '../../storage/settings';
  import AppIcon from '../../ui/AppIcon.svelte';
  import { NAME } from '../../ui/brand';
  import Icon from '../../ui/Icon.svelte';
  import Demo from './Demo.svelte';
  import Files from './Files.svelte';
  import FilesPreview from './FilesPreview.svelte';
  import Hello from './Hello.svelte';
  import Ready from './Ready.svelte';

  type Step = 'hello' | 'files' | 'ready';
  const STEPS: Step[] = ['hello', 'files', 'ready'];

  /** Each step's field: its colour, and which Kip, how tall. */
  const FIELDS: Record<Step, { tone: string; kip: string; height: number }> = {
    hello: { tone: 'field-ink', kip: 'wave', height: 400 },
    files: { tone: 'field-sun', kip: 'carry', height: 300 },
    ready: { tone: 'field-orange', kip: 'cheer', height: 230 },
  };

  let step = $state<Step>('hello');
  const field = $derived(FIELDS[step]);
  const index = $derived(STEPS.indexOf(step));

  let formats = $state<Formats>({ json: true, csv: true, markdown: true });
  let includeMedia = $state(false);
  let skipped = $state(false);
  let saveError = $state('');
  let saved: Promise<void> = Promise.resolve();

  // Firefox grants access to Reddit only when asked; Chrome grants it at install.
  let hasAccess = $state(true);
  let denied = $state(false);

  let question: HTMLElement;

  onMount(async () => {
    hasAccess = await browser.permissions.contains({ origins: HOST_PERMISSIONS.slice(0, 2) });
    const settings = await loadSettings();
    formats = { ...settings.formats };
    includeMedia = settings.includeMedia;
  });

  async function grant() {
    // The request must come first in the click handler, or Firefox refuses it.
    const ok = await browser.permissions.request({ origins: HOST_PERMISSIONS });
    denied = !ok;
    hasAccess = ok;
  }

  async function save() {
    saveError = '';
    try {
      const settings = await loadSettings();
      await saveSettings({ ...settings, formats: { ...formats }, includeMedia });
    } catch (error) {
      saveError = error instanceof Error ? error.message : String(error);
    }
  }

  async function show(next: Step) {
    step = next;
    if (next === 'ready' && !skipped) saved = save();
    await tick();
    // Screen readers and keyboards start at the question.
    question.querySelector('h1')?.focus();
  }

  /** The second click of a double-click would land on the next step's button: ignored. */
  const move = (to: () => Step | undefined) => (event: MouseEvent) => {
    const next = to();
    if (event.detail < 2 && next) void show(next);
  };
  const forward = () => STEPS[index + 1];
  const backward = () => {
    if (skipped) {
      skipped = false;
      return 'files';
    }
    return STEPS[index - 1];
  };
  const skip = () => {
    skipped = true;
    return 'ready' as const;
  };

  const nothingChosen = $derived(!formats.json && !formats.csv && !formats.markdown);

  async function openReddit(event: MouseEvent) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    await saved;
    location.assign('https://www.reddit.com/');
  }
</script>

<div class="ob">
  <main class="ob-main">
    <header class="ob-top">
      <span class="brand"><AppIcon size={32} /><span class="brand-name">{NAME}</span></span>
      <div class="top-right">
        <div class="steps" role="img" aria-label="Step {index + 1} of {STEPS.length}">
          {#each STEPS as s, i (s)}
            <i class:done={i < index} class:now={i === index}></i>
          {/each}
        </div>
        <button
          type="button"
          class="btn btn-text btn-sm"
          class:gone={step === 'ready'}
          onclick={move(skip)}>Skip</button
        >
      </div>
    </header>

    <div class="ob-q" bind:this={question}>
      {#if step === 'hello'}
        <Hello {hasAccess} {denied} ongrant={grant} />
      {:else if step === 'files'}
        <Files bind:formats bind:includeMedia />
      {:else}
        <Ready {saveError} />
      {/if}
    </div>

    <div class="ob-actions">
      {#if step === 'hello'}
        <button type="button" class="btn btn-primary btn-lg" onclick={move(forward)}
          >Get started<Icon name="arrowRight" /></button
        >
        <span class="small">Two quick steps</span>
      {:else}
        <button type="button" class="btn btn-light back" aria-label="Back" onclick={move(backward)}
          ><Icon name="arrowLeft" /></button
        >
        {#if step === 'files'}
          <button
            type="button"
            class="btn btn-primary btn-lg"
            disabled={nothingChosen}
            onclick={move(forward)}>Continue<Icon name="arrowRight" /></button
          >
          {#if nothingChosen}<span class="small">Pick at least one.</span>{/if}
        {:else}
          <a class="btn btn-primary btn-lg" href="https://www.reddit.com/" onclick={openReddit}
            >Go to reddit.com<Icon name="arrowRight" /></a
          >
        {/if}
      {/if}
    </div>
  </main>

  <aside class="ob-field {field.tone}">
    {#if step === 'hello'}
      <p class="greeting">Hi, I'm Kip.<br /><span>I pack Reddit threads into tidy files.</span></p>
    {:else if step === 'files'}
      <FilesPreview {formats} {includeMedia} />
    {:else}
      <Demo />
    {/if}
    <img
      class="kip kip-{step}"
      src="/kip/{field.kip}.webp"
      alt=""
      style:height="{field.height}px"
    />
    {#if step === 'ready'}
      <p class="caption">One click in the toolbar, or Export beside Share on any post.</p>
    {/if}
  </aside>
</div>

<style>
  :global(body) {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font: 400 15px/1.5 var(--font-ui);
    -webkit-font-smoothing: antialiased;
  }
  :global(*, *::before, *::after) {
    box-sizing: border-box;
  }

  .ob {
    min-height: 100vh;
    min-height: 100dvh;
    display: grid;
    grid-template-columns: minmax(0, 1fr) clamp(420px, 44vw, 760px);
    gap: 24px;
    padding: 24px;
  }
  .ob-main {
    display: grid;
    grid-template-rows: auto 1fr auto;
    gap: 24px;
    padding: 24px 40px 24px 48px;
    min-width: 0;
  }
  .ob-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    max-width: 572px;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
  .brand-name {
    font: 750 20px/1 var(--font-display);
    letter-spacing: -0.01em;
  }
  .top-right {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .gone {
    visibility: hidden;
  }
  .ob-q {
    display: grid;
    align-content: center;
    gap: 22px;
    max-width: 540px;
  }
  .ob-q :global(h1:focus) {
    outline: none;
  }
  .ob-q :global(.lead) {
    margin-top: -8px;
  }
  .ob-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 56px;
  }
  .back {
    padding: 0 22px;
  }

  /* Step dots; the current one is a stretched stitch, like the logo's. */
  .steps {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .steps i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--brand-pale);
    transition: width 0.2s var(--ease-out);
  }
  .steps i.done {
    background: var(--brand);
  }
  .steps i.now {
    width: 26px;
    height: 10px;
    border-radius: 5px;
    background: var(--brand);
  }

  .ob-field {
    border-radius: var(--r-field);
    position: relative;
    overflow: hidden;
    display: grid;
    place-items: end center;
    min-height: 520px;
  }
  .field-ink {
    background: #14202f;
  }
  .field-sun {
    background: #ffc43d;
  }
  .field-orange {
    background: #ff4500;
  }
  .kip {
    display: block;
    width: auto;
    max-height: calc(100vh - 220px);
    margin-bottom: -6px;
  }
  .kip-files {
    justify-self: end;
    margin-right: 36px;
  }
  .kip-ready {
    justify-self: start;
    margin-left: 32px;
  }
  .greeting {
    position: absolute;
    top: 40px;
    left: 44px;
    right: 44px;
    margin: 0;
    font: 800 32px/1.1 var(--font-display);
    letter-spacing: -0.02em;
    color: #fff;
  }
  .greeting span {
    color: #a9b6c7;
    font-weight: 600;
    font-size: 20px;
    letter-spacing: 0;
  }
  .caption {
    position: absolute;
    right: 40px;
    bottom: 40px;
    width: 220px;
    margin: 0;
    color: #fff;
    font-size: 15px;
    font-weight: 600;
    line-height: 1.4;
  }

  @media (max-height: 720px) {
    .ob-main {
      padding-top: 8px;
      padding-bottom: 8px;
      gap: 16px;
    }
  }
  @media (max-width: 960px) {
    .ob {
      grid-template-columns: minmax(0, 1fr);
    }
    .ob-field {
      display: none;
    }
    .ob-main {
      padding: 8px 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .steps i {
      transition: none;
    }
  }
</style>
