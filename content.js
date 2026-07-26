(function () {
  const { detectSiteByLocation, writePreparedSourceList } = globalThis.JobChatContentCommon;
  let bossHookReady = false;
  const bossHookWaiters = [];

  function waitForBossHook() {
    if (bossHookReady) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('请登录或者刷新Boss直聘页')), 5000);
      bossHookWaiters.push(() => { clearTimeout(timeout); resolve(); });
    });
  }

  if (location.hostname.endsWith('zhipin.com')) {
    try {
      const injectHook = () => {
        const protocol = document.createElement('script');
        protocol.src = chrome.runtime.getURL('boss-message-protocol.js');
        const hook = document.createElement('script');
        hook.src = chrome.runtime.getURL('boss-hook.js');
        hook.onload = () => hook.remove();
        protocol.onload = () => { protocol.remove(); (document.documentElement || document.head).appendChild(hook); };
        (document.documentElement || document.head).appendChild(protocol);
      };
      if (document.documentElement || document.head) injectHook();
      else document.addEventListener('DOMContentLoaded', injectHook, { once: true });
    } catch (_) {}

    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (event.data?.source !== 'job-chat-recorder-boss-hook') return;
      const payload = event.data.payload || {};
      if (payload.type === 'BOSS_HOOK_READY') {
        bossHookReady = true;
        bossHookWaiters.splice(0).forEach((resolve) => resolve());
      }
      if (payload.type === 'BOSS_GEEK_FRIEND_LIST') {
        chrome.storage.local.set({ jobChatBossFriendListCapture: payload });
      }
      if (payload.type === 'BOSS_SEND_PROGRESS' || payload.type === 'BOSS_SEND_STARTED' || payload.type === 'BOSS_SEND_FINISHED' || payload.type === 'BOSS_SEND_ERROR') {
        chrome.runtime.sendMessage({ type: 'BOSS_SEND_PROGRESS', progress: payload });
      }
      if (payload.type === 'BOSS_SEND_STOPPED') chrome.runtime.sendMessage({ type: 'BOSS_SEND_PROGRESS', progress: payload });
      if (payload.type === 'BOSS_SEND_LOG') chrome.runtime.sendMessage({ type: 'BOSS_SEND_LOG', message: payload.message || '' });
    });
  }

  async function prepareByCurrentSite(siteKey) {
    const detected = detectSiteByLocation();
    if (siteKey === 'boss' && detected === 'boss') {
      const result = await globalThis.JobChatBossExtractor.prepare();
      await writePreparedSourceList('boss', result.list);
      return { pageTitle: document.title || '', pageUrl: location.href, total: 0, sourceTotal: result.needSync, sourceListTotal: result.list.length, syncSummary: result.syncSummary, records: [] };
    }
    if (siteKey === 'liepin' && detected === 'liepin') {
      const result = await globalThis.JobChatLiepinExtractor.prepare();
      await writePreparedSourceList('liepin', result.list);
      return { pageTitle: document.title || '', pageUrl: location.href, total: 0, sourceTotal: result.needSync, sourceListTotal: result.list.length, syncSummary: result.syncSummary, records: [] };
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
    if (message?.type === 'BOSS_SEND_BATCH') {
      if (!location.hostname.endsWith('zhipin.com')) { sendResponse({ ok: false, error: '当前标签页不是 BOSS直聘页面。' }); return; }
      globalThis.JobChatBossExtractor.prepareSendTargets(message.targets, message.ownerUserId)
        .then(async (targets) => {
          await waitForBossHook();
          window.postMessage({ source: 'job-chat-recorder-boss-content', command: { ...message, targets } }, '*');
          sendResponse({ ok: true, refreshedTargets: targets });
        })
        .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
      return true;
    }
    if (message?.type === 'BOSS_STOP_BATCH') {
      window.postMessage({ source: 'job-chat-recorder-boss-content', command: { type: 'BOSS_STOP_BATCH' } }, '*');
      sendResponse({ ok: true });
      return;
    }
    if (message?.type !== 'JOB_CHAT_EXTRACT_RECORDS' && message?.type !== 'BOSS_EXTRACT_CHAT_RECORDS') return;
    extractByCurrentSite(message?.siteKey)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  });
})();
