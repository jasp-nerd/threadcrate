<script lang="ts">
  // The export choices for one Reddit page: what it is, at most two choices with
  // their time, and the Export button. Hosted by the toolbar popup, and by the
  // export page when the popup can't open (#new?url=…).
  import { onMount } from 'svelte';
  import {
    currentDepth,
    depthChoices,
    DEPTH_LABEL,
    optionsFor,
    postChoice,
    POST_CHOICES,
    summaryLine,
    withDepth,
    type CommentDepth,
  } from '../app/export-request';
  import { humanDuration, plannedSeconds, shortDuration } from '../engine/estimate';
  import { MAX_LISTING, serializeOptions } from '../engine/options';
  import type { PageInfo, StartExportRequest } from '../messaging';
  import { describeTarget, type Target } from '../reddit/target';
  import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '../storage/settings';
  import Icon from './Icon.svelte';

  interface Props {
    url: string;
    target: Target;
    /** What the page shows about it, when the Reddit tab answered. */
    info: PageInfo | null;
    onexport: (request: StartExportRequest) => Promise<void>;
    onsettings: (section?: string) => void;
  }
  let { url, target, info, onexport, onsettings }: Props = $props();

  let settings = $state<Settings>(structuredClone(DEFAULT_SETTINGS));
  let loaded = $state(false);
  let starting = $state(false);
  let error = $state('');
  onMount(() => {
    void loadSettings().then((s) => {
      settings = s;
      loaded = true;
    });
  });

  const single = $derived(target.kind === 'post');
  /** Comments per post on this page: the post's own count, or the page's average. */
  const typical = $derived(single ? (info?.comments ?? null) : (info?.typicalComments ?? null));
  const options = $derived(optionsFor(settings, target));
  const secondsFor = (patch: Partial<Settings>) =>
    plannedSeconds(optionsFor({ ...settings, ...patch }, target), typical);

  const depth = $derived(currentDepth(settings, target));
  /** A single post has no choices unless it's big enough for "all" to take a while. */
  const askDepth = $derived(!single || (typical ?? 0) > 2000);
  const noun = $derived(
    target.kind === 'user' ? 'items' : target.kind === 'search' ? 'results' : 'posts',
  );

  function persist(next: Settings) {
    settings = next;
    void saveSettings($state.snapshot(settings));
  }

  async function start(e: MouseEvent) {
    // Only a person's click starts an export, never a script.
    if (!e.isTrusted || starting) return;
    starting = true;
    error = '';
    try {
      await onexport({ url, options: serializeOptions(options) });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      starting = false;
    }
  }

  const headline = $derived(
    single
      ? (info?.title ??
          (target.kind === 'post' && target.subreddit
            ? `A thread in r/${target.subreddit}`
            : 'This thread'))
      : describeTarget(target),
  );
  const subline = $derived.by(() => {
    if (single) {
      const where = target.kind === 'post' && target.subreddit ? `r/${target.subreddit}` : 'Post';
      return info?.comments != null
        ? `${where}, ${info.comments.toLocaleString()} comments`
        : info?.title
          ? where
          : 'Every comment';
    }
    if (target.kind === 'subreddit') return 'Subreddit';
    if (target.kind === 'user') return 'Posts and comments';
    return target.kind === 'search' && target.subreddit ? `In r/${target.subreddit}` : 'Search';
  });
  const buttonLabel = $derived(
    single
      ? 'Export thread'
      : `Export ${postChoice(settings.maxPosts) === MAX_LISTING ? 'all' : postChoice(settings.maxPosts)} ${noun}`,
  );
  const time = $derived(humanDuration(secondsFor({})));
  const DEPTH_HINT: Record<CommentDepth, string> = {
    none: 'Just the posts. Fastest.',
    top: 'The comments a post shows first, about 25.',
    '100': 'The best 100 comments of each post.',
    all: 'Every comment and reply. Big threads take longest.',
  };
</script>

<div class="form" class:loading={!loaded}>
  <div class="target">
    <p class="heading what" dir="auto">{headline}</p>
    <p class="small">{subline}</p>
  </div>

  {#if !single}
    <div class="field">
      <span class="label" id="posts-label">{noun[0]!.toUpperCase() + noun.slice(1)}</span>
      <div class="seg" role="group" aria-labelledby="posts-label">
        {#each POST_CHOICES as n (n)}
          <button
            type="button"
            aria-pressed={postChoice(settings.maxPosts) === n}
            onclick={() => persist({ ...settings, maxPosts: n })}
          >
            {n === MAX_LISTING ? 'All' : n}
            <small>{shortDuration(secondsFor({ maxPosts: n }))}</small>
          </button>
        {/each}
      </div>
      <p class="small">
        {#if postChoice(settings.maxPosts) === MAX_LISTING && target.kind === 'subreddit' && settings.deep}
          All combines several of Reddit's lists to find more than 1,000 posts.
          <button class="link" type="button" onclick={() => onsettings('subreddits')}>Change</button
          >
        {:else}
          Reddit lists up to about 1,000 {noun}{target.kind === 'subreddit' ? ' a list' : ''}.
          {#if target.kind === 'subreddit'}
            <button class="link" type="button" onclick={() => onsettings('subreddits')}
              >Find more</button
            >{/if}
        {/if}
      </p>
    </div>
  {/if}

  {#if askDepth}
    <div class="field">
      <span class="label" id="depth-label">{single ? 'Comments' : 'Comments per post'}</span>
      <div class="seg" role="group" aria-labelledby="depth-label">
        {#each depthChoices(target) as d (d)}
          <button
            type="button"
            aria-pressed={depth === d}
            onclick={() => persist(withDepth(settings, target, d))}
          >
            {DEPTH_LABEL[d]}
            <small>{shortDuration(secondsFor(withDepth(settings, target, d)))}</small>
          </button>
        {/each}
      </div>
      <p class="small">{DEPTH_HINT[depth]}</p>
    </div>
  {/if}

  {#if error}<p class="notice notice-rose" role="alert"><Icon name="alert" />{error}</p>{/if}

  <button
    class="btn btn-primary btn-lg btn-block"
    type="button"
    disabled={starting}
    onclick={start}
  >
    <Icon name="download" />{starting ? 'Opening…' : buttonLabel}
  </button>

  <div class="mode">
    <span>{summaryLine(settings)}</span>
    <button class="link" type="button" onclick={() => onsettings('files')}>Change</button>
  </div>
  <p class="small time">
    {time[0]!.toUpperCase() + time.slice(1)}{typical === null ? ' (an estimate)' : ''}. It runs in
    its own tab; keep browsing.
  </p>
</div>

<style>
  .form {
    display: grid;
    gap: 14px;
  }
  /* The remembered choices arrive a moment after opening: no flash of the defaults. */
  .form.loading {
    visibility: hidden;
  }
  .target {
    display: grid;
    gap: 2px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--mist-2);
  }
  .what {
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .field {
    display: grid;
    gap: 8px;
  }
  .mode {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    font-size: 13px;
    color: var(--ink-2);
  }
  .mode .link {
    color: var(--ink);
    font-weight: 650;
    text-decoration: none;
  }
  .mode .link:hover {
    text-decoration: underline;
  }
  .time {
    margin-top: -6px;
  }
</style>
