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

function migrateBossChatSecurityId(record) {
  if (!record || (record.siteKey !== 'boss' && record.sourceName !== 'BOSS直聘')) return record;
  const oldBoss = record.boss || {};
  const chatSecurityId = String(oldBoss.chatSecurityId || oldBoss.securityId || '').trim();
  if (oldBoss.chatSecurityId === chatSecurityId && !Object.prototype.hasOwnProperty.call(oldBoss, 'securityId')) return record;
  const boss = { ...oldBoss, chatSecurityId };
  delete boss.securityId;
  return { ...record, boss };
}

function mergedConversationFields(oldRecord, nextRecord) {
  const conversation = globalThis.JobChatRecords?.mergeConversation(
    oldRecord?.conversation,
    nextRecord?.conversation
  );
  return conversation ? { conversation } : {};
}

function supportedSiteNames() {
  return 'zhipin.com（BOSS直聘）、liepin.com（猎聘）';
}

globalThis.JobChatSupportedSites = SUPPORTED_SITES;
importScripts('runtime-config.js');
if (globalThis.JobChatRuntimeConfig?.enableDebugLog) {
  try {
    importScripts('runtime-config.local.js');
  } catch (_) {
    // 本地 GA4 配置为可选文件，不存在时保持统计关闭。
  }
}
importScripts('analytics.js', 'shared-utils.js', 'shared-records.js', 'background-database.js');

const CONTENT_SCRIPT_FILES = [
  'src/shared-utils.js',
  'src/shared-records.js',
  'src/content-common.js',
  'src/online-job-filter.js',
  'src/site-adapters.js',
  'src/job-sync-core.js',
  'src/boss-extractor.js',
  'src/liepin-extractor.js',
  'src/content.js',
  'src/boss-auto-greeting.js',
  'src/liepin-auto-greeting.js'
];
let activeBossSendTabId = null;
let activeLiepinSendTabId = null;
let activeJobDetailRefreshTabId = null;
let activeJobDetailRefreshRunId = null;
let activeSyncReloadCancelled = false;
let activeExtractionProgressContext = null;
let sendProgressSaveQueue = Promise.resolve();
let jobDetailProgressSaveQueue = Promise.resolve();
let companyProfileSaveQueue = Promise.resolve();
const ONLINE_ONLY_TABS_STORAGE_KEY = 'jobChatOnlineOnlyTabs';
const COMPANY_FILTER_TABS_STORAGE_KEY = 'jobChatCompanyFilterTabs';
const COMPANY_FILTER_KEYWORDS_STORAGE_KEY = 'jobChatCompanyFilterKeywords';
let companyFilterKeywordsSaveQueue = Promise.resolve();
const AUTO_GREETING_RUN_STORAGE_KEY = 'jobChatAutoGreetingRun';
const AUTO_GREETING_HISTORY_STORAGE_KEY = 'jobChatAutoGreetingHistory';
const AUTO_GREETING_LOG_TABS_STORAGE_KEY = 'jobChatAutoGreetingLogTabs';
const AUTO_GREETING_LOGS_STORAGE_KEY = 'jobChatAutoGreetingLogsByTab';
let autoGreetingSaveQueue = Promise.resolve();
let autoGreetingLogQueue = Promise.resolve();
let autoGreetingRiskQueue = Promise.resolve();
const AUTO_GREETING_BACKGROUND_SESSION_ID = crypto.randomUUID();

function autoGreetingPanelPath(debug = false, floatingTabId = 0) {
  const params = new URLSearchParams();
  if (floatingTabId) {
    params.set('mode', 'floating');
    params.set('tabId', String(floatingTabId));
  }
  if (debug) params.set('debug', '1');
  const query = params.toString();
  return `auto-message-panel.html${query ? `?${query}` : ''}`;
}

async function findAutoGreetingFloatingWindow(tabId) {
  const expected = chrome.runtime.getURL(autoGreetingPanelPath(false, tabId)).replace('?debug=1', '');
  const windows = await chrome.windows.getAll({ populate: true });
  return windows.find((windowInfo) => windowInfo.type === 'popup' && windowInfo.tabs?.some((tab) => {
    const url = String(tab.url || '');
    return url.startsWith(expected) && new URL(url).searchParams.get('mode') === 'floating';
  })) || null;
}

async function floatAutoGreetingPanel(tabId, debug) {
  const existing = await findAutoGreetingFloatingWindow(tabId);
  if (existing?.id) {
    await chrome.windows.update(existing.id, { focused: true });
    return existing;
  }
  const floating = await chrome.windows.create({
    url: chrome.runtime.getURL(autoGreetingPanelPath(Boolean(debug), tabId)),
    type: 'popup',
    width: 460,
    height: 760,
    focused: true
  });
  if (chrome.sidePanel?.setOptions) {
    await chrome.sidePanel.setOptions({ tabId, enabled: false }).catch(() => {});
  }
  return floating;
}

async function dockAutoGreetingPanel(tabId, windowId, debug) {
  if (!Number.isInteger(Number(windowId)) || Number(windowId) <= 0) throw new Error('浮动窗口无效。');
  if (chrome.sidePanel?.setOptions) {
    const ownerTab = await chrome.tabs.get(tabId);
    await chrome.sidePanel.setOptions({ tabId, enabled: true });
    await chrome.sidePanel.setOptions({ path: autoGreetingPanelPath(Boolean(debug)), enabled: true });
    await chrome.sidePanel.open({ windowId: ownerTab.windowId });
  }
  await chrome.windows.remove(Number(windowId));
}

function redactAutoGreetingLog(value) {
  return String(value || '')
    .replace(/\b(securityId|lid|token|cookie|authorization)=([^&\s]+)/gi, '$1=[已隐藏]')
    .replace(/\b[A-Za-z0-9_~-]{80,}\b/g, '[长标识已隐藏]');
}

async function setAutoGreetingLogEnabled(tabId, enabled) {
  const store = await chrome.storage.session.get([AUTO_GREETING_LOG_TABS_STORAGE_KEY]);
  const tabs = store[AUTO_GREETING_LOG_TABS_STORAGE_KEY] && typeof store[AUTO_GREETING_LOG_TABS_STORAGE_KEY] === 'object'
    ? store[AUTO_GREETING_LOG_TABS_STORAGE_KEY] : {};
  if (enabled) tabs[String(tabId)] = true;
  else delete tabs[String(tabId)];
  await chrome.storage.session.set({ [AUTO_GREETING_LOG_TABS_STORAGE_KEY]: tabs });
}

async function appendAutoGreetingLog(tabId, message, options = {}) {
  if (!Number.isInteger(Number(tabId)) || Number(tabId) <= 0) return;
  autoGreetingLogQueue = autoGreetingLogQueue.catch(() => {}).then(async () => {
    const store = await chrome.storage.session.get([AUTO_GREETING_LOG_TABS_STORAGE_KEY, AUTO_GREETING_LOGS_STORAGE_KEY]);
    const enabledTabs = store[AUTO_GREETING_LOG_TABS_STORAGE_KEY];
    if (!enabledTabs || enabledTabs[String(tabId)] !== true) return;
    const logsByTab = store[AUTO_GREETING_LOGS_STORAGE_KEY] && typeof store[AUTO_GREETING_LOGS_STORAGE_KEY] === 'object'
      ? store[AUTO_GREETING_LOGS_STORAGE_KEY] : {};
    const entries = Array.isArray(logsByTab[String(tabId)]) ? logsByTab[String(tabId)] : [];
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    logsByTab[String(tabId)] = [...entries, {
      time,
      message: options.raw === true ? String(message || '') : redactAutoGreetingLog(message)
    }].slice(-300);
    await chrome.storage.session.set({ [AUTO_GREETING_LOGS_STORAGE_KEY]: logsByTab });
  });
  return autoGreetingLogQueue;
}

async function clearAutoGreetingLog(tabId) {
  const store = await chrome.storage.session.get([AUTO_GREETING_LOGS_STORAGE_KEY]);
  const logsByTab = store[AUTO_GREETING_LOGS_STORAGE_KEY] && typeof store[AUTO_GREETING_LOGS_STORAGE_KEY] === 'object'
    ? store[AUTO_GREETING_LOGS_STORAGE_KEY] : {};
  delete logsByTab[String(tabId)];
  await chrome.storage.session.set({ [AUTO_GREETING_LOGS_STORAGE_KEY]: logsByTab });
}

function autoGreetingJobId(record) {
  return String(record?.jobRef?.externalId || record?.boss?.jobId || '').trim().toLowerCase();
}

function autoGreetingHistoryKey(message) {
  const siteKey = String(message.siteKey || 'boss').trim().toLowerCase();
  const jobId = String(message.jobId || '').trim().toLowerCase();
  if (siteKey !== 'liepin') return jobId;
  const recruiterId = String(message.recruiterId || '').trim().toLowerCase();
  const candidateKey = String(message.candidateKey || `${recruiterId}|${jobId}`).trim().toLowerCase();
  return candidateKey.startsWith('liepin|') ? candidateKey : `liepin|${candidateKey}`;
}

function recordMatchesAutoGreeting(record, siteKey, jobId, recruiterId) {
  const recordSite = String(record?.siteKey || (record?.sourceName === '猎聘' ? 'liepin' : 'boss')).toLowerCase();
  if (siteKey !== 'liepin') return recordSite !== 'liepin' && autoGreetingJobId(record) === jobId;
  const recordRecruiterId = String(
    record?.liepin?.recruiterId
    || record?.liepin?.oppositeUserId
    || ''
  ).trim().toLowerCase();
  return recordSite === 'liepin'
    && autoGreetingJobId(record) === jobId
    && Boolean(recruiterId)
    && recordRecruiterId === recruiterId;
}

async function ensureAutoGreetingContent(tabId) {
  let status = await sendMessageToTab(tabId, { type: 'JOB_CHAT_AUTO_GREETING_STATUS' });
  if (status?.ok) return status;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPT_FILES });
  } catch (error) {
    throw new Error(`无法连接招聘页面，请刷新页面后重试：${error?.message || String(error)}`);
  }
  status = await sendMessageToTab(tabId, { type: 'JOB_CHAT_AUTO_GREETING_STATUS' });
  if (!status?.ok) throw new Error('自动打招呼脚本未能连接当前页面，请刷新招聘页面后重试。');
  return status;
}

async function reconcileAutoGreetingRun(tabId) {
  const store = await chrome.storage.local.get([AUTO_GREETING_RUN_STORAGE_KEY]);
  const run = store[AUTO_GREETING_RUN_STORAGE_KEY];
  if (!run || Number(run.tabId) !== Number(tabId)) return null;
  if (run.riskRetryPaused) return run;
  if (run.status === 'refreshing') return run;
  if (!['running', 'paused', 'cancelling'].includes(run.status)) return run;
  const taskStatus = await sendMessageToTab(run.tabId, { type: 'JOB_CHAT_AUTO_GREETING_STATUS' });
  if (taskStatus?.active && taskStatus.runId === run.runId) return run;
  const interrupted = {
    ...run,
    status: 'failed',
    currentJobName: '',
    statusText: '页面中的自动打招呼任务已结束，请重新启动。',
    updatedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [AUTO_GREETING_RUN_STORAGE_KEY]: interrupted });
  return interrupted;
}

