(function () {
  const INSTALLATION_ID_KEY = 'jobChatAnalyticsInstallationId';
  const ENABLED_KEY = 'jobChatAnalyticsEnabled';
  const LAST_ACTIVE_DATE_KEY = 'jobChatAnalyticsLastActiveDate';
  const SESSION_ID = Date.now();
  const MAX_RECORD_COUNT = 1000000;

  const EVENT_PARAMS = {
    extension_installed: new Set(['page_mode']),
    extension_active: new Set(['page_mode']),
    records_saved: new Set(['site', 'record_count', 'record_count_bucket', 'page_mode', 'result']),
    csv_downloaded: new Set(['site', 'record_count', 'record_count_bucket', 'record_scope', 'page_mode', 'result']),
    sync_completed: new Set(['site', 'record_count', 'record_count_bucket', 'inserted_count', 'updated_count', 'page_mode', 'result', 'error_code']),
    sync_failed: new Set(['site', 'page_mode', 'result', 'error_code'])
  };

  const ENUMS = {
    site: new Set(['zhipin', 'liepin', 'mixed', 'none']),
    page_mode: new Set(['sync', 'overview', 'popup', 'background']),
    result: new Set(['success', 'failed', 'cancelled', 'empty']),
    record_scope: new Set(['selected', 'all', 'none']),
    record_count_bucket: new Set(['0', '1-10', '11-50', '51-100', '101-500', '500+']),
    error_code: new Set([
      'none',
      'unsupported_site',
      'page_unavailable',
      'network_failed',
      'storage_failed',
      'risk_control',
      'cancelled',
      'sync_failed',
      'unknown'
    ])
  };

  let dailyActivePromise = null;
  let platformMetadataPromise = null;

  function runtimeConfig() {
    return globalThis.JobChatRuntimeConfig || {};
  }

  function measurementId() {
    const value = String(runtimeConfig().ga4MeasurementId || '').trim();
    return /^G-[A-Z0-9]+$/i.test(value) ? value : '';
  }

  function apiSecret() {
    return String(runtimeConfig().ga4ApiSecret || '').trim();
  }

  function configured() {
    return runtimeConfig().analyticsEnabled !== false && Boolean(measurementId() && apiSecret());
  }

  function extensionVersion() {
    const version = String(chrome.runtime.getManifest().version || 'unknown');
    return runtimeConfig().enableDebugLog ? `${version}-dev` : version;
  }

  function collectEndpoint() {
    const url = new URL('https://www.google-analytics.com/mp/collect');
    url.searchParams.set('measurement_id', measurementId());
    url.searchParams.set('api_secret', apiSecret());
    return url.toString();
  }

  function randomId() {
    return crypto.randomUUID();
  }

  function localDate(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function normalizeSite(value) {
    if (value === 'boss') return 'zhipin';
    return ENUMS.site.has(String(value || '')) ? String(value) : 'none';
  }

  function recordCount(value) {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) ? Math.max(0, Math.min(MAX_RECORD_COUNT, number)) : 0;
  }

  function recordCountBucket(value) {
    const count = recordCount(value);
    if (count === 0) return '0';
    if (count <= 10) return '1-10';
    if (count <= 50) return '11-50';
    if (count <= 100) return '51-100';
    if (count <= 500) return '101-500';
    return '500+';
  }

  function normalizeEnum(name, value) {
    const text = String(value || '');
    if (name === 'site') return normalizeSite(text);
    return ENUMS[name]?.has(text) ? text : (name === 'error_code' ? 'unknown' : '');
  }

  function normalizeEventParams(eventName, params) {
    const allowed = EVENT_PARAMS[eventName];
    if (!allowed) return null;
    const normalized = {};

    allowed.forEach((name) => {
      if (name.endsWith('_count')) {
        normalized[name] = recordCount(params?.[name]);
        return;
      }
      const value = normalizeEnum(name, params?.[name]);
      if (value) normalized[name] = value;
    });

    if (allowed.has('record_count')) {
      normalized.record_count_bucket = recordCountBucket(normalized.record_count);
    }
    return normalized;
  }

  function normalizeOsName(value) {
    const names = {
      mac: 'MacOS',
      win: 'Windows',
      linux: 'Linux',
      cros: 'Chrome OS',
      android: 'Android',
      openbsd: 'OpenBSD',
      fuchsia: 'Fuchsia'
    };
    return names[String(value || '').toLowerCase()] || 'Unknown';
  }

  function normalizeArchitecture(value) {
    const architecture = String(value || '').toLowerCase();
    if (architecture === 'arm64' || architecture === 'arm') return architecture;
    if (architecture === 'x86-64' || architecture === 'x86-32') return architecture;
    if (architecture === 'mips' || architecture === 'mips64') return architecture;
    return 'unknown';
  }

  function chromeVersionFromUserAgent() {
    const match = String(navigator.userAgent || '').match(/(?:Chrome|CriOS)\/([0-9.]+)/i);
    return match?.[1] || 'unknown';
  }

  async function getHighEntropyMetadata() {
    if (!navigator.userAgentData?.getHighEntropyValues) {
      return { osVersion: 'unknown', browserVersion: chromeVersionFromUserAgent() };
    }
    try {
      const data = await navigator.userAgentData.getHighEntropyValues(['platformVersion', 'fullVersionList']);
      const chromeBrand = (data.fullVersionList || []).find((item) => /Google Chrome/i.test(item.brand))
        || (data.fullVersionList || []).find((item) => /Chrom/i.test(item.brand));
      return {
        osVersion: String(data.platformVersion || 'unknown'),
        browserVersion: String(chromeBrand?.version || chromeVersionFromUserAgent())
      };
    } catch (_) {
      return { osVersion: 'unknown', browserVersion: chromeVersionFromUserAgent() };
    }
  }

  async function platformMetadata() {
    if (!platformMetadataPromise) {
      platformMetadataPromise = (async () => {
        const [platform, highEntropy] = await Promise.all([
          chrome.runtime.getPlatformInfo().catch(() => ({})),
          getHighEntropyMetadata()
        ]);
        return {
          architecture: normalizeArchitecture(platform.arch),
          device: {
            category: 'desktop',
            language: String(navigator.language || 'unknown').slice(0, 16),
            operating_system: normalizeOsName(platform.os),
            operating_system_version: highEntropy.osVersion,
            browser: 'Chrome',
            browser_version: highEntropy.browserVersion
          }
        };
      })();
    }
    return platformMetadataPromise;
  }

  async function getOrCreateIdentity() {
    const stored = await chrome.storage.local.get([INSTALLATION_ID_KEY]);
    const installationId = String(stored[INSTALLATION_ID_KEY] || '') || randomId();
    const updates = {};
    if (!stored[INSTALLATION_ID_KEY]) updates[INSTALLATION_ID_KEY] = installationId;
    if (Object.keys(updates).length) await chrome.storage.local.set(updates);
    return { installationId };
  }

  async function isUserEnabled() {
    const stored = await chrome.storage.local.get([ENABLED_KEY]);
    if (typeof stored[ENABLED_KEY] === 'boolean') return stored[ENABLED_KEY];
    return runtimeConfig().analyticsUserEnabledByDefault !== false;
  }

  async function setEnabled(enabled) {
    await chrome.storage.local.set({ [ENABLED_KEY]: Boolean(enabled) });
    await clearUninstallUrl();
    return { enabled: Boolean(enabled), configured: configured() };
  }

  async function clearUninstallUrl() {
    await chrome.runtime.setUninstallURL('');
    return true;
  }

  async function sendEvent(eventName, params = {}) {
    if (!configured() || !await isUserEnabled()) return false;
    const normalizedParams = normalizeEventParams(eventName, params);
    if (!normalizedParams) return false;

    const [{ installationId }, platform] = await Promise.all([
      getOrCreateIdentity(),
      platformMetadata()
    ]);
    const eventParams = {
      ...normalizedParams,
      extension_version: extensionVersion(),
      architecture: platform.architecture,
      session_id: SESSION_ID,
      engagement_time_msec: 1
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(collectEndpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          client_id: installationId,
          timestamp_micros: Date.now() * 1000,
          consent: {
            ad_user_data: 'DENIED',
            ad_personalization: 'DENIED'
          },
          device: platform.device,
          events: [{ name: eventName, params: eventParams }]
        })
      });
      return response.ok;
    } catch (_) {
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function trackDailyActive(pageMode) {
    if (dailyActivePromise) return dailyActivePromise;
    dailyActivePromise = (async () => {
      const today = localDate();
      const stored = await chrome.storage.local.get([LAST_ACTIVE_DATE_KEY]);
      if (stored[LAST_ACTIVE_DATE_KEY] === today) return false;
      const sent = await sendEvent('extension_active', { page_mode: pageMode });
      if (sent) await chrome.storage.local.set({ [LAST_ACTIVE_DATE_KEY]: today });
      return sent;
    })();
    try {
      return await dailyActivePromise;
    } finally {
      dailyActivePromise = null;
    }
  }

  async function handleInstalled(details) {
    await getOrCreateIdentity();
    await clearUninstallUrl();
    if (details?.reason === chrome.runtime.OnInstalledReason.INSTALL || details?.reason === 'install') {
      await sendEvent('extension_installed', { page_mode: 'background' });
    }
  }

  async function status() {
    return {
      enabled: await isUserEnabled(),
      configured: configured(),
      measurementIdConfigured: Boolean(measurementId()),
      apiSecretConfigured: Boolean(apiSecret())
    };
  }

  globalThis.JobChatAnalytics = {
    handleInstalled,
    isConfigured: configured,
    recordCountBucket,
    clearUninstallUrl,
    sendEvent,
    setEnabled,
    status,
    trackDailyActive
  };
})();
