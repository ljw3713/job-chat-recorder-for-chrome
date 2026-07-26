const SUPPORTED_SITES = [
  {
    key: 'boss',
    hostPattern: /(^|\.)zhipin\.com$/i,
    title: 'BOSS直聘沟通记录',
    source: 'BOSS直聘',
    messageType: 'JOB_CHAT_EXTRACT_RECORDS'
  },
  {
    key: 'liepin',
    hostPattern: /(^|\.)liepin\.com$/i,
    title: '猎聘沟通记录',
    source: '猎聘',
    messageType: 'JOB_CHAT_EXTRACT_RECORDS'
  }
];

function getHostname(tabUrl) {
  try { return new URL(tabUrl).hostname; } catch (_) { return ''; }
}

function detectSupportedSite(tabUrl) {
  const hostname = getHostname(tabUrl);
  return SUPPORTED_SITES.find((site) => site.hostPattern.test(hostname)) || null;
}

function supportedSiteNames() {
  return 'zhipin.com（BOSS直聘）、liepin.com（猎聘）';
}

globalThis.JobChatSupportedSites = SUPPORTED_SITES;
importScripts('shared-utils.js', 'shared-records.js', 'background-database.js');

const CONTENT_SCRIPT_FILES = [
  'shared-utils.js',
  'shared-records.js',
  'content-common.js',
  'boss-extractor.js',
  'liepin-extractor.js',
  'content.js'
];
let activeBossSendTabId = null;
let bossSendLogQueue = Promise.resolve();

function unsupportedMessage(tabUrl) {
  const hostname = getHostname(tabUrl) || tabUrl || '当前页面';
  return `暂不支持当前网站：${hostname}\n目前支持 ${supportedSiteNames()}。`;
}

function sendExtractMessage(tabId, site) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: site.messageType, siteKey: site.key }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response);
    });
  });
}

async function persistRefreshedBossTargets(targets) {
  const validTargets = (Array.isArray(targets) ? targets : []).filter((target) => target?.recordKey && !target?.prepareError && target?.boss);
  if (!validTargets.length) return;
  const byKey = new Map(validTargets.map((target) => [String(target.recordKey), target.boss]));
  const store = await chrome.storage.local.get(['jobChatRecords']);
  const records = Array.isArray(store.jobChatRecords) ? store.jobChatRecords : [];
  let changed = false;
  const allowedFields = [
    'ownerUserId', 'friendId', 'peerKey', 'chatSecurityId', 'uploadSecurityId',
    'friendSource', 'bossId', 'encryptBossId', 'jobId', 'encryptJobId'
  ];
  const nextRecords = records.map((record) => {
    const refreshed = byKey.get(String(record?.recordKey || ''));
    if (!refreshed) return record;
    const boss = { ...(record.boss || {}) };
    allowedFields.forEach((field) => {
      if (refreshed[field] !== undefined && refreshed[field] !== '') boss[field] = refreshed[field];
    });
    changed = true;
    return { ...record, boss };
  });
  if (changed) await chrome.storage.local.set({ jobChatRecords: nextRecords });
}

function localDateTime(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function updateBossRecordAfterSent(recordKey, message) {
  if (!recordKey || !message) return;
  const store = await chrome.storage.local.get(['jobChatRecords']);
  const records = Array.isArray(store.jobChatRecords) ? store.jobChatRecords : [];
  const sentAt = new Date();
  const updatedDate = localDateTime(sentAt);
  let changed = false;
  const nextRecords = records.map((record) => {
    if (String(record?.recordKey || '') !== String(recordKey)) return record;
    changed = true;
    return {
      ...record,
      time: updatedDate,
      updatedDate,
      updatedAt: sentAt.toISOString(),
      lastMessage: message,
      messageStatus: '0',
      boss: {
        ...(record.boss || {}),
        messageStatus: '0',
        lastMsgTime: sentAt.getTime(),
        lastMessageInfo: {
          ...(record.boss?.lastMessageInfo || {}),
          showText: message,
          msgTime: sentAt.getTime()
        }
      }
    };
  });
  if (changed) await chrome.storage.local.set({ jobChatRecords: nextRecords });
}

async function getBossTabAccount(tab) {
  if (!tab?.id) return { tab, userId: '', error: '标签页无效。' };
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: async () => {
        try {
          const response = await fetch('/wapi/zpuser/wap/getUserInfo.json', {
            method: 'GET',
            credentials: 'include',
            headers: { accept: 'application/json, text/plain, */*' }
          });
          if (!response.ok) return { userId: '', error: `HTTP ${response.status}` };
          const data = await response.json();
          const userId = data?.code === 0 ? String(data?.zpData?.userId || '') : '';
          return { userId, error: userId ? '' : (data?.message || '未登录') };
        } catch (error) {
          return { userId: '', error: error?.message || String(error) };
        }
      }
    });
    const result = results?.[0]?.result || {};
    return { tab, userId: String(result.userId || ''), error: String(result.error || '') };
  } catch (error) {
    return { tab, userId: '', error: error?.message || String(error) };
  }
}