async function startAutoGreeting(message) {
  const tabId = Number(message.tabId || 0);
  if (!Number.isInteger(tabId) || tabId <= 0) throw new Error('没有找到当前标签页。');
  const tab = await chrome.tabs.get(tabId);
  let tabUrl;
  try { tabUrl = new URL(tab?.url || ''); } catch (_) { tabUrl = null; }
  const site = tabUrl && /(^|\.)zhipin\.com$/i.test(tabUrl.hostname)
    ? 'boss'
    : (tabUrl && /(^|\.)liepin\.com$/i.test(tabUrl.hostname) ? 'liepin' : '');
  if (!site) {
    throw new Error('请在已登录的 BOSS直聘或猎聘页面启动自动打招呼。');
  }
  const contentStatus = await ensureAutoGreetingContent(tabId);
  const store = await chrome.storage.local.get([AUTO_GREETING_RUN_STORAGE_KEY]);
  let current = store[AUTO_GREETING_RUN_STORAGE_KEY];
  if (current?.siteKey !== 'liepin' && current?.status === 'refreshing'
    && current.riskRecoverySessionId !== AUTO_GREETING_BACKGROUND_SESSION_ID) {
    const stale = {
      ...current,
      status: 'failed',
      currentJobName: '',
      statusText: '上次环境异常重试因扩展重新加载而结束，请重新启动。',
      updatedAt: new Date().toISOString()
    };
    await chrome.storage.local.set({ [AUTO_GREETING_RUN_STORAGE_KEY]: stale });
    current = null;
  }
  if (current && ['running', 'paused', 'cancelling', 'refreshing'].includes(current.status)) {
    if (current.status === 'refreshing') throw new Error('环境异常刷新重试正在进行，请稍候。');
    let taskStatus = Number(current.tabId) === tabId ? contentStatus : null;
    if (!taskStatus) {
      try { taskStatus = await sendMessageToTab(current.tabId, { type: 'JOB_CHAT_AUTO_GREETING_STATUS' }); } catch (_) {}
    }
    if (taskStatus?.active && taskStatus.runId === current.runId) throw new Error('已有自动打招呼任务正在运行。');
    await chrome.storage.local.set({
      [AUTO_GREETING_RUN_STORAGE_KEY]: { ...current, status: 'failed', statusText: '原任务页面已刷新或关闭，任务已结束。', updatedAt: new Date().toISOString() }
    });
  }
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const run = {
    runId, tabId, siteKey: site, status: 'running', config: message.config || {},
    processed: 0, succeeded: 0, skipped: 0, failed: 0, totalDiscovered: 0,
    currentJobName: '', statusText: '正在启动', startedAt,
    deadlineAt: Date.now() + 30 * 60 * 1000,
    updatedAt: startedAt
  };
  await chrome.storage.local.set({ [AUTO_GREETING_RUN_STORAGE_KEY]: run });
  await appendAutoGreetingLog(tabId, `启动任务：目标 ${Number(run.config.greetingCount || 0)} 条，请求速率 ${Number(run.config.requestRatePerMinute || 25)} 次/分钟，并发 1`);
  const response = await sendMessageToTab(tabId, {
    type: 'JOB_CHAT_AUTO_GREETING_START', runId, config: run.config,
    deadlineAt: run.deadlineAt,
    onlineOnly: await onlineOnlyState(tabId)
  });
  if (!response?.ok) {
    const failed = { ...run, status: 'failed', statusText: response?.error || '无法启动自动打招呼任务。', updatedAt: new Date().toISOString() };
    await chrome.storage.local.set({ [AUTO_GREETING_RUN_STORAGE_KEY]: failed });
    await appendAutoGreetingLog(tabId, `启动失败：${failed.statusText}`);
    throw new Error(failed.statusText);
  }
  const startedRun = { ...run, recommendedListUrl: String(response.recommendedListUrl || '') };
  await chrome.storage.local.set({ [AUTO_GREETING_RUN_STORAGE_KEY]: startedRun });
  return { ok: true, run: startedRun };
}

async function controlAutoGreeting(message, action) {
  const requestedTabId = Number(message.tabId || 0);
  const store = await chrome.storage.local.get([AUTO_GREETING_RUN_STORAGE_KEY]);
  const storedRun = store[AUTO_GREETING_RUN_STORAGE_KEY];
  // A code=37 retry is managed by the background worker while the page is
  // waiting to reload.  Do not require the panel's current tab lookup here:
  // the panel can be floating or its active-tab query can temporarily be empty.
  const run = action === 'pause' && storedRun?.status === 'refreshing'
    ? storedRun
    : await reconcileAutoGreetingRun(requestedTabId || storedRun?.tabId);
  if (action === 'pause' && run?.status === 'refreshing') {
    const paused = {
      ...run,
      status: 'paused',
      riskControlCount: 0,
      riskRecoverySessionId: '',
      riskRetryPaused: true,
      statusText: '环境异常重试已暂停，重试次数已重置。',
      updatedAt: new Date().toISOString()
    };
    await chrome.storage.local.set({ [AUTO_GREETING_RUN_STORAGE_KEY]: paused });
    await appendAutoGreetingLog(run.tabId, paused.statusText);
    return { ok: true };
  }
  if (action === 'resume' && run?.status === 'paused' && run.riskRetryPaused) {
    const resumed = {
      ...run,
      status: 'running',
      riskRetryPaused: false,
      statusText: '继续处理推荐岗位，环境异常重试次数已重置。',
      updatedAt: new Date().toISOString()
    };
    await chrome.storage.local.set({ [AUTO_GREETING_RUN_STORAGE_KEY]: resumed });
    await ensureAutoGreetingContent(run.tabId);
    const response = await sendMessageToTab(run.tabId, {
      type: 'JOB_CHAT_AUTO_GREETING_START',
      runId: run.runId,
      config: run.config || {},
      recommendedListUrl: run.recommendedListUrl,
      deadlineAt: run.deadlineAt,
      onlineOnly: await onlineOnlyState(run.tabId),
      initialProgress: {
        processed: Number(run.processed || 0),
        succeeded: Number(run.succeeded || 0),
        skipped: Number(run.skipped || 0),
        failed: Number(run.failed || 0),
        totalDiscovered: Number(run.totalDiscovered || 0)
      }
    });
    if (!response?.ok) {
      await chrome.storage.local.set({ [AUTO_GREETING_RUN_STORAGE_KEY]: { ...resumed, status: 'failed', statusText: response?.error || '无法继续环境异常重试。', updatedAt: new Date().toISOString() } });
      throw new Error(response?.error || '无法继续环境异常重试。');
    }
    return { ok: true };
  }
  if (action === 'cancel' && run?.status === 'paused' && run.riskRetryPaused) {
    const cancelled = {
      ...run,
      status: 'cancelled',
      currentJobName: '',
      riskRetryPaused: false,
      riskRecoverySessionId: '',
      statusText: '自动打招呼任务已取消',
      updatedAt: new Date().toISOString()
    };
    await chrome.storage.local.set({ [AUTO_GREETING_RUN_STORAGE_KEY]: cancelled });
    await appendAutoGreetingLog(run.tabId, cancelled.statusText);
    return { ok: true };
  }
  const allowed = action === 'cancel'
    ? run?.status === 'paused'
    : ['running', 'paused'].includes(run?.status);
  if (!run?.tabId || !allowed) {
    throw new Error(action === 'cancel' ? '请先暂停任务再取消。' : '当前没有可控制的自动打招呼任务。');
  }
  const response = await sendMessageToTab(run.tabId, { type: `JOB_CHAT_AUTO_GREETING_${action.toUpperCase()}` });
  if (!response?.ok) throw new Error(response?.error || `无法${action === 'pause' ? '暂停' : (action === 'cancel' ? '取消' : '继续')}任务。`);
  return { ok: true };
}

async function handleAutoGreetingRiskControl(message, sender) {
  const store = await chrome.storage.local.get([AUTO_GREETING_RUN_STORAGE_KEY]);
  const run = store[AUTO_GREETING_RUN_STORAGE_KEY];
  if (!run || run.runId !== message.runId || Number(run.tabId) !== Number(sender.tab?.id)) return;
  const recommendedListUrl = String(message.recommendedListUrl || run.recommendedListUrl || '');
  const riskControlCount = Number(run.riskControlCount || 0) + 1;
  if (riskControlCount > 3) {
    const stopped = {
      ...run,
      riskControlCount,
      status: 'failed',
      currentJobName: '',
      statusText: '环境异常（code=37）连续重试已超过 3 次，自动打招呼已停止。',
      updatedAt: new Date().toISOString()
    };
    await chrome.storage.local.set({ [AUTO_GREETING_RUN_STORAGE_KEY]: stopped });
    await appendAutoGreetingLog(run.tabId, stopped.statusText);
    return;
  }
  const retryDelaySeconds = [10, 30, 60][riskControlCount - 1];

  const refreshing = {
    ...run,
    recommendedListUrl,
    riskControlCount,
    riskRecoverySessionId: AUTO_GREETING_BACKGROUND_SESSION_ID,
    status: 'refreshing',
    statusText: `环境异常第 ${riskControlCount} 次，等待 ${retryDelaySeconds} 秒后刷新页面重试。`,
    updatedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [AUTO_GREETING_RUN_STORAGE_KEY]: refreshing });
  await appendAutoGreetingLog(run.tabId, `${refreshing.statusText} 异常阶段：${String(message.phase || '未知')}`);

  try {
    await new Promise((resolve) => setTimeout(resolve, retryDelaySeconds * 1000));
    const waitingStore = await chrome.storage.local.get([AUTO_GREETING_RUN_STORAGE_KEY]);
    const waitingRun = waitingStore[AUTO_GREETING_RUN_STORAGE_KEY];
    if (!waitingRun || waitingRun.runId !== run.runId || waitingRun.status !== 'refreshing') return;
    await reloadTabAndWait(run.tabId, 30000);
    await ensureAutoGreetingContent(run.tabId);
    const latestStore = await chrome.storage.local.get([AUTO_GREETING_RUN_STORAGE_KEY]);
    const latest = latestStore[AUTO_GREETING_RUN_STORAGE_KEY];
    if (!latest || latest.runId !== run.runId || latest.status !== 'refreshing') return;
    const resumed = {
      ...latest,
      status: 'running',
      riskRecoverySessionId: '',
      currentJobName: '',
      statusText: `页面刷新完成，正在进行第 ${riskControlCount} 次重试。`,
      updatedAt: new Date().toISOString()
    };
    await chrome.storage.local.set({ [AUTO_GREETING_RUN_STORAGE_KEY]: resumed });
    const response = await sendMessageToTab(run.tabId, {
      type: 'JOB_CHAT_AUTO_GREETING_START',
      runId: run.runId,
      config: run.config || {},
      recommendedListUrl: resumed.recommendedListUrl,
      deadlineAt: resumed.deadlineAt,
      onlineOnly: await onlineOnlyState(run.tabId),
      initialProgress: {
        processed: Number(resumed.processed || 0),
        succeeded: Number(resumed.succeeded || 0),
        skipped: Number(resumed.skipped || 0),
        failed: Number(resumed.failed || 0),
        totalDiscovered: Number(resumed.totalDiscovered || 0)
      }
    });
    if (!response?.ok) throw new Error(response?.error || '刷新后无法重新启动自动打招呼任务。');
    await appendAutoGreetingLog(run.tabId, resumed.statusText);
  } catch (error) {
    const failedStore = await chrome.storage.local.get([AUTO_GREETING_RUN_STORAGE_KEY]);
    const current = failedStore[AUTO_GREETING_RUN_STORAGE_KEY];
    // A user may pause during the retry delay or while the tab is reloading.
    // Keep that explicit pause instead of replacing it with a refresh failure.
    if (!current || current.runId !== run.runId || current.status !== 'refreshing') return;
    const failed = {
      ...current,
      status: 'failed',
      currentJobName: '',
      statusText: `环境异常后刷新重试失败：${error?.message || String(error)}`,
      updatedAt: new Date().toISOString()
    };
    await chrome.storage.local.set({ [AUTO_GREETING_RUN_STORAGE_KEY]: failed });
    await appendAutoGreetingLog(run.tabId, failed.statusText);
  }
}

async function resetAutoGreetingRiskControl(message, sender) {
  const store = await chrome.storage.local.get([AUTO_GREETING_RUN_STORAGE_KEY]);
  const run = store[AUTO_GREETING_RUN_STORAGE_KEY];
  if (!run || run.runId !== message.runId || Number(run.tabId) !== Number(sender.tab?.id) || !Number(run.riskControlCount)) return;
  await chrome.storage.local.set({
    [AUTO_GREETING_RUN_STORAGE_KEY]: {
      ...run,
      riskControlCount: 0,
      updatedAt: new Date().toISOString()
    }
  });
}

async function reserveAutoGreetingJob(message) {
  const siteKey = String(message.siteKey || 'boss').trim().toLowerCase();
  const jobId = String(message.jobId || '').trim().toLowerCase();
  if (!jobId) throw new Error('岗位 ID 为空。');
  const recruiterId = String(message.recruiterId || '').trim().toLowerCase();
  if (siteKey === 'liepin' && !recruiterId) throw new Error('猎聘招聘者 ID 为空。');
  const historyKey = autoGreetingHistoryKey(message);
  const store = await chrome.storage.local.get(['jobChatRecords', 'jobChatPendingRecords', 'jobChatIgnoredRecords', AUTO_GREETING_HISTORY_STORAGE_KEY]);
  const records = [
    ...(Array.isArray(store.jobChatRecords) ? store.jobChatRecords : []),
    ...(Array.isArray(store.jobChatPendingRecords?.records) ? store.jobChatPendingRecords.records : []),
    ...(Array.isArray(store.jobChatIgnoredRecords) ? store.jobChatIgnoredRecords : [])
  ];
  const history = store[AUTO_GREETING_HISTORY_STORAGE_KEY] && typeof store[AUTO_GREETING_HISTORY_STORAGE_KEY] === 'object'
    ? store[AUTO_GREETING_HISTORY_STORAGE_KEY] : {};
  const state = history[historyKey]?.state;
  if (records.some((record) => recordMatchesAutoGreeting(record, siteKey, jobId, recruiterId))
    || ['sending', 'success', 'unknown'].includes(state)) {
    return { ok: true, reserved: false };
  }
  if (message.checkOnly === true) return { ok: true, reserved: true };
  history[historyKey] = {
    siteKey,
    candidateKey: historyKey,
    jobId,
    recruiterId,
    runId: String(message.runId || ''),
    state: 'sending',
    updatedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [AUTO_GREETING_HISTORY_STORAGE_KEY]: history });
  return { ok: true, reserved: true };
}

