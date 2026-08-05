(function () {
  const { detectSiteByLocation, writePreparedSourceList } = globalThis.JobChatContentCommon;
  let bossHookReady = false;
  let jobDetailRefreshStopRequested = false;
  let jobDetailRefreshAbortController = null;
  const bossHookWaiters = [];
  const bossPageRequestWaiters = new Map();
  let bossPageRequestSequence = 0;

  function waitForBossHook() {
    if (bossHookReady) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('请登录或者刷新Boss直聘页')), 5000);
      bossHookWaiters.push(() => { clearTimeout(timeout); resolve(); });
    });
  }

  function bossPageRequest(url, init = {}) {
    return waitForBossHook().then(() => new Promise((resolve, reject) => {
      const requestId = `boss-page-request-${Date.now()}-${bossPageRequestSequence += 1}`;
      const signal = init.signal;
      const timeoutMs = Math.max(1000, Number(init.timeoutMs || 30000));
      if (signal?.aborted) {
        const error = new Error('已停止同步。');
        error.name = 'AbortError';
        reject(error);
        return;
      }
      let timeout = null;
      const cleanup = () => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
      };
      const stopRequest = (error) => {
        const waiter = bossPageRequestWaiters.get(requestId);
        if (!waiter) return;
        bossPageRequestWaiters.delete(requestId);
        cleanup();
        window.postMessage({
          source: 'job-chat-recorder-boss-content',
          command: { type: 'BOSS_PAGE_REQUEST_ABORT_V3', requestId }
        }, '*');
        reject(error);
      };
      const onAbort = () => {
        const error = new Error('已停止同步。');
        error.name = 'AbortError';
        stopRequest(error);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      bossPageRequestWaiters.set(requestId, {
        resolve,
        reject,
        cleanup
      });
      timeout = setTimeout(() => {
        const error = new Error(`BOSS 页面请求等待响应超时（${Math.round(timeoutMs / 1000)} 秒）。`);
        error.name = 'TimeoutError';
        stopRequest(error);
      }, timeoutMs);
      window.postMessage({
        source: 'job-chat-recorder-boss-content',
        command: {
          type: 'BOSS_PAGE_REQUEST_V3',
          requestId,
          url: String(url),
          method: String(init.method || 'GET'),
          headers: init.headers || {},
          body: init.body ?? null
        }
      }, '*');
    }));
  }

  if (location.hostname.endsWith('zhipin.com')) {
    globalThis.JobChatBossPageRequest = bossPageRequest;
  }

  if (location.hostname.endsWith('zhipin.com')) {
    try {
      const injectHook = () => {
        const protocol = document.createElement('script');
        protocol.src = chrome.runtime.getURL('src/boss-message-protocol.js');
        const hook = document.createElement('script');
        hook.src = chrome.runtime.getURL('src/boss-hook.js');
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
      if (payload.type === 'BOSS_PAGE_REQUEST_RESULT_V3') {
        const waiter = bossPageRequestWaiters.get(payload.requestId);
        if (waiter) {
          bossPageRequestWaiters.delete(payload.requestId);
          waiter.cleanup();
          if (payload.ok) waiter.resolve(payload.result);
          else {
            const error = new Error(payload.errorMessage || 'BOSS 页面请求失败。');
            error.name = payload.errorName || 'Error';
            waiter.reject(error);
          }
        }
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
    const adapter = globalThis.JobChatSiteAdapters?.get(siteKey);
    if (siteKey === detected && typeof adapter?.prepareSync === 'function') {
      const result = await adapter.prepareSync();
      await writePreparedSourceList(siteKey, result.list, {
        ...(result.syncSummary || {}),
        sourceTotal: Number(result.needSync || 0)
      });
      return { pageTitle: document.title || '', pageUrl: location.href, total: 0, sourceTotal: result.needSync, sourceListTotal: result.list.length, syncSummary: result.syncSummary, records: [] };
    }
    return extractByCurrentSite(siteKey);
  }

  async function extractByCurrentSite(siteKey, options = {}) {
    const detected = detectSiteByLocation();
    const adapter = globalThis.JobChatSiteAdapters?.get(siteKey === detected ? siteKey : detected);
    if (typeof adapter?.extractRecords === 'function') return adapter.extractRecords(options);
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
    if (message?.type === 'LIEPIN_SEND_BATCH') {
      if (!location.hostname.endsWith('liepin.com')) {
        sendResponse({ ok: false, error: '当前标签页不是猎聘页面。' });
        return;
      }
      try {
        const data = globalThis.JobChatLiepinExtractor.startSendBatch(
          message.targets,
          message.message,
          message.rate
        );
        sendResponse({ ok: true, ...data });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
      return;
    }
    if (message?.type === 'LIEPIN_STOP_BATCH') {
      globalThis.JobChatLiepinExtractor?.stopSendBatch();
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === 'JOB_CHAT_REFRESH_RECORDS') {
      const detected = detectSiteByLocation();
      const adapter = globalThis.JobChatSiteAdapters?.get(detected);
      if (!adapter?.supportsJobDetail || typeof adapter.refreshRecords !== 'function') {
        sendResponse({ ok: false, error: `${detected === 'liepin' ? '猎聘' : '当前网站'}暂不支持更新岗位详情。` });
        return;
      }
      jobDetailRefreshStopRequested = false;
      const abortController = new AbortController();
      jobDetailRefreshAbortController = abortController;
      adapter.refreshRecords(message.records || [], {
        forceChat: true,
        forceJobDetail: message.forceJobDetail === true,
        rate: message.rate,
        retryDelaySeconds: message.retryDelaySeconds,
        retryCount: message.retryCount,
        riskRetryAttempt: message.riskRetryAttempt,
        riskRetryAttempts: message.riskRetryAttempts,
        allowRiskReload: message.allowRiskReload,
        shouldStop: () => jobDetailRefreshStopRequested,
        signal: abortController.signal,
        onProgress: (progress) => chrome.runtime.sendMessage({
          type: 'JOB_CHAT_REFRESH_PROGRESS',
          progress: { ...progress, storageScope: message.storageScope, runId: message.runId }
        }),
        onLog: message.debugLog ? (entry) => chrome.runtime.sendMessage({
          type: 'JOB_CHAT_LOG_EVENT',
          logType: 'summary',
          entry: { time: new Date().toISOString(), ...entry }
        }).catch(() => {}) : undefined
      })
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) => sendResponse(abortController.signal.aborted
          ? { ok: true, data: { records: [], results: [], stopped: true } }
          : { ok: false, error: error?.message || String(error) }))
        .finally(() => {
          if (jobDetailRefreshAbortController === abortController) jobDetailRefreshAbortController = null;
        });
      return true;
    }
    if (message?.type === 'JOB_CHAT_STOP_REFRESH') {
      jobDetailRefreshStopRequested = true;
      jobDetailRefreshAbortController?.abort();
      sendResponse({ ok: true });
      return;
    }
    if (message?.type !== 'JOB_CHAT_EXTRACT_RECORDS' && message?.type !== 'BOSS_EXTRACT_CHAT_RECORDS') return;
    extractByCurrentSite(message?.siteKey, {
      syncSelection: message?.syncSelection,
      retryDelaySeconds: message?.retryDelaySeconds,
      retryCount: message?.retryCount,
      riskRetryAttempt: message?.riskRetryAttempt,
      riskRetryAttempts: message?.riskRetryAttempts,
      allowRiskReload: message?.allowRiskReload
    })
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  });
})();
