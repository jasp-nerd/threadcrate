<script lang="ts">
  // A running or just-finished export, in the popup: how far it is, or how it
  // ended, and a way back to its tab or its file.
  import { browser } from 'wxt/browser';
  import type { Activity } from '../storage/activity';
  import Icon from './Icon.svelte';
  import Logo from './Logo.svelte';

  let {
    activity,
    ondismiss,
    compact = false,
  }: { activity: Activity; ondismiss: () => void; compact?: boolean } = $props();

  const running = $derived(activity.status === 'running' || activity.status === 'paused');
  const HEAD: Record<Activity['status'], string> = {
    running: 'Exporting',
    paused: 'Waiting for Reddit',
    done: 'Saved',
    partial: 'Saved, some parts missing',
    stopped: 'Stopped early, saved what it had',
    failed: 'Not saved',
  };

  async function showTab() {
    if (activity.tabId === null) return;
    const tab = await browser.tabs.update(activity.tabId, { active: true }).catch(() => null);
    if (tab?.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true });
    window.close();
  }

  function showFile() {
    if (activity.downloadId !== null) browser.downloads.show(activity.downloadId);
  }
</script>

{#if compact && !running}
  <!-- Beside the export form: one row, so the popup stays under 600 px. -->
  <section class="card activity row" class:done={activity.status === 'done'}>
    <span class="mark small-mark {activity.status}">
      <Icon
        name={activity.status === 'done' ? 'check' : activity.status === 'failed' ? 'x' : 'alert'}
      />
    </span>
    <div class="text">
      <p class="label">{HEAD[activity.status]}</p>
      <p class="what">{activity.title}</p>
    </div>
    {#if activity.downloadId !== null}
      <button class="btn btn-icon" type="button" aria-label="Show in folder" onclick={showFile}
        ><Icon name="folder" /></button
      >
    {/if}
    <button class="btn btn-icon" type="button" aria-label="Dismiss" onclick={ondismiss}
      ><Icon name="x" /></button
    >
  </section>
{:else}
  <section class="card activity" class:done={activity.status === 'done'}>
    <div class="top">
      {#if running}
        <Logo size={32} progress={activity.fraction} waiting={activity.status === 'paused'} />
      {:else}
        <span class="mark {activity.status}">
          <Icon
            name={activity.status === 'done'
              ? 'check'
              : activity.status === 'failed'
                ? 'x'
                : 'alert'}
          />
        </span>
      {/if}
      <div class="text">
        <p class="label">{HEAD[activity.status]}</p>
        <p class="what">{activity.title}</p>
      </div>
      {#if !running}
        <button class="btn btn-icon close" type="button" aria-label="Dismiss" onclick={ondismiss}
          ><Icon name="x" /></button
        >
      {/if}
    </div>
    {#if running}
      <span class="bar" class:waiting={activity.status === 'paused'}
        ><i style:--p={activity.fraction}></i></span
      >
    {/if}
    <p class="small num">{activity.line}</p>
    <div class="actions">
      {#if !running && activity.downloadId !== null}
        <button class="btn btn-dark btn-sm" type="button" onclick={showFile}
          ><Icon name="folder" />Show in folder</button
        >
      {/if}
      {#if activity.tabId !== null}
        <button class="btn btn-text btn-sm" type="button" onclick={showTab}
          >{running ? 'Show progress' : 'Details'}</button
        >
      {/if}
    </div>
  </section>
{/if}

<style>
  .activity {
    padding: 12px 14px;
    display: grid;
    gap: 8px;
  }
  .top {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 12px;
    align-items: center;
  }
  .text {
    min-width: 0;
  }
  .text p {
    margin: 0;
  }
  .what {
    font-weight: 650;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mark {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--sun-wash);
    color: var(--sun-ink);
  }
  .mark.done {
    background: var(--mint-wash);
    color: var(--mint-ink);
  }
  .mark.failed {
    background: var(--rose-wash);
    color: var(--rose-ink);
  }
  .row {
    grid-template-columns: auto 1fr auto auto;
    align-items: center;
    gap: 10px;
    padding: 8px 8px 8px 12px;
  }
  .small-mark {
    width: 28px;
    height: 28px;
  }
  .close {
    margin: -6px -8px 0 0;
  }
  .actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .actions:empty {
    display: none;
  }
  .small {
    margin: 0;
  }
</style>