async function saveAutoGreetingSuccess(message) {
  const siteKey = String(message.siteKey || 'boss').trim().toLowerCase();
  const jobId = String(message.jobId || '').trim().toLowerCase();
  if (!jobId || !message.record) throw new Error('同步记录缺少岗位信息。');
  const recruiterId = String(message.recruiterId || '').trim().toLowerCase();
  const historyKey = autoGreetingHistoryKey(message);
  const store = await chrome.storage.local.get(['jobChatRecords', 'jobChatCompanyProfiles', AUTO_GREETING_HISTORY_STORAGE_KEY, AUTO_GREETING_RUN_STORAGE_KEY]);
  const existing = Array.isArray(store.jobChatRecords) ? store.jobChatRecords : [];
  const normalized = globalThis.JobChatRecords.normalizeStoredRecord(message.record, existing.length);
  const foundIndex = existing.findIndex((record) => (
    recordMatchesAutoGreeting(record, siteKey, jobId, recruiterId)
    || record?.recordKey === normalized.recordKey
  ));
  const records = [...existing];
  if (foundIndex >= 0) records[foundIndex] = { ...records[foundIndex], ...normalized, index: records[foundIndex].index || foundIndex + 1 };
  else records.push({ ...normalized, index: records.length + 1 });
  const history = store[AUTO_GREETING_HISTORY_STORAGE_KEY] && typeof store[AUTO_GREETING_HISTORY_STORAGE_KEY] === 'object'
    ? store[AUTO_GREETING_HISTORY_STORAGE_KEY] : {};
  history[historyKey] = {
    ...(history[historyKey] || {}),
    siteKey,
    candidateKey: historyKey,
    jobId,
    recruiterId,
    runId: String(message.runId || ''),
    state: 'success',
    updatedAt: new Date().toISOString()
  };
  const next = { jobChatRecords: records, [AUTO_GREETING_HISTORY_STORAGE_KEY]: history };
  const run = store[AUTO_GREETING_RUN_STORAGE_KEY];
  if (run?.runId === message.runId) {
    const sentItem = message.sentItem && typeof message.sentItem === 'object' ? message.sentItem : {};
    const entry = {
      companyName: String(sentItem.companyName || normalized.companyName || ''),
      companyDetail: String(sentItem.companyDetail || ''),
      companyIndustry: String(sentItem.companyIndustry || ''),
      companyScale: String(sentItem.companyScale || ''),
      jobName: String(sentItem.jobName || normalized.jobName || ''),
      jobDetail: String(sentItem.jobDetail || normalized.jobInfo?.description || ''),
      salary: String(sentItem.salary || normalized.jobInfo?.salary || ''),
      jobLocation: String(sentItem.jobLocation || normalized.jobInfo?.location || ''),
      jobExperience: String(sentItem.jobExperience || normalized.jobInfo?.experience || ''),
      jobEducation: String(sentItem.jobEducation || normalized.jobInfo?.education || ''),
      jobSkills: Array.isArray(sentItem.jobSkills) ? sentItem.jobSkills : (Array.isArray(normalized.jobInfo?.skills) ? normalized.jobInfo.skills : []),
      jobAddress: String(sentItem.jobAddress || normalized.jobInfo?.address || ''),
      message: String(sentItem.message || normalized.lastMessage || ''),
      sentAt: String(sentItem.sentAt || normalized.updatedAt || new Date().toISOString())
    };
    next[AUTO_GREETING_RUN_STORAGE_KEY] = {
      ...run,
      sentMessages: [...(Array.isArray(run.sentMessages) ? run.sentMessages : []), entry].slice(-100),
      updatedAt: new Date().toISOString()
    };
  }
  const profile = message.companyProfile;
  if (profile?.companyKey) {
    const profiles = store.jobChatCompanyProfiles && typeof store.jobChatCompanyProfiles === 'object' ? store.jobChatCompanyProfiles : {};
    next.jobChatCompanyProfiles = { ...profiles, [profile.companyKey]: profile };
  }
  await chrome.storage.local.set(next);
  return { ok: true };
}

async function saveAutoGreetingOutcome(message) {
  const siteKey = String(message.siteKey || 'boss').trim().toLowerCase();
  const jobId = String(message.jobId || '').trim().toLowerCase();
  if (!jobId) throw new Error('岗位 ID 为空。');
  const recruiterId = String(message.recruiterId || '').trim().toLowerCase();
  const historyKey = autoGreetingHistoryKey(message);
  const store = await chrome.storage.local.get([AUTO_GREETING_HISTORY_STORAGE_KEY]);
  const history = store[AUTO_GREETING_HISTORY_STORAGE_KEY] && typeof store[AUTO_GREETING_HISTORY_STORAGE_KEY] === 'object'
    ? store[AUTO_GREETING_HISTORY_STORAGE_KEY] : {};
  history[historyKey] = {
    ...(history[historyKey] || {}), siteKey, candidateKey: historyKey, jobId, recruiterId,
    runId: String(message.runId || ''),
    state: message.outcome === 'unknown' ? 'unknown' : 'failed',
    error: String(message.error || ''), updatedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [AUTO_GREETING_HISTORY_STORAGE_KEY]: history });
  return { ok: true };
}

async function saveAutoGreetingProgress(message, sender) {
  const store = await chrome.storage.local.get([AUTO_GREETING_RUN_STORAGE_KEY]);
  const run = store[AUTO_GREETING_RUN_STORAGE_KEY];
  if (!run || run.runId !== message.runId) return { ok: false, error: '任务已失效。' };
  if (sender.tab?.id && Number(sender.tab.id) !== Number(run.tabId)) return { ok: false, error: '任务标签页不匹配。' };
  const progress = message.progress || {};
  await chrome.storage.local.set({
    [AUTO_GREETING_RUN_STORAGE_KEY]: {
      ...run,
      ...progress,
      recommendedListUrl: String(message.recommendedListUrl || run.recommendedListUrl || ''),
      deadlineAt: Number(message.deadlineAt || run.deadlineAt || 0),
      timeLimitPaused: Boolean(message.timeLimitPaused),
      updatedAt: new Date().toISOString()
    }
  });
  const counts = `成功 ${Number(progress.succeeded || 0)}，处理 ${Number(progress.processed || 0)}，跳过 ${Number(progress.skipped || 0)}，失败 ${Number(progress.failed || 0)}`;
  await appendAutoGreetingLog(run.tabId, `${progress.currentJobName ? `${progress.currentJobName}：` : ''}${progress.statusText || progress.status || '状态更新'}（${counts}）`);
  return { ok: true };
}

