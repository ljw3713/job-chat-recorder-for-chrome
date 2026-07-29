(function () {
  const adapters = new Map();

  function register(siteKey, adapter) {
    if (siteKey && adapter) adapters.set(siteKey, adapter);
  }

  function get(siteKey) {
    return adapters.get(siteKey) || null;
  }

  globalThis.JobChatSiteAdapters = { register, get };
})();
