const btn = document.getElementById('extractBtn');
const btnText = document.getElementById('btnText');
const errorBox = document.getElementById('error');
const currentSiteBox = document.getElementById('currentSite');
const overviewBtn = document.getElementById('overviewBtn');

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
    await chrome.tabs.create({ url: chrome.runtime.getURL('results.html?mode=overview'), active: true });
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
