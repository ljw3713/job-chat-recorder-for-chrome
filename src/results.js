const meta = document.getElementById('meta');
const jsonBox = document.getElementById('jsonBox');
const jsonPreviewTabs = document.getElementById('jsonPreviewTabs');
const personalTab = document.getElementById('personalTab');
const tableBox = document.getElementById('tableBox');
const analyticsEnabled = document.getElementById('analyticsEnabled');
const analyticsHint = document.getElementById('analyticsHint');
const copyTableBtn = document.getElementById('copyTableBtn');
const copyJsonBtn = document.getElementById('copyJsonBtn');
const downloadCsvBtn = document.getElementById('downloadCsvBtn');
const updateDetailsBtn = document.getElementById('updateDetailsBtn');
const todayOnly = document.getElementById('todayOnly');
const sourceFilter = document.getElementById('sourceFilter');
const companyFilter = document.getElementById('companyFilter');
const messageStatusFilter = document.getElementById('messageStatusFilter');
const dateFieldFilter = document.getElementById('dateFieldFilter');
const dateFrom = document.getElementById('dateFrom');
const dateTo = document.getElementById('dateTo');
const sortBy = document.getElementById('sortBy');
const pageHeading = document.getElementById('pageHeading');
const statusBox = document.getElementById('statusBox');
const statusText = document.getElementById('statusText');
const syncCategoryProgress = document.getElementById('syncCategoryProgress');
const communicationProgressText = document.getElementById('communicationProgressText');
const communicationProgressBar = document.getElementById('communicationProgressBar');
const jobDetailProgressText = document.getElementById('jobDetailProgressText');
const jobDetailProgressBar = document.getElementById('jobDetailProgressBar');
const syncRefreshNote = document.getElementById('syncRefreshNote');
const saveBtn = document.getElementById('saveBtn');
const overviewBtn = document.getElementById('overviewBtn');
const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
const ignoreSelectedBtn = document.getElementById('ignoreSelectedBtn');
const ignoredRecordsBtn = document.getElementById('ignoredRecordsBtn');
const cancelSyncBtn = document.getElementById('cancelSyncBtn');
const resumeSyncBtn = document.getElementById('resumeSyncBtn');
const resumeInsertBox = document.getElementById('resumeInsertBox');
const resumeUpdateBox = document.getElementById('resumeUpdateBox');
const resumeInsert = document.getElementById('resumeInsert');
const resumeUpdate = document.getElementById('resumeUpdate');
const pageHint = document.getElementById('pageHint');
const syncRateBox = document.getElementById('syncRateBox');
const syncRateUnit = document.getElementById('syncRateUnit');
const syncRateLimit = document.getElementById('syncRateLimit');
const startSyncBtn = document.getElementById('startSyncBtn');
const ratingPromptModal = document.getElementById('ratingPromptModal');
const closeRatingPromptBtn = document.getElementById('closeRatingPromptBtn');
const confirmRatingPromptBtn = document.getElementById('confirmRatingPromptBtn');
const importCsvBtn = document.getElementById('importCsvBtn');
const importCsvInput = document.getElementById('importCsvInput');
const ignoredModal = document.getElementById('ignoredModal');
const ignoredRecordsBox = document.getElementById('ignoredRecordsBox');
const closeIgnoredModalBtn = document.getElementById('closeIgnoredModalBtn');
const requestLogsBtn = document.getElementById('requestLogsBtn');
const requestLogsModal = document.getElementById('requestLogsModal');
const requestLogsBox = document.getElementById('requestLogsBox');
const closeRequestLogsModalBtn = document.getElementById('closeRequestLogsModalBtn');
const sendMessageBtn = document.getElementById('sendMessageBtn');
const sendMessageModal = document.getElementById('sendMessageModal');
const closeSendMessageModalBtn = document.getElementById('closeSendMessageModalBtn');
const sendMessageTitle = document.getElementById('sendMessageTitle');
const sendMessageText = document.getElementById('sendMessageText');
const sendMessageCount = document.getElementById('sendMessageCount');
const sendMessageRate = document.getElementById('sendMessageRate');
const startSendMessageBtn = document.getElementById('startSendMessageBtn');
const sendMessageSummary = document.getElementById('sendMessageSummary');
const sendMessageTargets = document.getElementById('sendMessageTargets');
const sendMessageLog = document.getElementById('sendMessageLog');
const queryInput = document.getElementById('queryInput');
const jobInfoCard = document.getElementById('jobInfoCard');
const updateDetailsModal = document.getElementById('updateDetailsModal');
const closeUpdateDetailsModalBtn = document.getElementById('closeUpdateDetailsModalBtn');
const updateDetailsTitle = document.getElementById('updateDetailsTitle');
const updateDetailsSummary = document.getElementById('updateDetailsSummary');
const updateDetailsRate = document.getElementById('updateDetailsRate');
const updateDetailsRetryDelay = document.getElementById('updateDetailsRetryDelay');
const updateDetailsRetryCount = document.getElementById('updateDetailsRetryCount');
const startUpdateDetailsBtn = document.getElementById('startUpdateDetailsBtn');
const updateDetailsProgressBar = document.getElementById('updateDetailsProgressBar');
const updateDetailsRefreshNote = document.getElementById('updateDetailsRefreshNote');
const updateDetailsTargets = document.getElementById('updateDetailsTargets');
const updateDetailsLog = document.getElementById('updateDetailsLog');
const devFeatureToggles = document.getElementById('devFeatureToggles');
const logFeatureToggle = document.getElementById('logFeatureToggle');
const debugFeatureToggle = document.getElementById('debugFeatureToggle');

const pageParams = new URLSearchParams(location.search);
const mode = pageParams.get('mode') === 'sync' ? 'sync' : 'overview';
const runtimeConfig = globalThis.JobChatRuntimeConfig || {
  enableDebugLog: false,
  resultsPagePath: (targetMode) => `results.html?mode=${targetMode === 'sync' ? 'sync' : 'overview'}`
};
const isDevelopmentVersion = Boolean(runtimeConfig.enableDebugLog);
function featureFlag(name, defaultValue = false) {
  const value = String(pageParams.get(name) || '').toLowerCase();
  if (['true', '1', 'enable', 'enabled', 'on'].includes(value)) return true;
  if (['false', '0', 'disable', 'disabled', 'off'].includes(value)) return false;
  return defaultValue;
}
const sendLogEnabled = featureFlag('log', isDevelopmentVersion);
const debugEnabled = featureFlag('debug', isDevelopmentVersion);
const debugDataEnabled = mode === 'overview' && debugEnabled;
const ratingPromptConfig = runtimeConfig.ratingPrompt || {};
const RATING_PROMPT_STATE_KEY = String(
  ratingPromptConfig.storageKey || 'jobChatRatingPromptState'
);
const configuredRatingPromptThreshold = Number(ratingPromptConfig.clickThreshold);
const RATING_PROMPT_CLICK_THRESHOLD = Number.isFinite(configuredRatingPromptThreshold)
  ? Math.max(0, Math.floor(configuredRatingPromptThreshold))
  : 10;
const CHROME_WEB_STORE_URL = String(ratingPromptConfig.storeUrl || '');
if (sendMessageLog) sendMessageLog.style.display = sendLogEnabled ? '' : 'none';
const { normalizeText, formatDate, escapeHtml } = globalThis.JobChatUtils;
const {
  recruiterInfo,
  normalizeRecordDate,
  communicationDate,
  displayRecordDate,
  makeRecordKey,
  normalizeJobRef,
  normalizeJobInfo,
  normalizeConversation,
  isCompleteJobInfo
} = globalThis.JobChatRecords;

function isResolvedJobInfo(record) {
  return isCompleteJobInfo(record)
    || ((record?.siteKey === 'liepin' || record?.sourceName === '猎聘')
      && record?.liepin?.jobPreviewStatus === 'empty'
      && record?.jobInfo?.fetchStatus === 'success');
}
const ResultsDb = globalThis.JobChatResultsDb;

function trackAnalyticsEvent(eventName, params = {}) {
  return chrome.runtime.sendMessage({
    type: 'JOB_CHAT_ANALYTICS_EVENT',
    eventName,
    params
  }).catch(() => ({ ok: false, sent: false }));
}

function setAnalyticsHint(configured) {
  if (!analyticsHint) return;
  analyticsHint.textContent = configured
    ? '仅统计功能使用数量、版本、地区和设备类型，不上传聊天或账号信息。'
    : '当前构建尚未配置 GA4，不会发送统计数据。';
}

async function initializeAnalyticsSetting() {
  if (!analyticsEnabled) return;
  const response = await chrome.runtime.sendMessage({
    type: 'JOB_CHAT_ANALYTICS_STATUS'
  }).catch(() => null);
  const status = response?.data || {};
  analyticsEnabled.checked = status.enabled !== false;
  setAnalyticsHint(Boolean(status.configured));
}

if (analyticsEnabled) {
  analyticsEnabled.addEventListener('change', async () => {
    analyticsEnabled.disabled = true;
    const enabled = analyticsEnabled.checked;
    const response = await chrome.runtime.sendMessage({
      type: 'JOB_CHAT_ANALYTICS_SET_ENABLED',
      enabled
    }).catch(() => null);
    analyticsEnabled.disabled = false;
    if (!response?.ok) {
      analyticsEnabled.checked = !enabled;
      return;
    }
    setAnalyticsHint(Boolean(response.data?.configured));
    if (enabled) {
      chrome.runtime.sendMessage({
        type: 'JOB_CHAT_ANALYTICS_ACTIVE',
        pageMode: mode
      }).catch(() => {});
    }
  });
}

function analyticsSiteForRecords(records) {
  const sites = new Set((records || []).map(recordSiteKey).filter(Boolean));
  if (sites.size > 1) return 'mixed';
  return sites.size === 1 ? [...sites][0] : 'none';
}

function trackSavedRecords(records, result) {
  const groups = new Map();
  (records || []).forEach((record) => {
    const site = recordSiteKey(record) || 'none';
    groups.set(site, (groups.get(site) || 0) + 1);
  });
  if (!groups.size) groups.set('none', 0);
  return Promise.all([...groups.entries()].map(([site, count]) => trackAnalyticsEvent('records_saved', {
    site,
    record_count: count,
    page_mode: mode,
    result
  })));
}

let latestData = null;
let extractionStatus = null;
let allRecords = [];
let currentRecords = [];
let pageRecords = [];
let ignoredRecords = [];
let companyProfiles = {};
let internalAccountInfo = {};
let activePreviewTab = 'communication';
let selectedKeys = new Set();
let queryValue = '';
let queryTimer = null;
let sendRunning = false;
let sendSiteKey = '';
let sendStatuses = new Map();
let sendLogs = [];
let detailsUpdating = false;
let jobInfoHideTimer = null;
let detailRefreshRecords = [];
let detailRefreshStatuses = new Map();
let detailRefreshLogs = [];
let detailRefreshRequestLogs = [];
let detailRefreshRecordStats = null;
let detailRefreshRunId = null;
let detailRefreshCountdownTimer = null;
let jobDetailNotSyncedOnly = false;
let lastOverviewSelectedRecordKey = '';
let activeSelectionAction = '';
let currentPage = 1;
let pageSize = 100;

function updateFeatureFlag(name, enabled) {
  const url = new URL(location.href);
  url.searchParams.set(name, enabled ? 'true' : 'false');
  location.replace(url.toString());
}

