(function () {
  const { formatDate } = globalThis.JobChatUtils;

  function threeMonthsAgo() {
    const date = new Date();
    date.setMonth(date.getMonth() - 3);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function isWithinLastThreeMonthsTimestamp(ts) {
    if (!ts) return false;
    const date = new Date(Number(ts));
    if (Number.isNaN(date.getTime())) return false;
    return date >= threeMonthsAgo();
  }

  function filterBossRecentList(list) {
    if (!Array.isArray(list)) return [];
    return list.filter((item) => isWithinLastThreeMonthsTimestamp(item?.updateTime || item?.lastMessageInfo?.msgTime || item?.lastTS));
  }

  function filterLiepinRecentContacts(list) {
    if (!Array.isArray(list)) return [];
    return list.filter((item) => isWithinLastThreeMonthsTimestamp(item?.latestMsgTime));
  }

  function isTodayTimestamp(ts) {
    if (!ts) return false;
    const date = new Date(Number(ts));
    if (Number.isNaN(date.getTime())) return false;
    return formatDate(date) === formatDate(new Date());
  }

  async function getSyncDelayMs() {
    try {
      const store = await chrome.storage.local.get(['jobChatSyncRateSettings', 'jobChatSyncRateLimit']);
      const settings = store.jobChatSyncRateSettings || {};
      const unit = ['second', 'minute', 'hour'].includes(settings.unit) ? settings.unit : 'second';
      const count = Math.max(1, Math.min(3600, Math.floor(Number(settings.count || store.jobChatSyncRateLimit || 2))));
      const unitMs = unit === 'hour' ? 60 * 60 * 1000 : unit === 'minute' ? 60 * 1000 : 1000;
      return Math.ceil(unitMs / count);
    } catch (_) {
      return 500;
    }
  }

  function reportProgress(siteKey, siteTitle, sourceName, synced, total, extra = {}) {
    try {
      chrome.runtime.sendMessage({
        type: 'JOB_CHAT_EXTRACTION_PROGRESS',
        progress: {
          siteKey,
          siteTitle,
          sourceName,
          synced,
          total,
          ...extra,
          message: extra.message || `正在提取${sourceName}沟通记录... 已同步 ${synced} / ${total} 条`
        }
      });
    } catch (_) {}
  }

  async function isCancelRequested() {
    try {
      const store = await chrome.storage.local.get(['jobChatCancelRequested', 'jobChatLiepinCancelRequested']);
      return Boolean(store.jobChatCancelRequested || store.jobChatLiepinCancelRequested);
    } catch (_) {
      return false;
    }
  }

  async function savePartial(siteKey, siteTitle, sourceName, records, synced, total, interrupted, completed, extra = {}) {
    try {
      await chrome.runtime.sendMessage({
        type: 'JOB_CHAT_PARTIAL_RESULTS',
        data: {
          siteKey,
          siteTitle,
          sourceName,
          pageTitle: document.title || '',
          pageUrl: location.href,
          extractedAt: new Date().toISOString(),
          synced,
          total,
          interrupted: Boolean(interrupted),
          completed: Boolean(completed),
          ...extra,
          records
        }
      });
    } catch (_) {}
  }

  async function readIgnoredRecords() {
    try {
      const store = await chrome.storage.local.get(['jobChatIgnoredRecords']);
      return Array.isArray(store.jobChatIgnoredRecords) ? store.jobChatIgnoredRecords : [];
    } catch (_) {
      return [];
    }
  }

  async function writePreparedSourceList(siteKey, list, syncSummary) {
    try {
      await chrome.storage.local.set({
        jobChatPreparedSourceList: {
          siteKey,
          pageUrl: location.href,
          capturedAt: new Date().toISOString(),
          syncSummary: syncSummary || {},
          list: Array.isArray(list) ? list : []
        }
      });
    } catch (_) {}
  }

  async function readPreparedSourceList(siteKey) {
    try {
      const store = await chrome.storage.local.get(['jobChatPreparedSourceList']);
      const snapshot = store.jobChatPreparedSourceList;
      if (snapshot?.siteKey !== siteKey || !Array.isArray(snapshot.list)) return null;
      return snapshot;
    } catch (_) {
      return null;
    }
  }

  function appendRequestLog(entry) {
    try {
      chrome.runtime.sendMessage({
        type: 'JOB_CHAT_LOG_EVENT',
        logType: 'request',
        entry: {
          time: new Date().toISOString(),
          ...entry
        }
      }).catch((error) => {
        const errorMessage = error?.message || String(error);
        const contextInvalidated = /Extension context invalidated/i.test(errorMessage);
        console.error(
          contextInvalidated
            ? '[JobChat] 扩展上下文已失效，当前请求日志无法发送到结果页。通常是扩展被重新加载/更新，或标签页在同步过程中刷新、跳转。'
            : '[JobChat] 请求日志发送失败。',
          {
            error: errorMessage,
            contextInvalidated,
            logStep: entry?.step || '',
            siteKey: entry?.siteKey || '',
            pageUrl: location.href,
            readyState: document.readyState,
            visibilityState: document.visibilityState,
            entry
          }
        );
      });
    } catch (error) {
      const errorMessage = error?.message || String(error);
      const contextInvalidated = /Extension context invalidated/i.test(errorMessage);
      console.error(
        contextInvalidated
          ? '[JobChat] 扩展上下文已失效，当前请求日志无法发送到结果页。通常是扩展被重新加载/更新，或标签页在同步过程中刷新、跳转。'
          : '[JobChat] 请求日志发送失败。',
        {
          error: errorMessage,
          contextInvalidated,
          logStep: entry?.step || '',
          siteKey: entry?.siteKey || '',
          pageUrl: location.href,
          readyState: document.readyState,
          visibilityState: document.visibilityState,
          entry
        }
      );
    }
    return Promise.resolve();
  }

  function detectSiteByLocation() {
    const hostname = location.hostname;
    if (/(^|\.)zhipin\.com$/i.test(hostname)) return 'boss';
    if (/(^|\.)liepin\.com$/i.test(hostname)) return 'liepin';
    return 'unsupported';
  }

  globalThis.JobChatContentCommon = {
    filterBossRecentList,
    filterLiepinRecentContacts,
    isTodayTimestamp,
    getSyncDelayMs,
    reportProgress,
    isCancelRequested,
    savePartial,
    readIgnoredRecords,
    writePreparedSourceList,
    readPreparedSourceList,
    appendRequestLog,
    detectSiteByLocation
  };
})();