async function getOrCreateBossPcDeviceId() {
  const store = await chrome.storage.local.get(['jobChatBossPcDeviceId']);
  const saved = String(store.jobChatBossPcDeviceId || '').trim();
  if (saved) return saved;
  const generated = crypto.randomUUID().replace(/-/g, '');
  await chrome.storage.local.set({ jobChatBossPcDeviceId: generated });
  return generated;
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (result) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(result || { ok: false, error: '标签页没有返回结果。' });
    });
  });
}

async function sendBossBatchToTab(tabId, message) {
  let response = await sendMessageToTab(tabId, message);
  if (response?.ok || !/Receiving end does not exist|Could not establish connection/i.test(String(response?.error || ''))) return response;
  await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPT_FILES });
  response = await sendMessageToTab(tabId, message);
  return response;
}

async function sendBossBatch(message) {
  const keys = new Set(Array.isArray(message?.recordKeys) ? message.recordKeys.map(String) : []);
  if (!keys.size) throw new Error('没有选中记录。');
  const store = await chrome.storage.local.get(['jobChatRecords']);
  const records = (Array.isArray(store.jobChatRecords) ? store.jobChatRecords : []).filter((record) => keys.has(String(record.recordKey)));
  if (records.length !== keys.size) throw new Error('部分选中记录已不存在，请刷新总览后重试。');
  if (records.some((record) => record.siteKey !== 'boss' && record.sourceName !== 'BOSS直聘')) throw new Error('选中记录包含猎聘，不能发送整个批次。');
  const tabs = await chrome.tabs.query({ url: ['https://*.zhipin.com/*'] });
  if (!tabs.length) throw new Error('没有打开 BOSS直聘标签页，请打开并登录后重试。');
  const tab = [...tabs].sort((left, right) => Number(right.lastAccessed || 0) - Number(left.lastAccessed || 0))[0];
  if (!tab?.id) throw new Error('无法选择 BOSS直聘标签页。');
  const account = await getBossTabAccount(tab);
  if (!account.userId) throw new Error('请登录或者刷新Boss直聘页');
  const targets = records.map((record) => ({ recordKey: record.recordKey, boss: record.boss || {} }));
  const ownerUserId = account.userId;
  const fallbackPcDeviceId = await getOrCreateBossPcDeviceId();
  const response = await sendBossBatchToTab(tab.id, { type: 'BOSS_SEND_BATCH', targets, ownerUserId, fallbackPcDeviceId, message: message.message, rate: message.rate });
  if (!response?.ok) throw new Error(response?.error || '无法启动 BOSS 发送任务，请刷新 BOSS 页面后重试。');
  await persistRefreshedBossTargets(response.refreshedTargets);
  activeBossSendTabId = tab.id;
  return { ok: true, total: targets.length };
}

async function stopBossBatch() {
  if (!activeBossSendTabId) return { ok: true };
  const tabId = activeBossSendTabId;
  const response = await new Promise((resolve) => chrome.tabs.sendMessage(tabId, { type: 'BOSS_STOP_BATCH' }, (result) => {
    if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message }); else resolve(result || { ok: false });
  }));
  if (!response?.ok) throw new Error(response?.error || '无法停止发送任务。');
  return { ok: true };
}

async function ensureResultsTab() {
  const url = chrome.runtime.getURL('results.html?mode=sync');
  const tab = await chrome.tabs.create({ url, active: true });
  return tab.id;
}


