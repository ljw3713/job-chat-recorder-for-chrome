(function () {
  if (globalThis.JobChatOnlineJobFilter) return;

  const adapters = new Map();
  const offlineIdentifiers = new Set();
  let activeAdapter = null;
  let enabled = false;
  let observer = null;
  let renderQueued = false;
  let hasMore = false;
  let requestInFlight = false;
  let autoRequestPending = false;
  let autoLoadAttempts = 0;
  let fillCheckTimer = null;
  let requestTimer = null;
  let fallbackScrollTimer = null;
  const MAX_AUTO_LOAD_ATTEMPTS = 10;
  const FILL_CHECK_DELAY_MS = 160;
  const REQUEST_START_TIMEOUT_MS = 1200;
  const REQUEST_FINISH_TIMEOUT_MS = 15000;

  function registerAdapter(adapter) {
    if (adapter?.siteKey && typeof adapter.matchesLocation === 'function' && typeof adapter.filterCards === 'function') {
      adapters.set(adapter.siteKey, adapter);
      if (adapter.matchesLocation(location)) activeAdapter = adapter;
    }
  }

  function adapterForCurrentPage() {
    return [...adapters.values()].find((adapter) => adapter.matchesLocation(location)) || null;
  }

  function filterCurrentCards() {
    renderQueued = false;
    if (!enabled || !activeAdapter || !offlineIdentifiers.size) return;
    activeAdapter.filterCards(document, offlineIdentifiers);
    scheduleFillCheck();
  }

  function queueFilter() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(filterCurrentCards);
  }

  function startObserver() {
    if (!document.documentElement) {
      document.addEventListener('DOMContentLoaded', startObserver, { once: true });
      return;
    }
    observer ||= new MutationObserver(queueFilter);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function clearTimer(timerName) {
    if (timerName === 'fill') {
      clearTimeout(fillCheckTimer);
      fillCheckTimer = null;
    } else if (timerName === 'request') {
      clearTimeout(requestTimer);
      requestTimer = null;
    } else if (timerName === 'fallback') {
      clearTimeout(fallbackScrollTimer);
      fallbackScrollTimer = null;
    }
  }

  function scheduleFillCheck(delay = FILL_CHECK_DELAY_MS) {
    clearTimer('fill');
    fillCheckTimer = setTimeout(checkAndRequestMore, delay);
  }

  function listNeedsMoreJobs() {
    const list = document.querySelector('.job-list-container');
    if (!list) return false;
    const rect = list.getBoundingClientRect();
    const scrollingElement = document.scrollingElement || document.documentElement;
    const pageBottomDistance = scrollingElement.scrollHeight - scrollingElement.scrollTop - window.innerHeight;
    return rect.bottom <= window.innerHeight + 160 || pageBottomDistance <= 160;
  }

  function dispatchScrollSignal() {
    window.dispatchEvent(new Event('scroll'));
    fallbackScrollTimer = setTimeout(() => {
      if (!enabled || !autoRequestPending || !hasMore) return;
      document.dispatchEvent(new Event('scroll'));
    }, 250);
  }

  function checkAndRequestMore() {
    fillCheckTimer = null;
    if (!enabled || !hasMore || requestInFlight || autoLoadAttempts >= MAX_AUTO_LOAD_ATTEMPTS) return;
    if (!listNeedsMoreJobs()) {
      autoLoadAttempts = 0;
      return;
    }
    autoLoadAttempts += 1;
    autoRequestPending = true;
    requestInFlight = true;
    dispatchScrollSignal();
    requestTimer = setTimeout(() => {
      requestTimer = null;
      if (!autoRequestPending) return;
      autoRequestPending = false;
      requestInFlight = false;
      scheduleFillCheck(500);
    }, REQUEST_START_TIMEOUT_MS);
  }

  function markRequestStarted() {
    const wasAutoRequest = autoRequestPending;
    autoRequestPending = false;
    requestInFlight = true;
    clearTimer('request');
    clearTimer('fallback');
    if (!wasAutoRequest) autoLoadAttempts = 0;
    requestTimer = setTimeout(() => {
      requestTimer = null;
      requestInFlight = false;
      scheduleFillCheck(500);
    }, REQUEST_FINISH_TIMEOUT_MS);
  }

  function acceptJobBatch(payload) {
    requestInFlight = false;
    autoRequestPending = false;
    clearTimer('request');
    clearTimer('fallback');
    hasMore = payload.hasMore === true;
    if (!hasMore) autoLoadAttempts = 0;
    if (Array.isArray(payload.encryptJobIds)) {
      payload.encryptJobIds.forEach((identifier) => {
        const normalized = String(identifier || '').trim();
        if (normalized) offlineIdentifiers.add(normalized);
      });
    }
    queueFilter();
    scheduleFillCheck();
  }

  function notifyBossHook() {
    if (activeAdapter?.siteKey !== 'boss') return;
    window.postMessage({
      source: 'job-chat-recorder-boss-content',
      command: { type: 'BOSS_ONLINE_ONLY_SET', enabled }
    }, '*');
  }

  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled && activeAdapter);
    if (enabled) startObserver();
    else {
      observer?.disconnect();
      offlineIdentifiers.clear();
      hasMore = false;
      requestInFlight = false;
      autoRequestPending = false;
      autoLoadAttempts = 0;
      clearTimer('fill');
      clearTimer('request');
      clearTimer('fallback');
    }
    notifyBossHook();
  }

  registerAdapter({
    siteKey: 'boss',
    matchesLocation(currentLocation) {
      return /(^|\.)zhipin\.com$/i.test(currentLocation.hostname);
    },
    filterCards(root, identifiers) {
      let removed = 0;
      root.querySelectorAll('.job-card-box').forEach((card) => {
        const hrefElements = card.matches('[href]')
          ? [card, ...card.querySelectorAll('[href]')]
          : [...card.querySelectorAll('[href]')];
        const matched = hrefElements.some((element) => {
          const rawHref = element.getAttribute('href') || '';
          let href = rawHref;
          try { href = decodeURIComponent(rawHref); } catch (_) {}
          for (const identifier of identifiers) {
            if (rawHref.includes(identifier) || href.includes(identifier)) return true;
          }
          return false;
        });
        if (matched) {
          card.remove();
          removed += 1;
        }
      });
      return removed;
    }
  });

  activeAdapter ||= adapterForCurrentPage();

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== 'job-chat-recorder-boss-hook') return;
    const payload = event.data.payload || {};
    if (payload.type === 'BOSS_HOOK_READY') {
      notifyBossHook();
      return;
    }
    if (!enabled || activeAdapter?.siteKey !== 'boss') return;
    if (payload.type === 'BOSS_ONLINE_ONLY_JOB_REQUEST_STARTED') {
      markRequestStarted();
      return;
    }
    if (payload.type === 'BOSS_ONLINE_ONLY_JOB_BATCH') acceptJobBatch(payload);
  });

  async function initialize() {
    if (!activeAdapter) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'JOB_CHAT_ONLINE_ONLY_GET' });
      setEnabled(Boolean(response?.ok && response.enabled));
    } catch (_) {
      setEnabled(false);
    }
  }

  globalThis.JobChatOnlineJobFilter = {
    registerAdapter,
    isEnabled: () => enabled
  };

  initialize();
})();