if (isDevelopmentVersion) {
  devFeatureToggles?.classList.add('show');
  if (logFeatureToggle) {
    logFeatureToggle.checked = sendLogEnabled;
    logFeatureToggle.addEventListener('change', () => updateFeatureFlag('log', logFeatureToggle.checked));
  }
  if (debugFeatureToggle) {
    debugFeatureToggle.checked = debugEnabled;
    debugFeatureToggle.addEventListener('change', () => updateFeatureFlag('debug', debugFeatureToggle.checked));
  }
}

const tableHeaders = ['来源', '公司名', '岗位名', '申请时间', '更新时间', '备注', '招聘者', '状态', '原消息'];
const tableExportHeaders = ['唯一索引id', ...tableHeaders];
const csvExportHeaders = debugDataEnabled ? [...tableExportHeaders, '内部数据'] : tableExportHeaders;

if (personalTab) personalTab.style.display = debugEnabled ? '' : 'none';

function uniqueInternalValues(values) {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))].sort();
}

function companyPreviewData() {
  return Object.values(companyProfiles)
    .filter((profile) => profile && typeof profile === 'object')
    .sort((left, right) => normalizeText(left.name).localeCompare(normalizeText(right.name), 'zh-Hans-CN'));
}

function personalPreviewData() {
  const zhipinUserIds = uniqueInternalValues(internalAccountInfo.zhipinUserIds || []);
  const liepinUserIds = uniqueInternalValues(internalAccountInfo.liepinUserIds || []);
  const liepinImClientIds = internalAccountInfo.jobChatLiepinImClientIds
    && typeof internalAccountInfo.jobChatLiepinImClientIds === 'object'
    ? internalAccountInfo.jobChatLiepinImClientIds
    : {};
  return {
    zhipin: {
      userIds: zhipinUserIds,
      pcDeviceId: normalizeText(internalAccountInfo.jobChatBossPcDeviceId)
    },
    liepin: {
      userIds: liepinUserIds,
      imClientIds: liepinImClientIds
    }
  };
}

function activePreviewData() {
  if (activePreviewTab === 'company') return companyPreviewData();
  if (activePreviewTab === 'personal' && debugEnabled) return personalPreviewData();
  return toOutputRows(pageRecords);
}

function selectPreviewTab(tabName) {
  activePreviewTab = tabName === 'personal' && !debugEnabled
    ? 'communication'
    : tabName;
  jsonPreviewTabs?.querySelectorAll('[data-preview-tab]').forEach((button) => {
    const active = button.dataset.previewTab === activePreviewTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.tabIndex = active ? 0 : -1;
    if (active) jsonBox.setAttribute('aria-labelledby', button.id);
  });
  updateJsonBox();
}

jsonPreviewTabs?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-preview-tab]');
  if (button) selectPreviewTab(button.dataset.previewTab);
});
jsonPreviewTabs?.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  const tabs = [...jsonPreviewTabs.querySelectorAll('[data-preview-tab]')]
    .filter((button) => button.style.display !== 'none');
  const currentIndex = tabs.findIndex((button) => button.dataset.previewTab === activePreviewTab);
  const direction = event.key === 'ArrowRight' ? 1 : -1;
  const next = tabs[(currentIndex + direction + tabs.length) % tabs.length];
  if (!next) return;
  event.preventDefault();
  selectPreviewTab(next.dataset.previewTab);
  next.focus();
});

function normalizeMessageStatus(value) {
  const text = normalizeText(value);
  if (text === '已读' || text.startsWith('1')) return '1';
  if (text === '未读' || text.startsWith('0')) return '0';
  return '';
}

function displayDate(value) {
  return displayRecordDate(value || '');
}

function exportDateTime(value) {
  return normalizeText(value) ? normalizeRecordDate(value) : '';
}

function messageStatusText(value) {
  return normalizeMessageStatus(value) === '1' ? '已读' : '未读';
}

function inferMessageStatus(record) {
  const explicit = normalizeMessageStatus(record?.messageStatus);
  if (explicit) return explicit;
  const bossRawStatus = normalizeText(record?.boss?.lastMessageInfo?.status);
  if (bossRawStatus) return bossRawStatus === '1' ? '0' : '1';
  const liepinRead = normalizeText(record?.liepin?.oppositeRead);
  if (liepinRead) return liepinRead === '1' ? '1' : '0';
  return '';
}

function recordKeyOf(record) {
  return normalizeText(record?.recordKey || makeRecordKey(record));
}

function normalizeRecord(record, index) {
  const updatedDate = communicationDate(record);
  const applicationDate = normalizeText(record.applicationDate || record.createdDate) || updatedDate;
  const normalized = {
    note: '',
    ...record,
    index: record.index || index + 1,
    sourceName: normalizeText(record.sourceName || ''),
    siteKey: normalizeText(record.siteKey || ''),
    companyName: normalizeText(record.companyName),
    jobName: normalizeText(record.jobName),
    recruiterName: normalizeText(record.recruiterName),
    recruiterTitle: normalizeText(record.recruiterTitle),
    lastMessage: normalizeText(record.lastMessage),
    messageStatus: inferMessageStatus(record),
    note: normalizeText(record.note || ''),
    applicationDate,
    updatedDate: normalizeText(record.updatedDate || updatedDate),
    jobRef: normalizeJobRef(record.jobRef),
    jobInfo: normalizeJobInfo(record.jobInfo),
    companyKey: normalizeText(record.companyKey || '')
  };
  delete normalized.bossJobSecurityId;
  delete normalized.externalJobId;
  delete normalized.jobDetailAccessToken;
  if (normalized.siteKey === 'boss' || normalized.sourceName === 'BOSS直聘') {
    const boss = normalized.boss || {};
    normalized.boss = {
      ...boss,
      ownerUserId: normalizeText(boss.ownerUserId || ''),
      friendId: normalizeText(boss.friendId || ''),
      peerKey: normalizeText(boss.peerKey || boss.encryptBossId || boss.encryptFriendId || ''),
      chatSecurityId: normalizeText(boss.chatSecurityId || boss.securityId || ''),
      friendSource: boss.friendSource ?? ''
    };
    delete normalized.boss.bossSecurityId;
    delete normalized.boss.bossJobSecurityId;
    delete normalized.boss.uploadSecurityId;
    delete normalized.boss.encryptJobId;
  }
  normalized.recordKey = makeRecordKey(normalized);
  return normalized;
}

function isTodayRecord(record) {
  return displayDate(record.updatedDate) === formatDate(new Date());
}

function boldNumber(value) {
  return `<strong>${escapeHtml(value)}</strong>`;
}

function isLiepinContext() {
  return extractionStatus?.siteKey === 'liepin' || latestData?.siteKey === 'liepin';
}

function isInterruptibleContext() {
  const key = extractionStatus?.siteKey || latestData?.siteKey || '';
  return key === 'liepin' || key === 'boss';
}

function configurePageMode() {
  if (mode === 'sync') {
    saveBtn.style.display = '';
    if (requestLogsBtn) requestLogsBtn.style.display = sendLogEnabled ? '' : 'none';
    if (importCsvBtn) importCsvBtn.style.display = 'none';
    overviewBtn.textContent = '查看总记录';
    pageHint.textContent = '同步结果页：可先删除不需要的记录，再保存到总记录。备注列可双击编辑，岗位列可悬浮查看详情。';
  } else {
    saveBtn.style.display = 'none';
    if (requestLogsBtn) requestLogsBtn.style.display = 'none';
    if (importCsvBtn) importCsvBtn.style.display = '';
    overviewBtn.textContent = '刷新总览';
    pageHint.textContent = debugDataEnabled
      ? '调试数据模式：JSON 和 CSV 会包含完整内部数据；CSV 导入会按唯一索引新增记录或覆盖已有记录的内部数据。'
      : '';
    if (sendMessageBtn) sendMessageBtn.style.display = '';
  }
  if (mode === 'sync' && sendMessageBtn) sendMessageBtn.style.display = 'none';
  if (queryInput) queryInput.style.display = mode === 'overview' ? '' : 'none';
}

function formatRequestLog(entry, index) {
  const copy = { ...(entry || {}) };
  const time = copy.time || '';
  delete copy.time;
  return `[${index + 1}] ${time}\n${JSON.stringify(copy, null, 2)}`;
}

async function showRequestLogs() {
  if (!requestLogsBox || !requestLogsModal) return;
  requestLogsBox.textContent = detailRefreshRequestLogs.length
    ? detailRefreshRequestLogs.map(formatRequestLog).join('\n\n')
    : '暂无请求日志。';
  requestLogsModal.classList.add('show');
}

function configureTodayOnly() {
  if (!todayOnly) return;
  todayOnly.disabled = false;
  todayOnly.closest('.filter-box')?.classList.remove('disabled');
}

function updateSyncButtons() {
  if (!cancelSyncBtn || !resumeSyncBtn) return;
  const isSync = mode === 'sync';
  const isSupported = isInterruptibleContext();
  const isLoading = extractionStatus?.state === 'loading';
  const isReady = extractionStatus?.state === 'ready';
  const interrupted = Boolean(latestData?.syncSummary?.interrupted || extractionStatus?.interrupted);
  const completed = Boolean(latestData?.syncSummary?.completed);

  if (syncRateBox) syncRateBox.style.display = isSync && isSupported ? '' : 'none';
  const showStart = isSync && isSupported && isReady;
  if (startSyncBtn) startSyncBtn.style.display = showStart ? '' : 'none';
  cancelSyncBtn.style.display = isSync && isSupported && isLoading ? '' : 'none';
  const showResume = isSync && isSupported && interrupted && !isLoading && !completed;
  resumeSyncBtn.style.display = showResume ? '' : 'none';
  const showSyncSelection = showStart || showResume;
  if (resumeInsertBox) resumeInsertBox.style.display = showSyncSelection ? 'inline-flex' : 'none';
  if (resumeUpdateBox) resumeUpdateBox.style.display = showSyncSelection ? 'inline-flex' : 'none';
}

function progressMessage(status) {
  if (status?.message) return status.message;
  if (status?.siteKey === 'liepin' || status?.siteKey === 'boss') {
    const synced = Number(status.synced || 0);
    const total = Number(status.total || 0);
    const sourceName = status.sourceName || (status.siteKey === 'boss' ? 'BOSS直聘' : '猎聘');
    return `正在提取${sourceName}沟通记录... 已同步 ${synced} / ${total} 条`;
  }
  return status?.message || '正在提取沟通记录...';
}

function categoryProgressValue(category) {
  const completed = Math.max(0, Number(category?.completed || 0));
  const total = Math.max(0, Number(category?.total || 0));
  return {
    completed,
    total,
    percent: total ? Math.min(100, Math.round(completed / total * 100)) : 100
  };
}

function renderSyncCategoryProgress(status) {
  if (!syncCategoryProgress) return;
  const categories = status?.progressCategories;
  const supportsCategoryProgress = status?.siteKey === 'boss' || status?.siteKey === 'liepin';
  const shouldShow = mode === 'sync'
    && supportsCategoryProgress
    && categories
    && (status?.state === 'loading' || status?.state === 'ready');
  syncCategoryProgress.style.display = shouldShow ? '' : 'none';
  if (!shouldShow) return;
  const communication = categoryProgressValue(categories.communication);
  const jobDetail = categoryProgressValue(categories.jobDetail);
  communicationProgressText.textContent = communication.total
    ? `${communication.completed} / ${communication.total}`
    : '无需同步';
  jobDetailProgressText.textContent = jobDetail.total
    ? `${jobDetail.completed} / ${jobDetail.total}`
    : '无需同步';
  communicationProgressBar.style.width = `${communication.percent}%`;
  jobDetailProgressBar.style.width = `${jobDetail.percent}%`;
  if (syncRefreshNote) {
    const showBossRefreshNote = status?.siteKey === 'boss'
      && Boolean(status?.jobDetailRequired || jobDetail.total > 0);
    syncRefreshNote.style.display = showBossRefreshNote ? '' : 'none';
  }
}