async function prepareSyncFromTab(tab) {
  if (!tab?.id) throw new Error('没有找到当前活动标签页。');
  const site = detectSupportedSite(tab.url || '');
  if (!site) throw new Error(unsupportedMessage(tab.url || ''));

  await chrome.storage.local.set({
    jobChatLiepinCancelRequested: true,
    jobChatCancelRequested: true,
    jobChatRequestLogs: []
  });
  let response = await sendExtractMessage(tab.id, { ...site, messageType: 'JOB_CHAT_PREPARE_SYNC' });
  if (!response?.ok) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_SCRIPT_FILES });
    response = await sendExtractMessage(tab.id, { ...site, messageType: 'JOB_CHAT_PREPARE_SYNC' });
  }
  if (!response?.ok) throw new Error(response?.error || `无法读取${site.source}列表。`);
  const total = Number(response.data?.sourceTotal || response.data?.total || 0);
  const summary = response.data?.syncSummary || {};
  const hasActionSummary = Number.isFinite(Number(summary.inserted)) || Number.isFinite(Number(summary.updatedMsg)) || Number.isFinite(Number(summary.updated));
  const inserted = hasActionSummary ? Number(summary.inserted || 0) : 0;
  const updatedMsg = hasActionSummary ? Number(summary.updatedMsg || summary.updated || 0) : 0;
  const readyMessage = total === 0
    ? `${site.source}没有待同步记录。`
    : hasActionSummary
      ? `已获取${site.source}列表，新增 ${inserted} 条，更新消息 ${updatedMsg} 条。请设置同步速率后点击“同步”。`
      : `已获取${site.source}列表，共 ${total} 条。请设置同步速率后点击“同步”。`;
  const pendingData = {
    pageTitle: response.data?.pageTitle || '',
    pageUrl: response.data?.pageUrl || tab.url || '',
    extractedAt: new Date().toISOString(),
    siteKey: site.key,
    siteTitle: site.title,
    sourceName: site.source,
    total: 0,
    records: [],
    syncSummary: { fetched: 0, inserted, updated: updatedMsg, updatedMsg, saved: false, interrupted: false, completed: total === 0, synced: 0, sourceTotal: total }
  };
  await chrome.storage.local.set({
    jobChatPendingRecords: pendingData,
    bossChatStatsLatest: pendingData,
    jobChatExtractionStatus: {
      state: total === 0 ? 'done' : 'ready',
      siteKey: site.key,
      siteTitle: site.title,
      sourceName: site.source,
      startedAt: new Date().toISOString(),
      synced: 0,
      total,
      inserted,
      updated: updatedMsg,
      updatedMsg,
      message: readyMessage
    }
  });
  return pendingData;
}