async function readOnlineOnlyTabs() {
  const store = await chrome.storage.session.get([ONLINE_ONLY_TABS_STORAGE_KEY]);
  const value = store[ONLINE_ONLY_TABS_STORAGE_KEY];
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function onlineOnlyState(tabId) {
  const tabs = await readOnlineOnlyTabs();
  return Boolean(tabs[String(tabId)]);
}

async function setOnlineOnlyState(tabId, enabled) {
  const tabs = await readOnlineOnlyTabs();
  const key = String(tabId);
  if (enabled) tabs[key] = true;
  else delete tabs[key];
  await chrome.storage.session.set({ [ONLINE_ONLY_TABS_STORAGE_KEY]: tabs });
  return Boolean(enabled);
}

async function companyFilterState(tabId) {
  const store = await chrome.storage.session.get([COMPANY_FILTER_TABS_STORAGE_KEY]);
  const tabs = store[COMPANY_FILTER_TABS_STORAGE_KEY];
  return Boolean(tabs && typeof tabs === 'object' && tabs[String(tabId)]);
}

async function setCompanyFilterState(tabId, enabled) {
  const store = await chrome.storage.session.get([COMPANY_FILTER_TABS_STORAGE_KEY]);
  const tabs = store[COMPANY_FILTER_TABS_STORAGE_KEY]
    && typeof store[COMPANY_FILTER_TABS_STORAGE_KEY] === 'object'
    && !Array.isArray(store[COMPANY_FILTER_TABS_STORAGE_KEY])
    ? store[COMPANY_FILTER_TABS_STORAGE_KEY]
    : {};
  const key = String(tabId);
  if (enabled) tabs[key] = true;
  else delete tabs[key];
  await chrome.storage.session.set({ [COMPANY_FILTER_TABS_STORAGE_KEY]: tabs });
  return Boolean(enabled);
}

async function companyFilterKeywords() {
  const store = await chrome.storage.local.get([COMPANY_FILTER_KEYWORDS_STORAGE_KEY]);
  return String(store[COMPANY_FILTER_KEYWORDS_STORAGE_KEY] || '');
}

async function setCompanyFilterKeywords(value) {
  const keywords = String(value || '');
  companyFilterKeywordsSaveQueue = companyFilterKeywordsSaveQueue.catch(() => {}).then(async () => {
    await chrome.storage.local.set({ [COMPANY_FILTER_KEYWORDS_STORAGE_KEY]: keywords });
    return keywords;
  });
  return companyFilterKeywordsSaveQueue;
}

chrome.tabs.onRemoved.addListener((tabId) => {
  readOnlineOnlyTabs().then(async (tabs) => {
    const key = String(tabId);
    if (!Object.prototype.hasOwnProperty.call(tabs, key)) return;
    delete tabs[key];
    await chrome.storage.session.set({ [ONLINE_ONLY_TABS_STORAGE_KEY]: tabs });
  }).catch(() => {});
  chrome.storage.session.get([COMPANY_FILTER_TABS_STORAGE_KEY]).then(async (store) => {
    const tabs = store[COMPANY_FILTER_TABS_STORAGE_KEY];
    const key = String(tabId);
    if (!tabs || typeof tabs !== 'object' || !Object.prototype.hasOwnProperty.call(tabs, key)) return;
    delete tabs[key];
    await chrome.storage.session.set({ [COMPANY_FILTER_TABS_STORAGE_KEY]: tabs });
  }).catch(() => {});
  chrome.storage.session.get([AUTO_GREETING_LOG_TABS_STORAGE_KEY, AUTO_GREETING_LOGS_STORAGE_KEY]).then(async (store) => {
    const tabs = store[AUTO_GREETING_LOG_TABS_STORAGE_KEY] && typeof store[AUTO_GREETING_LOG_TABS_STORAGE_KEY] === 'object'
      ? store[AUTO_GREETING_LOG_TABS_STORAGE_KEY] : {};
    const logs = store[AUTO_GREETING_LOGS_STORAGE_KEY] && typeof store[AUTO_GREETING_LOGS_STORAGE_KEY] === 'object'
      ? store[AUTO_GREETING_LOGS_STORAGE_KEY] : {};
    delete tabs[String(tabId)];
    delete logs[String(tabId)];
    await chrome.storage.session.set({
      [AUTO_GREETING_LOG_TABS_STORAGE_KEY]: tabs,
      [AUTO_GREETING_LOGS_STORAGE_KEY]: logs
    });
  }).catch(() => {});
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.storage.local.get([AUTO_GREETING_RUN_STORAGE_KEY]).then((store) => {
    const run = store[AUTO_GREETING_RUN_STORAGE_KEY];
    if (!run || Number(run.tabId) !== Number(tabId) || !['running', 'refreshing'].includes(run.status)) return;
    chrome.tabs.sendMessage(tabId, { type: 'JOB_CHAT_AUTO_GREETING_WAKE' }).catch(() => {});
  }).catch(() => {});
});

chrome.storage.local.remove(['jobChatRequestLogs', 'jobChatRefreshLogs', 'jobChatBossSendLogs']).catch(() => {});
chrome.runtime.onInstalled.addListener((details) => {
  globalThis.JobChatAnalytics.handleInstalled(details).catch(() => {});
});
globalThis.JobChatAnalytics.clearUninstallUrl().catch(() => {});

function analyticsErrorCode(error) {
  const message = String(error?.message || error || '').toLowerCase();
  if (!message) return 'unknown';
  if (message.includes('不支持当前网站') || message.includes('暂不支持')) return 'unsupported_site';
  if (message.includes('cancel') || message.includes('中断') || message.includes('取消')) return 'cancelled';
  if (message.includes('code=37') || message.includes('安全验证') || message.includes('风控')) return 'risk_control';
  if (message.includes('storage') || message.includes('quota') || message.includes('保存')) return 'storage_failed';
  if (message.includes('network') || message.includes('fetch') || message.includes('网络')) return 'network_failed';
  if (message.includes('页面') || message.includes('tab') || message.includes('标签页')) return 'page_unavailable';
  return 'sync_failed';
}

async function extractFromTabWithAnalytics(tab, syncSelection) {
  const site = detectSupportedSite(tab?.url || '');
  try {
    const data = await extractFromTab(tab, syncSelection);
    const summary = data?.syncSummary || {};
    const stoppedByRiskControl = Boolean(summary.jobDetail?.stoppedByRiskControl);
    const interrupted = Boolean(summary.interrupted);
    await globalThis.JobChatAnalytics.sendEvent('sync_completed', {
      site: site?.key || 'none',
      record_count: Number(summary.synced || data?.records?.length || 0),
      inserted_count: Number(summary.inserted || 0),
      updated_count: Number(summary.updatedMsg ?? summary.updated ?? 0),
      page_mode: 'background',
      result: stoppedByRiskControl || interrupted ? 'cancelled' : 'success',
      error_code: stoppedByRiskControl ? 'risk_control' : (interrupted ? 'cancelled' : 'none')
    });
    return data;
  } catch (error) {
    await globalThis.JobChatAnalytics.sendEvent('sync_failed', {
      site: site?.key || 'none',
      page_mode: 'background',
      result: analyticsErrorCode(error) === 'cancelled' ? 'cancelled' : 'failed',
      error_code: analyticsErrorCode(error)
    });
    throw error;
  }
}

function unsupportedMessage(tabUrl) {
  const hostname = getHostname(tabUrl) || tabUrl || '当前页面';
  return `暂不支持当前网站：${hostname}\n目前支持 ${supportedSiteNames()}。`;
}

function sendExtractMessage(tabId, site, extra = {}) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: site.messageType, siteKey: site.key, ...extra }, (response) => {
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
  const byKey = new Map(validTargets.map((target) => [String(target.recordKey), target]));
  const store = await chrome.storage.local.get(['jobChatRecords']);
  const records = Array.isArray(store.jobChatRecords) ? store.jobChatRecords : [];
  let changed = false;
  const allowedFields = [
    'ownerUserId', 'friendId', 'peerKey', 'chatSecurityId',
    'friendSource', 'bossId', 'encryptBossId', 'jobId'
  ];
  const nextRecords = records.map((record) => {
    const refreshedTarget = byKey.get(String(record?.recordKey || ''));
    if (!refreshedTarget) return record;
    const refreshed = refreshedTarget.boss || {};
    const boss = { ...(record.boss || {}) };
    allowedFields.forEach((field) => {
      if (refreshed[field] !== undefined && refreshed[field] !== '') boss[field] = refreshed[field];
    });
    delete boss.bossSecurityId;
    delete boss.bossJobSecurityId;
    delete boss.uploadSecurityId;
    delete boss.encryptJobId;
    changed = true;
    const nextRecord = { ...record, boss };
    delete nextRecord.bossJobSecurityId;
    return nextRecord;
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
    const conversation = record.conversation && typeof record.conversation === 'object'
      ? globalThis.JobChatRecords.normalizeConversation({
          ...record.conversation,
          sync: {
            ...(record.conversation.sync || {}),
            complete: false
          }
        })
      : undefined;
    return {
      ...record,
      ...(conversation ? { conversation } : {}),
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

async function updateLiepinRecordFromSendProgress(progress) {
  const recordKey = String(progress?.recordKey || '');
  if (!recordKey) return;
  const oppositeUserId = String(progress?.oppositeUserId || '').trim();
  const sentMessage = String(progress?.sentMessage || '');
  const sent = (progress?.status === '成功' || progress?.status === '已发送') && sentMessage;
  if (!oppositeUserId && !sent) return;
  const store = await chrome.storage.local.get(['jobChatRecords']);
  const records = Array.isArray(store.jobChatRecords) ? store.jobChatRecords : [];
  const rawTimestamp = Number(progress?.msgTime || Date.now());
  const timestamp = Number.isFinite(rawTimestamp) && rawTimestamp > 0 ? rawTimestamp : Date.now();
  const sentAt = new Date(timestamp);
  const updatedDate = localDateTime(sentAt);
  let changed = false;
  const nextRecords = records.map((record) => {
    if (String(record?.recordKey || '') !== recordKey) return record;
    changed = true;
    const liepin = {
      ...(record.liepin || {}),
      ...(oppositeUserId ? { oppositeUserId } : {})
    };
    if (!sent) return { ...record, liepin };
    const conversation = record.conversation && typeof record.conversation === 'object'
      ? globalThis.JobChatRecords.normalizeConversation({
          ...record.conversation,
          sync: {
            ...(record.conversation.sync || {}),
            complete: false
          }
        })
      : undefined;
    return {
      ...record,
      ...(conversation ? { conversation } : {}),
      time: updatedDate,
      updatedDate,
      updatedAt: sentAt.toISOString(),
      lastMessage: sentMessage,
      messageStatus: '0',
      liepin: {
        ...liepin,
        latestMsgId: String(progress?.msgId || liepin.latestMsgId || ''),
        latestMsgTime: timestamp,
        oppositeRead: '0'
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

function reloadTabAndWait(tabId, timeoutMs = 30000, shouldContinue) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      clearInterval(cancelPoll);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish();
    };
    const timeout = setTimeout(() => finish(new Error('刷新 BOSS 标签页等待超时。')), timeoutMs);
    const cancelPoll = setInterval(() => {
      if (!shouldContinue || shouldContinue()) return;
      const error = new Error('岗位信息同步已停止。');
      error.name = 'AbortError';
      finish(error);
    }, 250);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.reload(tabId, {}, () => {
      if (chrome.runtime.lastError) finish(new Error(chrome.runtime.lastError.message));
    });
  });
}

async function waitWhileJobDetailRefreshActive(runId, milliseconds) {
  const deadline = Date.now() + milliseconds;
  let nextKeepAliveAt = 0;
  while (Date.now() < deadline) {
    if (runId && activeJobDetailRefreshRunId !== runId) return false;
    if (Date.now() >= nextKeepAliveAt) {
      await chrome.storage.local.get(['jobChatRefreshProgress']);
      nextKeepAliveAt = Date.now() + 5000;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, Math.max(0, deadline - Date.now()))));
  }
  return !runId || activeJobDetailRefreshRunId === runId;
}

async function waitWhileSyncActive(siteKey, milliseconds) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    const state = await chrome.storage.local.get(['jobChatCancelRequested', 'jobChatLiepinCancelRequested']);
    if (siteKey === 'boss' ? state.jobChatCancelRequested : state.jobChatLiepinCancelRequested) return false;
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, Math.max(0, deadline - Date.now()))));
  }
  return true;
}

async function sendJobDetailRefreshToTab(tabId, payload) {
  let response = await sendMessageToTab(tabId, payload);
  if (response?.ok || !/Receiving end does not exist|Could not establish connection/i.test(String(response?.error || ''))) return response;
  await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPT_FILES });
  response = await sendMessageToTab(tabId, payload);
  return response;
}

function addJobDetailStats(target, source) {
  if (!source) return target;
  ['requested', 'success', 'failed', 'skipped', 'riskPauses'].forEach((field) => {
    target[field] = Number(target[field] || 0) + Number(source[field] || 0);
  });
  target.stoppedByRiskControl = Boolean(target.stoppedByRiskControl || source.stoppedByRiskControl);
  return target;
}

function addConversationStats(target, source) {
  if (!source) return target;
  ['requested', 'success', 'failed', 'skipped', 'messageFailed'].forEach((field) => {
    target[field] = Number(target[field] || 0) + Number(source[field] || 0);
  });
  return target;
}

function buildRefreshRecordStats(records, resultsByKey, riskControls = 0) {
  const stats = {
    success: 0,
    failed: 0,
    skipped: 0,
    riskControls: Number(riskControls || 0)
  };
  records.forEach((record) => {
    const result = resultsByKey.get(String(record?.recordKey || ''));
    if (!result || result.skipped) {
      stats.skipped += 1;
    } else if (result.ok) {
      stats.success += 1;
    } else {
      stats.failed += 1;
    }
  });
  return stats;
}

async function getTabSnapshot(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return { tabId, url: String(tab?.url || ''), title: String(tab?.title || ''), status: String(tab?.status || '') };
  } catch (error) {
    return { tabId, url: '', title: '', status: '', error: error?.message || String(error) };
  }
}

function appendSyncReloadLog(entry, includeRefreshSummary = false) {
  const time = new Date().toISOString();
  try {
    chrome.runtime.sendMessage({
      type: 'JOB_CHAT_LOG_EVENT',
      logType: 'request',
      entry: { time, siteKey: 'boss', ...entry }
    }).catch(() => {});
    if (includeRefreshSummary) {
      chrome.runtime.sendMessage({
        type: 'JOB_CHAT_LOG_EVENT',
        logType: 'summary',
        entry: { time, siteKey: 'boss', step: entry.step, message: entry.message }
      }).catch(() => {});
    }
  } catch (_) {}
  return Promise.resolve();
}

