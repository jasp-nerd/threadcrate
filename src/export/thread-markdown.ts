// A thread as one readable Markdown file: the post, then the comments as nested
// lists. Good for reading offline, quoting, and pasting into an AI tool.
//
// Strangers wrote this text, and some Markdown viewers render raw HTML. So HTML
// is escaped outside code, and script links are defused. data.json and the CSV
// files keep the text exactly as Reddit had it.

import { walk, type Comment, type Post, type Thread } from '../reddit/model';

/** Plain text (titles, names, flair) made inert in Markdown. */
function text(s: string): string {
  return (
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, ' ')
      // No links, images or code: without brackets there is no link to follow.
      .replace(/[\\`[\]!]/g, '\\$&')
  );
}

/** Link targets a Markdown viewer may follow; anything else is defused. */
function safeTarget(raw: string): string {
  // Viewers decode entities and ignore whitespace and control characters in schemes.
  const decoded = raw
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&colon;/gi, ':')
    // Named whitespace entities, which viewers drop inside a scheme like any other.
    .replace(/&(?:tab|newline);/gi, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\s\u0000-\u001f]/g, '');
  const scheme = /^<?([a-z][a-z0-9+.-]*):/i.exec(decoded)?.[1]?.toLowerCase();
  return scheme && !['http', 'https', 'mailto'].includes(scheme) ? 'unsafe:blocked' : raw;
}

/** One stretch of Markdown outside fenced code: no raw HTML, no script links. */
function defuse(md: string): string {
  return (
    md
      // Every <, inline code included: backslash-escaped backticks make "code" that a
      // viewer renders as text, so telling them apart isn't safe.
      .replace(/</g, '&lt;')
      // Inline links and images: [text](target "title")
      .replace(
        /(\]\(\s*)([^\s()]*(?:\([^\s()]*\)[^\s()]*)*)/g,
        (_, open: string, target: string) => open + safeTarget(target),
      )
      // Reference definitions: [label]: target
      .replace(
        /^( {0,3}\[[^\]]+\]:[ \t]*)(\S+)/gm,
        (_, open: string, target: string) => open + safeTarget(target),
      )
  );
}

/**
 * A Markdown body made safe to render in viewers that allow raw HTML. Only fenced
 * code blocks (``` or ~~~ at the start of a line), whose content no viewer renders
 * as HTML, are left exactly as written.
 */
export function safeMarkdown(md: string): string {
  const out: string[] = [];
  let plain: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (plain.length) out.push(defuse(plain.join('\n')));
    plain = [];
  };
  for (const line of md.split('\n')) {
    if (fence === null) {
      const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      // A backtick fence's info string can't contain backticks.
      if (open && !(open[1]!.startsWith('`') && line.slice(open[0].length).includes('`'))) {
        flush();
        fence = open[1]!;
        out.push(line);
      } else plain.push(line);
    } else {
      out.push(line);
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1]![0] === fence[0] && close[1]!.length >= fence.length) fence = null;
    }
  }
  flush();
  return out.join('\n');
}

function when(iso: string | null): string {
  return iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : 'unknown date';
}

function points(n: number | null): string {
  if (n === null) return '';
  return `${n} ${Math.abs(n) === 1 ? 'point' : 'points'}`;
}

function user(name: string | null): string {
  return !name || name === '[deleted]' ? '[deleted]' : `u/${name}`;
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line.trim() ? pad + line : ''))
    .join('\n');
}

export function postHeader(post: Post): string {
  const meta = [
    post.subreddit ? `r/${text(post.subreddit)}` : '',
    text(user(post.author)),
    when(post.created_utc),
    points(post.score),
    post.num_comments === null ? '' : `${post.num_comments} comments`,
  ].filter(Boolean);
  const lines = [`# ${text(post.title)}`, '', meta.join(', '), '', `<${post.permalink}>`];
  if (!post.is_self && post.url && post.url !== post.permalink && /^https?:\/\//.test(post.url))
    lines.push('', `Link: <${post.url}>`);
  if (post.link_flair_text) lines.push('', `Flair: ${text(post.link_flair_text)}`);
  if (post.selftext) lines.push('', safeMarkdown(post.selftext));
  if (post.media.length) {
    lines.push('', '**Media**', '');
    for (const m of post.media)
      lines.push(`- ${m.type}: <${m.url}>${m.caption ? ` (${text(m.caption)})` : ''}`);
  }
  return lines.join('\n');
}

/** Deeper replies stay at this indent (with their depth noted), so files don't balloon. */
const MAX_INDENT_DEPTH = 30;

function commentBlock(c: Comment, out: string[]) {
  const pad = Math.min(c.depth, MAX_INDENT_DEPTH) * 2;
  const tags = [
    c.is_submitter ? 'OP' : '',
    c.distinguished ?? '',
    c.stickied ? 'pinned' : '',
    c.depth > MAX_INDENT_DEPTH ? `reply depth ${c.depth}` : '',
  ]
    .filter(Boolean)
    .map((t) => ` [${t}]`)
    .join('');
  const meta = [points(c.score), when(c.created_utc)].filter(Boolean).join(', ');
  out.push(`${' '.repeat(pad)}- **${text(user(c.author))}**${tags} (${meta})`);
  out.push('');
  out.push(indent(c.body ? safeMarkdown(c.body) : '*(no text)*', pad + 2));
  out.push('');
}

export function threadMarkdown(thread: Thread): string {
  const out = [postHeader(thread.post), '', '---', ''];
  const expected = thread.post.num_comments;
  const count =
    expected !== null && expected !== thread.comment_count
      ? `${thread.comment_count} of ${expected} comments`
      : `${thread.comment_count} comments`;
  out.push(`## Comments (${count})`, '');
  for (const c of walk(thread.comments)) commentBlock(c, out);
  if (thread.gaps.length) {
    const missing = thread.gaps.reduce((n, g) => n + (g.count ?? 0), 0);
    out.push(
      '---',
      '',
      `*${thread.gaps.length} part${thread.gaps.length === 1 ? '' : 's'} of this thread could not be loaded${missing ? ` (about ${missing} comments)` : ''}. See manifest.json.*`,
      '',
    );
  }
  return `${out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}
