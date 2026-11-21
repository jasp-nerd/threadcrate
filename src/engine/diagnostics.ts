// What an export records for a bug report: its decisions, the answers that went
// wrong, and where its requests went. "Copy diagnostics" on the end screen copies
// it; the counts by kind also go into manifest.json.

import type { AnswerInfo } from '../reddit/client';
import type { ExportResult } from './result';

export type Diagnostic =
  { at: number; kind: 'note'; text: string } | ({ kind: 'answer' } & AnswerInfo);

/** Enough for a report, and bounded however long the export runs. */
const MAX_ENTRIES = 400;
/** Answers kept even when they went well: the start says most about how Reddit treats us. */
const FIRST_ANSWERS = 8;

export function createDiagnostics(now: () => number, onNote?: (text: string) => void) {
  const entries: Diagnostic[] = [];
  const byKind = new Map<string, number>();
  let answers = 0;
  return {
    entries,
    /** A decision or problem, also shown in the activity log as it happens. */
    note: (text: string) => {
      if (entries.length < MAX_ENTRIES) entries.push({ at: now(), kind: 'note', text });
      onNote?.(text);
    },
    /** One answer from Reddit: counted by kind, and kept when it went wrong. */
    answer: (a: AnswerInfo) => {
      const kind = requestKind(a.url, a.method);
      byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
      answers++;
      if ((answers <= FIRST_ANSWERS || a.preview !== undefined) && entries.length < MAX_ENTRIES)
        entries.push({ kind: 'answer', ...a });
      if (a.preview !== undefined)
        onNote?.(
          `Reddit answered ${a.status} to ${new URL(a.url).pathname} (${a.via === 'direct' ? 'sent directly' : 'through the Reddit tab'})`,
        );
    },
    /** Requests by kind, the most frequent first. */
    requestsByKind: (): Record<string, number> =>
      Object.fromEntries([...byKind].sort((a, b) => b[1] - a[1])),
  };
}

/** A request's kind, for the count of requests by kind. */
export function requestKind(url: string, method: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'other';
  }
  const p = u.pathname;
  if (p.startsWith('/svc/shreddit/more-comments/'))
    return u.searchParams.get('top-level') === '1' ? 'more comments' : 'more replies';
  if (p.startsWith('/svc/shreddit/community-more-posts/')) return 'listing pages';
  if (p.startsWith('/svc/shreddit/comments/')) return 'comment trees';
  if (/\/search\/?$/.test(p) || p.startsWith('/svc/shreddit/search')) return 'search pages';
  if (p.startsWith('/api/morechildren')) return 'API more comments';
  if (p.startsWith('/api/info')) return 'API comments by id';
  if (p.startsWith('/api/me')) return 'API who am I';
  if (/^\/comments\/[a-z0-9]+\/_\//i.test(p)) return 'API comment subtrees';
  if (/\.json$/.test(p)) return /\/comments\//.test(p) ? 'API threads' : 'API other';
  if (/\/comments\/[a-z0-9]+\/comment\//i.test(p)) return 'comment pages';
  if (/\/comments\/[a-z0-9]+\//i.test(p)) return 'post pages';
  if (/^\/r\/[^/]+\/?$/.test(p)) return 'subreddit pages';
  if (/^\/r\/[^/]+\/s\//.test(p)) return 'share links';
  return method === 'GET' ? 'other' : `other ${method}`;
}

/** The report "Copy diagnostics" puts on the clipboard, for a bug report. */
export function diagnosticsReport(r: ExportResult, tool: string, browser: string): string {
  return JSON.stringify(
    {
      tool,
      browser,
      status: r.status,
      error: r.error,
      failedRequest: r.errorUrl,
      readFrom: r.backend,
      options: {
        ...r.options,
        maxComments: Number.isFinite(r.options.maxComments) ? r.options.maxComments : 'all',
      },
      requests: r.requests,
      diagnostics: r.diagnostics,
    },
    null,
    2,
  );
}