async function refreshSelectedRecords(message) {
  const recordKeys = new Set((Array.isArray(message?.recordKeys) ? message.recordKeys : []).map(String));
  if (!recordKeys.size) throw new Error('没有选中记录。');
  const storageScope = message?.storageScope === 'pending' ? 'pending' : 'total';
  const store = await chrome.storage.local.get(['jobChatRecords', 'jobChatPendingRecords']);
  const storedSourceRecords = storageScope === 'pending'
    ? (Array.isArray(store.jobChatPendingRecords?.records) ? store.jobChatPendingRecords.records : [])
    : (Array.isArray(store.jobChatRecords) ? store.jobChatRecords : []);
  let sourceRecordsNeedMigration = false;
  const sourceRecords = storedSourceRecords.map((storedRecord, index) => {
    const migratedRecord = migrateBossChatSecurityId(storedRecord);
    const normalizedRecord = globalThis.JobChatRecords.normalizeStoredRecord(migratedRecord, index);
    if (migratedRecord !== storedRecord || normalizedRecord.recordKey !== storedRecord?.recordKey) {
      sourceRecordsNeedMigration = true;
    }
    return normalizedRecord;
  });
  if (sourceRecordsNeedMigration) {
    if (storageScope === 'pending') {
      const pending = { ...(store.jobChatPendingRecords || {}), records: sourceRecords, total: sourceRecords.length };
      await chrome.storage.local.set({ jobChatPendingRecords: pending, bossChatStatsLatest: pending });
    } else {
      await chrome.storage.local.set({ jobChatRecords: sourceRecords });
    }
  }
  const selectedRecords = sourceRecords.filter((record) => recordKeys.has(String(record?.recordKey || '')));
  const pendingOrder = new Map((store.jobChatPendingRecords?.records || []).map((record, index) => [String(record?.recordKey || ''), index]));
  const sourceOrder = new Map(sourceRecords.map((record, index) => [String(record?.recordKey || ''), index]));
  const records = [...selectedRecords].sort((left, right) => {
    const leftKey = String(left?.recordKey || '');
    const rightKey = String(right?.recordKey || '');
    const leftOrder = pendingOrder.has(leftKey) ? pendingOrder.get(leftKey) : sourceOrder.get(leftKey);
    const rightOrder = pendingOrder.has(rightKey) ? pendingOrder.get(rightKey) : sourceOrder.get(rightKey);
    return Number(leftOrder || 0) - Number(rightOrder || 0);
  });
  const sourceKeyCounts = new Map();
  sourceRecords.forEach((record) => {
    const key = String(record?.recordKey || '');
    if (key) sourceKeyCounts.set(key, Number(sourceKeyCounts.get(key) || 0) + 1);
  });
  const storageScopeName = storageScope === 'pending' ? '本次同步记录' : '总记录';
  const missingKeys = [...recordKeys].filter((key) => !sourceKeyCounts.has(key));
  if (missingKeys.length) {
    throw new Error(`选中的记录已不在${storageScopeName}中：${missingKeys.slice(0, 3).join('、')}${missingKeys.length > 3 ? ` 等 ${missingKeys.length} 条` : ''}。请刷新列表后重试。`);
  }
  const duplicateKeys = [...recordKeys].filter((key) => Number(sourceKeyCounts.get(key) || 0) > 1);
  if (duplicateKeys.length) {
    throw new Error(`${storageScopeName}中存在重复唯一标识：${duplicateKeys.slice(0, 3).join('、')}。请先整理重复记录后重试。`);
  }
  const recordSiteKey = (record) => record?.siteKey || (record?.sourceName === '猎聘' ? 'liepin' : (record?.sourceName === 'BOSS直聘' ? 'boss' : ''));
  const selectedSiteKeys = new Set(records.map(recordSiteKey).filter(Boolean));
  if (selectedSiteKeys.size !== 1) throw new Error('请选择同一个招聘网站的记录后再更新岗位与消息。');
  const siteKey = [...selectedSiteKeys][0];
  if (siteKey !== 'boss' && siteKey !== 'liepin') throw new Error('选中记录所属网站暂不支持岗位详情更新。');
  const siteName = siteKey === 'liepin' ? '猎聘' : 'BOSS直聘';
  const tabPatterns = siteKey === 'liepin'
    ? ['https://*.liepin.com/*']
    : ['https://*.zhipin.com/*'];
  const tabs = await chrome.tabs.query({ url: tabPatterns });
  if (!tabs.length) throw new Error(`没有打开${siteName}标签页，请打开并登录后重试。`);
  const tab = [...tabs].sort((left, right) => Number(right.lastAccessed || 0) - Number(left.lastAccessed || 0))[0];
  if (!tab?.id) throw new Error(`无法选择${siteName}标签页。`);
  activeJobDetailRefreshTabId = tab.id;
  activeJobDetailRefreshRunId = message.runId || null;
  const runId = message.runId || null;
  const retryDelaySeconds = Math.max(1, Math.min(3600, Math.floor(Number(message.retryDelaySeconds || 60))));
  const retryCount = Math.max(1, Math.min(10, Math.floor(Number(message.retryCount || 3))));
  const retryAttempts = new Map();
  const refreshedByKey = new Map();
  const resultsByKey = new Map();
  const jobDetail = { requested: 0, success: 0, failed: 0, skipped: 0, riskPauses: 0, stoppedByRiskControl: false };
  const conversation = { requested: 0, success: 0, failed: 0, skipped: 0, messageFailed: 0 };
  let remainingRecords = records;
  let response = null;
  let paused = false;
  let stopped = false;

  await appendSyncReloadLog({
    siteKey,
    step: 'jobDetail:dispatch:start',
    message: `开始向${siteName}标签页发送岗位与消息同步任务；tabId=${tab.id}；记录=${records.length} 条。`,
    runId,
    storageScope,
    recordCount: records.length,
    recordKeys: records.map((record) => String(record?.recordKey || '')),
    tab: await getTabSnapshot(tab.id)
  }, true);

  while (remainingRecords.length) {
    if (runId && activeJobDetailRefreshRunId !== runId) {
      stopped = true;
      break;
    }
    const batchRecords = remainingRecords;
    const dispatchStartedAt = Date.now();
    try {
      response = await sendJobDetailRefreshToTab(tab.id, {
        type: 'JOB_CHAT_REFRESH_RECORDS',
        records: batchRecords,
        storageScope,
        rate: message.rate,
        retryDelaySeconds,
        retryCount,
        riskRetryAttempts: Object.fromEntries(retryAttempts),
        allowRiskReload: true,
        debugLog: Boolean(message.debugLog),
        runId
      });
    } catch (error) {
      await appendSyncReloadLog({
        siteKey,
        step: 'jobDetail:dispatch:error',
        message: `向${siteName}标签页发送同步任务时异常；tabId=${tab.id}；${error?.message || String(error)}`,
        runId,
        recordCount: batchRecords.length,
        elapsedMs: Date.now() - dispatchStartedAt,
        error: error?.message || String(error),
        tab: await getTabSnapshot(tab.id)
      }, true);
      throw error;
    }
    const responseError = String(response?.error || '');
    await appendSyncReloadLog({
      siteKey,
      step: response?.ok ? 'jobDetail:dispatch:complete' : 'jobDetail:dispatch:failed',
      message: response?.ok
        ? `${siteName}标签页已返回同步结果；tabId=${tab.id}；耗时=${Date.now() - dispatchStartedAt}ms。`
        : `${siteName}标签页同步消息失败；tabId=${tab.id}；${responseError || '未返回错误信息'}`,
      runId,
      recordCount: batchRecords.length,
      elapsedMs: Date.now() - dispatchStartedAt,
      response: {
        ok: Boolean(response?.ok),
        error: responseError,
        contextInvalidated: /Extension context invalidated|message port closed|Receiving end does not exist|Could not establish connection/i.test(responseError)
      },
      tab: await getTabSnapshot(tab.id)
    }, true);
    if (!response?.ok) break;

    const data = response.data || {};
    (Array.isArray(data.records) ? data.records : []).forEach((record) => {
      if (record?.recordKey) refreshedByKey.set(String(record.recordKey), record);
    });
    (Array.isArray(data.results) ? data.results : []).forEach((result) => {
      if (result?.recordKey) resultsByKey.set(String(result.recordKey), result);
    });
    addJobDetailStats(jobDetail, data.jobDetail);
    addConversationStats(conversation, data.conversation);

    const completedKeys = new Set([...resultsByKey.keys()]);
    remainingRecords = records.filter((record) => !completedKeys.has(String(record.recordKey)));

    const riskReload = Boolean(data.reloadRequired);
    const intervalReload = !riskReload && Boolean(data.periodicReloadRequired);
    if (!riskReload && !intervalReload) {
      paused = Boolean(data.paused);
      stopped = Boolean(data.stopped);
      break;
    }

    const retryRecordKey = String(data.retryRecordKey || remainingRecords[0]?.recordKey || '');
    const nextAttempt = riskReload ? (retryAttempts.get(retryRecordKey) || 0) + 1 : 0;
    if (riskReload) retryAttempts.set(retryRecordKey, nextAttempt);
    const beforeReload = await getTabSnapshot(tab.id);
    await appendSyncReloadLog({
      step: 'jobDetail:tabReload:start',
      message: riskReload
        ? `岗位详情接口返回 code=37，开始刷新 BOSS 标签页；tabId=${tab.id}；记录=${retryRecordKey}；重试=${nextAttempt}/${retryCount}；URL=${beforeReload.url}`
        : `已完成 4 条岗位详情同步，开始周期刷新 BOSS 标签页；tabId=${tab.id}；下一条记录=${retryRecordKey}；URL=${beforeReload.url}`,
      recordKey: retryRecordKey,
      attempt: nextAttempt,
      retryCount,
      reason: riskReload ? 'code37' : 'interval',
      phase: 'start',
      tab: beforeReload
    }, true);
    if (riskReload) {
      await chrome.storage.local.set({
        jobChatRefreshProgress: {
          recordKey: retryRecordKey,
          status: '重试中',
          error: `接口返回 code=37，正在刷新 BOSS 标签页（第 ${nextAttempt}/${retryCount} 次重试）。`,
          remainingSeconds: 0,
          retryAt: 0,
          storageScope,
          runId,
          updatedAt: new Date().toISOString()
        }
      });
    }
    try {
      await reloadTabAndWait(tab.id, 30000, () => !runId || activeJobDetailRefreshRunId === runId);
    } catch (error) {
      await appendSyncReloadLog({
        step: 'jobDetail:tabReload:error',
        message: `BOSS 标签页${riskReload ? '风控' : '周期'}刷新${error?.name === 'AbortError' ? '已取消' : '失败'}；tabId=${tab.id}；记录=${retryRecordKey}；${error?.message || String(error)}`,
        recordKey: retryRecordKey,
        attempt: nextAttempt,
        retryCount,
        reason: riskReload ? 'code37' : 'interval',
        phase: error?.name === 'AbortError' ? 'cancelled' : 'error',
        tab: await getTabSnapshot(tab.id),
        error: error?.message || String(error)
      }, true);
      if (error?.name !== 'AbortError') throw error;
      stopped = true;
      break;
    }
    const afterReload = await getTabSnapshot(tab.id);
    await appendSyncReloadLog({
      step: 'jobDetail:tabReload:complete',
      message: riskReload
        ? `BOSS 标签页风控刷新完成；tabId=${tab.id}；记录=${retryRecordKey}；重试=${nextAttempt}/${retryCount}；URL=${afterReload.url}`
        : `BOSS 标签页周期刷新完成；tabId=${tab.id}；下一条记录=${retryRecordKey}；URL=${afterReload.url}`,
      recordKey: retryRecordKey,
      attempt: nextAttempt,
      retryCount,
      reason: riskReload ? 'code37' : 'interval',
      phase: 'complete',
      tab: afterReload
    }, true);
    if (!riskReload) continue;
    const retryAt = Date.now() + retryDelaySeconds * 1000;
    await appendSyncReloadLog({
      step: 'jobDetail:tabReload:retryWait',
      message: `刷新后等待 ${retryDelaySeconds} 秒，再从记录 ${retryRecordKey} 重新执行同步。`,
      recordKey: retryRecordKey,
      attempt: nextAttempt,
      retryCount,
      phase: 'retry-wait',
      waitSeconds: retryDelaySeconds,
      retryAt,
      tab: afterReload
    }, true);
    await chrome.storage.local.set({
      jobChatRefreshProgress: {
        recordKey: retryRecordKey,
        status: '重试中',
        error: `接口返回 code=37，BOSS 标签页已刷新，第 ${nextAttempt}/${retryCount} 次重试，等待剩余 ${retryDelaySeconds} 秒。`,
        remainingSeconds: retryDelaySeconds,
        retryAt,
        storageScope,
        runId,
        updatedAt: new Date().toISOString()
      }
    });
    if (!await waitWhileJobDetailRefreshActive(runId, retryDelaySeconds * 1000)) {
      stopped = true;
      break;
    }
  }

  if (!message.runId || activeJobDetailRefreshRunId === message.runId) {
    activeJobDetailRefreshTabId = null;
    activeJobDetailRefreshRunId = null;
  }
  if (!response?.ok && !stopped) {
    await appendSyncReloadLog({
      siteKey,
      step: 'refresh:messageResponse',
      request: { type: 'JOB_CHAT_REFRESH_RECORDS', tabId: tab.id, recordKeys: records.map((record) => record.recordKey), rate: message.rate, debugLog: Boolean(message.debugLog) },
      response: { ok: Boolean(response?.ok), error: String(response?.error || '').slice(0, 500) }
    });
    throw new Error(response?.error || '更新岗位与消息失败。');
  }
  const refreshed = [...refreshedByKey.values()];
  const byKey = new Map(refreshed.map((record) => [String(record.recordKey), record]));
  const merge = (oldRecord) => {
    const next = byKey.get(String(oldRecord?.recordKey || ''));
    if (!next) return oldRecord;
    return migrateBossChatSecurityId({
      ...oldRecord, ...next,
      boss: { ...(oldRecord.boss || {}), ...(next.boss || {}) },
      liepin: { ...(oldRecord.liepin || {}), ...(next.liepin || {}) },
      jobRef: { ...(oldRecord.jobRef || {}), ...(next.jobRef || {}) },
      jobInfo: next.jobInfo || oldRecord.jobInfo || {},
      ...mergedConversationFields(oldRecord, next),
      note: oldRecord.note || next.note || '',
      applicationDate: oldRecord.applicationDate || next.applicationDate
    });
  };
  if (storageScope === 'pending') {
    const pending = store.jobChatPendingRecords || { records: [] };
    const nextRecords = sourceRecords.map(merge);
    await chrome.storage.local.set({ jobChatPendingRecords: { ...pending, records: nextRecords, total: nextRecords.length, extractedAt: new Date().toISOString() } });
  } else {
    await chrome.storage.local.set({ jobChatRecords: sourceRecords.map(merge) });
  }
  const results = [...resultsByKey.values()];
  const recordStats = buildRefreshRecordStats(records, resultsByKey, jobDetail.riskPauses);
  return {
    ok: true,
    total: records.length,
    updated: refreshed.length,
    failed: results.filter((result) => !result.ok).length,
    results,
    paused,
    stopped,
    recordStats,
    jobDetail,
    conversation
  };
}

