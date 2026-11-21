import { defineBackground } from '#imports';
import { browser } from 'wxt/browser';
import { saveJob } from '../engine/jobs';
import { onMessage } from '../messaging';

export default defineBackground(() => {
  // Exports run in their own tab: they survive closing or navigating the Reddit tab,
  // and an extension page can parse HTML, which the service worker can't.
  onMessage('startExport', async ({ data, sender }) => {
    // From the page's own button the sender is the Reddit tab; from the popup, it says which.
    const senderTab = (sender as { tab?: { id?: number } }).tab;
    const tabId = senderTab?.id ?? data.tabId;
    const tab = tabId !== undefined ? await browser.tabs.get(tabId).catch(() => null) : null;
    const id = await saveJob({
      url: data.url,
      options: data.options,
      createdAt: Date.now(),
      tabId,
    });
    await browser.tabs.create({
      url: browser.runtime.getURL(`/export.html#${id}`),
      // Next to the Reddit tab, so it's easy to find and close.
      index: tab ? tab.index + 1 : undefined,
      openerTabId: tab?.id,
    });
  });

  // The Export button on Reddit pages opens the toolbar popup. Browsers that can't
  // open it from code (Firefox before 149, an unfocused window) get the same form in a tab.
  onMessage('openPopup', async ({ data, sender }) => {
    const tab = (sender as { tab?: { id?: number; windowId?: number; index: number } }).tab;
    try {
      if (tab?.windowId !== undefined)
        await browser.windows.update(tab.windowId, { focused: true });
      await browser.action.openPopup();
    } catch {
      await browser.tabs.create({
        url: browser.runtime.getURL(`/export.html#new?url=${encodeURIComponent(data.url)}`),
        index: tab ? tab.index + 1 : undefined,
        openerTabId: tab?.id,
      });
    }
  });

  // Once, after install: how it works, and what it does and doesn't do with your data.
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install')
      void browser.tabs.create({ url: browser.runtime.getURL('/welcome.html') });
  });

  // "Export finished" notifications bring back the export's tab.
  browser.notifications.onClicked.addListener((id) => {
    const tabId = Number(/^threadcrate:(\d+)$/.exec(id)?.[1]);
    if (!Number.isInteger(tabId)) return;
    void (async () => {
      const tab = await browser.tabs.update(tabId, { active: true }).catch(() => undefined);
      if (tab?.windowId !== undefined)
        await browser.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
    })();
    void browser.notifications.clear(id);
  });

  // An export tab closed mid-export leaves its percentage on the toolbar icon:
  // clear it once no export tab is left.
  browser.tabs.onRemoved.addListener(() => {
    void browser.tabs
      .query({ url: browser.runtime.getURL('/export.html') + '*' })
      .then((tabs) => {
        if (!tabs.length) return browser.action.setBadgeText({ text: '' });
      })
      .catch(() => undefined);
  });
});
