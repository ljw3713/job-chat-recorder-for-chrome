(function () {
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

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getHostname(url) {
    try { return new URL(url).hostname; } catch (_) { return ''; }
  }

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

  function htmlDecode(text) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = String(text || '');
    return normalizeText(textarea.value || text || '');
  }

  function getCookieValue(name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : '';
  }

  globalThis.JobChatUtils = {
    normalizeText,
    formatDate,
    addDays,
    sleep,
    getHostname,
    extractJobName,
    htmlDecode,
    getCookieValue
  };
})();