async function stopJobDetailRefresh() {
  if (!activeJobDetailRefreshTabId) return { ok: true };
  const tabId = activeJobDetailRefreshTabId;
  activeJobDetailRefreshTabId = null;
  activeJobDetailRefreshRunId = null;
  chrome.tabs.sendMessage(tabId, { type: 'JOB_CHAT_STOP_REFRESH' }, () => void chrome.runtime.lastError);
  return { ok: true };
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

async function sendLiepinBatch(message) {
  const keys = new Set(Array.isArray(message?.recordKeys) ? message.recordKeys.map(String) : []);
  if (!keys.size) throw new Error('没有选中记录。');
  const store = await chrome.storage.local.get(['jobChatRecords']);
  const records = (Array.isArray(store.jobChatRecords) ? store.jobChatRecords : [])
    .filter((record) => keys.has(String(record.recordKey)));
  if (records.length !== keys.size) throw new Error('部分选中记录已不存在，请刷新总览后重试。');
  if (records.some((record) => record.siteKey !== 'liepin' && record.sourceName !== '猎聘')) {
    throw new Error('选中记录包含 BOSS，不能发送整个批次。');
  }
  const tabs = await chrome.tabs.query({ url: ['https://*.liepin.com/*'] });
  if (!tabs.length) throw new Error('没有打开猎聘标签页，请打开并登录后重试。');
  const tab = [...tabs].sort((left, right) => Number(right.lastAccessed || 0) - Number(left.lastAccessed || 0))[0];
  if (!tab?.id) throw new Error('无法选择猎聘标签页。');
  const targets = records.map((record) => ({
    recordKey: record.recordKey,
    liepin: record.liepin || {}
  }));
  const response = await sendBossBatchToTab(tab.id, {
    type: 'LIEPIN_SEND_BATCH',
    targets,
    message: message.message,
    rate: message.rate
  });
  if (!response?.ok) throw new Error(response?.error || '无法启动猎聘发送任务，请刷新猎聘页面后重试。');
  activeLiepinSendTabId = tab.id;
  return { ok: true, total: targets.length };
}

async function sendChatBatch(message) {
  const siteKey = String(message?.siteKey || '');
  if (activeBossSendTabId || activeLiepinSendTabId) throw new Error('已有发送批次正在运行。');
  if (siteKey === 'boss') return sendBossBatch(message);
  if (siteKey === 'liepin') return sendLiepinBatch(message);
  throw new Error('无法确定选中记录所属网站。');
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

async function stopChatBatch() {
  if (activeLiepinSendTabId) {
    const tabId = activeLiepinSendTabId;
    const response = await sendMessageToTab(tabId, { type: 'LIEPIN_STOP_BATCH' });
    if (!response?.ok) throw new Error(response?.error || '无法停止猎聘发送任务。');
    return { ok: true };
  }
  return stopBossBatch();
}

async function ensureResultsTab() {
  const url = chrome.runtime.getURL(globalThis.JobChatRuntimeConfig.resultsPagePath('sync'));
  const tab = await chrome.tabs.create({ url, active: true });
  return tab.id;
}


async function prepareSyncFromTab(tab) {
  if (!tab?.id) throw new Error('没有找到当前活动标签页。');
  const site = detectSupportedSite(tab.url || '');
  if (!site) throw new Error(unsupportedMessage(tab.url || ''));

  await chrome.storage.local.set({
    jobChatLiepinCancelRequested: true,
    jobChatCancelRequested: true
  });
  try {
    chrome.runtime.sendMessage({ type: 'JOB_CHAT_LOG_EVENT', logType: 'clear' }).catch(() => {});
  } catch (_) {}
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
  const updatedMsg = hasActionSummary ? Number(summary.updatedMsg ?? summary.updated ?? 0) : 0;
  const jobDetailSync = Math.max(0, Number(summary.jobDetailSync || 0));
  const readyMessage = total === 0
    ? `${site.source}没有待同步记录。`
    : `已获取${site.source}待更新记录 ${total} 条，其中消息状态：新增 ${inserted} 条，更新 ${updatedMsg} 条；岗位详情同步 ${jobDetailSync} 条。请设置同步速率后点击“同步”。`;
  const pendingData = {
    pageTitle: response.data?.pageTitle || '',
    pageUrl: response.data?.pageUrl || tab.url || '',
    extractedAt: new Date().toISOString(),
    siteKey: site.key,
    siteTitle: site.title,
    sourceName: site.source,
    total: 0,
    records: [],
    syncSummary: { fetched: 0, inserted, updated: updatedMsg, updatedMsg, jobDetailSync, saved: false, interrupted: false, completed: total === 0, synced: 0, sourceTotal: total }
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
      progressCategories: {
        communication: { completed: 0, total: inserted + updatedMsg },
        jobDetail: { completed: 0, total: jobDetailSync }
      },
      jobDetailRequired: jobDetailSync > 0,
      message: readyMessage
    }
  });
  return pendingData;
}

async function extractFromTab(tab, syncSelection) {
  if (!tab?.id) throw new Error('没有找到当前活动标签页。');

  const site = detectSupportedSite(tab.url || '');
  if (!site) throw new Error(unsupportedMessage(tab.url || ''));
  activeSyncReloadCancelled = false;
  const preparedStore = await chrome.storage.local.get([
    'jobChatExtractionStatus',
    'jobChatPreparedSourceList',
    'jobChatPendingRecords'
  ]);
  const preparedCategories = preparedStore.jobChatExtractionStatus?.progressCategories || {};
  const preparedSnapshot = preparedStore.jobChatPreparedSourceList?.siteKey === site.key
    ? preparedStore.jobChatPreparedSourceList
    : null;
  const preparedSummary = preparedSnapshot?.syncSummary || {};
  const pendingSummary = preparedStore.jobChatPendingRecords?.siteKey === site.key
    ? preparedStore.jobChatPendingRecords?.syncSummary || {}
    : {};
  const hasInterruptedProgress = Boolean(pendingSummary.interrupted)
    && Number(pendingSummary.synced || 0) > 0;
  const previousSummary = hasInterruptedProgress ? pendingSummary : {};
  const previousJobDetail = previousSummary.jobDetail || {};
  const previousConversation = previousSummary.conversation || {};
  const previousInserted = Number(previousSummary.inserted || 0);
  const previousUpdated = Number(previousSummary.updatedMsg ?? previousSummary.updated ?? 0);
  const previousSynced = Number(previousSummary.synced || 0);
  const previousJobDetailCompleted = Number(previousJobDetail.success || 0)
    + Number(previousJobDetail.failed || 0)
    + Number(previousJobDetail.skipped || 0);
  const preparedCommunicationTotal = Number(
    preparedSummary.messageSync
      ?? (Number(preparedSummary.inserted || 0) + Number(preparedSummary.updatedMsg ?? preparedSummary.updated ?? 0))
  );
  activeExtractionProgressContext = {
    siteKey: site.key,
    syncedCompleted: previousSynced,
    sourceTotal: Number(
      preparedSummary.sourceTotal
        || previousSummary.sourceTotal
        || preparedStore.jobChatExtractionStatus?.total
        || 0
    ),
    insertedCompleted: previousInserted,
    updatedCompleted: previousUpdated,
    communicationCompleted: previousInserted + previousUpdated + Number(previousConversation.messageFailed || 0),
    jobDetailCompleted: previousJobDetailCompleted,
    communicationTotal: Math.max(
      previousInserted + previousUpdated,
      previousInserted + previousUpdated + Number(previousConversation.messageFailed || 0),
      preparedCommunicationTotal,
      Number(preparedCategories.communication?.total || 0)
    ),
    jobDetailTotal: Math.max(
      previousJobDetailCompleted,
      Number(preparedSummary.jobDetailSync || 0),
      Number(preparedCategories.jobDetail?.total || 0)
    )
  };

  await chrome.storage.local.set({
    jobChatLiepinCancelRequested: false,
    jobChatCancelRequested: false
  });

  await chrome.storage.local.set({
    jobChatExtractionStatus: {
      state: 'loading',
      siteKey: site.key,
      siteTitle: site.title,
      sourceName: site.source,
      startedAt: new Date().toISOString(),
      progressCategories: {
        communication: {
          completed: activeExtractionProgressContext.communicationCompleted,
          total: activeExtractionProgressContext.communicationTotal
        },
        jobDetail: {
          completed: activeExtractionProgressContext.jobDetailCompleted,
          total: activeExtractionProgressContext.jobDetailTotal
        }
      },
      jobDetailRequired: activeExtractionProgressContext.jobDetailTotal > 0,
      message: `正在提取${site.source}沟通记录...`
    }
  });

  const retryStore = await chrome.storage.local.get(['jobChatJobDetailRetryDelay', 'jobChatJobDetailRetryCount']);
  const retryDelaySeconds = Math.max(1, Math.min(3600, Math.floor(Number(retryStore.jobChatJobDetailRetryDelay || 60))));
  const retryCount = Math.max(1, Math.min(10, Math.floor(Number(retryStore.jobChatJobDetailRetryCount || 3))));
  const retryAttempts = new Map();
  const accumulatedSummary = {
    inserted: previousInserted,
    updated: previousUpdated,
    updatedMsg: previousUpdated,
    synced: previousSynced,
    jobDetail: {
      requested: Number(previousJobDetail.requested || 0),
      success: Number(previousJobDetail.success || 0),
      failed: Number(previousJobDetail.failed || 0),
      skipped: Number(previousJobDetail.skipped || 0),
      riskPauses: Number(previousJobDetail.riskPauses || 0),
      stoppedByRiskControl: Boolean(previousJobDetail.stoppedByRiskControl)
    },
    conversation: {
      requested: Number(previousConversation.requested || 0),
      success: Number(previousConversation.success || 0),
      failed: Number(previousConversation.failed || 0),
      skipped: Number(previousConversation.skipped || 0),
      messageFailed: Number(previousConversation.messageFailed || 0)
    }
  };
  let firstSourceTotal = Number(
    preparedSummary.sourceTotal
      || previousSummary.sourceTotal
      || preparedStore.jobChatExtractionStatus?.total
      || 0
  );
  let response = null;

  while (true) {
    const payload = {
      syncSelection,
      retryDelaySeconds,
      retryCount,
      riskRetryAttempts: Object.fromEntries(retryAttempts),
      allowRiskReload: true
    };
    response = await sendExtractMessage(tab.id, site, payload);

    if (!response?.ok) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_SCRIPT_FILES });
      response = await sendExtractMessage(tab.id, site, payload);
    }
    if (!response?.ok) break;
    const riskReload = Boolean(response.data?.reloadRequired);
    const intervalReload = Boolean(response.data?.periodicReloadRequired);
    if (!riskReload && !intervalReload) break;

    const summary = response.data.syncSummary || {};
    if (!firstSourceTotal) firstSourceTotal = Number(summary.sourceTotal || response.data.sourceTotal || 0);
    accumulatedSummary.inserted += Number(summary.inserted || 0);
    accumulatedSummary.updated += Number(summary.updated || 0);
    accumulatedSummary.updatedMsg += Number(summary.updatedMsg ?? summary.updated ?? 0);
    accumulatedSummary.synced += Number(response.data.synced || 0);
    addJobDetailStats(accumulatedSummary.jobDetail, summary.jobDetail);
    addConversationStats(accumulatedSummary.conversation, summary.conversation);
    if (activeExtractionProgressContext) {
      activeExtractionProgressContext.syncedCompleted = accumulatedSummary.synced;
      activeExtractionProgressContext.insertedCompleted = accumulatedSummary.inserted;
      activeExtractionProgressContext.updatedCompleted = accumulatedSummary.updatedMsg;
      activeExtractionProgressContext.communicationCompleted = accumulatedSummary.inserted
        + accumulatedSummary.updatedMsg
        + accumulatedSummary.conversation.messageFailed;
      activeExtractionProgressContext.jobDetailCompleted = accumulatedSummary.jobDetail.success
        + accumulatedSummary.jobDetail.failed
        + accumulatedSummary.jobDetail.skipped;
    }

    const currentRecordKey = String(response.data.retryRecordKey || '');
    const nextAttempt = riskReload ? (retryAttempts.get(currentRecordKey) || 0) + 1 : 0;
    if (riskReload) retryAttempts.set(currentRecordKey, nextAttempt);
    const beforeReload = await getTabSnapshot(tab.id);
    await appendSyncReloadLog({
      step: 'jobDetail:tabReload:start',
      message: riskReload
        ? `岗位详情接口返回 code=37，开始刷新 BOSS 标签页；tabId=${tab.id}；记录=${currentRecordKey}；重试=${nextAttempt}/${retryCount}；URL=${beforeReload.url}`
        : `已完成 4 条岗位详情同步，开始周期刷新 BOSS 标签页；tabId=${tab.id}；URL=${beforeReload.url}`,
      recordKey: currentRecordKey,
      attempt: nextAttempt,
      retryCount,
      reason: riskReload ? 'code37' : 'interval',
      phase: 'start',
      tab: beforeReload
    });
    if (riskReload) {
      await chrome.storage.local.set({
        jobChatExtractionStatus: {
          state: 'loading',
          siteKey: site.key,
          siteTitle: site.title,
          sourceName: site.source,
          startedAt: new Date().toISOString(),
          message: `岗位详情接口返回 code=37，正在刷新 BOSS 标签页（第 ${nextAttempt}/${retryCount} 次重试）。`
        }
      });
    }
    try {
      await reloadTabAndWait(tab.id, 30000, () => !activeSyncReloadCancelled);
    } catch (error) {
      await appendSyncReloadLog({
        step: 'jobDetail:tabReload:error',
        message: `BOSS 标签页${riskReload ? '风控' : '周期'}刷新${error?.name === 'AbortError' ? '已取消' : '失败'}；tabId=${tab.id}；记录=${currentRecordKey}；${error?.message || String(error)}`,
        recordKey: currentRecordKey,
        attempt: nextAttempt,
        retryCount,
        reason: riskReload ? 'code37' : 'interval',
        phase: error?.name === 'AbortError' ? 'cancelled' : 'error',
        tab: await getTabSnapshot(tab.id),
        error: error?.message || String(error)
      });
      if (error?.name !== 'AbortError') throw error;
      break;
    }
    const afterReload = await getTabSnapshot(tab.id);
    await appendSyncReloadLog({
      step: 'jobDetail:tabReload:complete',
      message: riskReload
        ? `BOSS 标签页风控刷新完成；tabId=${tab.id}；记录=${currentRecordKey}；重试=${nextAttempt}/${retryCount}；URL=${afterReload.url}`
        : `BOSS 标签页周期刷新完成；tabId=${tab.id}；URL=${afterReload.url}`,
      recordKey: currentRecordKey,
      attempt: nextAttempt,
      retryCount,
      reason: riskReload ? 'code37' : 'interval',
      phase: 'complete',
      tab: afterReload
    });
    if (!riskReload) continue;
    await appendSyncReloadLog({
      step: 'jobDetail:tabReload:retryWait',
      message: `刷新后等待 ${retryDelaySeconds} 秒，再从记录 ${currentRecordKey} 重新执行同步。`,
      recordKey: currentRecordKey,
      attempt: nextAttempt,
      retryCount,
      phase: 'retry-wait',
      waitSeconds: retryDelaySeconds,
      retryAt: Date.now() + retryDelaySeconds * 1000,
      tab: afterReload
    });
    if (!await waitWhileSyncActive(site.key, retryDelaySeconds * 1000)) break;
  }

  if (!response?.ok) {
    throw new Error(response?.error || `无法读取页面。请确认当前页是 ${site.source} 页面。`);
  }

  if (accumulatedSummary.synced || accumulatedSummary.jobDetail.riskPauses) {
    const summary = response.data?.syncSummary || {};
    response.data = {
      ...(response.data || {}),
      synced: accumulatedSummary.synced + Number(response.data?.synced || 0),
      sourceTotal: firstSourceTotal || Number(response.data?.sourceTotal || 0),
      syncSummary: {
        ...summary,
        inserted: accumulatedSummary.inserted + Number(summary.inserted || 0),
        updated: accumulatedSummary.updated + Number(summary.updated || 0),
        updatedMsg: accumulatedSummary.updatedMsg + Number(summary.updatedMsg ?? summary.updated ?? 0),
        jobDetail: addJobDetailStats(accumulatedSummary.jobDetail, summary.jobDetail),
        conversation: addConversationStats(accumulatedSummary.conversation, summary.conversation)
      }
    };
  }

  const data = await globalThis.JobChatBackgroundDb.savePendingExtraction(response.data || {}, site);
  const summary = data.syncSummary || {};
  const actionText = `消息状态：新增 ${summary.inserted || 0} 条，更新 ${summary.updatedMsg ?? summary.updated ?? 0} 条`;
  const jobDetail = summary.jobDetail || {};
  const jobDetailText = Number(jobDetail.requested || 0)
    ? `岗位详情：成功 ${jobDetail.success || 0} 条，失败 ${jobDetail.failed || 0} 条，跳过 ${jobDetail.skipped || 0} 条，风控暂停 ${jobDetail.riskPauses || 0} 次${jobDetail.stoppedByRiskControl ? '（已因安全验证停止；可在总览页选择记录后手动更新）' : ''}`
    : '';
  const conversation = summary.conversation || {};
  const conversationText = Number(conversation.requested || 0)
    ? `完整会话：成功 ${conversation.success || 0} 条，失败 ${conversation.failed || 0} 条，跳过 ${conversation.skipped || 0} 条`
    : '';
  const syncDetailText = [conversationText, jobDetailText].filter(Boolean).join('；');
  const stoppedByRiskControl = Boolean(jobDetail.stoppedByRiskControl);

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
      message: stoppedByRiskControl
        ? `已因岗位详情安全验证停止${site.source}同步，已处理 ${summary.synced || 0} / ${summary.sourceTotal || data.records?.length || 0} 条，${actionText}${syncDetailText ? `；${syncDetailText}` : ''}。`
        : summary.interrupted
          ? `已中断${site.source}同步，已处理 ${summary.synced || 0} / ${summary.sourceTotal || data.records?.length || 0} 条，${actionText}${syncDetailText ? `；${syncDetailText}` : ''}。可继续同步。`
          : `本次${actionText}${syncDetailText ? `；${syncDetailText}` : ''}。请在同步结果页确认后保存到总记录。`
    }
  });

  activeExtractionProgressContext = null;
  return data;
}

