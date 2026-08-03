(function () {
  if (globalThis.JobChatOnlineJobFilter) return;

  const adapters = new Map();
  const offlineIdentifiers = new Set();
  let activeAdapter = null;
  let enabled = false;
  let companyFilterEnabled = false;
  let companyKeywords = [];
  let settingsKnown = false;
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
  const LIEPIN_FILTERED_CARD_CLASS = 'job-chat-filtered-card-hidden';
  const FILTER_STYLE_ID = 'job-chat-online-only-filter-style';

  function ensureFilterStyle() {
    if (document.getElementById(FILTER_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = FILTER_STYLE_ID;
    style.textContent = `.${LIEPIN_FILTERED_CARD_CLASS} { display: none !important; }`;
    (document.head || document.documentElement)?.appendChild(style);
  }

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
    if (!hasActiveFilter()) return;
    activeAdapter.filterCards(document, offlineIdentifiers, {
      onlineOnlyEnabled: enabled,
      companyFilterEnabled,
      companyKeywords
    });
    scheduleFillCheck();
  }

  function normalizeCompanyKeywords(value) {
    return [...new Set(String(value || '')
      .split('|')
      .map((keyword) => keyword.trim().toLocaleLowerCase())
      .filter(Boolean))];
  }

  function hasActiveFilter() {
    return Boolean(activeAdapter && (enabled || (companyFilterEnabled && companyKeywords.length)));
  }

  function textIncludesKeyword(card, selector, keywords) {
    if (!keywords.length) return false;
    const text = String(card.querySelector(selector)?.textContent || '').trim().toLocaleLowerCase();
    return Boolean(text && keywords.some((keyword) => text.includes(keyword)));
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
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href'],
      characterData: true
    });
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
    const scrollingElement = document.scrollingElement || document.documentElement;
    const pageBottomDistance = scrollingElement.scrollHeight - scrollingElement.scrollTop - window.innerHeight;
    if (typeof activeAdapter?.needsMoreJobs === 'function') {
      return activeAdapter.needsMoreJobs(document, window, pageBottomDistance);
    }
    return pageBottomDistance <= 160;
  }

  function dispatchScrollSignal() {
    window.dispatchEvent(new Event('scroll'));
    fallbackScrollTimer = setTimeout(() => {
      if (!hasActiveFilter() || !autoRequestPending || !hasMore) return;
      document.dispatchEvent(new Event('scroll'));
    }, 250);
  }

  function checkAndRequestMore() {
    fillCheckTimer = null;
    if (!hasActiveFilter() || !hasMore || requestInFlight || autoLoadAttempts >= MAX_AUTO_LOAD_ATTEMPTS) return;
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
    const identifiers = typeof activeAdapter?.identifiersFromPayload === 'function'
      ? activeAdapter.identifiersFromPayload(payload)
      : [];
    if (enabled && Array.isArray(identifiers)) {
      identifiers.forEach((identifier) => {
        const normalized = typeof activeAdapter?.normalizeIdentifier === 'function'
          ? activeAdapter.normalizeIdentifier(identifier)
          : String(identifier || '').trim();
        if (normalized) offlineIdentifiers.add(normalized);
      });
    }
    queueFilter();
    scheduleFillCheck();
  }

  function notifyPageHook() {
    if (!settingsKnown || !activeAdapter?.commandSource || !activeAdapter?.setCommandType) return;
    window.postMessage({
      source: activeAdapter.commandSource,
      command: { type: activeAdapter.setCommandType, enabled: hasActiveFilter() }
    }, '*');
  }

  function applySettings(onlineOnly, companyFilter, keywords) {
    enabled = Boolean(onlineOnly && activeAdapter);
    companyFilterEnabled = Boolean(companyFilter && activeAdapter);
    companyKeywords = normalizeCompanyKeywords(keywords);
    settingsKnown = true;
    if (hasActiveFilter()) {
      ensureFilterStyle();
      startObserver();
      queueFilter();
    }
    else {
      observer?.disconnect();
      activeAdapter?.clearFilter?.(document);
      offlineIdentifiers.clear();
      hasMore = false;
      requestInFlight = false;
      autoRequestPending = false;
      autoLoadAttempts = 0;
      clearTimer('fill');
      clearTimer('request');
      clearTimer('fallback');
    }
    notifyPageHook();
  }

  registerAdapter({
    siteKey: 'boss',
    hookSource: 'job-chat-recorder-boss-hook',
    readyType: 'BOSS_HOOK_READY',
    requestStartedType: 'BOSS_ONLINE_ONLY_JOB_REQUEST_STARTED',
    batchType: 'BOSS_ONLINE_ONLY_JOB_BATCH',
    commandSource: 'job-chat-recorder-boss-content',
    setCommandType: 'BOSS_ONLINE_ONLY_SET',
    matchesLocation(currentLocation) {
      return /(^|\.)zhipin\.com$/i.test(currentLocation.hostname);
    },
    identifiersFromPayload(payload) {
      return payload.encryptJobIds;
    },
    needsMoreJobs(root, currentWindow, pageBottomDistance) {
      const list = root.querySelector('.job-list-container');
      if (!list) return false;
      return list.getBoundingClientRect().bottom <= currentWindow.innerHeight + 160
        || pageBottomDistance <= 160;
    },
    filterCards(root, identifiers, options) {
      let removed = 0;
      root.querySelectorAll('.job-card-box').forEach((card) => {
        const hrefElements = card.matches('[href]')
          ? [card, ...card.querySelectorAll('[href]')]
          : [...card.querySelectorAll('[href]')];
        const offlineMatched = options.onlineOnlyEnabled && hrefElements.some((element) => {
          const rawHref = element.getAttribute('href') || '';
          let href = rawHref;
          try { href = decodeURIComponent(rawHref); } catch (_) {}
          for (const identifier of identifiers) {
            if (rawHref.includes(identifier) || href.includes(identifier)) return true;
          }
          return false;
        });
        const companyMatched = options.companyFilterEnabled
          && textIncludesKeyword(card, '.boss-name', options.companyKeywords);
        if (offlineMatched || companyMatched) {
          card.remove();
          removed += 1;
        }
      });
      return removed;
    }
  });

  function normalizeLiepinJobLink(value) {
    try {
      const parsed = new URL(String(value || ''), location.origin);
      if (!/(^|\.)liepin\.com$/i.test(parsed.hostname)) return '';
      return parsed.pathname.replace(/\/+$/, '');
    } catch (_) {
      return '';
    }
  }

  registerAdapter({
    siteKey: 'liepin',
    hookSource: 'job-chat-recorder-liepin-online-hook',
    readyType: 'LIEPIN_ONLINE_ONLY_HOOK_READY',
    requestStartedType: 'LIEPIN_ONLINE_ONLY_JOB_REQUEST_STARTED',
    batchType: 'LIEPIN_ONLINE_ONLY_JOB_BATCH',
    commandSource: 'job-chat-recorder-liepin-online-content',
    setCommandType: 'LIEPIN_ONLINE_ONLY_SET',
    matchesLocation(currentLocation) {
      return /(^|\.)liepin\.com$/i.test(currentLocation.hostname);
    },
    identifiersFromPayload(payload) {
      return payload.identifiers;
    },
    normalizeIdentifier(identifier) {
      return normalizeLiepinJobLink(identifier);
    },
    needsMoreJobs(root, currentWindow, pageBottomDistance) {
      const cards = [...root.querySelectorAll(`.pull-up-li:not(.${LIEPIN_FILTERED_CARD_CLASS})`)];
      const lastCard = cards[cards.length - 1];
      const listMarker = lastCard || this.listRoot;
      return (listMarker && listMarker.getBoundingClientRect().bottom <= currentWindow.innerHeight + 160)
        || pageBottomDistance <= 160;
    },
    filterCards(root, identifiers, options) {
      let hidden = 0;
      const cards = [...root.querySelectorAll('.pull-up-li')];
      if (cards.length) this.listRoot = cards[0].parentElement;
      cards.forEach((card) => {
        const jobLink = card.querySelector('a[data-nick="job-detail-job-info"][href]');
        const normalized = normalizeLiepinJobLink(jobLink?.getAttribute('href') || '');
        const offlineMatched = options.onlineOnlyEnabled && Boolean(normalized && identifiers.has(normalized));
        const companyMatched = options.companyFilterEnabled
          && textIncludesKeyword(card, '[class*="company-name-"]', options.companyKeywords);
        const matched = offlineMatched || companyMatched;
        card.classList.toggle(LIEPIN_FILTERED_CARD_CLASS, matched);
        if (matched) hidden += 1;
      });
      return hidden;
    },
    clearFilter(root) {
      root.querySelectorAll(`.${LIEPIN_FILTERED_CARD_CLASS}`).forEach((card) => {
        card.classList.remove(LIEPIN_FILTERED_CARD_CLASS);
      });
    }
  });

  activeAdapter ||= adapterForCurrentPage();

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== activeAdapter?.hookSource) return;
    const payload = event.data.payload || {};
    if (payload.type === activeAdapter.readyType) {
      notifyPageHook();
      return;
    }
    if (!hasActiveFilter()) return;
    if (payload.type === activeAdapter.requestStartedType) {
      markRequestStarted();
      return;
    }
    if (payload.type === activeAdapter.batchType) acceptJobBatch(payload);
  });

  async function initialize() {
    if (!activeAdapter) return;
    try {
      const [onlineOnlyResponse, companyFilterResponse] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'JOB_CHAT_ONLINE_ONLY_GET' }),
        chrome.runtime.sendMessage({ type: 'JOB_CHAT_COMPANY_FILTER_GET' })
      ]);
      applySettings(
        Boolean(onlineOnlyResponse?.ok && onlineOnlyResponse.enabled),
        Boolean(companyFilterResponse?.ok && companyFilterResponse.enabled),
        companyFilterResponse?.ok ? companyFilterResponse.keywords : ''
      );
    } catch (_) {
      applySettings(false, false, '');
    }
  }

  globalThis.JobChatOnlineJobFilter = {
    registerAdapter,
    isEnabled: () => enabled,
    isCompanyFilterEnabled: () => companyFilterEnabled
  };

  initialize();
})();