function setStatus(state, message) {
  if (!statusBox || !statusText) return;
  if (!state || state === 'done') {
    statusBox.className = 'status-card';
    statusText.textContent = '';
    if (syncCategoryProgress) syncCategoryProgress.style.display = 'none';
    return;
  }
  statusBox.className = `status-card show ${state === 'error' ? 'error' : state === 'ready' ? 'ready' : ''}`;
  statusText.textContent = message || (state === 'loading' ? '正在提取沟通记录...' : state === 'ready' ? '已获取待同步列表。' : '提取失败。');
}


function renderReady(status) {
  const title = status?.siteTitle || '招聘沟通记录';
  const source = status?.sourceName || '-';
  pageHeading.textContent = title;
  document.title = title;
  meta.innerHTML = `来源：${escapeHtml(source)} · 待同步：${boldNumber(status?.total || 0)} 条`;
  extractionStatus = status || extractionStatus;
  configureTodayOnly();
  const message = status?.message || '已获取待同步列表，请点击“同步”。';
  setStatus('ready', message);
  renderSyncCategoryProgress({ ...status, state: 'ready' });
  updateSyncButtons();
  tableBox.innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
  jsonBox.textContent = JSON.stringify({
    sourceName: source,
    total: status?.total || 0,
    inserted: status?.inserted,
    updatedMsg: status?.updatedMsg,
    state: 'ready'
  }, null, 2);
}

function renderLoading(status) {
  const title = status?.siteTitle || '招聘沟通记录';
  const source = status?.sourceName || '-';
  pageHeading.textContent = title;
  document.title = title;
  meta.textContent = `来源：${source}`;
  extractionStatus = status || extractionStatus;
  configureTodayOnly();
  setStatus('loading', progressMessage(status));
  renderSyncCategoryProgress({ ...status, state: 'loading' });
  updateSyncButtons();
  if (!allRecords.length) {
    tableBox.innerHTML = '<div class="empty">正在加载数据，请稍候...</div>';
    jsonBox.textContent = 'loading...';
  }
}

function renderError(status) {
  const title = status?.siteTitle || '招聘沟通记录';
  const source = status?.sourceName || '-';
  pageHeading.textContent = title;
  document.title = title;
  meta.textContent = `来源：${source}`;
  extractionStatus = status || extractionStatus;
  configureTodayOnly();
  setStatus('error', status?.message || '提取失败。');
  tableBox.innerHTML = '<div class="empty">提取失败，请返回招聘网站页面后重新点击插件。</div>';
  jsonBox.textContent = JSON.stringify({ error: status?.message || '提取失败。' }, null, 2);
}

function populateSelect(select, values, emptyLabel) {
  const selected = select.value;
  const unique = [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  select.innerHTML = `<option value="">${emptyLabel}</option>` + unique.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  if (unique.includes(selected)) select.value = selected;
}

function populateFilters() {
  populateSelect(sourceFilter, allRecords.map((r) => r.sourceName), '全部来源');
  populateSelect(companyFilter, allRecords.map((r) => r.companyName), '全部公司');
}

function filterAllRecords() {
  let records = [...allRecords];
  if (todayOnly.checked) records = records.filter(isTodayRecord);
  const source = sourceFilter.value;
  if (source) records = records.filter((r) => r.sourceName === source);
  const company = companyFilter.value;
  if (company) records = records.filter((r) => r.companyName === company);
  const messageStatus = messageStatusFilter?.value || '';
  if (messageStatus) records = records.filter((r) => (normalizeMessageStatus(r.messageStatus) || '0') === messageStatus);
  if (jobDetailNotSyncedOnly) records = records.filter((record) => !isResolvedJobInfo(record));
  const words = queryValue.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (words.length) records = records.filter((record) => {
    const searchable = [record.companyName, record.jobName, record.recruiterName, record.recruiterTitle, record.lastMessage].join(' ').toLocaleLowerCase();
    return words.every((word) => searchable.includes(word));
  });
  const dateField = dateFieldFilter.value || 'updatedDate';
  const from = dateFrom.value;
  const to = dateTo.value;
  if (from) records = records.filter((r) => displayDate(r[dateField]) >= from);
  if (to) records = records.filter((r) => displayDate(r[dateField]) <= to);

  const [field, direction] = (sortBy.value || 'updatedDate-desc').split('-');
  records.sort((a, b) => {
    const result = String(a[field] || '').localeCompare(String(b[field] || ''));
    return direction === 'asc' ? result : -result;
  });
  return records;
}

function paginateRecords(records) {
  if (mode !== 'overview') {
    pageRecords = records;
    return pageRecords;
  }
  const totalPages = Math.max(1, Math.ceil(records.length / pageSize));
  currentPage = Math.max(1, Math.min(currentPage, totalPages));
  const offset = (currentPage - 1) * pageSize;
  pageRecords = records.slice(offset, offset + pageSize);
  return pageRecords;
}

function applyFilters() {
  currentRecords = filterAllRecords();
  return paginateRecords(currentRecords);
}

function paginationPageNumbers(totalPages) {
  const pages = new Set([1, totalPages]);
  for (let page = currentPage - 2; page <= currentPage + 2; page += 1) {
    if (page >= 1 && page <= totalPages) pages.add(page);
  }
  const sorted = [...pages].sort((left, right) => left - right);
  const output = [];
  sorted.forEach((page, index) => {
    if (index && page - sorted[index - 1] > 1) output.push('<span aria-hidden="true">…</span>');
    output.push(`<button type="button" class="${page === currentPage ? 'active' : ''}" data-page="${page}"${page === currentPage ? ' aria-current="page"' : ''}>${page}</button>`);
  });
  return output.join('');
}

function paginationMarkup() {
  if (mode !== 'overview') return '';
  const total = currentRecords.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (currentPage - 1) * pageSize + 1 : 0;
  const to = total ? Math.min(currentPage * pageSize, total) : 0;
  const sizes = [20, 50, 100, 200, 500];
  return `<div class="pagination-bar"><span>显示 ${from}–${to} 条，共 ${total} 条</span><div class="pagination-controls"><button type="button" data-page="${Math.max(1, currentPage - 1)}"${currentPage <= 1 ? ' disabled' : ''}>上一页</button>${paginationPageNumbers(totalPages)}<button type="button" data-page="${Math.min(totalPages, currentPage + 1)}"${currentPage >= totalPages ? ' disabled' : ''}>下一页</button><label class="pagination-size">每页 <select id="pageSizeSelect">${sizes.map((size) => `<option value="${size}"${size === pageSize ? ' selected' : ''}>${size}</option>`).join('')}</select> 条</label></div></div>`;
}

function bindPaginationControls() {
  if (mode !== 'overview') return;
  tableBox.querySelectorAll('[data-page]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextPage = Math.max(1, Number(button.dataset.page || 1));
      if (nextPage === currentPage) return;
      currentPage = nextPage;
      lastOverviewSelectedRecordKey = '';
      renderTable();
    });
  });
  const pageSizeSelect = document.getElementById('pageSizeSelect');
  pageSizeSelect?.addEventListener('change', () => {
    pageSize = Math.max(1, Number(pageSizeSelect.value || 100));
    currentPage = 1;
    lastOverviewSelectedRecordKey = '';
    renderTable();
  });
}

function toOutputRows(records = currentRecords) {
  return records.map((r) => {
    const output = {
      recordKey: normalizeText(r.recordKey || makeRecordKey(r)),
      sourceName: normalizeText(r.sourceName),
      companyName: normalizeText(r.companyName),
      jobName: normalizeText(r.jobName),
      applicationDate: exportDateTime(r.applicationDate),
      updatedDate: exportDateTime(r.updatedDate),
      note: normalizeText(r.note),
      messageStatus: messageStatusText(r.messageStatus),
      recruiterInfo: recruiterInfo(r),
      lastMessage: normalizeText(r.lastMessage)
    };
    if (!debugDataEnabled) return output;
    return {
      ...r,
      ...output,
      recruiterName: normalizeText(r.recruiterName),
      recruiterTitle: normalizeText(r.recruiterTitle),
      jobRef: normalizeJobRef(r.jobRef),
      companyKey: normalizeText(r.companyKey || ''),
      jobInfo: normalizeJobInfo(r.jobInfo)
    };
  });
}

function getTodayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isSyncedToday(record) {
  if (!record?.updatedAt) return false;
  const date = new Date(record.updatedAt);
  if (Number.isNaN(date.getTime())) return false;
  return formatDate(date) === getTodayString();
}

function updateMeta() {
  updateSyncButtons();
  const total = allRecords.length;
  const visible = currentRecords.length;
  const source = latestData?.sourceName || '-';
  const summary = latestData?.syncSummary;
  const updatedMsg = summary?.updatedMsg ?? summary?.updated ?? 0;
  const syncText = summary?.saved ? ` · 保存结果：新增 ${summary.inserted || 0} 条，更新消息 ${updatedMsg} 条` : '';
  const jobDetail = summary?.jobDetail;
  const jobDetailText = jobDetail && Number(jobDetail.requested || 0)
    ? `岗位详情：请求 ${jobDetail.requested || 0} 条，成功 ${jobDetail.success || 0} 条，失败 ${jobDetail.failed || 0} 条，跳过 ${jobDetail.skipped || 0} 条，风控暂停 ${jobDetail.riskPauses || 0} 次${jobDetail.stoppedByRiskControl ? '（安全验证停止；可在总览页手动更新）' : ''}`
    : '';
  const conversation = summary?.conversation;
  const conversationText = conversation && Number(conversation.requested || 0)
    ? `完整会话：请求 ${conversation.requested || 0} 条，成功 ${conversation.success || 0} 条，失败 ${conversation.failed || 0} 条，跳过 ${conversation.skipped || 0} 条`
    : '';
  const title = mode === 'sync' ? (latestData?.siteTitle || '同步结果') : '招聘沟通记录总览';
  pageHeading.textContent = title;
  document.title = title;

  if (mode === 'sync') {
    const detailText = `${conversationText} | ${jobDetailText}`.replace(/^ · /,'');
    const detailHtml = detailText
      ? `<div class="sync-meta-details">${detailText.replace(/(\d+)/g, '<strong>$1</strong>')}</div>`
      : '';
    meta.innerHTML = `本次同步共 ${boldNumber(total)} 条 · 当前显示：${boldNumber(visible)} 条 · 最近同步时间：${escapeHtml(latestData?.extractedAt || '-')} · 来源：${escapeHtml(source)}${syncText.replace(/(\d+)/g, '<strong>$1</strong>')}${detailHtml}`;
    return;
  }

  const todaySynced = allRecords.filter(isSyncedToday).length;
  meta.innerHTML = `总记录共 ${boldNumber(total)} 条 · 筛选结果：${boldNumber(visible)} 条 · 本页：${boldNumber(pageRecords.length)} 条 · 今日同步 ${boldNumber(todaySynced)} 条 · 最近同步时间：${escapeHtml(latestData?.extractedAt || '-')}`;
}

function updateJsonBox() {
  jsonBox.textContent = JSON.stringify(activePreviewData(), null, 2);
}

function toTsv(includeHeader = true) {
  const rows = toOutputRows().map((r) => [r.recordKey, r.sourceName, r.companyName, r.jobName, r.applicationDate, r.updatedDate, r.note, r.recruiterInfo, r.messageStatus, r.lastMessage]);
  return ResultsDb.tsv(tableExportHeaders, rows, includeHeader);
}