async function extractFromTab(tab) {
  if (!tab?.id) throw new Error('没有找到当前活动标签页。');

  const site = detectSupportedSite(tab.url || '');
  if (!site) throw new Error(unsupportedMessage(tab.url || ''));

  await chrome.storage.local.set({
    jobChatLiepinCancelRequested: false,
    jobChatCancelRequested: false,
    jobChatRequestLogs: []
  });

  await chrome.storage.local.set({
    jobChatExtractionStatus: {
      state: 'loading',
      siteKey: site.key,
      siteTitle: site.title,
      sourceName: site.source,
      startedAt: new Date().toISOString(),
      message: `正在提取${site.source}沟通记录...`
    }
  });

  let response = await sendExtractMessage(tab.id, site);

  if (!response?.ok) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_SCRIPT_FILES });
    response = await sendExtractMessage(tab.id, site);
  }

  if (!response?.ok) {
    throw new Error(response?.error || `无法读取页面。请确认当前页是 ${site.source} 页面。`);
  }

  const data = await globalThis.JobChatBackgroundDb.savePendingExtraction(response.data || {}, site);
  const summary = data.syncSummary || {};
  const actionText = Number(summary.inserted || 0) || Number(summary.updatedMsg || summary.updated || 0)
    ? `新增 ${summary.inserted || 0} 条，更新消息 ${summary.updatedMsg || summary.updated || 0} 条`
    : `同步 ${summary.fetched || 0} 条`;

  await chrome.storage.local.set({ jobChatLiepinCancelRequested: false, jobChatCancelRequested: false });

  await chrome.storage.local.set({
    jobChatExtractionStatus: {
      state: 'done',
      siteKey: site.key,
      siteTitle: site.title,
      sourceName: site.source,
      finishedAt: new Date().toISOString(),
      total: data.records?.length || 0,
      inserted: Number(summary.inserted || 0),
      updated: Number(summary.updated || 0),
      updatedMsg: Number(summary.updatedMsg || summary.updated || 0),
      message: summary.interrupted ? `已中断${site.source}同步，已处理 ${summary.synced || 0} / ${summary.sourceTotal || data.records?.length || 0} 条，${actionText}。可继续同步。` : `本次${actionText}。请在同步结果页确认后保存到总记录。`
    }
  });

  return data;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message?.type === 'BOSS_SEND_BATCH') {
    sendBossBatch(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'BOSS_STOP_BATCH') {
    stopBossBatch().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'BOSS_SEND_PROGRESS') {
    const { sentMessage = '', ...progress } = message.progress || {};
    if (progress.type === 'BOSS_SEND_FINISHED' || progress.type === 'BOSS_SEND_ERROR' || progress.type === 'BOSS_SEND_STOPPED') activeBossSendTabId = null;
    const updateRecord = progress.status === '成功' || progress.status === '已发送'
      ? updateBossRecordAfterSent(progress.recordKey, String(sentMessage || ''))
      : Promise.resolve();
    updateRecord
      .then(() => chrome.storage.local.set({ jobChatBossSendProgress: { ...progress, updatedAt: new Date().toISOString() } }))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'BOSS_SEND_LOG') {
    bossSendLogQueue = bossSendLogQueue.then(() => chrome.storage.local.get(['jobChatBossSendLogs'])).then((store) => {
      const logs = Array.isArray(store.jobChatBossSendLogs) ? store.jobChatBossSendLogs : [];
      logs.push({ time: new Date().toISOString(), message: String(message.message || '') });
      return chrome.storage.local.set({ jobChatBossSendLogs: logs.slice(-200) });
    });
    bossSendLogQueue.then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }


  if (message?.type === 'START_PREPARED_SYNC') {
    (async () => {
      const store = await chrome.storage.local.get(['jobChatLastSourceTab']);
      const tab = store.jobChatLastSourceTab;
      if (!tab?.id || !tab?.url) throw new Error('没有找到上次同步的页面，请回到对应招聘网站页面重新点击插件同步。');
      await chrome.storage.local.set({ jobChatLiepinCancelRequested: false, jobChatCancelRequested: false });
      await extractFromTab(tab);
      return { ok: true };
    })()
      .then((data) => sendResponse(data || { ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'CANCEL_LIEPIN_SYNC' || message?.type === 'CANCEL_CURRENT_SYNC') {
    chrome.storage.local.set({ jobChatLiepinCancelRequested: true, jobChatCancelRequested: true })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'RESUME_LIEPIN_SYNC' || message?.type === 'RESUME_CURRENT_SYNC') {
    (async () => {
      const store = await chrome.storage.local.get(['jobChatLastSourceTab']);
      const tab = store.jobChatLastSourceTab;
      if (!tab?.id || !tab?.url) throw new Error('没有找到上次同步的页面，请回到对应招聘网站页面重新点击插件同步。');
      await chrome.storage.local.set({ jobChatLiepinCancelRequested: false, jobChatCancelRequested: false });
      await extractFromTab(tab);
      return { ok: true };
    })()
      .then((data) => sendResponse(data || { ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_PARTIAL_RESULTS') {
    globalThis.JobChatBackgroundDb.savePartialExtraction(message.data || {})
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_LIEPIN_PARTIAL_RESULTS') {
    globalThis.JobChatBackgroundDb.saveLiepinPartialExtraction(message.data || {})
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'SAVE_PENDING_TO_TOTAL') {
    globalThis.JobChatBackgroundDb.savePendingToTotal()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'OPEN_OVERVIEW_PAGE') {
    chrome.tabs.create({ url: chrome.runtime.getURL('results.html?mode=overview'), active: true })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'OPEN_SYNC_PAGE') {
    chrome.tabs.create({ url: chrome.runtime.getURL('results.html?mode=sync'), active: true })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_EXTRACTION_PROGRESS') {
    const progress = message.progress || {};
    const sourceName = progress.sourceName || (progress.siteKey === 'boss' ? 'BOSS直聘' : '猎聘');
    const siteTitle = progress.siteTitle || (progress.siteKey === 'boss' ? 'BOSS直聘沟通记录' : '猎聘沟通记录');
    chrome.storage.local.set({
      jobChatExtractionStatus: {
        state: 'loading',
        siteKey: progress.siteKey || 'liepin',
        siteTitle,
        sourceName,
        startedAt: progress.startedAt || new Date().toISOString(),
        synced: Number(progress.synced || 0),
        total: Number(progress.total || 0),
        inserted: Number(progress.inserted || 0),
        updated: Number(progress.updated || 0),
        updatedMsg: Number(progress.updatedMsg || progress.updated || 0),
        message: progress.message || `正在提取${sourceName}沟通记录... 已同步 ${Number(progress.synced || 0)} / ${Number(progress.total || 0)} 条`
      }
    }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type !== 'START_JOB_CHAT_EXTRACTION') return;

  (async () => {
    const sourceTab = message.tab;
    const site = detectSupportedSite(sourceTab?.url || '');

    await chrome.storage.local.set({
      jobChatLastSourceTab: { id: sourceTab?.id, url: sourceTab?.url, title: sourceTab?.title },
      jobChatLiepinCancelRequested: false,
      jobChatCancelRequested: false,
      jobChatExtractionStatus: {
        state: 'loading',
        siteKey: site?.key || '',
        siteTitle: site?.title || '招聘沟通记录',
        sourceName: site?.source || '',
        startedAt: new Date().toISOString(),
        message: site ? `正在提取${site.source}沟通记录...` : '正在检查当前网站...'
      }
    });

    await ensureResultsTab();
    sendResponse({ ok: true });

    try {
      await prepareSyncFromTab(sourceTab);
    } catch (error) {
      await chrome.storage.local.set({
        jobChatExtractionStatus: {
          state: 'error',
          siteKey: site?.key || '',
          siteTitle: site?.title || '招聘沟通记录',
          sourceName: site?.source || '',
          finishedAt: new Date().toISOString(),
          message: error?.message || String(error)
        }
      });
    }
  })();

  return true;
});
