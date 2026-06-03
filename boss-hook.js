(function () {
  if (window.__JOB_CHAT_BOSS_HOOK_INSTALLED__) return;
  window.__JOB_CHAT_BOSS_HOOK_INSTALLED__ = true;

  function emit(payload) {
    try {
      window.postMessage({ source: 'job-chat-recorder-boss-hook', payload }, '*');
    } catch (_) {}
  }

  function isTarget(url) {
    return typeof url === 'string' && (
      url.includes('/wapi/zprelation/friend/geekFilterByLabel') ||
      url.includes('/wapi/zprelation/friend/getGeekFriendList.json')
    );
  }

  function isTargetMethod(method, url) {
    if (typeof url !== 'string') return false;
    if (url.includes('/wapi/zprelation/friend/geekFilterByLabel')) return method === 'GET';
    if (url.includes('/wapi/zprelation/friend/getGeekFriendList.json')) return method === 'POST';
    return false;
  }

  function safeText(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    try { return String(value); } catch (_) { return ''; }
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = async function (...args) {
      const input = args[0];
      const init = args[1] || {};
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = (init.method || (input && input.method) || 'GET').toUpperCase();
      const body = init.body || '';
      const response = await originalFetch.apply(this, args);
      if (isTargetMethod(method, url)) {
        try {
          const cloned = response.clone();
          const data = await cloned.json();
          emit({ type: 'BOSS_GEEK_FRIEND_LIST', url, method, body: safeText(body), data, capturedAt: new Date().toISOString() });
        } catch (error) {
          emit({ type: 'BOSS_GEEK_FRIEND_LIST_ERROR', url, method, body: safeText(body), error: String(error), capturedAt: new Date().toISOString() });
        }
      }
      return response;
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__jobChatRecorder = { method: String(method || 'GET').toUpperCase(), url: String(url || '') };
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const info = this.__jobChatRecorder || {};
    if (isTargetMethod(info.method, info.url)) {
      this.addEventListener('load', function () {
        try {
          const data = JSON.parse(this.responseText || '{}');
          emit({ type: 'BOSS_GEEK_FRIEND_LIST', url: info.url, method: info.method, body: safeText(body), data, capturedAt: new Date().toISOString() });
        } catch (error) {
          emit({ type: 'BOSS_GEEK_FRIEND_LIST_ERROR', url: info.url, method: info.method, body: safeText(body), error: String(error), capturedAt: new Date().toISOString() });
        }
      });
    }
    return originalSend.call(this, body);
  };
})();
