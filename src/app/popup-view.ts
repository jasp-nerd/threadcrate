// What the toolbar popup shows for the current tab. Decided from the address
// alone: Reddit's markup changes often, its URLs hardly ever.
import { isRedditUrl, parseTarget, unsupportedReason, type Target } from '../reddit/target';

export type PopupView =
  /** Not a Reddit page (or no address: the browser's own pages). */
  | { kind: 'off-reddit' }
  /**
   * Reddit, but nothing this extension can export: the home feed, settings, chat.
   * `reason` says why when the page looks exportable but isn't (r/all, comment search).
   */
  | { kind: 'nothing'; url: string; reason: string | null }
  | { kind: 'target'; url: string; target: Target };

export function popupView(url: string | undefined): PopupView {
  if (!url || !isRedditUrl(url)) return { kind: 'off-reddit' };
  const target = parseTarget(url);
  return target
    ? { kind: 'target', url, target }
    : { kind: 'nothing', url, reason: unsupportedReason(url) };
}
