const btn = document.getElementById('extractBtn');
const btnText = document.getElementById('btnText');
const errorBox = document.getElementById('error');
const currentSiteBox = document.getElementById('currentSite');
const openBossChatBtn = document.getElementById('openBossChatBtn');
const overviewBtn = document.getElementById('overviewBtn');

const BOSS_CHAT_URL = 'https://www.zhipin.com/web/geek/chat';

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

function isBossChatPage(tabUrl) {
  try {
    const url = new URL(tabUrl);
    return url.hostname === 'www.zhipin.com' && url.pathname === '/web/geek/chat';
  } catch (_) {
    return false;
  }
}

function isBossSite(tabUrl) {
  return detectSupportedSite(tabUrl)?.key === 'boss';
}

function supportedSiteNames() {
  return 'zhipin.com（BOSS直聘）、liepin.com（猎聘）';
}

function setLoading(isLoading) {
  document.body.classList.toggle('loading', isLoading);
  btn.disabled = isLoading;
  if (openBossChatBtn) openBossChatBtn.disabled = isLoading;
  btnText.textContent = isLoading ? '正在同步，请稍候...' : '同步当前聊天记录';
}

async function refreshCurrentSiteHint() {
  const tab = await getActiveTab();
  const tabUrl = tab?.url || '';
  const site = detectSupportedSite(tabUrl);
  if (openBossChatBtn) openBossChatBtn.classList.add('hidden');
  btn.disabled = false;

  if (site?.key === 'boss' && !isBossChatPage(tabUrl)) {
    currentSiteBox.textContent = '当前不是 BOSS直聘消息页面。需要跳转到“消息”页面才能提取。';
    currentSiteBox.className = 'site warn';
    if (openBossChatBtn) openBossChatBtn.classList.remove('hidden');
    btn.disabled = true;
    return;
  }

  if (site) {
    currentSiteBox.textContent = `当前网站：${site.source}，可以提取。`;
    currentSiteBox.className = 'site ok';
  } else {
    currentSiteBox.textContent = `当前网站：暂不支持。目前支持 ${supportedSiteNames()}。`;
    currentSiteBox.className = 'site warn';
  }
}

if (openBossChatBtn) {
  openBossChatBtn.addEventListener('click', async () => {
    await chrome.tabs.create({ url: BOSS_CHAT_URL, active: true });
    window.close();
  });
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
    if (isBossSite(tab.url || '') && !isBossChatPage(tab.url || '')) {
      throw new Error('当前不是 BOSS直聘消息页面。请点击“打开 BOSS直聘消息页面”后再提取。');
    }

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
