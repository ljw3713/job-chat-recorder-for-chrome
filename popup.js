const btn = document.getElementById('extractBtn');
const btnText = document.getElementById('btnText');
const errorBox = document.getElementById('error');
const currentSiteBox = document.getElementById('currentSite');
const overviewBtn = document.getElementById('overviewBtn');
const analyticsEnabled = document.getElementById('analyticsEnabled');
const analyticsHint = document.getElementById('analyticsHint');

const SUPPORTED_SITES = [
  { key: 'boss', hostPattern: /(^|\.)zhipin\.com$/i, source: 'BOSS直聘' },
  { key: 'liepin', hostPattern: /(^|\.)liepin\.com$/i, source: '猎聘' }
];

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
  btnText.textContent = isLoading ? '正在同步，请稍候...' : '同步当前聊天记录';
}

function setAnalyticsHint(configured) {
  if (!analyticsHint) return;
  analyticsHint.textContent = configured
    ? '仅统计功能使用数量、版本、地区和设备类型，不上传聊天或账号信息。'
    : '当前构建尚未配置 GA4，不会发送统计数据。';
}

async function initializeAnalytics() {
  if (!analyticsEnabled) return;
  const response = await chrome.runtime.sendMessage({ type: 'JOB_CHAT_ANALYTICS_STATUS' }).catch(() => null);
  const status = response?.data || {};
  analyticsEnabled.checked = status.enabled !== false;
  setAnalyticsHint(Boolean(status.configured));
  if (analyticsEnabled.checked) {
    chrome.runtime.sendMessage({
      type: 'JOB_CHAT_ANALYTICS_ACTIVE',
      pageMode: 'popup'
    }).catch(() => {});
  }
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
        pageMode: 'popup'
      }).catch(() => {});
    }
  });
}

async function refreshCurrentSiteHint() {
  const tab = await getActiveTab();
  const tabUrl = tab?.url || '';
  const site = detectSupportedSite(tabUrl);
  btn.disabled = false;

  if (site) {
    currentSiteBox.textContent = `当前网站：${site.source}，可以提取。`;
    currentSiteBox.className = 'site ok';
  } else {
    currentSiteBox.textContent = `当前网站：暂不支持。目前支持 ${supportedSiteNames()}。`;
    currentSiteBox.className = 'site warn';
  }
}

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

refreshCurrentSiteHint();
initializeAnalytics();
