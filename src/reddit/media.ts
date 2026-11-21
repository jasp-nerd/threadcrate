import { mediaItem, type MediaItem, type MediaType } from './model';

const IMAGE_EXT = /\.(?:jpe?g|png|gif|webp|avif)$/i;

/** i.redd.it's original for a preview.redd.it image (previews are resized and signed). */
export function originalImageUrl(url: string): string {
  try {
    const u = new URL(url);
    if (
      u.hostname === 'preview.redd.it' &&
      IMAGE_EXT.test(u.pathname) &&
      !/\.gif$/i.test(u.pathname)
    ) {
      // Gallery previews are named "<title-slug>-v0-<media id>.jpeg"; the original is
      // i.redd.it/<media id>.jpeg (i.redd.it answers 403 for the slugged name).
      const named = /-v0-([a-z0-9]+\.[a-z0-9]+)$/i.exec(u.pathname);
      return `https://i.redd.it${named ? `/${named[1]}` : u.pathname}`;
    }
  } catch {
    // Keep whatever we were given.
  }
  return url;
}

/** "https://v.redd.it/<id>/HLSPlaylist.m3u8?…" or "https://v.redd.it/<id>" to "<id>". */
export function vredditId(url: string | null | undefined): string | null {
  return /^https:\/\/v\.redd\.it\/([a-z0-9]+)(?:[/?#]|$)/i.exec(url ?? '')?.[1] ?? null;
}

/** A v.redd.it video's playlists: they need no signature, so links to them don't expire. */
export function vredditStreams(id: string): { hls_url: string; dash_url: string } {
  return {
    hls_url: `https://v.redd.it/${id}/HLSPlaylist.m3u8`,
    dash_url: `https://v.redd.it/${id}/DASHPlaylist.mpd`,
  };
}

export function isDirectImage(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      (u.hostname === 'i.redd.it' ||
        u.hostname === 'i.imgur.com' ||
        u.hostname === 'preview.redd.it') &&
      IMAGE_EXT.test(u.pathname)
    );
  } catch {
    return false;
  }
}

interface JsonMediaMeta {
  status?: string;
  e?: string;
  m?: string;
  s?: { u?: string; gif?: string; mp4?: string; x?: number; y?: number };
}

interface JsonRedditVideo {
  fallback_url?: string;
  hls_url?: string;
  dash_url?: string;
  duration?: number;
  width?: number;
  height?: number;
  is_gif?: boolean;
}

interface JsonImage {
  source?: { url?: string; width?: number; height?: number };
  resolutions?: { url?: string; width?: number; height?: number }[];
}

export interface JsonPostMedia {
  is_self?: boolean;
  is_gallery?: boolean;
  is_video?: boolean;
  post_hint?: string;
  url?: string;
  url_overridden_by_dest?: string;
  thumbnail?: string;
  gallery_data?: { items?: { media_id: string; caption?: string }[] } | null;
  media_metadata?: Record<string, JsonMediaMeta> | null;
  secure_media?: { reddit_video?: JsonRedditVideo } | null;
  media?: { reddit_video?: JsonRedditVideo } | null;
  preview?: { images?: JsonImage[]; reddit_video_preview?: JsonRedditVideo } | null;
  poll_data?: unknown;
  crosspost_parent_list?: JsonPostMedia[];
}

/** What a post from Reddit's JSON API shows: its type and the media files in it. */
export function mediaFromJson(d: JsonPostMedia): { media_type: MediaType; media: MediaItem[] } {
  const own = mediaOf(d);
  if (own.media.length || !d.crosspost_parent_list?.length) return own;
  // A crosspost keeps its media on the original post.
  const parent = mediaOf(d.crosspost_parent_list[0]!);
  return parent.media.length ? parent : own;
}

/** Reddit's JSON escapes "&" in the URLs of `preview` (even with raw_json=1 in old posts). */
const unescapeUrl = (u: string | undefined): string | null => (u ? u.replace(/&amp;/g, '&') : null);

/**
 * A post's thumbnail from the JSON API: a resized preview about 640 px wide, else
 * the small `thumbnail` (whose "self", "default", "nsfw", "spoiler" and "" are
 * placeholders, not images). A crosspost's comes from the original.
 */