function csvExportRecords() {
  const selected = selectedRecords();
  return selected.length ? selected : allRecords;
}

function toCsv() {
  const rows = csvExportRecords().map((record) => {
    const output = {
      recordKey: normalizeText(record.recordKey || makeRecordKey(record)),
      sourceName: normalizeText(record.sourceName),
      companyName: normalizeText(record.companyName),
      jobName: normalizeText(record.jobName),
      applicationDate: exportDateTime(record.applicationDate),
      updatedDate: exportDateTime(record.updatedDate),
      note: normalizeText(record.note),
      recruiterInfo: recruiterInfo(record),
      messageStatus: messageStatusText(record.messageStatus),
      lastMessage: normalizeText(record.lastMessage)
    };
    const row = [
      output.recordKey,
      output.sourceName,
      output.companyName,
      output.jobName,
      output.applicationDate,
      output.updatedDate,
      output.note,
      output.recruiterInfo,
      output.messageStatus,
      output.lastMessage
    ];
    if (debugDataEnabled) row.push(ResultsDb.csvInternalData(record));
    return row;
  });
  return ResultsDb.csv(csvExportHeaders, rows);
}

async function persistCurrentRecords() {
  const records = allRecords.map((record, index) => ({ ...record, index: index + 1 }));
  allRecords = records;
  if (mode === 'sync') {
    latestData = await ResultsDb.saveSyncRecords(latestData, records);
  } else {
    latestData = await ResultsDb.saveOverviewRecords(latestData, records);
  }
}

async function persistIgnoredRecords() {
  const byKey = new Map();
  ignoredRecords.forEach((record) => {
    const recordKey = recordKeyOf(record);
    if (!recordKey) return;
    byKey.set(recordKey, { ...record, recordKey });
  });
  ignoredRecords = Array.from(byKey.values()).map((record, index) => ({ ...record, index: index + 1 }));
  await ResultsDb.saveIgnoredRecords(ignoredRecords);
}

function normalizedIgnoredRecords() {
  const byKey = new Map();
  ignoredRecords.forEach((record) => {
    const recordKey = recordKeyOf(record);
    if (!recordKey) return;
    byKey.set(recordKey, { ...record, recordKey });
  });
  return Array.from(byKey.values()).map((record, index) => ({ ...record, index: index + 1 }));
}

async function ignoreSelectedRecords() {
  if (!selectedKeys.size) return;
  const selected = allRecords.filter((record) => selectedKeys.has(record.recordKey));
  if (!selected.length) return;
  if (!confirm(`确认忽略选中的 ${selected.length} 条记录？`)) return;

  const ignoredByKey = new Map(ignoredRecords.map((record) => [record.recordKey, record]));
  selected.forEach((record) => {
    ignoredByKey.set(record.recordKey, {
      ...record,
      ignoredAt: record.ignoredAt || new Date().toISOString()
    });
  });
  ignoredRecords = Array.from(ignoredByKey.values());
  allRecords = allRecords.filter((record) => !selectedKeys.has(record.recordKey));
  const ignoredKeys = new Set(selected.map((record) => record.recordKey));
  selectedKeys.clear();

  ignoredRecords = normalizedIgnoredRecords();
  const records = allRecords.map((record, index) => ({ ...record, index: index + 1 }));
  allRecords = records;
  latestData = { ...(latestData || {}), total: records.length, records };

  const totalRecords = await ResultsDb.loadTotalRecords();
  const keptTotalRecords = totalRecords.filter((record) => !ignoredKeys.has(recordKeyOf(record))).map((record, index) => ({ ...record, index: index + 1 }));
  const storageUpdate = {
    jobChatIgnoredRecords: ignoredRecords,
    jobChatRecords: keptTotalRecords
  };
  if (mode === 'sync') {
    storageUpdate.jobChatPendingRecords = latestData;
    storageUpdate.bossChatStatsLatest = latestData;
  } else {
    storageUpdate.jobChatRecords = records;
    storageUpdate.bossChatStatsLatest = latestData;
  }
  await ResultsDb.saveMultiple(storageUpdate);

  populateFilters();
  renderTable();
}

function ignoredCreatedTime(record) {
  return normalizeText(record.createdAt || record.importedAt || record.ignoredAt || record.applicationDate || record.updatedDate || '-');
}

function renderIgnoredRecordsModal() {
  if (!ignoredRecordsBox) return;
  if (!ignoredRecords.length) {
    ignoredRecordsBox.innerHTML = '<div class="empty">暂无忽略记录。</div>';
    return;
  }
  ignoredRecordsBox.innerHTML = `
    <table>
      <thead>
        <tr>
          <th class="source">来源</th>
          <th class="company">公司</th>
          <th class="job">岗位</th>
          <th class="date">创建时间</th>
          <th class="action">操作</th>
        </tr>
      </thead>
      <tbody>
        ${ignoredRecords.map((record) => `
          <tr>
            <td class="source-cell">${escapeHtml(record.sourceName)}</td>
            <td class="company-cell">${escapeHtml(record.companyName)}</td>
            <td class="job-cell">${escapeHtml(record.jobName)}</td>
            <td class="date-cell">${escapeHtml(ignoredCreatedTime(record))}</td>
            <td class="action-cell"><button class="secondary restore-ignored-record" data-key="${escapeHtml(record.recordKey)}">恢复</button></td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  ignoredRecordsBox.querySelectorAll('.restore-ignored-record').forEach((button) => {
    button.addEventListener('click', () => restoreIgnoredRecord(button.dataset.key));
  });
}

async function restoreIgnoredRecord(recordKey) {
  const record = ignoredRecords.find((item) => item.recordKey === recordKey);
  if (!record) return;
  ignoredRecords = ignoredRecords.filter((item) => item.recordKey !== recordKey);
  const restored = { ...record };
  delete restored.ignoredAt;
  const byKey = new Map(allRecords.map((item) => [item.recordKey, item]));
  byKey.set(recordKey, restored);
  allRecords = Array.from(byKey.values()).map((item, index) => ({ ...item, index: index + 1 }));
  selectedKeys.delete(recordKey);
  await persistIgnoredRecords();
  await persistCurrentRecords();
  populateFilters();
  renderTable();
  renderIgnoredRecordsModal();
}

function saveEditableValue(recordKey, field, value) {
  const record = allRecords.find((item) => item.recordKey === recordKey);
  if (!record) return;
  record[field] = field === 'messageStatus' ? normalizeMessageStatus(value) : normalizeText(value);
  persistCurrentRecords();
  renderTable();
}

function bindEditableCells() {
  tableBox.querySelectorAll('.editable').forEach((cell) => {
    cell.addEventListener('dblclick', () => {
      hideJobInfoCard();
      cell.dataset.original = cell.textContent;
      cell.contentEditable = 'true';
      cell.classList.add('editing');
      cell.focus();
      const range = document.createRange();
      range.selectNodeContents(cell);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    cell.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); cell.blur(); }
      if (event.key === 'Escape') { event.preventDefault(); cell.textContent = cell.dataset.original || ''; cell.blur(); }
    });
    cell.addEventListener('blur', () => {
      if (cell.contentEditable !== 'true') return;
      cell.contentEditable = 'false';
      cell.classList.remove('editing');
      const value = normalizeText(cell.textContent);
      cell.textContent = value;
      saveEditableValue(cell.dataset.key, cell.dataset.field, value);
    });
  });

  tableBox.querySelectorAll('.row-select').forEach((checkbox) => {
    checkbox.checked = selectedKeys.has(checkbox.value);
    checkbox.addEventListener('click', (event) => { checkbox.dataset.shiftKey = event.shiftKey ? '1' : ''; });
    checkbox.addEventListener('change', (event) => {
      activeSelectionAction = '';
      const recordKey = checkbox.value;
      const canRangeSelect = mode === 'overview' && (event.shiftKey || checkbox.dataset.shiftKey === '1') && lastOverviewSelectedRecordKey;
      const startIndex = canRangeSelect ? pageRecords.findIndex((record) => record.recordKey === lastOverviewSelectedRecordKey) : -1;
      const endIndex = pageRecords.findIndex((record) => record.recordKey === recordKey);
      if (startIndex >= 0 && endIndex >= 0) {
        const [from, to] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
        pageRecords.slice(from, to + 1).forEach((record) => {
          if (checkbox.checked) selectedKeys.add(record.recordKey);
          else selectedKeys.delete(record.recordKey);
        });
      } else if (checkbox.checked) {
        selectedKeys.add(recordKey);
      } else {
        selectedKeys.delete(recordKey);
      }
      if (mode === 'overview') lastOverviewSelectedRecordKey = recordKey;
      updateSelectAllCheckbox();
      updateDeleteButton();
      if (startIndex >= 0 && endIndex >= 0) renderTable();
    });
  });

  const selectAll = document.getElementById('selectAllRows');
  if (selectAll) {
    selectAll.addEventListener('change', () => {
      activeSelectionAction = '';
      pageRecords.forEach((record) => {
        if (selectAll.checked) selectedKeys.add(record.recordKey);
        else selectedKeys.delete(record.recordKey);
      });
      renderTable();
    });
  }
  updateSelectAllCheckbox();
}

function updateSelectAllCheckbox() {
  const selectAll = document.getElementById('selectAllRows');
  if (!selectAll) return;
  const total = pageRecords.length;
  const selected = pageRecords.filter((record) => selectedKeys.has(record.recordKey)).length;
  selectAll.checked = total > 0 && selected === total;
  selectAll.indeterminate = selected > 0 && selected < total;
}

function bindJobDetailNotSyncedFilter() {
  const checkbox = document.getElementById('jobDetailNotSyncedFilter');
  if (!checkbox) return;
  checkbox.checked = jobDetailNotSyncedOnly;
  checkbox.addEventListener('change', () => {
    jobDetailNotSyncedOnly = checkbox.checked;
    currentPage = 1;
    lastOverviewSelectedRecordKey = '';
    selectedKeys.clear();
    renderTable();
  });
}

function updateDeleteButton() {
  if (!deleteSelectedBtn) return;
  const showCount = (action) => selectedKeys.size && (mode !== 'overview' || !activeSelectionAction || activeSelectionAction === action);
  const selectedCount = selectedRecords().length;
  if (downloadCsvBtn) {
    downloadCsvBtn.textContent = selectedCount ? `下载 CSV（${selectedCount}）` : '下载 CSV';
  }
  deleteSelectedBtn.textContent = showCount('delete') ? `删除选中（${selectedKeys.size}）` : '删除选中';
  deleteSelectedBtn.disabled = selectedKeys.size === 0;
  if (updateDetailsBtn) {
    updateDetailsBtn.textContent = detailsUpdating ? '查看同步进度' : (showCount('update') ? `更新选中（${selectedKeys.size}）` : '更新选中');
    updateDetailsBtn.disabled = !detailsUpdating && selectedKeys.size === 0;
  }
  if (ignoreSelectedBtn) {
    ignoreSelectedBtn.textContent = showCount('ignore') ? `忽略选中（${selectedKeys.size}）` : '忽略选中';
    ignoreSelectedBtn.disabled = selectedKeys.size === 0;
  }
  if (ignoredRecordsBtn) {
    ignoredRecordsBtn.style.display = mode === 'overview' ? '' : 'none';
    ignoredRecordsBtn.textContent = ignoredRecords.length ? `忽略记录（${ignoredRecords.length}）` : '忽略记录';
  }
  if (sendMessageBtn) {
    sendMessageBtn.textContent = showCount('send') ? `发送信息（${selectedKeys.size}）` : '发送信息';
    sendMessageBtn.disabled = selectedKeys.size === 0 || sendRunning;
  }
}

