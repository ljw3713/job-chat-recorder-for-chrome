(function () {
  const { normalizeText, formatDateTime, getCookieValue, sleep } = globalThis.JobChatUtils;
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
      record?.recordKey,
      record?.liepin?.latestMsgId
    ].forEach((key) => addLiepinKeyVariants(keys, key));
  }

  function indexLiepinRecords(records) {
    const byKey = new Map();
    (records || []).forEach((record) => {
      const keys = new Set();
      addLiepinRecordKeys(keys, record);
      keys.forEach((key) => {
        if (!byKey.has(key)) byKey.set(key, record);
      });
    });
    return byKey;
  }

  function findLiepinRecordForItem(recordsByKey, item) {
    for (const key of liepinItemKeys(item)) {
      const record = recordsByKey.get(key);
      if (record) return record;
    }
    return null;
  }

  function liepinLatestMsgId(record) {
    return normalizeText(record?.liepin?.latestMsgId || record?.latestMsgId || '');
  }

  function liepinMessageStatusFromItem(item) {
    return normalizeText(item?.oppositeRead) === '1' ? '1' : '0';
  }

  function liepinMessageStatusFromRecord(record) {
    return normalizeText(record?.messageStatus || record?.liepin?.oppositeRead || '');
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

  function liepinSyncMessage(synced, total, insertedCount, updatedMsgCount) {
    return `正在同步猎聘沟通记录... 已处理 ${synced} / ${total} 条，新增 ${insertedCount} 条，更新消息 ${updatedMsgCount} 条`;
  }

  function liepinSyncSummary(insertedCount, updatedMsgCount) {
    return {
      inserted: insertedCount,
      updated: updatedMsgCount,
      updatedMsg: updatedMsgCount
    };
  }

  async function saveLiepinPartial(records, synced, total, interrupted, completed, insertedCount = 0, updatedMsgCount = 0) {
    return savePartial('liepin', '猎聘沟通记录', '猎聘', records, synced, total, interrupted, completed, {
      syncSummary: liepinSyncSummary(insertedCount, updatedMsgCount)
    });
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

  async function buildLiepinRecord(item, imId, index, existingRecord) {
    const key = liepinContactKey(item);
    const payloadInfo = parseLiepinLastPayload(item.lastPayload);
    let preview = {};
    try { preview = await fetchLiepinJobPreview(item.imId || imId, item.oppositeImId); } catch (_) { preview = {}; }

    const jobTitle = preview.jobTitle || payloadInfo.jobTitle || '';
    const jobSalary = preview.jobSalary || payloadInfo.jobSalary || '';
    const companyName = preview.jobCompany || item.company || payloadInfo.jobCompany || '';
    const lastMessage = payloadInfo.message || normalizeText(item.lastPayload || '');

    return {
      ...(existingRecord || {}),
      index,
      time: formatDateTime(new Date(Number(item.latestMsgTime))),
      updatedAt: new Date().toISOString(),
      recruiterName: normalizeText(item.name),
      companyName: normalizeText(companyName),
      recruiterTitle: normalizeText(item.title),
      jobName: liepinJobText(jobTitle, jobSalary),
      lastMessage,
      messageStatus: liepinMessageStatusFromItem(item),
      liepin: {
        ...(existingRecord?.liepin || {}),
        imId: item.imId || imId,
        oppositeImId: item.oppositeImId || existingRecord?.liepin?.oppositeImId || '',
        latestMsgId: item.latestMsgId || '',
        latestMsgTime: item.latestMsgTime || '',
        oppositeRead: normalizeText(item.oppositeRead || ''),
        contactKey: key,
        homePage: item.homePage || existingRecord?.liepin?.homePage || ''
      }
    };
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

    const savedByKey = indexLiepinRecords(savedRecords);
    const pendingByKey = indexLiepinRecords(pendingRecords);
    const ignoredKeys = new Set();
    ignoredRecords.forEach((record) => addLiepinRecordKeys(ignoredKeys, record));
    const contactsToSync = contacts.filter((item) => {
      const keys = liepinItemKeys(item);
      if (keys.some((key) => ignoredKeys.has(key))) return false;
      const existingRecord = findLiepinRecordForItem(pendingByKey, item) || findLiepinRecordForItem(savedByKey, item);
      if (!existingRecord) return true;
      const latestMsgId = normalizeText(item?.latestMsgId || '');
      const latestMsgChanged = Boolean(latestMsgId && liepinLatestMsgId(existingRecord) !== latestMsgId);
      const statusChanged = liepinMessageStatusFromRecord(existingRecord) !== liepinMessageStatusFromItem(item);
      return latestMsgChanged || statusChanged;
    });
    return { contacts, contactsToSync, pendingRecords, savedByKey, pendingByKey };
  }

  async function extractLiepinChatRecords() {
    const imId = getLiepinImId();
    if (!imId) throw new Error('没有在当前猎聘页面 Cookie / 缓存中找到 imId_0。请确认已登录猎聘，并刷新页面后重试。');

    const { contactsToSync, pendingRecords, savedByKey, pendingByKey } = await getFilteredContacts(imId);
    const records = [...pendingRecords];
    const totalToSync = contactsToSync.length;
    let syncedCount = 0;
    let insertedCount = 0;
    let updatedMsgCount = 0;

    reportProgress('liepin', '猎聘沟通记录', '猎聘', syncedCount, totalToSync, {
      inserted: insertedCount,
      updated: updatedMsgCount,
      updatedMsg: updatedMsgCount,
      message: liepinSyncMessage(syncedCount, totalToSync, insertedCount, updatedMsgCount)
    });
    await saveLiepinPartial(records, syncedCount, totalToSync, false, syncedCount >= totalToSync, insertedCount, updatedMsgCount);

    for (let i = 0; i < contactsToSync.length; i += 1) {
      const item = contactsToSync[i];

      if (await isCancelRequested()) {
        await saveLiepinPartial(records, syncedCount, totalToSync, true, false, insertedCount, updatedMsgCount);
        return {
          pageTitle: document.title || '',
          pageUrl: location.href,
          extractedAt: new Date().toISOString(),
          total: records.length,
          synced: syncedCount,
          interrupted: true,
          sourceTotal: totalToSync,
          syncSummary: liepinSyncSummary(insertedCount, updatedMsgCount),
          records
        };
      }

      if (records.length > 0) await sleep(await getSyncDelayMs());

      const existingRecord = findLiepinRecordForItem(pendingByKey, item) || findLiepinRecordForItem(savedByKey, item);
      const isUpdate = Boolean(existingRecord);
      const existingIndex = records.findIndex((record) => liepinItemKeys(item).some((itemKey) => {
        const recordKeys = new Set();
        addLiepinRecordKeys(recordKeys, record);
        return recordKeys.has(itemKey);
      }));
      const nextRecord = await buildLiepinRecord(item, imId, existingIndex >= 0 ? existingIndex + 1 : records.length + 1, existingRecord);
      if (existingIndex >= 0) {
        records[existingIndex] = nextRecord;
      } else {
        records.push(nextRecord);
      }
      syncedCount += 1;
      if (isUpdate) updatedMsgCount += 1;
      else insertedCount += 1;
      reportProgress('liepin', '猎聘沟通记录', '猎聘', syncedCount, totalToSync, {
        inserted: insertedCount,
        updated: updatedMsgCount,
        updatedMsg: updatedMsgCount,
        message: liepinSyncMessage(syncedCount, totalToSync, insertedCount, updatedMsgCount)
      });
      await saveLiepinPartial(records, syncedCount, totalToSync, false, syncedCount >= totalToSync, insertedCount, updatedMsgCount);
    }

    return {
      pageTitle: document.title || '',
      pageUrl: location.href,
      extractedAt: new Date().toISOString(),
      total: records.length,
      synced: syncedCount,
      interrupted: false,
      sourceTotal: totalToSync,
      syncSummary: liepinSyncSummary(insertedCount, updatedMsgCount),
      records
    };
  }

  async function prepareLiepinSync() {
    const imId = getLiepinImId();
    if (!imId) throw new Error('没有在当前猎聘页面 Cookie / 缓存中找到 imId_0。请确认已登录猎聘，并刷新页面后重试。');
    const { contacts, contactsToSync, savedByKey, pendingByKey } = await getFilteredContacts(imId);
    const insertedCount = contactsToSync.filter((item) => !findLiepinRecordForItem(pendingByKey, item) && !findLiepinRecordForItem(savedByKey, item)).length;
    const updatedMsgCount = contactsToSync.length - insertedCount;
    return {
      list: contacts,
      needSync: contactsToSync.length,
      syncSummary: liepinSyncSummary(insertedCount, updatedMsgCount)
    };
  }

  globalThis.JobChatLiepinExtractor = {
    extract: extractLiepinChatRecords,
    prepare: prepareLiepinSync
  };
})();