export function thumbnailFromJson(d: JsonPostMedia): string | null {
  const sized = (d.preview?.images?.[0]?.resolutions ?? []).filter((r) => r.url);
  const preview = sized.filter((r) => (r.width ?? 0) <= 640).pop() ?? sized[0];
  if (preview?.url) return unescapeUrl(preview.url);
  if (d.thumbnail && /^https:\/\//.test(d.thumbnail)) return unescapeUrl(d.thumbnail);
  const parent = d.crosspost_parent_list?.[0];
  return parent ? thumbnailFromJson(parent) : null;
}

function mediaOf(d: JsonPostMedia): { media_type: MediaType; media: MediaItem[] } {
  if (d.is_gallery && d.gallery_data?.items?.length && d.media_metadata) {
    const media: MediaItem[] = [];
    for (const item of d.gallery_data.items) {
      const meta = d.media_metadata[item.media_id];
      if (!meta || meta.status !== 'valid' || !meta.s) continue;
      const s = meta.s;
      if (s.mp4) media.push(galleryItem('video', s.mp4, s, item.caption));
      else if (s.gif) media.push(galleryItem('gif', s.gif, s, item.caption));
      else if (s.u) media.push(galleryItem('image', originalImageUrl(s.u), s, item.caption));
    }
    return { media_type: 'gallery', media };
  }
  const video = d.secure_media?.reddit_video ?? d.media?.reddit_video;
  if (d.is_video && video?.fallback_url) {
    return {
      media_type: 'video',
      media: [
        mediaItem(video.is_gif ? 'gif' : 'video', stripQuery(video.fallback_url), {
          width: video.width ?? null,
          height: video.height ?? null,
          duration: video.duration ?? null,
          hls_url: video.hls_url ? stripQuery(unescapeUrl(video.hls_url)!) : null,
          dash_url: video.dash_url ? stripQuery(unescapeUrl(video.dash_url)!) : null,
        }),
      ],
    };
  }
  if (d.poll_data) return { media_type: 'poll', media: [] };
  if (d.is_self) return { media_type: 'text', media: [] };
  const url = d.url_overridden_by_dest ?? d.url ?? '';
  if (d.post_hint === 'image' || isDirectImage(url)) {
    return {
      media_type: 'image',
      media: [mediaItem(/\.gif$/i.test(url) ? 'gif' : 'image', url)],
    };
  }
  return { media_type: 'link', media: [] };
}

function galleryItem(
  type: MediaItem['type'],
  url: string,
  s: { x?: number; y?: number },
  caption: string | undefined,
): MediaItem {
  return mediaItem(type, url, {
    width: s.x ?? null,
    height: s.y ?? null,
    caption: caption ?? null,
  });
}

function stripQuery(url: string): string {
  const i = url.indexOf('?');
  return i === -1 ? url : url.slice(0, i);
}

/**
 * The best track of a kind in a v.redd.it DASH playlist (DASHPlaylist.mpd), made
 * absolute against `base`. Reddit serves video and audio as separate files whose
 * names changed over the years (DASH_audio.mp4, DASH_AUDIO_128.mp4,
 * CMAF_AUDIO_128.mp4), so the playlist is read instead of guessing.
 */
function bestTrack(mpd: string, base: string, kind: 'video' | 'audio'): string | null {
  // The type is on the set, or on each of its representations.
  const ofKind = new RegExp(`contentType="${kind}"|mimeType="${kind}/`, 'i');
  let best: { url: string; bandwidth: number } | null = null;
  for (const set of mpd.split(/<AdaptationSet\b/i).slice(1)) {
    if (!ofKind.test(set)) continue;
    for (const rep of set.split(/<Representation\b/i).slice(1)) {
      const bandwidth = Number(/bandwidth="(\d+)"/i.exec(rep)?.[1] ?? 0);
      const baseUrl = /<BaseURL>([^<]+)<\/BaseURL>/i.exec(rep)?.[1]?.trim();
      if (baseUrl && (!best || bandwidth > best.bandwidth))
        best = { url: new URL(baseUrl, base).toString(), bandwidth };
    }
  }
  return best?.url ?? null;
}

/** The best video track of a v.redd.it video; `base` is the video's folder (v.redd.it/<id>/). */
export function videoUrlFromMpd(mpd: string, base: string): string | null {
  return bestTrack(mpd, base, 'video');
}

/** The audio track that goes with `videoUrl`, a track in the same folder. */
export function audioUrlFromMpd(mpd: string, videoUrl: string): string | null {
  return bestTrack(mpd, videoUrl.replace(/\/[^/]*$/, '/'), 'audio');
}