function showJobInfoCard(target, record) {
  if (!jobInfoCard) return;
  clearTimeout(jobInfoHideTimer);
  jobInfoCard.classList.remove('conversation-mode');
  const info = normalizeJobInfo(record.jobInfo);
  const empty = !info.skills.length && !info.description;
  const emptyLiepinPreview = (record?.siteKey === 'liepin' || record?.sourceName === '猎聘')
    && record?.liepin?.jobPreviewStatus === 'empty';
  const status = info.fetchStatus === 'failed'
    ? `获取失败：${info.errorMessage || '请稍后重试。'}`
    : (info.errorMessage || (emptyLiepinPreview
      ? '猎聘岗位预览请求成功，该联系人当前没有关联岗位。'
      : (empty ? '暂无岗位详情，可勾选后点击“更新详情”。' : '')));
  const summary = [info.salary, info.location, info.experience, info.education].filter(Boolean).join(' · ');
  jobInfoCard.innerHTML = `<h3>${escapeHtml(info.title || record.jobName || '岗位详情')}</h3><div class="job-info-meta">${escapeHtml(summary)}</div><div class="keywords">${info.skills.map((item) => `<span class="keyword">${escapeHtml(item)}</span>`).join('')}</div><p class="detail">${escapeHtml(info.description || status)}</p><div class="job-info-meta">${escapeHtml(info.address ? `地址：${info.address}` : '')}${escapeHtml(info.fetchedAt ? ` 最近获取：${info.fetchedAt}` : '')}</div>`;
  positionInfoCard(target);
}

function showCompanyInfoCard(target, record) {
  if (!jobInfoCard) return;
  clearTimeout(jobInfoHideTimer);
  jobInfoCard.classList.remove('conversation-mode');
  const companyKey = normalizeText(record?.companyKey);
  const profile = companyKey && companyProfiles[companyKey] && typeof companyProfiles[companyKey] === 'object'
    ? companyProfiles[companyKey]
    : null;
  const name = normalizeText(profile?.name || record?.companyName || '公司详情');
  const summary = [
    normalizeText(profile?.industry) ? `行业：${normalizeText(profile.industry)}` : '',
    normalizeText(profile?.employeeScale) ? `规模：${normalizeText(profile.employeeScale)}` : ''
  ].filter(Boolean).join(' · ');
  const description = globalThis.JobChatRecords.normalizeMultilineText(profile?.description)
    || (companyKey ? '暂无公司介绍。' : '暂无公司详情，请先同步岗位信息。');
  jobInfoCard.innerHTML = `<h3>${escapeHtml(name)}</h3><div class="job-info-meta">${escapeHtml(summary)}</div><p class="detail">${escapeHtml(description)}</p>`;
  positionInfoCard(target);
}

function completeConversation(record) {
  if (!record?.conversation || typeof record.conversation !== 'object') return null;
  const conversation = normalizeConversation(record.conversation);
  return conversation.sync.complete && conversation.messages.length ? conversation : null;
}

