const btn = document.getElementById('extractBtn');
const btnText = document.getElementById('btnText');
const errorBox = document.getElementById('error');
const currentSiteBox = document.getElementById('currentSite');
const overviewBtn = document.getElementById('overviewBtn');
const onlineOnlyOption = document.getElementById('onlineOnlyOption');
const onlineOnlyCheckbox = document.getElementById('onlineOnlyCheckbox');
const onlineOnlyText = document.getElementById('onlineOnlyText');
const nonHunterOption = document.getElementById('nonHunterOption');
const nonHunterCheckbox = document.getElementById('nonHunterCheckbox');
const nonHunterText = document.getElementById('nonHunterText');
const companyFilterRow = document.getElementById('companyFilterRow');
const companyFilterCheckbox = document.getElementById('companyFilterCheckbox');
const companyFilterKeywordsInput = document.getElementById('companyFilterKeywords');
const languageCn = document.getElementById('languageCn');
const languageEn = document.getElementById('languageEn');
const autoMessageBtn = document.getElementById('autoMessageBtn');
let activeTab = null;

const SUPPORTED_SITES = [
  { key: 'boss', hostPattern: /(^|\.)zhipin\.com$/i, source: 'BOSS直聘' },
  { key: 'liepin', hostPattern: /(^|\.)liepin\.com$/i, source: '猎聘' }
];

function t(key, parameters) {
  return globalThis.JobChatI18n.translate(key, parameters);
}

function syncLanguageSelection(language) {
  languageCn.checked = language === 'cn';
  languageEn.checked = language === 'en';
}

async function initializeLanguageSelection() {
  await globalThis.JobChatI18n.init();
  syncLanguageSelection(globalThis.JobChatI18n.getLanguage());
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

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

function setLoading(isLoading) {
  document.body.classList.toggle('loading', isLoading);
  btn.disabled = isLoading;
  btnText.textContent = isLoading ? t('popup.syncing') : t('popup.syncCurrent');
}

function setOnlineOnlyAvailability(site, enabled = false) {
  const available = Boolean(site);
  onlineOnlyCheckbox.disabled = !available;
  onlineOnlyCheckbox.checked = available && Boolean(enabled);
  onlineOnlyOption.classList.toggle('disabled', !available);
  onlineOnlyText.dataset.tooltip = available
    ? '修改后需要刷新当前招聘页面才能生效'
    : '请先打开 BOSS直聘或猎聘页面';
}

function setNonHunterAvailability(site, enabled = false) {
  const available = Boolean(site);
  nonHunterCheckbox.disabled = !available;
  nonHunterCheckbox.checked = available && Boolean(enabled);
  nonHunterOption.classList.toggle('disabled', !available);
  nonHunterText.dataset.tooltip = available
    ? '修改后需要刷新当前招聘页面才能生效'
    : '请先打开 BOSS直聘或猎聘页面';
}

function setCompanyFilterAvailability(site, enabled = false, keywords = '') {
  const available = Boolean(site);
  companyFilterCheckbox.disabled = !available;
  companyFilterCheckbox.checked = available && Boolean(enabled);
  companyFilterKeywordsInput.disabled = !available;
  companyFilterKeywordsInput.value = String(keywords || '');
  companyFilterRow.classList.toggle('disabled', !available);
}

function setAutoMessageAvailability(site) {
  const available = Boolean(site);
  autoMessageBtn.disabled = !available;
  autoMessageBtn.title = available ? '' : '请先打开 BOSS直聘或猎聘页面';
}

async function refreshCurrentSiteHint() {
  const tab = await getActiveTab();
  activeTab = tab || null;
  const tabUrl = tab?.url || '';
  const site = detectSupportedSite(tabUrl);
  btn.disabled = false;

  if (site) {
    currentSiteBox.textContent = t('popup.currentSite', { site: site.source });
    currentSiteBox.className = 'site ok';
    const [onlineOnlyResponse, nonHunterResponse, companyFilterResponse] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'JOB_CHAT_ONLINE_ONLY_GET', tabId: tab.id }),
      chrome.runtime.sendMessage({ type: 'JOB_CHAT_NON_HUNTER_GET', tabId: tab.id }),
      chrome.runtime.sendMessage({ type: 'JOB_CHAT_COMPANY_FILTER_GET', tabId: tab.id })
    ]);
    setOnlineOnlyAvailability(site, onlineOnlyResponse?.ok && onlineOnlyResponse.enabled);
    setNonHunterAvailability(site, nonHunterResponse?.ok && nonHunterResponse.enabled);
    setCompanyFilterAvailability(
      site,
      companyFilterResponse?.ok && companyFilterResponse.enabled,
      companyFilterResponse?.ok ? companyFilterResponse.keywords : ''
    );
    setAutoMessageAvailability(site);
  } else {
    currentSiteBox.textContent = t('popup.unsupportedSite', { sites: supportedSiteNames() });
    currentSiteBox.className = 'site warn';
    setOnlineOnlyAvailability(null, false);
    setNonHunterAvailability(null, false);
    setCompanyFilterAvailability(null, false, '');
    setAutoMessageAvailability(null);
  }
}

