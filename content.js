(function () {
  if (globalThis.__JOB_CHAT_CONTENT_INSTALLED__) return;
  globalThis.__JOB_CHAT_CONTENT_INSTALLED__ = true;

  const { detectSiteByLocation, writePreparedSourceList } = globalThis.JobChatContentCommon;

  if (location.hostname.endsWith('zhipin.com')) {
    try {
      const injectHook = () => {
        const hook = document.createElement('script');
        hook.src = chrome.runtime.getURL('boss-hook.js');
        hook.onload = () => hook.remove();
        (document.documentElement || document.head).appendChild(hook);
      };
      if (document.documentElement || document.head) injectHook();
      else document.addEventListener('DOMContentLoaded', injectHook, { once: true });
    } catch (_) {}

    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (event.data?.source !== 'job-chat-recorder-boss-hook') return;
      const payload = event.data.payload || {};
      if (payload.type === 'BOSS_GEEK_FRIEND_LIST') {
        chrome.storage.local.set({ jobChatBossFriendListCapture: payload });
      }
    });
  }

  async function prepareByCurrentSite(siteKey) {
    const detected = detectSiteByLocation();
    if (siteKey === 'boss' && detected === 'boss') {
      const result = await globalThis.JobChatBossExtractor.prepare();
      await writePreparedSourceList('boss', result.list);
      return { pageTitle: document.title || '', pageUrl: location.href, total: 0, sourceTotal: result.needSync, sourceListTotal: result.list.length, records: [] };
    }
    if (siteKey === 'liepin' && detected === 'liepin') {
      const result = await globalThis.JobChatLiepinExtractor.prepare();
      await writePreparedSourceList('liepin', result.list);
      return { pageTitle: document.title || '', pageUrl: location.href, total: 0, sourceTotal: result.needSync, sourceListTotal: result.list.length, records: [] };
    }
    return extractByCurrentSite(siteKey);
  }

  async function extractByCurrentSite(siteKey) {
    const detected = detectSiteByLocation();
    if (siteKey === 'boss' && detected === 'boss') return globalThis.JobChatBossExtractor.extract();
    if (siteKey === 'liepin' && detected === 'liepin') return globalThis.JobChatLiepinExtractor.extract();
    if (detected === 'boss') return globalThis.JobChatBossExtractor.extract();
    if (detected === 'liepin') return globalThis.JobChatLiepinExtractor.extract();
    throw new Error('暂不支持当前网站。目前支持 zhipin.com（BOSS直聘）、liepin.com（猎聘）。');
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'JOB_CHAT_PREPARE_SYNC') {
      prepareByCurrentSite(message?.siteKey)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
      return true;
    }
    if (message?.type !== 'JOB_CHAT_EXTRACT_RECORDS' && message?.type !== 'BOSS_EXTRACT_CHAT_RECORDS') return;
    extractByCurrentSite(message?.siteKey)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  });
})();
