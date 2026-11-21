// Every message between the extension's parts, typed in one place.
import { defineExtensionMessaging } from '@webext-core/messaging';

export interface StartExportRequest {
  /** The Reddit page the export is for. */
  url: string;
  /** ExportOptions, serialized with serializeOptions(). */
  options: string;
  /** The Reddit tab it's for, when sent from the popup (from a tab, the sender says). */
  tabId?: number;
}

/** What the Reddit page itself shows about the export's target, for the popup. */
export interface PageInfo {
  url: string;
  /** A post's title, on a post page. */
  title: string | null;
  /** A post's comment count, on a post page. */
  comments: number | null;
  /** The average comment count of the posts the page shows, on a listing. */
  typicalComments: number | null;
}

/** A request a Reddit tab makes for the export tab (see engine/tab-fetch.ts). */
export interface RelayRequest {
  /** Names the request, so the export tab can abort it (relayAbort). */
  id: string;
  url: string;
  method: 'GET' | 'POST';
  body?: string;
  headers: Record<string, string>;
  /** The page the request is made from (a post's address for "more comments"). */
  referrer?: string;
}

export interface RelayResponse {
  status: number;
  url: string;
  headers: [string, string][];
  text: string;
}

interface ProtocolMap {
  /** Popup (or the page's Export button) → background: open an export tab for this page. */
  startExport(data: StartExportRequest): void;
  /** The page's Export button → background: open the toolbar popup (or a tab with the same form). */
  openPopup(data: { url: string }): void;
  /** Popup → content script: what the page shows about the post or listing. */
  pageInfo(): PageInfo;
  /** Export tab → content script: are you there and on www.reddit.com? */
  relayReady(): boolean;
  /** Export tab → content script: fetch this reddit.com URL from the page, with its cookies. */
  relayFetch(data: RelayRequest): RelayResponse;
  /** Export tab → content script: the export gave up on this request (stopped, timed out). */
  relayAbort(id: string): void;
  /** Check-connection page → content script: the start of this page's text (for a .json page opened as a page). */
  pageText(): { url: string; text: string };
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();
