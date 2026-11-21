// Downloads the media files of exported posts: images, gallery images, and
// Reddit-hosted videos.
//
// v.redd.it serves DASH: the video file has no sound, and the sound is a separate
// file listed in the video's DASHPlaylist.mpd. We save both rather than pull in a
// video muxer; the web-page backend usually finds Reddit's "packaged" MP4, which
// has the sound in it, and needs neither.

import type { RedditClient } from '../reddit/client';
import { isAborted } from '../reddit/errors';
import { audioUrlFromMpd, videoUrlFromMpd } from '../reddit/media';
import type { Post } from '../reddit/model';
import { mediaExtension, safeName } from '../export/filenames';

export interface MediaFile {
  path: string;
  data: Uint8Array;
  source: string;
}

export interface MediaFailure {
  post_id: string;
  url: string;
  reason: string;
}

/** Hosts we have permission to fetch from. Anything else is listed, not downloaded. */
const HOSTS = /^(?:i|v|preview|external-preview|packaged-media)\.redd\.it$|^i\.imgur\.com$/;
/** Larger files are listed instead of packed: the ZIP is built in memory. */
const MAX_MEDIA_BYTES = 300 * 1024 * 1024;

export function downloadable(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && HOSTS.test(u.hostname);
  } catch {
    return false;
  }
}

/** v.redd.it/<id> for any v.redd.it URL, or null. */
export function vredditBase(url: string): string | null {
  const m = /^https:\/\/v\.redd\.it\/([a-z0-9]+)(?:\/|$)/i.exec(url);
  return m ? `https://v.redd.it/${m[1]}` : null;
}

/**
 * Downloads one post's media, one file at a time through the paced client, into
 * `out` as it goes, so a stopped export keeps what it already has. Failures are
 * collected, never thrown: only the user stopping the export stops this.
 */
export async function downloadPostMedia(
  post: Post,
  client: RedditClient,
  name: (path: string) => string,
  out: { files: MediaFile[]; failures: MediaFailure[] },
): Promise<void> {
  const prefix = `media/${safeName(post.subreddit || 'reddit', 40)}_${safeName(post.id, 16)}`;
  let n = 0;

  const save = async (url: string, label: string) => {
    if (!downloadable(url)) throw new Error('not on a Reddit or Imgur media host');
    const { data, type, url: final } = await client.bytes(url, MAX_MEDIA_BYTES);
    // Imgur answers a deleted image with a redirect to its "removed" picture.
    if (/^https:\/\/i\.imgur\.com\/removed\.(?:png|jpg)$/i.test(final))
      throw new Error('removed from Imgur');
    n++;
    out.files.push({
      path: name(`${prefix}_${n}${label}.${mediaExtension(url, type)}`),
      data,
      source: url,
    });
  };

  for (const item of post.media) {
    const url = item.url;
    try {
      if (!downloadable(url)) throw new Error('not on a Reddit or Imgur media host');
      const base = vredditBase(url);
      if (!base) {
        await save(url, '');
        continue;
      }
      // A DASH video: the picture and the sound are separate files.
      const isBare = url.replace(/\/$/, '') === base;
      let mpd: string | null = null;
      try {
        mpd = await client.html(`${base}/DASHPlaylist.mpd`);
      } catch (error) {
        if (isAborted(error) || isBare) throw error;
        // Without the playlist, the video we already know still plays, just silently.
      }
      const video = isBare ? videoUrlFromMpd(mpd ?? '', `${base}/`) : url;
      if (!video) throw new Error('no video track in the playlist');
      await save(video, '_video');
      const audio = mpd ? audioUrlFromMpd(mpd, video) : null;
      if (audio) await save(audio, '_audio');
    } catch (error) {
      if (isAborted(error)) throw error;
      out.failures.push({
        post_id: post.id,
        url,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** Files downloading at once. Media hosts are CDNs that Reddit's own pages load in parallel. */
export const MEDIA_WORKERS = 3;
/** Media per export; beyond it, files are listed in manifest.json, not downloaded. */
const MAX_TOTAL_MEDIA_BYTES = 1.5 * 1024 * 1024 * 1024;

export interface MediaQueue {
  /** Queues a finished post's media (nothing when media is off). */
  add(post: Post): void;
  /** Waits for every queued file; no more may be added after. */
  finish(): Promise<void>;
  requests(): number;
  throttles(): number;
}

/**
 * Downloads posts' media in the background while the export goes on, a few posts
 * at a time, each worker with its own paced client (one host can't be flooded by
 * one worker). Stopping the export stops the downloads; files already in stay.
 */
export function createMediaQueue(o: {
  enabled: boolean;
  makeClient: () => RedditClient;
  signal: AbortSignal;
  out: { files: MediaFile[]; failures: MediaFailure[] };
  /** A post's files are done (downloaded or failed), and how long that took. */
  onDone: (files: number, seconds: number) => void;
  now: () => number;
}): MediaQueue {
  const queue: Post[] = [];
  const clients: RedditClient[] = [];
  const waiting: (() => void)[] = [];
  let closed = false;
  let bytes = 0;
  const used = new Set<string>();
  const name = (path: string) => {
    let p = path;
    for (let i = 2; used.has(p); i++) p = path.replace(/(\.[^.]+)$/, ` (${i})$1`);
    used.add(p);
    return p;
  };
  const wake = () => {
    for (const w of waiting.splice(0)) w();
  };
  o.signal.addEventListener('abort', wake, { once: true });

  async function worker(client: RedditClient) {
    for (;;) {
      if (o.signal.aborted) return;
      const post = queue.shift();
      if (!post) {
        if (closed) return;
        await new Promise<void>((resolve) => waiting.push(resolve));
        continue;
      }
      const startedAt = o.now();
      // The ZIP is built in memory: past a total, list the files instead of packing them.
      if (bytes >= MAX_TOTAL_MEDIA_BYTES) {
        for (const m of post.media)
          o.out.failures.push({
            post_id: post.id,
            url: m.url,
            reason: 'export media limit reached',
          });
      } else {
        const before = o.out.files.length;
        try {
          await downloadPostMedia(post, client, name, o.out);
        } catch {
          // Stopped: what's in stays in.
          return;
        } finally {
          for (const f of o.out.files.slice(before)) bytes += f.data.byteLength;
        }
      }
      o.onDone(post.media.length, (o.now() - startedAt) / 1000);
    }
  }

  const workers: Promise<void>[] = [];
  return {
    add(post) {
      if (!o.enabled || closed || !post.media.length) return;
      queue.push(post);
      if (workers.length < MEDIA_WORKERS) {
        const client = o.makeClient();
        clients.push(client);
        workers.push(worker(client));
      }
      wake();
    },
    async finish() {
      closed = true;
      wake();
      await Promise.all(workers);
    },
    requests: () => clients.reduce((n, c) => n + c.status.requests, 0),
    throttles: () => clients.reduce((n, c) => n + c.status.throttles, 0),
  };
}
