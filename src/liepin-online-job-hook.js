(function () {
  const hookVersion = '2026-08-03-online-only-v1';
  if (window.__JOB_CHAT_LIEPIN_ONLINE_JOB_HOOK_VERSION__ === hookVersion) {
    try {
      window.postMessage({
        source: 'job-chat-recorder-liepin-online-hook',
        payload: { type: 'LIEPIN_ONLINE_ONLY_HOOK_READY' }
      }, '*');
    } catch (_) {}
    return;
  }
  window.__JOB_CHAT_LIEPIN_ONLINE_JOB_HOOK_VERSION__ = hookVersion;

  let stateKnown = false;
  let enabled = false;
  const pendingOfflineLinks = new Set();
  let pendingBatch = null;

  function emit(payload) {
    try {
      window.postMessage({ source: 'job-chat-recorder-liepin-online-hook', payload }, '*');
    } catch (_) {}
  }

  function requestUrl(input) {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    return input?.url || '';
  }

  function isTarget(method, url) {
    if (String(method || 'GET').toUpperCase() !== 'POST') return false;
    try {
      const parsed = new URL(String(url || ''), location.href);
      return /(^|\.)liepin\.com$/i.test(parsed.hostname)
        && parsed.pathname === '/api/com.liepin.csearch.home-recommend-job-new';
    } catch (_) {
      return false;
    }
  }

  function batchFromResponse(payload) {
    if (payload?.flag !== 1 || !Array.isArray(payload?.data?.data)) return null;
    const records = payload.data.data;
    return {
      identifiers: records
        .filter((item) => item?.recruiter?.imStatus === false)
        .map((item) => String(item?.job?.link || '').trim())
        .filter(Boolean),
      hasMore: payload.data.hasNextPage === true,
      jobCount: records.length
    };
  }

  function emitBatch(batch) {
    if (!batch) return;
    emit({
      type: 'LIEPIN_ONLINE_ONLY_JOB_BATCH',
      identifiers: [...new Set(batch.identifiers || [])].slice(0, 2000),
      hasMore: batch.hasMore === true,
      jobCount: Math.max(0, Number(batch.jobCount || 0))
    });
  }

  function captureResponse(payload) {
    const batch = batchFromResponse(payload);
    if (!batch) return;
    if (!stateKnown) {
      batch.identifiers.forEach((identifier) => pendingOfflineLinks.add(identifier));
      pendingBatch = {
        identifiers: [...pendingOfflineLinks],
        hasMore: batch.hasMore,
        jobCount: batch.jobCount
      };
      return;
    }
    if (enabled) emitBatch(batch);
  }

  function setEnabled(nextEnabled) {
    stateKnown = true;
    enabled = Boolean(nextEnabled);
    if (enabled) emitBatch(pendingBatch);
    pendingOfflineLinks.clear();
    pendingBatch = null;
  }

  function shouldInspect(method, url) {
    return isTarget(method, url) && (!stateKnown || enabled);
  }

  function inspectResponse(response, method, url) {
    if (!shouldInspect(method, url)) return;
    try {
      response.clone().json().then(captureResponse).catch(() => {});
    } catch (_) {}
  }

  function reportRequestStarted(method, url) {
    if (!enabled || !isTarget(method, url)) return;
    emit({ type: 'LIEPIN_ONLINE_ONLY_JOB_REQUEST_STARTED' });
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = async function (...args) {
      const input = args[0];
      const init = args[1] || {};
      const url = requestUrl(input);
      const method = String(init.method || input?.method || 'GET').toUpperCase();
      reportRequestStarted(method, url);
      const response = await originalFetch.apply(this, args);
      inspectResponse(response, method, url);
      return response;
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__jobChatLiepinOnlineRequest = {
      method: String(method || 'GET').toUpperCase(),
      url: String(url || '')
    };
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const request = this.__jobChatLiepinOnlineRequest || {};
    reportRequestStarted(request.method, request.url);
    if (shouldInspect(request.method, request.url)) {
      this.addEventListener('load', function () {
        try {
          const payload = this.responseType === 'json'
            ? this.response
            : JSON.parse(this.responseText || '{}');
          captureResponse(payload);
        } catch (_) {}
      }, { once: true });
    }
    return originalSend.apply(this, args);
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== 'job-chat-recorder-liepin-online-content') return;
    const command = event.data.command || {};
    if (command.type === 'LIEPIN_ONLINE_ONLY_SET') setEnabled(command.enabled);
  });

  emit({ type: 'LIEPIN_ONLINE_ONLY_HOOK_READY' });
})();
