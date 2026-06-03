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

function normalizeText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function normalizeRecordDate(rawValue) {
  const raw = normalizeText(rawValue);
  const now = new Date();
  if (!raw) return formatDate(now);
  if (/^\d{1,2}:\d{2}$/.test(raw)) return formatDate(now);
  if (raw.includes('昨天')) return formatDate(addDays(now, -1));
  if (raw.includes('前天')) return formatDate(addDays(now, -2));
  let match = raw.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (match) return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
  match = raw.match(/(?:^|\D)(\d{1,2})[-/.月](\d{1,2})(?:日)?(?:\D|$)/);
  if (match) return `${now.getFullYear()}-${String(match[1]).padStart(2, '0')}-${String(match[2]).padStart(2, '0')}`;
  return raw;
}

function recruiterInfo(record) {
  const name = normalizeText(record?.recruiterName);
  const title = normalizeText(record?.recruiterTitle);
  if (name && title) return `${name} / ${title}`;
  return name || title || '';
}

function makeRecordKey(record) {
  const siteKey = normalizeText(record?.siteKey || '');
  const sourceName = normalizeText(record?.sourceName || '');
  const bossId = normalizeText(record?.boss?.encryptBossId || record?.boss?.bossId || '');
  const bossJobId = normalizeText(record?.boss?.jobId || '');
  if ((siteKey === 'boss' || sourceName === 'BOSS直聘') && bossId && bossJobId) return `boss|${bossId.toLowerCase()}|${bossJobId.toLowerCase()}`;
  if ((siteKey === 'boss' || sourceName === 'BOSS直聘') && bossId) return `boss|${bossId.toLowerCase()}`;
  const oppositeImId = normalizeText(record?.liepin?.oppositeImId || '');
  if ((siteKey === 'liepin' || sourceName === '猎聘') && oppositeImId) return `liepin|${oppositeImId.toLowerCase()}`;
  if (record?.recordKey) return normalizeText(record.recordKey);
  return [sourceName || siteKey || '', record.companyName, record.jobName, recruiterInfo(record)]
    .map((v) => normalizeText(v).toLowerCase())
    .join('|');
}

function prepareRecord(rawRecord, site) {
  const updatedDate = normalizeRecordDate(rawRecord.time || rawRecord.updatedDate || rawRecord.applicationDate);
  const record = {
    ...rawRecord,
    sourceName: site.source,
    siteKey: site.key,
    applicationDate: normalizeRecordDate(rawRecord.applicationDate || rawRecord.createdDate || rawRecord.time || updatedDate),
    updatedDate,
    time: updatedDate,
    note: normalizeText(rawRecord.note || ''),
    companyName: normalizeText(rawRecord.companyName),
    jobName: normalizeText(rawRecord.jobName),
    recruiterName: normalizeText(rawRecord.recruiterName),
    recruiterTitle: normalizeText(rawRecord.recruiterTitle),
    lastMessage: normalizeText(rawRecord.lastMessage),
    updatedAt: new Date().toISOString()
  };
  record.recordKey = makeRecordKey(record);
  return record;
}

async function readStoredRecords() {
  const store = await chrome.storage.local.get(['jobChatRecords']);
  return Array.isArray(store.jobChatRecords) ? store.jobChatRecords : [];
}

function normalizeStoredRecords(records) {
  return (records || []).map((record) => {
    const normalized = {
      ...record,
      note: normalizeText(record.note || ''),
      applicationDate: normalizeRecordDate(record.applicationDate || record.time || record.updatedDate),
      updatedDate: normalizeRecordDate(record.updatedDate || record.time || record.applicationDate),
      sourceName: normalizeText(record.sourceName || ''),
      siteKey: normalizeText(record.siteKey || ''),
      recordKey: record.recordKey || makeRecordKey(record)
    };
    normalized.recordKey = makeRecordKey(normalized);
    return normalized;
  });
}

