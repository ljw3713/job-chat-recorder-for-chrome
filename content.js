(() => {
  const normalizeText = (text) => (text || '').replace(/\s+/g, ' ').trim();

  function extractJobName(message) {
    const text = normalizeText(message);
    const patterns = [
      /我对\s*(.*?)\s*很感兴趣/,
      /我对\s*(.*?)\s*感兴趣/,
      /对\s*(.*?)\s*很感兴趣/
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) return normalizeText(match[1]);
    }
    return '';
  }

  function parseBossFriendItem(item, index) {
    const time = normalizeText(item.querySelector('.time')?.textContent);
    const recruiterName = normalizeText(item.querySelector('.name-text')?.textContent);

    const nameBox = item.querySelector('.name-box');
    const spans = Array.from(nameBox?.querySelectorAll(':scope > span') || []);
    const companyName = normalizeText(spans[1]?.textContent);
    const recruiterTitle = normalizeText(spans[2]?.textContent);

    const lastMessage = normalizeText(item.querySelector('.last-msg-text')?.textContent);
    const jobName = extractJobName(lastMessage);

    return {
      index: index + 1,
      time,
      recruiterName,
      companyName,
      recruiterTitle,
      jobName,
      lastMessage
    };
  }

  function extractBossChatRecords() {
    const nodes = Array.from(document.querySelectorAll('li[role="listitem"] .friend-content-warp'));
    const records = nodes
      .map(parseBossFriendItem)
      .filter((record) => record.time || record.recruiterName || record.companyName || record.lastMessage);

    const extractedAt = new Date().toISOString();
    const pageTitle = document.title || '';
    const pageUrl = location.href;

    return {
      pageTitle,
      pageUrl,
      extractedAt,
      total: records.length,
      records
    };
  }

  function detectSiteByLocation() {
    const hostname = location.hostname;
    if (/(^|\.)zhipin\.com$/i.test(hostname)) return 'boss';
    return 'unsupported';
  }

  function extractByCurrentSite(siteKey) {
    const detected = detectSiteByLocation();
    if (siteKey === 'boss' && detected === 'boss') return extractBossChatRecords();
    if (detected === 'boss') return extractBossChatRecords();
    throw new Error('暂不支持当前网站。目前只支持 zhipin.com（BOSS直聘）。');
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'JOB_CHAT_EXTRACT_RECORDS' && message?.type !== 'BOSS_EXTRACT_CHAT_RECORDS') return;
    try {
      sendResponse({ ok: true, data: extractByCurrentSite(message?.siteKey) });
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || String(error) });
    }
    return true;
  });
})();
