const btn = document.getElementById('extractBtn');
const errorBox = document.getElementById('error');
const currentSiteBox = document.getElementById('currentSite');

const SUPPORTED_SITES = [
  {
    key: 'boss',
    hostPattern: /(^|\.)zhipin\.com$/i,
    title: 'BOSS直聘沟通记录',
    source: 'BOSS直聘',
    messageType: 'JOB_CHAT_EXTRACT_RECORDS'
  }
];

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function getHostname(tabUrl) {
  try {
    return new URL(tabUrl).hostname;
  } catch (_) {
    return '';
  }
}

function detectSupportedSite(tabUrl) {
  const hostname = getHostname(tabUrl);
  return SUPPORTED_SITES.find((site) => site.hostPattern.test(hostname)) || null;
}

function sendExtractMessage(tabId, site) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: site.messageType, siteKey: site.key }, (response) => {
      resolve(response);
    });
  });
}

function unsupportedMessage(tabUrl) {
  const hostname = getHostname(tabUrl) || tabUrl || '当前页面';
  return `暂不支持当前网站：${hostname}\n目前只支持 zhipin.com（BOSS直聘）。`;
}

async function refreshCurrentSiteHint() {
  const tab = await getActiveTab();
  const site = detectSupportedSite(tab?.url || '');
  if (site) {
    currentSiteBox.textContent = `当前网站：${site.source}，可以提取。`;
    currentSiteBox.className = 'site ok';
  } else {
    currentSiteBox.textContent = '当前网站：暂不支持。目前只支持 zhipin.com（BOSS直聘）。';
    currentSiteBox.className = 'site warn';
  }
}

btn.addEventListener('click', async () => {
  btn.disabled = true;
  errorBox.textContent = '';
  try {
    const tab = await getActiveTab();
    if (!tab?.id) throw new Error('没有找到当前活动标签页。');

    const site = detectSupportedSite(tab.url || '');
    if (!site) throw new Error(unsupportedMessage(tab.url || ''));

    let response = await sendExtractMessage(tab.id, site);

    if (!response?.ok) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      response = await sendExtractMessage(tab.id, site);
    }

    if (!response?.ok) {
      throw new Error(response?.error || `无法读取页面。请确认当前页是 ${site.source} 沟通列表页。`);
    }

    const data = {
      ...response.data,
      siteKey: site.key,
      siteTitle: site.title,
      sourceName: site.source
    };

    await chrome.storage.local.set({ bossChatStatsLatest: data });
    await chrome.tabs.create({ url: chrome.runtime.getURL('results.html') });
    window.close();
  } catch (error) {
    errorBox.textContent = error?.message || String(error);
  } finally {
    btn.disabled = false;
  }
});

refreshCurrentSiteHint();