function mergeRecordLists(existing, incoming) {
  const byKey = new Map();
  normalizeStoredRecords(existing).forEach((record) => byKey.set(record.recordKey, record));

  let inserted = 0;
  let updated = 0;

  incoming.forEach((record) => {
    const old = byKey.get(record.recordKey);
    if (old) {
      byKey.set(record.recordKey, {
        ...old,
        ...record,
        note: old.note || record.note || '',
        applicationDate: old.applicationDate || record.applicationDate,
        updatedDate: record.updatedDate || old.updatedDate,
        createdAt: old.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      updated += 1;
    } else {
      byKey.set(record.recordKey, {
        ...record,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      inserted += 1;
    }
  });

  const records = Array.from(byKey.values())
    .sort((a, b) => String(b.updatedDate || '').localeCompare(String(a.updatedDate || '')))
    .map((record, index) => ({ ...record, index: index + 1 }));

  return { records, inserted, updated };
}

async function savePendingExtraction(extractedData, site) {
  const incoming = (extractedData.records || []).map((item) => prepareRecord(item, site));
  const pendingData = {
    pageTitle: extractedData.pageTitle || '',
    pageUrl: extractedData.pageUrl || '',
    extractedAt: new Date().toISOString(),
    siteKey: site.key,
    siteTitle: site.title,
    sourceName: site.source,
    total: incoming.length,
    records: incoming.map((record, index) => ({ ...record, index: index + 1 })),
    syncSummary: { fetched: incoming.length, inserted: 0, updated: 0, saved: false, interrupted: Boolean(extractedData.interrupted), completed: !extractedData.interrupted, synced: incoming.length, sourceTotal: Number(extractedData.sourceTotal || extractedData.total || incoming.length) }
  };

  await chrome.storage.local.set({
    jobChatPendingRecords: pendingData,
    bossChatStatsLatest: pendingData
  });

  return pendingData;
}



async function savePartialExtraction(partial) {
  const site = SUPPORTED_SITES.find((item) => item.key === partial.siteKey) || SUPPORTED_SITES.find((item) => item.key === 'liepin');
  const incoming = (partial.records || []).map((item) => prepareRecord(item, site));
  const pendingData = {
    pageTitle: partial.pageTitle || '',
    pageUrl: partial.pageUrl || '',
    extractedAt: partial.extractedAt || new Date().toISOString(),
    siteKey: site.key,
    siteTitle: partial.siteTitle || site.title,
    sourceName: partial.sourceName || site.source,
    total: incoming.length,
    records: incoming.map((record, index) => ({ ...record, index: index + 1 })),
    syncSummary: {
      fetched: incoming.length,
      inserted: 0,
      updated: 0,
      saved: false,
      interrupted: Boolean(partial.interrupted),
      completed: Boolean(partial.completed),
      synced: Number(partial.synced || incoming.length),
      sourceTotal: Number(partial.total || incoming.length)
    }
  };

  await chrome.storage.local.set({
    jobChatPendingRecords: pendingData,
    bossChatStatsLatest: pendingData
  });

  return pendingData;
}

async function saveLiepinPartialExtraction(partial) {
  return savePartialExtraction({ ...partial, siteKey: 'liepin', siteTitle: '猎聘沟通记录', sourceName: '猎聘' });
}

async function savePendingToTotal() {
  const store = await chrome.storage.local.get(['jobChatPendingRecords', 'jobChatRecords']);
  const pending = store.jobChatPendingRecords || { records: [] };
  const incoming = normalizeStoredRecords(pending.records || []);
  const merged = mergeRecordLists(store.jobChatRecords || [], incoming);
  const totalData = {
    ...(pending || {}),
    extractedAt: new Date().toISOString(),
    total: merged.records.length,
    records: merged.records,
    syncSummary: { fetched: incoming.length, inserted: merged.inserted, updated: merged.updated, saved: true }
  };
  await chrome.storage.local.set({
    jobChatRecords: merged.records,
    bossChatStatsLatest: totalData,
    jobChatPendingRecords: { ...(pending || {}), syncSummary: totalData.syncSummary, savedAt: new Date().toISOString() }
  });
  return totalData;
}


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

async function ensureResultsTab() {
  const url = chrome.runtime.getURL('results.html?mode=sync');
  const tab = await chrome.tabs.create({ url, active: true });
  return tab.id;
}


async function prepareSyncFromTab(tab) {
  if (!tab?.id) throw new Error('没有找到当前活动标签页。');
  const site = detectSupportedSite(tab.url || '');
  if (!site) throw new Error(unsupportedMessage(tab.url || ''));

  await chrome.storage.local.set({ jobChatLiepinCancelRequested: true, jobChatCancelRequested: true });
  let response = await sendExtractMessage(tab.id, { ...site, messageType: 'JOB_CHAT_PREPARE_SYNC' });
  if (!response?.ok) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    response = await sendExtractMessage(tab.id, { ...site, messageType: 'JOB_CHAT_PREPARE_SYNC' });
  }
  if (!response?.ok) throw new Error(response?.error || `无法读取${site.source}列表。`);
  const total = Number(response.data?.sourceTotal || response.data?.total || 0);
  const pendingData = {
    pageTitle: response.data?.pageTitle || '',
    pageUrl: response.data?.pageUrl || tab.url || '',
    extractedAt: new Date().toISOString(),
    siteKey: site.key,
    siteTitle: site.title,
    sourceName: site.source,
    total: 0,
    records: [],
    syncSummary: { fetched: 0, inserted: 0, updated: 0, saved: false, interrupted: false, completed: total === 0, synced: 0, sourceTotal: total }
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
      message: total === 0 ? `${site.source}没有待同步记录。` : `已获取${site.source}列表，共 ${total} 条。请设置每秒同步限制后点击“同步”。`
    }
  });
  return pendingData;
}

async function extractFromTab(tab) {
  if (!tab?.id) throw new Error('没有找到当前活动标签页。');

  const site = detectSupportedSite(tab.url || '');
  if (!site) throw new Error(unsupportedMessage(tab.url || ''));

  await chrome.storage.local.set({ jobChatLiepinCancelRequested: false, jobChatCancelRequested: false });

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
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    response = await sendExtractMessage(tab.id, site);
  }

  if (!response?.ok) {
    throw new Error(response?.error || `无法读取页面。请确认当前页是 ${site.source} 页面。`);
  }

  const data = await savePendingExtraction(response.data || {}, site);
  const summary = data.syncSummary || {};

  await chrome.storage.local.set({ jobChatLiepinCancelRequested: false, jobChatCancelRequested: false });

  await chrome.storage.local.set({
    jobChatExtractionStatus: {
      state: 'done',
      siteKey: site.key,
      siteTitle: site.title,
      sourceName: site.source,
      finishedAt: new Date().toISOString(),
      total: data.records?.length || 0,
      message: summary.interrupted ? `已中断${site.source}同步，已同步 ${summary.synced || data.records?.length || 0} / ${summary.sourceTotal || data.records?.length || 0} 条。可继续同步。` : `本次同步 ${summary.fetched || 0} 条。请在同步结果页确认后保存到总记录。`
    }
  });

  return data;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {


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
    savePartialExtraction(message.data || {})
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_LIEPIN_PARTIAL_RESULTS') {
    saveLiepinPartialExtraction(message.data || {})
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'SAVE_PENDING_TO_TOTAL') {
    savePendingToTotal()
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