onlineOnlyCheckbox.addEventListener('change', async () => {
  errorBox.textContent = '';
  const enabled = onlineOnlyCheckbox.checked;
  onlineOnlyCheckbox.disabled = true;
  try {
    const tab = activeTab || await getActiveTab();
    if (!tab?.id || !detectSupportedSite(tab.url || '')) {
      throw new Error(t('popup.openSupportedSite'));
    }
    const response = await chrome.runtime.sendMessage({
      type: 'JOB_CHAT_ONLINE_ONLY_SET',
      tabId: tab.id,
      enabled
    });
    if (!response?.ok) throw new Error(response?.error || t('popup.saveOnlineOnlyFailed'));
    onlineOnlyCheckbox.checked = Boolean(response.enabled);
  } catch (error) {
    onlineOnlyCheckbox.checked = !enabled;
    errorBox.textContent = error?.message || String(error);
  } finally {
    onlineOnlyCheckbox.disabled = false;
  }
});

nonHunterCheckbox.addEventListener('change', async () => {
  errorBox.textContent = '';
  const enabled = nonHunterCheckbox.checked;
  nonHunterCheckbox.disabled = true;
  try {
    const tab = activeTab || await getActiveTab();
    if (!tab?.id || !detectSupportedSite(tab.url || '')) {
      throw new Error(t('popup.openSupportedSite'));
    }
    const response = await chrome.runtime.sendMessage({
      type: 'JOB_CHAT_NON_HUNTER_SET',
      tabId: tab.id,
      enabled
    });
    if (!response?.ok) throw new Error(response?.error || t('popup.saveNonHunterFailed'));
    nonHunterCheckbox.checked = Boolean(response.enabled);
  } catch (error) {
    nonHunterCheckbox.checked = !enabled;
    errorBox.textContent = error?.message || String(error);
  } finally {
    nonHunterCheckbox.disabled = false;
  }
});

companyFilterCheckbox.addEventListener('change', async () => {
  errorBox.textContent = '';
  const enabled = companyFilterCheckbox.checked;
  companyFilterCheckbox.disabled = true;
  try {
    const tab = activeTab || await getActiveTab();
    if (!tab?.id || !detectSupportedSite(tab.url || '')) {
      throw new Error(t('popup.openSupportedSite'));
    }
    const response = await chrome.runtime.sendMessage({
      type: 'JOB_CHAT_COMPANY_FILTER_SET_ENABLED',
      tabId: tab.id,
      enabled
    });
    if (!response?.ok) throw new Error(response?.error || t('popup.saveCompanyFilterFailed'));
    companyFilterCheckbox.checked = Boolean(response.enabled);
  } catch (error) {
    companyFilterCheckbox.checked = !enabled;
    errorBox.textContent = error?.message || String(error);
  } finally {
    companyFilterCheckbox.disabled = false;
  }
});

companyFilterKeywordsInput.addEventListener('input', () => {
  chrome.runtime.sendMessage({
    type: 'JOB_CHAT_COMPANY_FILTER_SET_KEYWORDS',
    keywords: companyFilterKeywordsInput.value
  }).then((response) => {
    if (!response?.ok) throw new Error(response?.error || t('popup.saveKeywordsFailed'));
  }).catch((error) => {
    errorBox.textContent = error?.message || String(error);
  });
});

[languageCn, languageEn].forEach((radio) => {
  radio.addEventListener('change', async () => {
    if (!radio.checked) return;
    errorBox.textContent = '';
    try {
      await globalThis.JobChatI18n.setLanguage(radio.value);
      syncLanguageSelection(globalThis.JobChatI18n.getLanguage());
    } catch (error) {
      errorBox.textContent = error?.message || String(error);
    }
  });
});

globalThis.JobChatI18n.onLanguageChanged((language) => {
  syncLanguageSelection(language);
  refreshCurrentSiteHint().catch(() => {});
});

autoMessageBtn.addEventListener('click', async (event) => {
  errorBox.textContent = '';
  autoMessageBtn.disabled = true;
  try {
    const tab = activeTab || await getActiveTab();
    if (!tab?.id || !detectSupportedSite(tab.url || '')) {
      throw new Error('请先打开 BOSS直聘或猎聘页面。');
    }
    if (!chrome.sidePanel?.open) {
      throw new Error('当前 Chrome 版本不支持侧边栏，请升级至 Chrome 116 或更高版本。');
    }
    const debugEnabled = Boolean(globalThis.JobChatRuntimeConfig?.enableDebugLog || event.ctrlKey);
    await chrome.sidePanel.setOptions({
      path: `auto-message-panel.html${debugEnabled ? '?debug=1' : ''}`,
      enabled: true
    });
    await chrome.sidePanel.open({ windowId: tab.windowId });
    window.close();
  } catch (error) {
    errorBox.textContent = error?.message || String(error);
    autoMessageBtn.disabled = false;
  }
});

if (overviewBtn) {
  overviewBtn.addEventListener('click', async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL(globalThis.JobChatRuntimeConfig.resultsPagePath('overview')), active: true });
    window.close();
  });
}

btn.addEventListener('click', async () => {
  errorBox.textContent = '';
  setLoading(true);

  try {
    const tab = await getActiveTab();
    if (!tab?.id) throw new Error('没有找到当前活动标签页。');

    const response = await chrome.runtime.sendMessage({
      type: 'START_JOB_CHAT_EXTRACTION',
      tab: { id: tab.id, url: tab.url, title: tab.title }
    });

    if (!response?.ok) throw new Error(response?.error || '启动提取失败。');
    // 后续提取在后台继续执行，结果页会自动显示 loading / 成功 / 失败状态。
    window.close();
  } catch (error) {
    errorBox.textContent = error?.message || String(error);
    setLoading(false);
  }
});

initializeLanguageSelection().then(refreshCurrentSiteHint).catch((error) => {
  errorBox.textContent = error?.message || String(error);
});
chrome.runtime.sendMessage({
  type: 'JOB_CHAT_ANALYTICS_ACTIVE',
  pageMode: 'popup'
}).catch(() => {});
