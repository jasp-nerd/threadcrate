// File and folder names that work on Windows, macOS and Linux, and inside ZIPs.

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** A safe single path segment. */
export function safeName(name: string, max = 80): string {
  let s = name
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  if ([...s].length > max)
    s = [...s]
      .slice(0, max)
      .join('')
      .trim()
      .replace(/[. ]+$/, '');
  if (!s || RESERVED.test(s.split('.')[0]!)) s = `_${s}`;
  return s;
}

/** "Why didn't Rome fall?" -> "why-didnt-rome-fall" (ASCII, for file names). */
export function slug(text: string, max = 50): string {
  const s = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const cut = s.length > max ? s.slice(0, max).replace(/-[^-]*$/, '') || s.slice(0, max) : s;
  return cut || 'untitled';
}

/** "2026-11-15_1830" in local time, for archive names. */
export function stamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}`;
}

/** Keeps every path in an archive unique by numbering repeats: a.md, a (2).md. */
export function uniquePaths() {
  const used = new Set<string>();
  return (path: string): string => {
    let candidate = path;
    const dot = path.lastIndexOf('.');
    const base = dot > path.lastIndexOf('/') ? path.slice(0, dot) : path;
    const ext = dot > path.lastIndexOf('/') ? path.slice(dot) : '';
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  };
}

/** A file extension for a media URL, from its path or else its content type. */
export function mediaExtension(url: string, contentType?: string | null): string {
  // Reddit serves GIFs converted to MP4 at .gif addresses (…/x.gif?format=mp4).
  const type = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  if (type === 'video/mp4') return 'mp4';
  try {
    if (new URL(url).searchParams.get('format') === 'mp4') return 'mp4';
    const m = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname);
    if (m) return m[1]!.toLowerCase();
  } catch {
    // Fall back to the content type.
  }
  return (
    {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'audio/mp4': 'm4a',
    }[type] ?? 'bin'
  );
}
