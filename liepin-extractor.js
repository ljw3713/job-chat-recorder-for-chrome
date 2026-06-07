(function () {
  const { normalizeText, formatDate, getCookieValue, sleep } = globalThis.JobChatUtils;
  const {
    filterLiepinRecentContacts,
    getSyncDelayMs,
    reportProgress,
    isCancelRequested,
    savePartial,
    readIgnoredRecords
  } = globalThis.JobChatContentCommon;

  async function readExistingLiepinPending() {
    try {
      const store = await chrome.storage.local.get(['jobChatPendingRecords', 'jobChatRecords']);
      const pending = store.jobChatPendingRecords;
      const pendingRecords = pending?.siteKey === 'liepin' && Array.isArray(pending.records) ? pending.records : [];
      const savedRecords = Array.isArray(store.jobChatRecords) ? store.jobChatRecords.filter((record) => record?.siteKey === 'liepin' || record?.sourceName === '猎聘') : [];
      return [...savedRecords, ...pendingRecords];
    } catch (_) {
      return [];
    }
  }

  function liepinContactKey(item) {
    return item?.oppositeImId || item?.id || item?.oppositeUserId || item?.latestMsgId || '';
  }

  function addLiepinKeyVariants(keys, value) {
    const key = normalizeText(value).toLowerCase();
    if (!key) return;
    keys.add(key);
    if (key.startsWith('liepin|')) {
      const raw = key.slice(7);
      if (raw) keys.add(raw);
    } else {
      keys.add(`liepin|${key}`);
    }
  }

  function addLiepinRecordKeys(keys, record) {
    [
      record?.liepin?.oppositeImId,
      record?.liepin?.contactKey,
      record?.recordKey
    ].forEach((key) => addLiepinKeyVariants(keys, key));
  }

  function liepinItemKeys(item) {
    const keys = new Set();
    [
      item?.oppositeImId,
      liepinContactKey(item),
      item?.id,
      item?.oppositeUserId,
      item?.latestMsgId
    ].forEach((key) => addLiepinKeyVariants(keys, key));
    return [...keys];
  }

  async function saveLiepinPartial(records, synced, total, interrupted, completed) {
    return savePartial('liepin', '猎聘沟通记录', '猎聘', records, synced, total, interrupted, completed);
  }

  function getLiepinImId() {
    const fromCookie = getCookieValue('imId_0');
    if (fromCookie) return fromCookie;

    const stores = [window.localStorage, window.sessionStorage];
    for (const store of stores) {
      try {
        for (let i = 0; i < store.length; i += 1) {
          const key = store.key(i);
          const value = store.getItem(key) || '';
          const text = `${key} ${value}`;
          const match = text.match(/imId_0["'\s:=]+([a-f0-9]{32})/i) || text.match(/\b[a-f0-9]{32}\b/i);
          if (match?.[1] || match?.[0]) return match[1] || match[0];
        }
      } catch (_) {}
    }
    return '';
  }

  function makeTraceId() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function liepinHeaders() {
    return {
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Client-Type': 'web',
      'X-Requested-With': 'XMLHttpRequest',
      'X-Fscp-Bi-Stat': JSON.stringify({ location: location.href }),
      'X-Fscp-Fe-Version': '1.0.0',
      'X-Fscp-Std-Info': JSON.stringify({ client_id: '11156' }),
      'X-Fscp-Trace-Id': makeTraceId(),
      'X-Fscp-Version': '1.1'
    };
  }

  async function postLiepinApi(path, params) {
    const response = await fetch(`https://api-c.liepin.com/api/${path}`, {
      method: 'POST',
      credentials: 'include',
      mode: 'cors',
      headers: liepinHeaders(),
      body: new URLSearchParams(params).toString()
    });
    if (!response.ok) throw new Error(`猎聘接口请求失败：HTTP ${response.status}`);
    const data = await response.json();
    if (data?.flag !== 1) throw new Error(`猎聘接口返回异常：${JSON.stringify(data).slice(0, 300)}`);
    return data.data || {};
  }

  function parseLiepinLastPayload(lastPayload) {
    if (!lastPayload) return { message: '', jobTitle: '', jobSalary: '', jobCompany: '' };
    try {
      const payload = typeof lastPayload === 'string' ? JSON.parse(lastPayload) : lastPayload;
      const bodyMsg = normalizeText((payload.bodies || []).map((body) => body?.msg).filter(Boolean).join(' '));
      const bizData = payload?.ext?.extBody?.bizData || {};
      return {
        message: bodyMsg,
        jobTitle: normalizeText(bizData.jobTitle || ''),
        jobSalary: normalizeText(bizData.jobSalary || ''),
        jobCompany: normalizeText(bizData.jobCompany || '')
      };
    } catch (_) {
      return { message: normalizeText(String(lastPayload)), jobTitle: '', jobSalary: '', jobCompany: '' };
    }
  }

  function liepinJobText(jobTitle, jobSalary) {
    const title = normalizeText(jobTitle);
    const salary = normalizeText(jobSalary);
    if (title && salary) return `${title}（${salary}）`;
    return title || '';
  }

  async function fetchLiepinContacts(imId) {
    const data = await postLiepinApi('com.liepin.im.c.contact.get-contact-list', {
      imUserType: '0',
      imId,
      imApp: '1',
      pageSize: '100',
      curPage: '0'
    });
    return filterLiepinRecentContacts(Array.isArray(data.list) ? data.list : []);
  }

  async function fetchLiepinJobPreview(imId, oppositeImId) {
    if (!oppositeImId) return {};
    return postLiepinApi('com.liepin.im.c.chat.job-preview', {
      imUserType: '0',
      imId,
      imApp: '1',
      oppositeImId
    });
  }

  async function getFilteredContacts(imId) {
    const contacts = filterLiepinRecentContacts(await fetchLiepinContacts(imId));
    const store = await chrome.storage.local.get(['jobChatPendingRecords', 'jobChatRecords']);
    const pending = store.jobChatPendingRecords;
    const pendingRecords = pending?.siteKey === 'liepin' && Array.isArray(pending.records) ? pending.records : [];
    const savedRecords = Array.isArray(store.jobChatRecords) ? store.jobChatRecords.filter((record) => record?.siteKey === 'liepin' || record?.sourceName === '猎聘') : [];
    const ignoredRecords = (await readIgnoredRecords()).filter((record) => record?.siteKey === 'liepin' || record?.sourceName === '猎聘');

    const savedKeys = new Set();
    savedRecords.forEach((record) => addLiepinRecordKeys(savedKeys, record));
    const pendingKeys = new Set();
    pendingRecords.forEach((record) => addLiepinRecordKeys(pendingKeys, record));
    const ignoredKeys = new Set();
    ignoredRecords.forEach((record) => addLiepinRecordKeys(ignoredKeys, record));
    const contactsToSync = contacts.filter((item) => {
      const keys = liepinItemKeys(item);
      return !keys.some((key) => savedKeys.has(key) || pendingKeys.has(key) || ignoredKeys.has(key));
    });
    return { contacts, contactsToSync, pendingRecords };
  }

  async function extractLiepinChatRecords() {
    const imId = getLiepinImId();
    if (!imId) throw new Error('没有在当前猎聘页面 Cookie / 缓存中找到 imId_0。请确认已登录猎聘，并刷新页面后重试。');

    const { contactsToSync, pendingRecords } = await getFilteredContacts(imId);
    const records = [...pendingRecords];
    const totalToSync = records.length + contactsToSync.length;

    reportProgress('liepin', '猎聘沟通记录', '猎聘', records.length, totalToSync);
    await saveLiepinPartial(records, records.length, totalToSync, false, records.length >= totalToSync);

    for (let i = 0; i < contactsToSync.length; i += 1) {
      const item = contactsToSync[i];
      const key = liepinContactKey(item);

      if (await isCancelRequested()) {
        await saveLiepinPartial(records, records.length, totalToSync, true, false);
        return {
          pageTitle: document.title || '',
          pageUrl: location.href,
          extractedAt: new Date().toISOString(),
          total: records.length,
          interrupted: true,
          sourceTotal: totalToSync,
          records
        };
      }

      if (records.length > 0) await sleep(await getSyncDelayMs());

      const payloadInfo = parseLiepinLastPayload(item.lastPayload);
      let preview = {};
      try { preview = await fetchLiepinJobPreview(item.imId || imId, item.oppositeImId); } catch (_) { preview = {}; }

      const jobTitle = preview.jobTitle || payloadInfo.jobTitle || '';
      const jobSalary = preview.jobSalary || payloadInfo.jobSalary || '';
      const companyName = preview.jobCompany || item.company || payloadInfo.jobCompany || '';
      const lastMessage = payloadInfo.message || normalizeText(item.lastPayload || '');

      records.push({
        index: records.length + 1,
        time: formatDate(new Date(Number(item.latestMsgTime))),
        recruiterName: normalizeText(item.name),
        companyName: normalizeText(companyName),
        recruiterTitle: normalizeText(item.title),
        jobName: liepinJobText(jobTitle, jobSalary),
        lastMessage,
        liepin: {
          imId: item.imId || imId,
          oppositeImId: item.oppositeImId || '',
          latestMsgId: item.latestMsgId || '',
          latestMsgTime: item.latestMsgTime || '',
          contactKey: key,
          homePage: item.homePage || ''
        }
      });
      reportProgress('liepin', '猎聘沟通记录', '猎聘', records.length, totalToSync);
      await saveLiepinPartial(records, records.length, totalToSync, false, records.length >= totalToSync);
    }

    return {
      pageTitle: document.title || '',
      pageUrl: location.href,
      extractedAt: new Date().toISOString(),
      total: records.length,
      interrupted: false,
      sourceTotal: totalToSync,
      records
    };
  }

  async function prepareLiepinSync() {
    const imId = getLiepinImId();
    if (!imId) throw new Error('没有在当前猎聘页面 Cookie / 缓存中找到 imId_0。请确认已登录猎聘，并刷新页面后重试。');
    const { contacts, contactsToSync } = await getFilteredContacts(imId);
    return { list: contacts, needSync: contactsToSync.length };
  }

  globalThis.JobChatLiepinExtractor = {
    extract: extractLiepinChatRecords,
    prepare: prepareLiepinSync
  };
})();