function conversationMessageTime(timestamp) {
  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function showConversationCard(target, record) {
  if (!jobInfoCard) return;
  const conversation = completeConversation(record);
  if (!conversation) return;
  clearTimeout(jobInfoHideTimer);
  jobInfoCard.classList.add('conversation-mode');
  const currentUserId = normalizeText(
    conversation.currentUserId
    || record?.boss?.ownerUserId
    || record?.liepin?.imId
  );
  const recruiterLabel = normalizeText(record?.recruiterName) || '招聘者';
  const messages = conversation.messages.map((message) => {
    const outgoing = Boolean(currentUserId && normalizeText(message.fromUserId) === currentUserId);
    const label = outgoing ? '我' : recruiterLabel;
    const time = conversationMessageTime(message.timestamp);
    return `<div class="conversation-row ${outgoing ? 'outgoing' : 'incoming'}"><div class="conversation-bubble"><div class="conversation-message-meta">${escapeHtml([label, time].filter(Boolean).join(' · '))}</div><p class="conversation-message-text">${escapeHtml(message.text)}</p></div></div>`;
  }).join('');
  const title = [normalizeText(record.companyName), normalizeText(record.jobName)].filter(Boolean).join(' · ') || '完整会话';
  jobInfoCard.innerHTML = `<h3>${escapeHtml(title)}</h3><div class="job-info-meta">共 ${conversation.messages.length} 条文本消息 · 按时间顺序</div><div class="conversation-list">${messages}</div>`;
  jobInfoCard.scrollTop = 0;
  positionInfoCard(target, { alignRightToTargetCenter: true });
}

function positionInfoCard(target, options = {}) {
  if (!jobInfoCard) return;
  const rect = target.getBoundingClientRect();
  jobInfoCard.classList.add('show');
  const cardRect = jobInfoCard.getBoundingClientRect();
  const targetCenter = rect.left + rect.width / 2;
  const preferredLeft = options.alignRightToTargetCenter
    ? targetCenter - cardRect.width
    : targetCenter;
  const left = Math.max(12, Math.min(window.innerWidth - cardRect.width - 12, preferredLeft));
  const top = rect.bottom + cardRect.height <= window.innerHeight ? rect.bottom : Math.max(12, rect.top - cardRect.height);
  jobInfoCard.style.left = `${left}px`;
  jobInfoCard.style.top = `${top}px`;
}

function closeJobInfoCard() {
  clearTimeout(jobInfoHideTimer);
  jobInfoCard?.classList.remove('show');
}

function scheduleJobInfoCardHide() {
  clearTimeout(jobInfoHideTimer);
  jobInfoHideTimer = setTimeout(() => jobInfoCard?.classList.remove('show'), 220);
}

function hideJobInfoCard() { closeJobInfoCard(); }

if (jobInfoCard) {
  jobInfoCard.addEventListener('mouseenter', () => clearTimeout(jobInfoHideTimer));
  jobInfoCard.addEventListener('mouseleave', scheduleJobInfoCardHide);
  jobInfoCard.addEventListener('focusin', () => clearTimeout(jobInfoHideTimer));
  jobInfoCard.addEventListener('focusout', scheduleJobInfoCardHide);
}

function bindLogSelectAll(element) {
  if (!element) return;
  element.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'a') return;
    event.preventDefault();
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

bindLogSelectAll(requestLogsBox);
bindLogSelectAll(updateDetailsLog);
bindLogSelectAll(sendMessageLog);

function detailRefreshStatusText(status) {
  if (status?.status === '同步中') return '同步中';
  if (status?.status === '重试中') return '重试中';
  if (status?.status === '成功') return '成功';
  if (status?.status === '失败') return '失败';
  if (status?.status === '已停止') return '已停止';
  return '等待同步';
}

function detailRefreshErrorText(status) {
  const error = status?.error || '';
  if (status?.status !== '重试中' || !status.retryAt) return error;
  const remaining = Math.max(0, Math.ceil((Number(status.retryAt) - Date.now()) / 1000));
  return error.replace(/剩余\s*\d+\s*秒/, `剩余 ${remaining} 秒`);
}

function updateDetailRefreshCountdownDisplay() {
  if (!updateDetailsModal?.classList.contains('show')) return;
  updateDetailsTargets.querySelectorAll('.detail-refresh-status[data-key]').forEach((cell) => {
    const status = detailRefreshStatuses.get(cell.dataset.key) || {};
    if (status.status === '重试中') cell.textContent = detailRefreshStatusText(status);
  });
  updateDetailsTargets.querySelectorAll('.detail-refresh-error[data-key]').forEach((cell) => {
    const status = detailRefreshStatuses.get(cell.dataset.key) || {};
    if (status.status === '重试中') cell.textContent = detailRefreshErrorText(status);
  });
}

function updateDetailRefreshCountdownTimer() {
  const needsTimer = detailsUpdating && [...detailRefreshStatuses.values()].some((status) => status.status === '重试中');
  if (needsTimer && !detailRefreshCountdownTimer) {
    detailRefreshCountdownTimer = setInterval(updateDetailRefreshCountdownDisplay, 1000);
  } else if (!needsTimer && detailRefreshCountdownTimer) {
    clearInterval(detailRefreshCountdownTimer);
    detailRefreshCountdownTimer = null;
  }
}

function renderUpdateDetailsModal() {
  if (!updateDetailsModal) return;
  const total = detailRefreshRecords.length;
  const statuses = detailRefreshRecords.map((record) => detailRefreshStatuses.get(record.recordKey) || {});
  const success = statuses.filter((status) => status.status === '成功').length;
  const failed = statuses.filter((status) => status.status === '失败').length;
  const recordStats = detailRefreshRecordStats;
  const displayedSuccess = recordStats ? Number(recordStats.success || 0) : success;
  const displayedFailed = recordStats ? Number(recordStats.failed || 0) : failed;
  const skipped = recordStats ? Number(recordStats.skipped || 0) : statuses.filter((status) => status.status === '跳过' || status.status === '已停止').length;
  const riskControls = Number(recordStats?.riskControls || 0);
  const displayedCompleted = displayedSuccess + displayedFailed + skipped;
  updateDetailsTitle.textContent = `更新岗位与消息（${total}）`;
  updateDetailsSummary.innerHTML = `<span>待同步总数：${total} 条</span><span class="refresh-counts"><span>成功：${displayedSuccess} 条</span><span>失败：${displayedFailed} 条</span><span>跳过：${skipped} 条</span><span>触发风控：${riskControls} 次</span></span>`;
  updateDetailsProgressBar.style.width = `${total ? Math.round(displayedCompleted / total * 100) : 0}%`;
  if (updateDetailsRefreshNote) updateDetailsRefreshNote.style.display = total ? '' : 'none';
  [updateDetailsRate, updateDetailsRetryDelay, updateDetailsRetryCount].forEach((input) => {
    if (input) input.disabled = detailsUpdating;
  });
  startUpdateDetailsBtn.textContent = detailsUpdating ? '暂停' : '同步';
  updateDetailsTargets.innerHTML = `<table><thead><tr><th>公司</th><th>岗位</th><th>招聘者</th><th>同步状态</th><th>说明</th></tr></thead><tbody>${detailRefreshRecords.map((record) => {
    const status = detailRefreshStatuses.get(record.recordKey) || {};
    return `<tr><td>${escapeHtml(record.companyName)}</td><td>${escapeHtml(record.jobName)}</td><td>${escapeHtml(recruiterInfo(record))}</td><td class="detail-refresh-status" data-key="${escapeHtml(record.recordKey)}">${escapeHtml(detailRefreshStatusText(status))}</td><td class="detail-refresh-error" data-key="${escapeHtml(record.recordKey)}">${escapeHtml(detailRefreshErrorText(status))}</td></tr>`;
  }).join('')}</tbody></table>`;
  if (updateDetailsLog) {
    updateDetailsLog.style.display = sendLogEnabled ? '' : 'none';
    const rawLogs = detailRefreshRequestLogs.map(formatRequestLog);
    const summaryLogs = detailRefreshLogs.map((entry) => `[${String(entry.time || '').slice(11, 19)}] ${entry.message || JSON.stringify(entry)}`);
    updateDetailsLog.textContent = rawLogs.length || summaryLogs.length ? [...summaryLogs, ...rawLogs].join('\n\n') : '暂无同步日志。';
    updateDetailsLog.scrollTop = updateDetailsLog.scrollHeight;
  }
  updateDetailRefreshCountdownTimer();
}

async function openUpdateDetailsModal() {
  if (detailsUpdating && detailRefreshRecords.length) {
    renderUpdateDetailsModal();
    updateDetailsModal.classList.add('show');
    return;
  }
  const records = selectedRecords();
  if (!records.length) return;
  const siteKeys = new Set(records.map((record) => record.siteKey || (record.sourceName === '猎聘' ? 'liepin' : (record.sourceName === 'BOSS直聘' ? 'boss' : ''))));
  if (siteKeys.size !== 1 || !['boss', 'liepin'].includes([...siteKeys][0])) {
    alert('请选择同一个招聘网站的记录后再更新岗位与消息。');
    return;
  }
  const selectedRecordKeys = new Set(records.map((record) => record.recordKey));
  const isExistingBatch = detailRefreshRecords.length === records.length
    && detailRefreshRecords.every((record) => selectedRecordKeys.has(record.recordKey));
  if (isExistingBatch) {
    const latestByKey = new Map(records.map((record) => [record.recordKey, record]));
    detailRefreshRecords = detailRefreshRecords.map((record) => latestByKey.get(record.recordKey) || record);
  } else {
    detailRefreshRecords = records;
    detailRefreshStatuses = new Map(records.map((record) => [record.recordKey, { status: '等待同步' }]));
    detailRefreshRecordStats = null;
    detailRefreshLogs = [];
    detailRefreshRequestLogs = [];
  }
  const store = await chrome.storage.local.get([
    'jobChatJobDetailRefreshRate',
    'jobChatJobDetailRetryDelay',
    'jobChatJobDetailRetryCount'
  ]);
  updateDetailsRate.value = String(Math.max(1, Math.min(3600, Number(store.jobChatJobDetailRefreshRate || 20))));
  updateDetailsRetryDelay.value = String(Math.max(1, Math.min(3600, Math.floor(Number(store.jobChatJobDetailRetryDelay || 60)))));
  updateDetailsRetryCount.value = String(Math.max(1, Math.min(10, Math.floor(Number(store.jobChatJobDetailRetryCount || 3)))));
  renderUpdateDetailsModal();
  updateDetailsModal.classList.add('show');
}

function markUnfinishedDetailRefreshFailed(errorMessage) {
  detailRefreshRecords.forEach((record) => {
    const status = detailRefreshStatuses.get(record.recordKey) || {};
    if (['成功', '失败', '已停止'].includes(status.status)) return;
    detailRefreshStatuses.set(record.recordKey, { status: '失败', error: errorMessage });
  });
}

async function startOrStopDetailRefresh() {
  if (detailsUpdating) {
    detailsUpdating = false;
    detailRefreshRunId = null;
    detailRefreshStatuses.forEach((status, recordKey) => {
      if (status.status === '重试中') {
        detailRefreshStatuses.set(recordKey, { status: '失败', error: '已手动暂停，当前重试已取消。' });
      } else if (status.status === '同步中' || status.status === '已停止') {
        detailRefreshStatuses.set(recordKey, { status: '等待同步', error: '' });
      }
    });
    updateDetailRefreshCountdownTimer();
    renderUpdateDetailsModal();
    updateDeleteButton();
    chrome.runtime.sendMessage({ type: 'JOB_CHAT_STOP_REFRESH' }).catch(() => {});
    return;
  }
  const retryRecords = detailRefreshRecords.filter((record) => detailRefreshStatuses.get(record.recordKey)?.status !== '成功');
  if (!retryRecords.length) return;
  const rate = Math.max(1, Math.min(3600, Math.floor(Number(updateDetailsRate.value || 20))));
  const retryDelaySeconds = Math.max(1, Math.min(3600, Math.floor(Number(updateDetailsRetryDelay.value || 60))));
  const retryCount = Math.max(1, Math.min(10, Math.floor(Number(updateDetailsRetryCount.value || 3))));
  updateDetailsRate.value = String(rate);
  updateDetailsRetryDelay.value = String(retryDelaySeconds);
  updateDetailsRetryCount.value = String(retryCount);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  detailRefreshRunId = runId;
  detailsUpdating = true;
  retryRecords.forEach((record) => detailRefreshStatuses.set(record.recordKey, { status: '等待同步', error: '' }));
  detailRefreshLogs = [];
  detailRefreshRequestLogs = [];
  detailRefreshRecordStats = null;
  renderUpdateDetailsModal();
  updateDeleteButton();
  chrome.storage.local.set({
    jobChatJobDetailRefreshRate: rate,
    jobChatJobDetailRetryDelay: retryDelaySeconds,
    jobChatJobDetailRetryCount: retryCount
  }).then(() => chrome.runtime.sendMessage({ type: 'JOB_CHAT_REFRESH_SELECTED', recordKeys: retryRecords.map((record) => record.recordKey), storageScope: mode === 'sync' ? 'pending' : 'total', rate, retryDelaySeconds, retryCount, debugLog: sendLogEnabled, runId }))
    .then(async (response) => {
      if (detailRefreshRunId !== runId) return;
      detailRefreshRecordStats = response?.recordStats || null;
      (response?.results || []).forEach((result) => {
        detailRefreshStatuses.set(result.recordKey, {
          status: result.skipped ? '跳过' : (result.ok ? '成功' : '失败'),
          error: result.error || ''
        });
      });
      if (!response?.ok) {
        markUnfinishedDetailRefreshFailed(response?.error || '更新岗位与消息失败。');
      }
      detailsUpdating = false;
      updateDetailRefreshCountdownTimer();
      renderUpdateDetailsModal();
      updateDeleteButton();
      await loadAndRenderLatest();
    })
    .catch((error) => {
      if (detailRefreshRunId !== runId) return;
      detailsUpdating = false;
      updateDetailRefreshCountdownTimer();
      markUnfinishedDetailRefreshFailed(error?.message || String(error));
      renderUpdateDetailsModal();
      updateDeleteButton();
    });
}

function selectedRecords() { return allRecords.filter((record) => selectedKeys.has(record.recordKey)); }
function recordSiteKey(record) {
  return record?.siteKey || (record?.sourceName === '猎聘' ? 'liepin' : (record?.sourceName === 'BOSS直聘' ? 'boss' : ''));
}
function isSendable(record) {
  const siteKey = recordSiteKey(record);
  if (siteKey !== 'boss' && siteKey !== 'liepin') return '暂不支持该网站';
  return '';
}
function sendStatusText(progress) {
  const status = progress?.status || '';
  if (status === '成功' || status === '已发送') return '成功';
  if (status === '失败' || status === '结果未知') return '失败';
  return '等待';
}
function renderSendModal() {
  const records = selectedRecords();
  const siteKeys = new Set(records.map(recordSiteKey).filter(Boolean));
  const mixedSites = siteKeys.size > 1;
  const blockedCount = mixedSites ? records.length : records.filter(isSendable).length;
  const sendable = records.length - blockedCount;
  const siteName = siteKeys.size === 1 && siteKeys.has('liepin') ? '猎聘' : 'BOSS直聘';
  sendMessageTitle.textContent = `已选 ${records.length} 条 · 可发送 ${sendable} 条 · 不可发送 ${blockedCount} 条`;
  sendMessageSummary.textContent = sendRunning
    ? '发送任务仍在运行；关闭窗口不会取消发送。'
    : (siteKeys.size > 1
      ? '同一批次只能选择同一个招聘网站的记录。'
      : `仅向当前已登录${siteName}账号下的已有联系人发送纯文本消息。`);
  sendMessageTargets.innerHTML = `<table><thead><tr><th>公司</th><th>岗位</th><th>招聘者</th><th>更新时间</th><th>发送状态</th><th>备注</th></tr></thead><tbody>${records.map((record) => {
    const reason = mixedSites ? '不能混合不同网站发送' : isSendable(record);
    const progress = sendStatuses.get(record.recordKey);
    const note = progress?.errorMessage || reason || '';
    return `<tr><td>${escapeHtml(record.companyName)}</td><td>${escapeHtml(record.jobName)}</td><td>${escapeHtml(recruiterInfo(record))}</td><td>${escapeHtml(displayDate(record.updatedDate))}</td><td>${escapeHtml(sendStatusText(progress))}</td><td>${escapeHtml(note)}</td></tr>`;
  }).join('')}</tbody></table>`;
  renderSendLog();
}
function renderSendLog() {
  if (!sendMessageLog || !sendLogEnabled) return;
  sendMessageLog.textContent = sendLogs.length ? sendLogs.map((entry) => `[${String(entry.time || '').slice(11, 19)}] ${entry.message || ''}`).join('\n') : '尚未开始发送。';
  sendMessageLog.scrollTop = sendMessageLog.scrollHeight;
}
function setSendControls(disabled) {
  [sendMessageText, sendMessageRate].forEach((element) => { if (element) element.disabled = disabled; });
  if (startSendMessageBtn) { startSendMessageBtn.disabled = false; startSendMessageBtn.textContent = disabled ? '停止' : '发送'; }
}

function renderTable() {
  const records = applyFilters();
  updateMeta();
  updateJsonBox();
  updateDeleteButton();
  const tableHeader = `
    <thead>
      <tr>
        <th class="select"><input id="selectAllRows" type="checkbox" title="全选当前页面" /></th>
        <th class="source">来源</th>
        <th class="company">公司</th>
        <th class="job">岗位 <label class="job-sync-filter"><input id="jobDetailNotSyncedFilter" type="checkbox" /> 未同步</label></th>
        <th class="date">申请时间</th>
        <th class="date">更新时间</th>
        <th class="note">备注</th>
        <th class="recruiter">招聘者</th>
        <th class="status">状态</th>
        <th class="message">原消息</th>
      </tr>
    </thead>`;
  if (!records.length) {
    tableBox.innerHTML = `<table>${tableHeader}<tbody><tr><td class="empty" colspan="10">没有符合条件的记录。</td></tr></tbody></table>${paginationMarkup()}`;
    bindEditableCells();
    bindJobDetailNotSyncedFilter();
    bindPaginationControls();
    return;
  }
  tableBox.innerHTML = `
    <table>
      ${tableHeader}
      <tbody>
        ${records.map((r) => `
          <tr>
            <td class="select-cell"><input class="row-select" type="checkbox" value="${escapeHtml(r.recordKey)}" /></td>
            <td class="source-cell">${escapeHtml(r.sourceName)}</td>
            <td class="company-cell company-hover-target" data-key="${escapeHtml(r.recordKey)}" tabindex="0" title="悬浮查看公司详情">${escapeHtml(r.companyName)}</td>
            <td class="job-cell job-hover-target" data-key="${escapeHtml(r.recordKey)}" tabindex="0" title="悬浮查看岗位详情">${escapeHtml(r.jobName)}</td>
            <td class="date-cell">${escapeHtml(displayDate(r.applicationDate))}</td>
            <td class="date-cell">${escapeHtml(displayDate(r.updatedDate))}</td>
            <td class="note-cell editable" data-key="${escapeHtml(r.recordKey)}" data-field="note" title="双击编辑备注">${escapeHtml(r.note || '')}</td>
            <td class="recruiter-cell">${escapeHtml(recruiterInfo(r))}</td>
            <td class="status-cell">${escapeHtml(messageStatusText(r.messageStatus))}</td>
            <td class="message-cell${completeConversation(r) ? ' message-hover-target' : ''}" data-key="${escapeHtml(r.recordKey)}"${completeConversation(r) ? ' tabindex="0" title="悬浮查看完整会话"' : ''}>${escapeHtml(r.lastMessage)}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    ${paginationMarkup()}`;
  bindEditableCells();
  bindJobDetailNotSyncedFilter();
  bindPaginationControls();
  tableBox.querySelectorAll('.company-hover-target').forEach((target) => {
    const record = allRecords.find((item) => item.recordKey === target.dataset.key);
    if (!record) return;
    target.addEventListener('mouseenter', () => showCompanyInfoCard(target, record));
    target.addEventListener('mouseleave', scheduleJobInfoCardHide);
    target.addEventListener('focus', () => showCompanyInfoCard(target, record));
    target.addEventListener('blur', scheduleJobInfoCardHide);
  });
  tableBox.querySelectorAll('.job-hover-target').forEach((target) => {
    const record = allRecords.find((item) => item.recordKey === target.dataset.key);
    if (!record) return;
    target.addEventListener('mouseenter', () => showJobInfoCard(target, record));
    target.addEventListener('mouseleave', scheduleJobInfoCardHide);
    target.addEventListener('focus', () => showJobInfoCard(target, record));
    target.addEventListener('blur', scheduleJobInfoCardHide);
  });
  tableBox.querySelectorAll('.message-hover-target').forEach((target) => {
    const record = allRecords.find((item) => item.recordKey === target.dataset.key);
    if (!record) return;
    target.addEventListener('mouseenter', () => showConversationCard(target, record));
    target.addEventListener('mouseleave', scheduleJobInfoCardHide);
    target.addEventListener('focus', () => showConversationCard(target, record));
    target.addEventListener('blur', scheduleJobInfoCardHide);
  });
}

async function loadAndRenderLatest() {
  const result = await ResultsDb.loadResultsState();
  extractionStatus = result.jobChatExtractionStatus || null;
  ignoredRecords = Array.isArray(result.jobChatIgnoredRecords) ? result.jobChatIgnoredRecords.map(normalizeRecord) : [];
  companyProfiles = result.jobChatCompanyProfiles && typeof result.jobChatCompanyProfiles === 'object'
    ? result.jobChatCompanyProfiles
    : {};
  const accountRecords = [
    ...(Array.isArray(result.jobChatRecords) ? result.jobChatRecords : []),
    ...(Array.isArray(result.jobChatPendingRecords?.records) ? result.jobChatPendingRecords.records : [])
  ];
  internalAccountInfo = debugEnabled ? {
    zhipinUserIds: uniqueInternalValues(accountRecords.map((record) => record?.boss?.ownerUserId)),
    liepinUserIds: uniqueInternalValues(accountRecords.map((record) => record?.liepin?.imId)),
    jobChatBossPcDeviceId: result.jobChatBossPcDeviceId || '',
    jobChatLiepinImClientIds: result.jobChatLiepinImClientIds || {}
  } : {};

  if (mode === 'sync') {
    latestData = result.jobChatPendingRecords || result.bossChatStatsLatest || { total: 0, records: [] };
    const ignoredKeys = new Set(ignoredRecords.map((record) => record.recordKey));
    allRecords = (latestData.records || []).map(normalizeRecord).filter((record) => !ignoredKeys.has(record.recordKey));
    if (allRecords.length !== (latestData.records || []).length) {
      latestData = { ...latestData, total: allRecords.length, records: allRecords };
      await ResultsDb.saveSyncRecords(latestData, allRecords);
    }

    if (extractionStatus?.state === 'ready') {
      configurePageMode();
      configureTodayOnly();
      populateFilters();
      renderReady(extractionStatus);
      return;
    }

    if (extractionStatus?.state === 'loading') {
      configurePageMode();
      configureTodayOnly();
      populateFilters();
      selectedKeys = new Set([...selectedKeys].filter((key) => allRecords.some((record) => record.recordKey === key)));
      renderTable();
      renderLoading(extractionStatus);
      return;
    }

    if (extractionStatus?.state === 'error') {
      renderError(extractionStatus);
      return;
    }
  } else {
    const records = Array.isArray(result.jobChatRecords) ? result.jobChatRecords : [];
    const ignoredKeys = new Set(ignoredRecords.map((record) => record.recordKey));
    const visibleRecords = records.map(normalizeRecord).filter((record) => !ignoredKeys.has(record.recordKey));
    latestData = { ...(result.bossChatStatsLatest || {}), siteTitle: '招聘沟通记录总览', sourceName: '全部来源', total: visibleRecords.length, records: visibleRecords };
    allRecords = visibleRecords;
  }

  configurePageMode();
  configureTodayOnly();
  populateFilters();
  setStatus(null, '');
  selectedKeys = new Set([...selectedKeys].filter((key) => allRecords.some((record) => record.recordKey === key)));
  renderTable();
}


async function importCsvFile(file) {
  const text = await file.text();
  const imported = ResultsDb.rowsFromImportedCsv(text, { allowInternalData: debugDataEnabled });
  if (!imported.length) throw new Error('CSV 中没有可导入的记录。');
  const byKey = new Map(allRecords.map((record) => [record.recordKey, record]));
  let inserted = 0;
  let updated = 0;
  imported.forEach((rawRecord, index) => {
    const record = normalizeRecord(rawRecord, index);
    if (byKey.has(record.recordKey)) updated += 1;
    else inserted += 1;
    byKey.set(record.recordKey, ResultsDb.mergeImportedRecord(
      byKey.get(record.recordKey),
      record,
      { allowInternalData: debugDataEnabled }
    ));
  });
  allRecords = Array.from(byKey.values()).map((record, index) => ({ ...record, index: index + 1 }));
  await persistCurrentRecords();
  populateFilters();
  renderTable();
  alert(`导入完成：新增 ${inserted} 条，更新 ${updated} 条。`);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.jobChatExtractionStatus || changes.bossChatStatsLatest || changes.jobChatRecords || changes.jobChatPendingRecords || changes.jobChatIgnoredRecords || changes.jobChatCompanyProfiles) {
    loadAndRenderLatest();
  }
  if (changes.jobChatBossSendProgress) {
    const progress = changes.jobChatBossSendProgress.newValue || {};
    if (progress.recordKey) sendStatuses.set(progress.recordKey, progress);
    if (progress.type === 'BOSS_SEND_ERROR' || progress.type === 'LIEPIN_SEND_ERROR') {
      selectedRecords().forEach((record) => {
        const current = sendStatuses.get(record.recordKey);
        if (sendStatusText(current) === '等待') {
          sendStatuses.set(record.recordKey, {
            recordKey: record.recordKey,
            status: '失败',
            errorCode: 'BATCH_FAILED',
            errorMessage: progress.errorMessage || '发送任务失败。'
          });
        }
      });
    }
    if (['BOSS_SEND_FINISHED', 'BOSS_SEND_ERROR', 'BOSS_SEND_STOPPED', 'LIEPIN_SEND_FINISHED', 'LIEPIN_SEND_ERROR', 'LIEPIN_SEND_STOPPED'].includes(progress.type)) {
      sendRunning = false;
      sendSiteKey = '';
      setSendControls(false);
    }
    if (sendMessageModal?.classList.contains('show')) renderSendModal();
    updateDeleteButton();
  }
  if (changes.jobChatRefreshProgress) {
    const progress = changes.jobChatRefreshProgress.newValue || {};
    if (detailsUpdating && detailRefreshRunId && progress.runId === detailRefreshRunId) {
      if (progress.recordKey) detailRefreshStatuses.set(progress.recordKey, {
        status: progress.status || '同步中',
        error: progress.error || '',
        remainingSeconds: Number(progress.remainingSeconds || 0),
        retryAt: Number(progress.retryAt || 0)
      });
      if (updateDetailsModal?.classList.contains('show')) renderUpdateDetailsModal();
    }
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'JOB_CHAT_SEND_LOG_EVENT') {
    if (!sendLogEnabled) return;
    sendLogs = [...sendLogs, {
      time: new Date().toISOString(),
      ...(message.entry || {})
    }].slice(-200);
    if (sendMessageModal?.classList.contains('show')) renderSendLog();
    return;
  }
  if (message?.type !== 'JOB_CHAT_LOG_EVENT') return;
  if (message.logType === 'clear') {
    detailRefreshLogs = [];
    detailRefreshRequestLogs = [];
  } else {
    const entry = { time: new Date().toISOString(), ...(message.entry || {}) };
    if (message.logType === 'request') {
      detailRefreshRequestLogs = [...detailRefreshRequestLogs, entry].slice(-1000);
    } else if (message.logType === 'summary' && sendLogEnabled) {
      detailRefreshLogs = [...detailRefreshLogs, entry].slice(-200);
    }
  }
  if (updateDetailsModal?.classList.contains('show')) renderUpdateDetailsModal();
});

[todayOnly, sourceFilter, companyFilter, messageStatusFilter, dateFieldFilter, dateFrom, dateTo, sortBy].forEach((el) => el?.addEventListener('change', () => {
  currentPage = 1;
  lastOverviewSelectedRecordKey = '';
  selectedKeys.clear();
  renderTable();
}));

if (queryInput) queryInput.addEventListener('input', () => {
  clearTimeout(queryTimer);
  queryTimer = setTimeout(() => {
    queryValue = normalizeText(queryInput.value);
    currentPage = 1;
    lastOverviewSelectedRecordKey = '';
    selectedKeys.clear();
    renderTable();
  }, 1000);
});

saveBtn.addEventListener('click', async () => {
  const recordsForAnalytics = [...allRecords];
  try {
    await persistCurrentRecords();
    const response = await chrome.runtime.sendMessage({ type: 'SAVE_PENDING_TO_TOTAL' });
    if (!response?.ok) {
      void trackSavedRecords(recordsForAnalytics, 'failed');
      alert(response?.error || '保存失败');
      return;
    }
    void trackSavedRecords(recordsForAnalytics, recordsForAnalytics.length ? 'success' : 'empty');
    saveBtn.textContent = '已保存到总记录';
    setTimeout(() => (saveBtn.textContent = '保存到总记录'), 1500);
    await loadAndRenderLatest();
  } catch (error) {
    void trackSavedRecords(recordsForAnalytics, 'failed');
    alert(error?.message || '保存失败');
  }
});

overviewBtn.addEventListener('click', async () => {
  if (mode === 'sync') {
    await chrome.tabs.create({ url: chrome.runtime.getURL(runtimeConfig.resultsPagePath('overview')), active: true });
  } else {
    await loadAndRenderLatest();
  }
});

deleteSelectedBtn.addEventListener('click', async () => {
  if (!selectedKeys.size) return;
  if (mode === 'overview') {
    activeSelectionAction = 'delete';
    updateDeleteButton();
  }
  if (!confirm(`确认删除选中的 ${selectedKeys.size} 条记录？`)) return;
  allRecords = allRecords.filter((record) => !selectedKeys.has(record.recordKey));
  selectedKeys.clear();
  await persistCurrentRecords();
  populateFilters();
  renderTable();
});

if (updateDetailsBtn) updateDetailsBtn.addEventListener('click', () => {
  if (mode === 'overview') {
    activeSelectionAction = 'update';
    updateDeleteButton();
  }
  openUpdateDetailsModal();
});
if (startUpdateDetailsBtn) startUpdateDetailsBtn.addEventListener('click', startOrStopDetailRefresh);
function closeUpdateDetailsModal() {
  if (detailsUpdating && !confirm('同步仍在进行，关闭弹窗不会停止同步。是否关闭？')) return;
  updateDetailsModal?.classList.remove('show');
  if (mode !== 'overview' || detailsUpdating) return;
  detailRefreshRecords = [];
  detailRefreshStatuses = new Map();
  detailRefreshRecordStats = null;
  detailRefreshRunId = null;
  detailRefreshLogs = [];
  detailRefreshRequestLogs = [];
  activeSelectionAction = '';
  selectedKeys.clear();
  updateDetailRefreshCountdownTimer();
  renderTable();
}
if (closeUpdateDetailsModalBtn) closeUpdateDetailsModalBtn.addEventListener('click', closeUpdateDetailsModal);
if (updateDetailsModal) updateDetailsModal.addEventListener('click', (event) => {
  if (event.target === updateDetailsModal) closeUpdateDetailsModal();
});

if (ignoreSelectedBtn) {
  ignoreSelectedBtn.addEventListener('click', () => {
    if (mode === 'overview') {
      activeSelectionAction = 'ignore';
      updateDeleteButton();
    }
    ignoreSelectedRecords();
  });
}

if (ignoredRecordsBtn) {
  ignoredRecordsBtn.addEventListener('click', () => {
    renderIgnoredRecordsModal();
    ignoredModal?.classList.add('show');
  });
}

if (closeIgnoredModalBtn) {
  closeIgnoredModalBtn.addEventListener('click', () => ignoredModal?.classList.remove('show'));
}

if (ignoredModal) {
  ignoredModal.addEventListener('click', (event) => {
    if (event.target === ignoredModal) ignoredModal.classList.remove('show');
  });
}

if (requestLogsBtn) {
  requestLogsBtn.addEventListener('click', showRequestLogs);
}

if (closeRequestLogsModalBtn) {
  closeRequestLogsModalBtn.addEventListener('click', () => requestLogsModal?.classList.remove('show'));
}

if (requestLogsModal) {
  requestLogsModal.addEventListener('click', (event) => {
    if (event.target === requestLogsModal) requestLogsModal.classList.remove('show');
  });
}

if (sendMessageBtn) sendMessageBtn.addEventListener('click', async () => {
  if (mode === 'overview') {
    activeSelectionAction = 'send';
    updateDeleteButton();
  }
  sendStatuses = new Map();
  const openingSiteKeys = new Set(selectedRecords().map(recordSiteKey).filter(Boolean));
  sendSiteKey = openingSiteKeys.size === 1 ? [...openingSiteKeys][0] : '';
  sendMessageText.value = '';
  sendMessageCount.textContent = '0 / 1000';
  sendMessageRate.value = String(await ResultsDb.loadSendRate(sendSiteKey || 'boss'));
  sendLogs = [];
  renderSendModal();
  sendMessageModal.classList.add('show');
});
if (sendMessageText) sendMessageText.addEventListener('input', () => { sendMessageCount.textContent = `${sendMessageText.value.length} / 1000`; });
if (sendMessageRate) sendMessageRate.addEventListener('change', async () => {
  const inputRate = Number(sendMessageRate.value);
  const rate = Number.isFinite(inputRate) ? Math.max(1, Math.floor(inputRate)) : 10;
  sendMessageRate.value = String(rate); await ResultsDb.saveSendRate(sendSiteKey || 'boss', rate);
});
if (startSendMessageBtn) startSendMessageBtn.addEventListener('click', async () => {
  if (sendRunning) {
    startSendMessageBtn.disabled = true;
    const response = await chrome.runtime.sendMessage({ type: 'JOB_CHAT_STOP_SEND' });
    if (!response?.ok) alert(response?.error || '无法停止发送任务。');
    startSendMessageBtn.disabled = false;
    return;
  }
  const message = normalizeText(sendMessageText.value);
  const records = selectedRecords();
  if (!message) { alert('请输入要发送的消息。'); return; }
  if (!records.length) { alert('没有选中记录。'); return; }
  const siteKeys = new Set(records.map(recordSiteKey));
  if (siteKeys.size !== 1 || !['boss', 'liepin'].includes([...siteKeys][0])) {
    alert('请选择同一个招聘网站的记录后再发送。');
    return;
  }
  sendSiteKey = [...siteKeys][0];
  const inputRate = Number(sendMessageRate.value);
  const rate = Number.isFinite(inputRate) ? Math.max(1, Math.floor(inputRate)) : 10;
  await ResultsDb.saveSendRate(sendSiteKey, rate);
  sendRunning = true; sendLogs = []; setSendControls(true); renderSendModal();
  const response = await chrome.runtime.sendMessage({
    type: 'JOB_CHAT_SEND_BATCH',
    siteKey: sendSiteKey,
    recordKeys: records.map((record) => record.recordKey),
    message,
    rate
  });
  if (!response?.ok) {
    const errorMessage = response?.error || '无法启动发送任务。';
    records.forEach((record) => {
      if (sendStatusText(sendStatuses.get(record.recordKey)) === '等待') {
        sendStatuses.set(record.recordKey, {
          recordKey: record.recordKey,
          status: '失败',
          errorCode: 'BATCH_START_FAILED',
          errorMessage
        });
      }
    });
    sendRunning = false;
    sendSiteKey = '';
    setSendControls(false);
    renderSendModal();
    alert(errorMessage);
  }
});
function closeSendModal() {
  if (sendRunning && !confirm('发送任务仍在运行。关闭弹窗不会取消发送，是否关闭？')) return;
  sendMessageModal.classList.remove('show');
}
if (closeSendMessageModalBtn) closeSendMessageModalBtn.addEventListener('click', closeSendModal);
if (sendMessageModal) sendMessageModal.addEventListener('click', (event) => { if (event.target === sendMessageModal) closeSendModal(); });



function normalizeSyncRateSettings() {
  const unit = ['second', 'minute', 'hour'].includes(syncRateUnit?.value) ? syncRateUnit.value : 'second';
  const count = Math.max(1, Math.min(3600, Math.floor(Number(syncRateLimit?.value || 2))));
  if (syncRateUnit) syncRateUnit.value = unit;
  if (syncRateLimit) syncRateLimit.value = String(count);
  return { unit, count };
}

async function updateRatingPromptState(updates) {
  const stored = await chrome.storage.local.get([RATING_PROMPT_STATE_KEY]);
  const current = stored[RATING_PROMPT_STATE_KEY] || {};
  await chrome.storage.local.set({
    [RATING_PROMPT_STATE_KEY]: {
      ...current,
      clickCount: Math.max(0, Number(current.clickCount) || 0),
      ...updates
    }
  });
}

async function countSyncClickAndMaybeShowRatingPrompt() {
  try {
    const stored = await chrome.storage.local.get([RATING_PROMPT_STATE_KEY]);
    const current = stored[RATING_PROMPT_STATE_KEY] || {};
    if (current.promptedAt) return;
    const clickCount = Math.max(0, Number(current.clickCount) || 0) + 1;
    const updates = { ...current, clickCount };
    if (clickCount > RATING_PROMPT_CLICK_THRESHOLD) {
      updates.promptedAt = new Date().toISOString();
      updates.action = 'shown';
    }
    await chrome.storage.local.set({ [RATING_PROMPT_STATE_KEY]: updates });
    if (updates.promptedAt && ratingPromptModal) {
      ratingPromptModal.classList.add('show');
      confirmRatingPromptBtn?.focus();
    }
  } catch (_) {
    // 评分提示状态失败不应影响正常同步。
  }
}

function closeRatingPrompt() {
  ratingPromptModal?.classList.remove('show');
}

if (closeRatingPromptBtn) {
  closeRatingPromptBtn.addEventListener('click', () => {
    closeRatingPrompt();
    void updateRatingPromptState({
      action: 'dismissed',
      handledAt: new Date().toISOString()
    }).catch(() => {});
  });
}

if (confirmRatingPromptBtn) {
  confirmRatingPromptBtn.addEventListener('click', async () => {
    closeRatingPrompt();
    await updateRatingPromptState({
      action: 'store_opened',
      handledAt: new Date().toISOString()
    }).catch(() => {});
    if (CHROME_WEB_STORE_URL) {
      await chrome.tabs.create({ url: CHROME_WEB_STORE_URL, active: true }).catch(() => {});
    }
  });
}

if (syncRateLimit || syncRateUnit) {
  ResultsDb.loadSyncRateSettings().then((settings) => {
    if (syncRateUnit) syncRateUnit.value = settings.unit || 'second';
    if (syncRateLimit) syncRateLimit.value = String(settings.count || 2);
  });
  [syncRateLimit, syncRateUnit].forEach((el) => el?.addEventListener('change', async () => {
    await ResultsDb.saveSyncRateSettings(normalizeSyncRateSettings());
  }));
}

if (startSyncBtn) {
  startSyncBtn.addEventListener('click', async () => {
    await countSyncClickAndMaybeShowRatingPrompt();
    const includeInsert = Boolean(resumeInsert?.checked);
    const includeUpdate = Boolean(resumeUpdate?.checked);
    if (!includeInsert && !includeUpdate) {
      alert('请至少选择“新增”或“更新”中的一项。');
      return;
    }
    startSyncBtn.disabled = true;
    await ResultsDb.saveSyncRateSettings(normalizeSyncRateSettings());
    const response = await chrome.runtime.sendMessage({
      type: 'START_PREPARED_SYNC',
      syncSelection: { includeInsert, includeUpdate }
    });
    if (!response?.ok) alert(response?.error || '同步失败');
    startSyncBtn.disabled = false;
  });
}

if (importCsvBtn && importCsvInput) {
  importCsvBtn.addEventListener('click', () => importCsvInput.click());
  importCsvInput.addEventListener('change', async () => {
    const file = importCsvInput.files?.[0];
    importCsvInput.value = '';
    if (!file) return;
    try { await importCsvFile(file); } catch (error) { alert(error?.message || String(error)); }
  });
}

if (cancelSyncBtn) {
  cancelSyncBtn.addEventListener('click', async () => {
    cancelSyncBtn.disabled = true;
    cancelSyncBtn.textContent = '正在中断...';
    await chrome.runtime.sendMessage({ type: 'CANCEL_CURRENT_SYNC' });
    setTimeout(() => {
      cancelSyncBtn.disabled = false;
      cancelSyncBtn.textContent = '中断同步';
    }, 1500);
  });
}

if (resumeSyncBtn) {
  resumeSyncBtn.addEventListener('click', async () => {
    const includeInsert = Boolean(resumeInsert?.checked);
    const includeUpdate = Boolean(resumeUpdate?.checked);
    if (!includeInsert && !includeUpdate) {
      alert('请至少选择“新增”或“更新”中的一项。');
      return;
    }
    resumeSyncBtn.disabled = true;
    resumeSyncBtn.textContent = '正在继续...';
    const response = await chrome.runtime.sendMessage({
      type: 'RESUME_CURRENT_SYNC',
      syncSelection: { includeInsert, includeUpdate }
    });
    if (!response?.ok) alert(response?.error || '继续同步失败');
    resumeSyncBtn.disabled = false;
    resumeSyncBtn.textContent = '继续同步';
  });
}

copyTableBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(toTsv(true));
  copyTableBtn.textContent = '已复制表格';
  setTimeout(() => (copyTableBtn.textContent = '复制表格'), 1200);
});

copyJsonBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(JSON.stringify(activePreviewData(), null, 2));
  copyJsonBtn.textContent = '已复制 JSON';
  setTimeout(() => (copyJsonBtn.textContent = '复制 JSON'), 1200);
});

downloadCsvBtn.addEventListener('click', () => {
  const exportRecords = csvExportRecords();
  const recordScope = selectedRecords().length ? 'selected' : 'all';
  const blob = new Blob(['\ufeff' + toCsv()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `job-chat-records-${mode}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  void trackAnalyticsEvent('csv_downloaded', {
    site: analyticsSiteForRecords(exportRecords),
    record_count: exportRecords.length,
    record_scope: recordScope,
    page_mode: mode,
    result: exportRecords.length ? 'success' : 'empty'
  });
});

chrome.runtime.sendMessage({
  type: 'JOB_CHAT_ANALYTICS_ACTIVE',
  pageMode: mode
}).catch(() => {});
initializeAnalyticsSetting();
configurePageMode();
loadAndRenderLatest();