function mergeRefreshedRecord(oldRecord, nextRecord) {
  return migrateBossChatSecurityId({
    ...oldRecord,
    ...nextRecord,
    boss: { ...(oldRecord?.boss || {}), ...(nextRecord?.boss || {}) },
    liepin: { ...(oldRecord?.liepin || {}), ...(nextRecord?.liepin || {}) },
    jobRef: { ...(oldRecord?.jobRef || {}), ...(nextRecord?.jobRef || {}) },
    jobInfo: nextRecord?.jobInfo || oldRecord?.jobInfo || {},
    ...mergedConversationFields(oldRecord, nextRecord),
    note: oldRecord?.note || nextRecord?.note || '',
    applicationDate: oldRecord?.applicationDate || nextRecord?.applicationDate
  });
}

async function saveRefreshProgressRecord(progress) {
  const nextRecord = progress?.record;
  const recordKey = String(nextRecord?.recordKey || progress?.recordKey || '');
  if (!nextRecord || !recordKey) return;
  const storageScope = progress?.storageScope === 'pending' ? 'pending' : 'total';
  const store = await chrome.storage.local.get(['jobChatRecords', 'jobChatPendingRecords']);
  if (storageScope === 'pending') {
    const pending = store.jobChatPendingRecords || { records: [] };
    const records = Array.isArray(pending.records) ? pending.records : [];
    const merged = records.map((record) => String(record?.recordKey || '') === recordKey ? mergeRefreshedRecord(record, nextRecord) : record);
    await chrome.storage.local.set({
      jobChatPendingRecords: { ...pending, records: merged, total: merged.length, extractedAt: new Date().toISOString() },
      bossChatStatsLatest: { ...pending, records: merged, total: merged.length, extractedAt: new Date().toISOString() }
    });
    return;
  }
  const records = Array.isArray(store.jobChatRecords) ? store.jobChatRecords : [];
  await chrome.storage.local.set({ jobChatRecords: records.map((record) => String(record?.recordKey || '') === recordKey ? mergeRefreshedRecord(record, nextRecord) : record) });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message?.type === 'JOB_CHAT_AUTO_GREETING_PANEL_FLOAT') {
    const tabId = Number(message.tabId || 0);
    if (!Number.isInteger(tabId) || tabId <= 0) {
      sendResponse({ ok: false, error: '没有找到关联的招聘标签页。' });
      return;
    }
    floatAutoGreetingPanel(tabId, Boolean(message.debug))
      .then((windowInfo) => sendResponse({ ok: true, windowId: windowInfo?.id || 0 }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_AUTO_GREETING_PANEL_DOCK') {
    dockAutoGreetingPanel(Number(message.tabId || 0), Number(message.windowId || 0), Boolean(message.debug))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_AUTO_GREETING_DEBUG_LOG') {
    const tabId = Number(sender.tab?.id || message.tabId || 0);
    appendAutoGreetingLog(tabId, message.message, { raw: true })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_AUTO_GREETING_LOG_ENABLE') {
    const tabId = Number(message.tabId || 0);
    if (!Number.isInteger(tabId) || tabId <= 0) {
      sendResponse({ ok: false, error: '没有找到当前标签页。' });
      return;
    }
    setAutoGreetingLogEnabled(tabId, Boolean(message.enabled))
      .then(() => appendAutoGreetingLog(tabId, message.enabled ? '调试日志已启用' : ''))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_AUTO_GREETING_LOG_CLEAR') {
    const tabId = Number(message.tabId || 0);
    clearAutoGreetingLog(tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_AUTO_GREETING_STATUS_GET') {
    const tabId = Number(message.tabId || sender.tab?.id || 0);
    if (!Number.isInteger(tabId) || tabId <= 0) {
      sendResponse({ ok: false, error: '没有找到当前标签页。' });
      return;
    }
    reconcileAutoGreetingRun(tabId)
      .then((run) => sendResponse({ ok: true, run }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_AUTO_GREETING_EXPECT_LIST_GET') {
    const tabId = Number(message.tabId || 0);
    ensureAutoGreetingContent(tabId)
      .then(() => sendMessageToTab(tabId, { type: 'JOB_CHAT_AUTO_GREETING_EXPECT_LIST_GET' }))
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_AUTO_GREETING_FILTER_OPTIONS_GET') {
    const tabId = Number(message.tabId || 0);
    ensureAutoGreetingContent(tabId)
      .then(() => sendMessageToTab(tabId, { type: 'JOB_CHAT_AUTO_GREETING_FILTER_OPTIONS_GET' }))
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_AUTO_GREETING_LOCATION_FILTER_OPTIONS_GET') {
    const tabId = Number(message.tabId || 0);
    ensureAutoGreetingContent(tabId)
      .then(() => sendMessageToTab(tabId, { type: 'JOB_CHAT_AUTO_GREETING_LOCATION_FILTER_OPTIONS_GET', cityCode: String(message.cityCode || '') }))
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_AUTO_GREETING_RISK_CONTROL') {
    autoGreetingRiskQueue = autoGreetingRiskQueue
      .catch(() => {})
      .then(() => handleAutoGreetingRiskControl(message, sender));
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === 'JOB_CHAT_AUTO_GREETING_RISK_RECOVERED') {
    autoGreetingSaveQueue = autoGreetingSaveQueue
      .catch(() => {})
      .then(() => resetAutoGreetingRiskControl(message, sender));
    autoGreetingSaveQueue
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_AUTO_GREETING_START') {
    startAutoGreeting(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_AUTO_GREETING_PAUSE' || message?.type === 'JOB_CHAT_AUTO_GREETING_RESUME' || message?.type === 'JOB_CHAT_AUTO_GREETING_CANCEL') {
    const action = message.type.endsWith('PAUSE') ? 'pause' : (message.type.endsWith('CANCEL') ? 'cancel' : 'resume');
    controlAutoGreeting(message, action).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_AUTO_GREETING_RESERVE') {
    autoGreetingSaveQueue = autoGreetingSaveQueue.catch(() => {}).then(() => reserveAutoGreetingJob(message));
    autoGreetingSaveQueue.then(sendResponse).catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_AUTO_GREETING_SUCCESS') {
    autoGreetingSaveQueue = autoGreetingSaveQueue.catch(() => {}).then(() => saveAutoGreetingSuccess(message));
    autoGreetingSaveQueue.then(sendResponse).catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_AUTO_GREETING_OUTCOME') {
    autoGreetingSaveQueue = autoGreetingSaveQueue.catch(() => {}).then(() => saveAutoGreetingOutcome(message));
    autoGreetingSaveQueue.then(sendResponse).catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_AUTO_GREETING_PROGRESS') {
    autoGreetingSaveQueue = autoGreetingSaveQueue.catch(() => {}).then(() => saveAutoGreetingProgress(message, sender));
    autoGreetingSaveQueue.then(sendResponse).catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_ONLINE_ONLY_GET') {
    const tabId = Number(message.tabId || sender.tab?.id || 0);
    if (!Number.isInteger(tabId) || tabId <= 0) {
      sendResponse({ ok: false, error: '没有找到当前标签页。' });
      return;
    }
    onlineOnlyState(tabId)
      .then((enabled) => sendResponse({ ok: true, enabled }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_ONLINE_ONLY_SET') {
    const tabId = Number(message.tabId || sender.tab?.id || 0);
    if (!Number.isInteger(tabId) || tabId <= 0) {
      sendResponse({ ok: false, error: '没有找到当前标签页。' });
      return;
    }
    chrome.tabs.get(tabId)
      .then((tab) => {
        if (message.enabled && !detectSupportedSite(tab?.url || '')) {
          throw new Error('仅在线岗位过滤目前只支持 BOSS直聘和猎聘。');
        }
        return setOnlineOnlyState(tabId, Boolean(message.enabled));
      })
      .then((enabled) => sendResponse({ ok: true, enabled }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_COMPANY_FILTER_GET') {
    const tabId = Number(message.tabId || sender.tab?.id || 0);
    if (!Number.isInteger(tabId) || tabId <= 0) {
      sendResponse({ ok: false, error: '没有找到当前标签页。' });
      return;
    }
    Promise.all([companyFilterState(tabId), companyFilterKeywords()])
      .then(([enabled, keywords]) => sendResponse({ ok: true, enabled, keywords }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_COMPANY_FILTER_SET_ENABLED') {
    const tabId = Number(message.tabId || sender.tab?.id || 0);
    if (!Number.isInteger(tabId) || tabId <= 0) {
      sendResponse({ ok: false, error: '没有找到当前标签页。' });
      return;
    }
    chrome.tabs.get(tabId)
      .then((tab) => {
        if (message.enabled && !detectSupportedSite(tab?.url || '')) {
          throw new Error('关键字岗位过滤目前只支持 BOSS直聘和猎聘。');
        }
        return setCompanyFilterState(tabId, Boolean(message.enabled));
      })
      .then((enabled) => sendResponse({ ok: true, enabled }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_COMPANY_FILTER_SET_KEYWORDS') {
    setCompanyFilterKeywords(message.keywords)
      .then((keywords) => sendResponse({ ok: true, keywords }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_ANALYTICS_STATUS') {
    globalThis.JobChatAnalytics.status()
      .then((data) => sendResponse({ ok: true, data }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_ANALYTICS_SET_ENABLED') {
    globalThis.JobChatAnalytics.setEnabled(Boolean(message.enabled))
      .then((data) => sendResponse({ ok: true, data }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_ANALYTICS_ACTIVE') {
    globalThis.JobChatAnalytics.trackDailyActive(message.pageMode)
      .then((sent) => sendResponse({ ok: true, sent }))
      .catch(() => sendResponse({ ok: false, sent: false }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_ANALYTICS_EVENT') {
    globalThis.JobChatAnalytics.sendEvent(message.eventName, message.params)
      .then((sent) => sendResponse({ ok: true, sent }))
      .catch(() => sendResponse({ ok: false, sent: false }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_COMPANY_PROFILE_UPSERT') {
    const profile = message.profile || {};
    companyProfileSaveQueue = companyProfileSaveQueue.catch(() => {}).then(async () => {
      const companyKey = String(profile.companyKey || '');
      if (!companyKey || !profile.siteKey || !profile.externalId) throw new Error('公司信息缺少唯一标识。');
      const store = await chrome.storage.local.get(['jobChatCompanyProfiles']);
      const profiles = store.jobChatCompanyProfiles && typeof store.jobChatCompanyProfiles === 'object'
        ? store.jobChatCompanyProfiles
        : {};
      await chrome.storage.local.set({
        jobChatCompanyProfiles: {
          ...profiles,
          [companyKey]: {
            companyKey,
            siteKey: String(profile.siteKey || ''),
            externalId: String(profile.externalId || ''),
            name: String(profile.name || ''),
            employeeScale: String(profile.employeeScale || ''),
            industry: String(profile.industry || ''),
            description: String(profile.description || '')
          }
        }
      });
    });
    companyProfileSaveQueue.then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_REFRESH_SELECTED') {
    refreshSelectedRecords(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_STOP_REFRESH') {
    stopJobDetailRefresh().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_REFRESH_PROGRESS') {
    const progress = message.progress || {};
    jobDetailProgressSaveQueue = jobDetailProgressSaveQueue
      .catch(() => {})
      .then(() => saveRefreshProgressRecord(progress))
      .then(() => chrome.storage.local.set({ jobChatRefreshProgress: { ...progress, updatedAt: new Date().toISOString() } }));
    jobDetailProgressSaveQueue
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'BOSS_SEND_BATCH') {
    sendBossBatch(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_SEND_BATCH') {
    sendChatBatch(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'BOSS_STOP_BATCH') {
    stopBossBatch().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_STOP_SEND') {
    stopChatBatch().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'BOSS_SEND_PROGRESS') {
    const { sentMessage = '', ...progress } = message.progress || {};
    if (progress.type === 'BOSS_SEND_FINISHED' || progress.type === 'BOSS_SEND_ERROR' || progress.type === 'BOSS_SEND_STOPPED') activeBossSendTabId = null;
    sendProgressSaveQueue = sendProgressSaveQueue
      .catch(() => {})
      .then(() => (progress.status === '成功' || progress.status === '已发送'
        ? updateBossRecordAfterSent(progress.recordKey, String(sentMessage || ''))
        : Promise.resolve()))
      .then(() => chrome.storage.local.set({ jobChatBossSendProgress: { ...progress, updatedAt: new Date().toISOString() } }));
    sendProgressSaveQueue
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'BOSS_SEND_LOG') {
    chrome.runtime.sendMessage({
      type: 'JOB_CHAT_SEND_LOG_EVENT',
      entry: { time: new Date().toISOString(), siteKey: 'boss', message: String(message.message || '') }
    }).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === 'LIEPIN_SEND_PROGRESS') {
    const progress = message.progress || {};
    if (progress.type === 'LIEPIN_SEND_FINISHED' || progress.type === 'LIEPIN_SEND_ERROR' || progress.type === 'LIEPIN_SEND_STOPPED') {
      activeLiepinSendTabId = null;
    }
    sendProgressSaveQueue = sendProgressSaveQueue
      .catch(() => {})
      .then(() => updateLiepinRecordFromSendProgress(progress))
      .then(() => chrome.storage.local.set({
        jobChatBossSendProgress: {
          ...progress,
          siteKey: 'liepin',
          updatedAt: new Date().toISOString()
        }
      }));
    sendProgressSaveQueue
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'LIEPIN_SEND_LOG') {
    chrome.runtime.sendMessage({
      type: 'JOB_CHAT_SEND_LOG_EVENT',
      entry: { time: new Date().toISOString(), siteKey: 'liepin', message: String(message.message || '') }
    }).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }


  if (message?.type === 'START_PREPARED_SYNC') {
    (async () => {
      const store = await chrome.storage.local.get(['jobChatLastSourceTab']);
      const tab = store.jobChatLastSourceTab;
      if (!tab?.id || !tab?.url) throw new Error('没有找到上次同步的页面，请回到对应招聘网站页面重新点击插件同步。');
      await chrome.storage.local.set({ jobChatLiepinCancelRequested: false, jobChatCancelRequested: false });
      await extractFromTabWithAnalytics(tab, message.syncSelection);
      return { ok: true };
    })()
      .then((data) => sendResponse(data || { ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'CANCEL_LIEPIN_SYNC' || message?.type === 'CANCEL_CURRENT_SYNC') {
    activeSyncReloadCancelled = true;
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
      await extractFromTabWithAnalytics(tab, message.syncSelection);
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
    chrome.tabs.create({ url: chrome.runtime.getURL(globalThis.JobChatRuntimeConfig.resultsPagePath('overview')), active: true })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'OPEN_SYNC_PAGE') {
    chrome.tabs.create({ url: chrome.runtime.getURL(globalThis.JobChatRuntimeConfig.resultsPagePath('sync')), active: true })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }

  if (message?.type === 'JOB_CHAT_EXTRACTION_PROGRESS') {
    const progress = message.progress || {};
    const sourceName = progress.sourceName || (progress.siteKey === 'boss' ? 'BOSS直聘' : '猎聘');
    const siteTitle = progress.siteTitle || (progress.siteKey === 'boss' ? 'BOSS直聘沟通记录' : '猎聘沟通记录');
    let progressCategories = progress.progressCategories || undefined;
    const progressContext = activeExtractionProgressContext?.siteKey === progress.siteKey
      ? activeExtractionProgressContext
      : null;
    let displayedSynced = Number(progress.synced || 0);
    let displayedTotal = Number(progress.total || 0);
    let displayedInserted = Number(progress.inserted || 0);
    let displayedUpdated = Number(progress.updatedMsg ?? progress.updated ?? 0);
    if (progressContext && progressCategories) {
      const localCommunication = progressCategories.communication || {};
      const localJobDetail = progressCategories.jobDetail || {};
      displayedSynced = progressContext.syncedCompleted + Number(progress.synced || 0);
      displayedTotal = Math.max(
        Number(progressContext.sourceTotal || 0),
        progressContext.syncedCompleted + Number(progress.total || 0)
      );
      displayedInserted = progressContext.insertedCompleted + Number(progress.inserted || 0);
      displayedUpdated = progressContext.updatedCompleted + Number(progress.updatedMsg ?? progress.updated ?? 0);
      progressContext.communicationTotal = Math.max(
        progressContext.communicationTotal,
        progressContext.communicationCompleted + Number(localCommunication.total || 0)
      );
      progressContext.jobDetailTotal = Math.max(
        progressContext.jobDetailTotal,
        progressContext.jobDetailCompleted + Number(localJobDetail.total || 0)
      );
      progressCategories = {
        communication: {
          completed: progressContext.communicationCompleted + Number(localCommunication.completed || 0),
          total: progressContext.communicationTotal
        },
        jobDetail: {
          completed: progressContext.jobDetailCompleted + Number(localJobDetail.completed || 0),
          total: progressContext.jobDetailTotal
        }
      };
    }
    chrome.storage.local.set({
      jobChatExtractionStatus: {
        state: 'loading',
        siteKey: progress.siteKey || 'liepin',
        siteTitle,
        sourceName,
        startedAt: progress.startedAt || new Date().toISOString(),
        synced: displayedSynced,
        total: displayedTotal,
        inserted: displayedInserted,
        updated: displayedUpdated,
        updatedMsg: displayedUpdated,
        progressCategories,
        jobDetailRequired: Boolean(progress.jobDetailRequired || progressCategories?.jobDetail?.total),
        message: progressContext
          ? `正在同步${sourceName}沟通记录... 已处理 ${displayedSynced} / ${displayedTotal} 条，消息状态：新增 ${displayedInserted} 条，更新 ${displayedUpdated} 条`
          : progress.message || `正在提取${sourceName}沟通记录... 已同步 ${displayedSynced} / ${displayedTotal} 条`
      }
    }).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type !== 'START_JOB_CHAT_EXTRACTION') return;

  (async () => {
    const sourceTab = message.tab;
    const site = detectSupportedSite(sourceTab?.url || '');
    const startedAt = new Date().toISOString();
    const pendingData = {
      pageTitle: sourceTab?.title || '',
      pageUrl: sourceTab?.url || '',
      extractedAt: startedAt,
      siteKey: site?.key || '',
      siteTitle: site?.title || '招聘沟通记录',
      sourceName: site?.source || '',
      total: 0,
      records: [],
      syncSummary: {
        fetched: 0,
        inserted: 0,
        updated: 0,
        updatedMsg: 0,
        saved: false,
        interrupted: false,
        completed: false,
        synced: 0,
        sourceTotal: 0
      }
    };

    await chrome.storage.local.set({
      jobChatLastSourceTab: { id: sourceTab?.id, url: sourceTab?.url, title: sourceTab?.title },
      jobChatLiepinCancelRequested: false,
      jobChatCancelRequested: false,
      jobChatPendingRecords: pendingData,
      bossChatStatsLatest: pendingData,
      jobChatExtractionStatus: {
        state: 'loading',
        siteKey: site?.key || '',
        siteTitle: site?.title || '招聘沟通记录',
        sourceName: site?.source || '',
        startedAt,
        message: site ? `正在提取${site.source}沟通记录...` : '正在检查当前网站...'
      }
    });

    await ensureResultsTab();
    sendResponse({ ok: true });

    try {
      await prepareSyncFromTab(sourceTab);
    } catch (error) {
      await globalThis.JobChatAnalytics.sendEvent('sync_failed', {
        site: site?.key || 'none',
        page_mode: 'background',
        result: analyticsErrorCode(error) === 'cancelled' ? 'cancelled' : 'failed',
        error_code: analyticsErrorCode(error)
      });
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
