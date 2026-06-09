(function () {
  const { normalizeText, formatDateTime, extractJobName, htmlDecode, getCookieValue, sleep } = globalThis.JobChatUtils;
  const {
    filterBossRecentList,
    getSyncDelayMs,
    reportProgress,
    isCancelRequested,
    savePartial,
    readIgnoredRecords,
    appendRequestLog
  } = globalThis.JobChatContentCommon;

  function parseBossFriendItem(item, index) {
    const time = normalizeText(item.querySelector('.time')?.textContent);
    const recruiterName = normalizeText(item.querySelector('.name-text')?.textContent);
    const nameBox = item.querySelector('.name-box');
    const spans = Array.from(nameBox?.querySelectorAll(':scope > span') || []);
    const companyName = normalizeText(spans[1]?.textContent);
    const recruiterTitle = normalizeText(spans[2]?.textContent);
    const lastMessage = normalizeText(item.querySelector('.last-msg-text')?.textContent);
    const jobName = extractJobName(lastMessage);
    return { index: index + 1, time, recruiterName, companyName, recruiterTitle, jobName, lastMessage };
  }

  function extractBossDomChatRecords() {
    const nodes = Array.from(document.querySelectorAll('li[role="listitem"] .friend-content-warp'));
    const records = nodes
      .map(parseBossFriendItem)
      .filter((record) => record.time || record.recruiterName || record.companyName || record.lastMessage);
    return {
      pageTitle: document.title || '',
      pageUrl: location.href,
      extractedAt: new Date().toISOString(),
      total: records.length,
      sourceTotal: records.length,
      records
    };
  }

  function bossHeaders(contentType) {
    const headers = {
      'accept': 'application/json, text/plain, */*',
      'x-requested-with': 'XMLHttpRequest, XMLHttpRequest',
      'traceid': `F-${Date.now().toString(16)}${Math.random().toString(36).slice(2, 10)}`
    };
    const token = getCookieValue('bst') || getCookieValue('zp_token');
    if (token) headers.zp_token = token;
    if (contentType) headers['content-type'] = contentType;
    return headers;
  }

  function bossIdOfItem(item) {
    return item?.encryptBossId || item?.encryptUid || '';
  }

  function bossRecordKeyParts(bossId, jobId) {
    const normalizedBossId = normalizeText(bossId).toLowerCase();
    const normalizedJobId = normalizeText(jobId).toLowerCase();
    if (normalizedBossId && normalizedJobId) return `${normalizedBossId}|${normalizedJobId}`;
    return '';
  }

  function bossItemRecordKey(item) {
    return bossRecordKeyParts(bossIdOfItem(item), item?.jobId);
  }

  function bossRecordRecordKey(record) {
    return bossRecordKeyParts(record?.boss?.encryptBossId || record?.boss?.bossId, record?.boss?.jobId);
  }

  function bossFriendKey(item) {
    return bossItemRecordKey(item) || bossIdOfItem(item) || item?.securityId || item?.uid || item?.jobId || item?.lastMessageInfo?.msgId || item?.encryptFriendId || item?.friendId || '';
  }

  function addBossKeyVariants(keys, value) {
    const key = normalizeText(value).toLowerCase();
    if (!key) return;
    keys.add(key);
    if (key.startsWith('boss|')) {
      const raw = key.slice(5);
      if (raw) keys.add(raw);
    } else {
      keys.add(`boss|${key}`);
    }
  }

  function addBossRecordKeys(keys, record) {
    const primaryKey = bossRecordRecordKey(record);
    const securityId = record?.boss?.securityId;
    const friendId = record?.boss?.encryptFriendId || record?.boss?.friendId;
    [primaryKey, securityId, friendId].forEach((key) => addBossKeyVariants(keys, key));
    if (!primaryKey && !securityId && !friendId) addBossKeyVariants(keys, record?.recordKey);
    if (primaryKey || securityId || friendId) return;
    [
      record?.boss?.contactKey,
      record?.boss?.encryptBossId,
      record?.boss?.bossId,
      record?.boss?.lastMsgId,
      record?.boss?.lastMessageInfo?.msgId
    ].forEach((key) => addBossKeyVariants(keys, key));
  }

  function addBossRecordToMap(map, record) {
    const keys = new Set();
    addBossRecordKeys(keys, record);
    keys.forEach((key) => {
      if (!map.has(key)) map.set(key, record);
    });
  }

  function bossItemKeys(item) {
    const keys = new Set();
    const primaryKey = bossItemRecordKey(item);
    const securityId = item?.securityId;
    const friendId = item?.encryptFriendId || item?.friendId;
    [primaryKey, securityId, friendId].forEach((key) => addBossKeyVariants(keys, key));
    if (primaryKey || securityId || friendId) return [...keys];
    [
      item?.encryptBossId,
      item?.encryptUid,
      item?.uid,
      item?.jobId,
      item?.lastMessageInfo?.msgId
    ].forEach((key) => addBossKeyVariants(keys, key));
    return [...keys];
  }

  function bossLastMsgIdFromRecord(record) {
    return normalizeText(record?.boss?.lastMsgId || record?.boss?.lastMessageInfo?.msgId);
  }

  function bossLastMsgIdFromItem(item) {
    return normalizeText(item?.lastMessageInfo?.msgId);
  }

  function bossMessageStatusFromItem(item) {
    return normalizeText(item?.lastMessageInfo?.status) === '1' ? '0' : '1';
  }

  function bossMessageStatusFromRecord(record) {
    return normalizeText(record?.messageStatus || record?.boss?.messageStatus || '');
  }

  function findBossRecordByItem(map, item) {
    return bossItemKeys(item).map((key) => map.get(key)).find(Boolean) || null;
  }

  function bossRecordMatchesItem(record, item) {
    const recordKeys = new Set();
    addBossRecordKeys(recordKeys, record);
    return bossItemKeys(item).some((key) => recordKeys.has(key));
  }

  function shouldSyncBossItem(item, savedMap, pendingMap) {
    const existing = findBossRecordByItem(pendingMap, item) || findBossRecordByItem(savedMap, item);
    if (!existing) return true;
    const oldMsgId = bossLastMsgIdFromRecord(existing);
    const newMsgId = bossLastMsgIdFromItem(item);
    const msgChanged = Boolean(newMsgId && oldMsgId !== newMsgId);
    const statusChanged = bossMessageStatusFromRecord(existing) !== bossMessageStatusFromItem(item);
    return msgChanged || statusChanged;
  }

  function bossSyncMessage(synced, total, insertedCount, updatedMsgCount) {
    return `正在同步BOSS直聘沟通记录... 已处理 ${synced} / ${total} 条，新增 ${insertedCount} 条，更新消息 ${updatedMsgCount} 条`;
  }

  function bossSyncSummary(insertedCount, updatedMsgCount) {
    return {
      inserted: insertedCount,
      updated: updatedMsgCount,
      updatedMsg: updatedMsgCount
    };
  }

  async function saveBossPartial(records, synced, total, interrupted, completed, insertedCount = 0, updatedMsgCount = 0) {
    return savePartial('boss', 'BOSS直聘沟通记录', 'BOSS直聘', records, synced, total, interrupted, completed, {
      syncSummary: bossSyncSummary(insertedCount, updatedMsgCount)
    });
  }

  function parseBossFriendListResult(data) {
    const candidates = [data?.zpData?.friendList, data?.zpData?.result, data?.result];
    return candidates.find((item) => Array.isArray(item) && item.length) || candidates.find(Array.isArray) || [];
  }

  async function readCapturedBossFriendRequest() {
    try {
      const store = await chrome.storage.local.get(['jobChatBossFriendListCapture']);
      const capture = store.jobChatBossFriendListCapture || {};
      if (!String(capture.url || '').includes('/wapi/zprelation/friend/getGeekFriendList.json')) return {};
      return {
        method: normalizeText(capture.method || 'POST').toUpperCase() || 'POST',
        body: normalizeText(capture.body || '')
      };
    } catch (_) {
      return {};
    }
  }

  async function fetchBossLabelFriendList() {
    const url = new URL('https://www.zhipin.com/wapi/zprelation/friend/geekFilterByLabel');
    url.searchParams.set('labelId', '0');
    await appendRequestLog({ siteKey: 'boss', step: 'geekFilterByLabel:start', method: 'GET', url: url.toString() });
    const response = await fetch(url.toString(), {
      method: 'GET',
      credentials: 'include',
      headers: bossHeaders()
    });
    await appendRequestLog({ siteKey: 'boss', step: 'geekFilterByLabel:http', status: response.status });
    if (!response.ok) throw new Error(`BOSS直聘列表接口请求失败：HTTP ${response.status}`);
    const data = await response.json();
    const list = parseBossFriendListResult(data);
    await appendRequestLog({ siteKey: 'boss', step: 'geekFilterByLabel:result', code: data?.code, message: data?.message || '', listCount: Array.isArray(list) ? list.length : 0, sampleKeys: Array.isArray(list) && list[0] ? Object.keys(list[0]).slice(0, 12) : [] });
    if (data?.code !== 0) throw new Error(`BOSS直聘列表接口返回异常：${JSON.stringify(data).slice(0, 300)}`);
    return list;
  }

  function bossFriendIdsFromLabelList(list) {
    if (!Array.isArray(list)) return [];
    const ids = [];
    const seen = new Set();
    list.forEach((item) => {
      const id = normalizeText(item?.friendId || item?.id || item?.relationId || item?.friend?.friendId);
      if (!id || seen.has(id)) return;
      seen.add(id);
      ids.push(id);
    });
    return ids;
  }

  function chunkList(list, size) {
    const chunks = [];
    for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size));
    return chunks;
  }

  function mergeBossFriendDetailList(labelList, detailList) {
    if (!Array.isArray(detailList)) return [];
    const labelByFriendId = new Map();
    const labelByOrder = Array.isArray(labelList) ? labelList : [];
    labelByOrder.forEach((item) => {
      const id = normalizeText(item?.friendId);
      if (id) labelByFriendId.set(id, item);
    });

    return detailList.map((item, index) => {
      const id = normalizeText(item?.friendId);
      const labelItem = (id && labelByFriendId.get(id)) || labelByOrder[index] || {};
      return {
        ...labelItem,
        ...item,
        friendId: item?.friendId || labelItem?.friendId || '',
        friendSource: item?.friendSource ?? labelItem?.friendSource ?? '',
        encryptFriendId: item?.encryptFriendId || labelItem?.encryptFriendId || '',
        updateTime: item?.updateTime || labelItem?.updateTime || item?.lastMessageInfo?.msgTime || item?.lastTS || ''
      };
    });
  }

  async function fetchBossFriendDetailListWithRequest(request) {
    const method = normalizeText(request?.method || 'POST').toUpperCase() || 'POST';
    const body = normalizeText(request?.body || '');
    await appendRequestLog({ siteKey: 'boss', step: 'getGeekFriendList:start', method, batchIndex: request?.batchIndex, batchTotal: request?.batchTotal, friendIdCount: request?.friendIdCount, bodyLength: body.length, bodyPreview: body.slice(0, 180) });
    const init = {
      method,
      credentials: 'include',
      headers: bossHeaders(method === 'POST' ? 'application/x-www-form-urlencoded' : '')
    };
    if (method !== 'GET' && body) init.body = body;
    const response = await fetch('https://www.zhipin.com/wapi/zprelation/friend/getGeekFriendList.json', init);
    await appendRequestLog({ siteKey: 'boss', step: 'getGeekFriendList:http', method, batchIndex: request?.batchIndex, batchTotal: request?.batchTotal, friendIdCount: request?.friendIdCount, status: response.status });
    if (!response.ok) throw new Error(`BOSS直聘岗位列表接口请求失败：HTTP ${response.status}`);
    const data = await response.json();
    const list = parseBossFriendListResult(data);
    await appendRequestLog({ siteKey: 'boss', step: 'getGeekFriendList:result', method, batchIndex: request?.batchIndex, batchTotal: request?.batchTotal, friendIdCount: request?.friendIdCount, code: data?.code, message: data?.message || '', listCount: Array.isArray(list) ? list.length : 0, sample: Array.isArray(list) && list[0] ? { name: list[0].name || '', jobId: list[0].jobId || '', friendId: list[0].friendId || '', securityId: list[0].securityId || '', msgId: list[0].lastMessageInfo?.msgId || '' } : null });
    if (data?.code !== 0) throw new Error(`BOSS直聘岗位列表接口返回异常：${JSON.stringify(data).slice(0, 300)}`);
    return list;
  }

  async function fetchBossFriendDetailList(friendIds) {
    const chunks = chunkList(friendIds, 150);
    const detailList = [];
    let batchError = null;
    await appendRequestLog({ siteKey: 'boss', step: 'getGeekFriendList:batchPlan', totalFriendIds: friendIds.length, batchSize: 150, batchTotal: chunks.length });
    try {
      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i];
        const body = new URLSearchParams({ friendIds: chunk.join(',') }).toString();
        const list = await fetchBossFriendDetailListWithRequest({
          method: 'POST',
          body,
          batchIndex: i + 1,
          batchTotal: chunks.length,
          friendIdCount: chunk.length
        });
        detailList.push(...list);
      }
      return detailList;
    } catch (error) {
      batchError = error;
      await appendRequestLog({ siteKey: 'boss', step: 'getGeekFriendList:batchError', error: error?.message || String(error) });
    }

    const capturedRequest = await readCapturedBossFriendRequest();
    const requests = [
      capturedRequest.body || capturedRequest.method ? { ...capturedRequest, batchIndex: 'fallback-captured' } : null,
      { method: 'GET', body: '', batchIndex: 'fallback-get' },
      { method: 'POST', body: '', batchIndex: 'fallback-empty-post' }
    ].filter(Boolean);
    const seen = new Set();
    let lastError = batchError;

    for (const request of requests) {
      const key = `${normalizeText(request.method || 'POST').toUpperCase()}|${normalizeText(request.body || '')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const list = await fetchBossFriendDetailListWithRequest(request);
        if (Array.isArray(list)) return list;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error('BOSS直聘岗位列表接口请求失败。');
  }

  async function fetchBossFriendList() {
    const labelList = await fetchBossLabelFriendList();
    const friendIds = bossFriendIdsFromLabelList(labelList);
    await appendRequestLog({ siteKey: 'boss', step: 'friendIds:parsed', labelCount: Array.isArray(labelList) ? labelList.length : 0, friendIdCount: friendIds.length, firstFriendIds: friendIds.slice(0, 10) });
    if (!friendIds.length) return [];
    let detailList = [];
    try {
      detailList = await fetchBossFriendDetailList(friendIds);
    } catch (error) {
      throw error;
    }
    const mergedList = mergeBossFriendDetailList(labelList, detailList);
    const recentList = filterBossRecentList(mergedList);
    await appendRequestLog({ siteKey: 'boss', step: 'bossList:filtered', detailCount: Array.isArray(detailList) ? detailList.length : 0, mergedCount: mergedList.length, recentCount: recentList.length });
    return recentList;
  }

  async function fetchBossData(item) {
    const bossId = item.encryptBossId || item.encryptUid || '';
    const securityId = item.securityId || '';
    if (!bossId || !securityId) return null;
    const url = new URL('https://www.zhipin.com/wapi/zpchat/geek/getBossData');
    url.searchParams.set('bossId', bossId);
    url.searchParams.set('bossSource', String(item.sourceType ?? 0));
    url.searchParams.set('securityId', securityId);
    const response = await fetch(url.toString(), {
      method: 'GET',
      credentials: 'include',
      headers: bossHeaders()
    });
    if (!response.ok) throw new Error(`BOSS直聘岗位详情接口请求失败：HTTP ${response.status}`);
    const data = await response.json();
    if (data?.code !== 0) throw new Error(`BOSS直聘岗位详情接口返回异常：${JSON.stringify(data).slice(0, 300)}`);
    return data?.zpData || {};
  }

  function bossJobText(jobName, salaryDesc) {
    const title = htmlDecode(jobName);
    const salary = normalizeText(salaryDesc);
    if (title && salary) return `${title}（${salary}）`;
    return title || '';
  }

  function bossListItemToRecord(item, detail, index, existingRecord) {
    const data = detail?.data || {};
    const job = detail?.job || {};
    const lastMessage = htmlDecode(item.lastMessageInfo?.showText || item.lastMsg || '');
    const fallbackJobName = htmlDecode(extractJobName(lastMessage));
    const jobName = bossJobText(job.jobName || item.jobName || fallbackJobName, job.salaryDesc || '') || existingRecord?.jobName || '';
    const companyName = htmlDecode(data.companyName || job.brandName || item.brandName || '') || existingRecord?.companyName || '';
    const ts = Number(item.lastMessageInfo?.msgTime || item.updateTime || item.lastTS || Date.now());
    return {
      ...(existingRecord || {}),
      index: index + 1,
      time: formatDateTime(new Date(ts)),
      updatedAt: new Date().toISOString(),
      recruiterName: htmlDecode(data.name || item.name || '') || existingRecord?.recruiterName || '',
      companyName,
      recruiterTitle: htmlDecode(data.title || item.title || item.bossTitle || '') || existingRecord?.recruiterTitle || '',
      jobName,
      lastMessage,
      messageStatus: bossMessageStatusFromItem(item),
      boss: {
        ...(existingRecord?.boss || {}),
        friendId: item.friendId || existingRecord?.boss?.friendId || '',
        friendSource: item.friendSource ?? existingRecord?.boss?.friendSource ?? '',
        encryptFriendId: item.encryptFriendId || existingRecord?.boss?.encryptFriendId || '',
        bossId: data.bossId || item.uid || existingRecord?.boss?.bossId || '',
        encryptBossId: data.encryptBossId || item.encryptBossId || item.encryptUid || existingRecord?.boss?.encryptBossId || '',
        securityId: data.securityId || item.securityId || existingRecord?.boss?.securityId || '',
        jobId: item.jobId || existingRecord?.boss?.jobId || '',
        encryptJobId: data.encryptJobId || item.encryptJobId || existingRecord?.boss?.encryptJobId || '',
        lastMsgId: item.lastMessageInfo?.msgId || '',
        lastMessageInfo: {
          ...(existingRecord?.boss?.lastMessageInfo || {}),
          ...(item.lastMessageInfo || {})
        },
        messageStatus: bossMessageStatusFromItem(item),
        lastMsgTime: ts,
        contactKey: bossFriendKey(item)
      }
    };
  }

  async function extractBossChatRecords() {
    const list = await fetchBossFriendList();
    if (!Array.isArray(list) || !list.length) {
      const domData = extractBossDomChatRecords();
      if (domData.records.length) {
        throw new Error('没有获取到 BOSS直聘最近 3 个月的聊天列表。请刷新 BOSS 页面后再点击同步。');
      }
      throw new Error('没有获取到 BOSS直聘聊天列表。请确认已登录并打开 BOSS直聘页面，然后刷新页面重试。');
    }

    const store = await chrome.storage.local.get(['jobChatPendingRecords', 'jobChatRecords']);
    const pending = store.jobChatPendingRecords;
    const pendingRecords = pending?.siteKey === 'boss' && Array.isArray(pending.records) ? pending.records : [];
    const savedRecords = Array.isArray(store.jobChatRecords) ? store.jobChatRecords.filter((record) => record?.siteKey === 'boss' || record?.sourceName === 'BOSS直聘') : [];
    const ignoredRecords = (await readIgnoredRecords()).filter((record) => record?.siteKey === 'boss' || record?.sourceName === 'BOSS直聘');

    const savedMap = new Map();
    savedRecords.forEach((record) => addBossRecordToMap(savedMap, record));
    const pendingMap = new Map();
    pendingRecords.forEach((record) => addBossRecordToMap(pendingMap, record));
    const ignoredMap = new Map();
    ignoredRecords.forEach((record) => addBossRecordToMap(ignoredMap, record));

    const records = [...pendingRecords];
    const itemsToSync = list.filter((item) => !findBossRecordByItem(ignoredMap, item) && shouldSyncBossItem(item, savedMap, pendingMap));
    const totalToSync = itemsToSync.length;
    let syncedCount = 0;
    let insertedCount = 0;
    let updatedMsgCount = 0;

    reportProgress('boss', 'BOSS直聘沟通记录', 'BOSS直聘', syncedCount, totalToSync, {
      inserted: insertedCount,
      updated: updatedMsgCount,
      updatedMsg: updatedMsgCount,
      message: bossSyncMessage(syncedCount, totalToSync, insertedCount, updatedMsgCount)
    });
    await saveBossPartial(records, syncedCount, totalToSync, false, syncedCount >= totalToSync, insertedCount, updatedMsgCount);

    for (let i = 0; i < itemsToSync.length; i += 1) {
      const item = itemsToSync[i];
      if (await isCancelRequested()) {
        await saveBossPartial(records, syncedCount, totalToSync, true, false, insertedCount, updatedMsgCount);
        return {
          pageTitle: document.title || '',
          pageUrl: location.href,
          extractedAt: new Date().toISOString(),
          total: records.length,
          synced: syncedCount,
          interrupted: true,
          sourceTotal: totalToSync,
          syncSummary: bossSyncSummary(insertedCount, updatedMsgCount),
          records
        };
      }

      if (records.length > 0) await sleep(await getSyncDelayMs());
      const existingRecord = findBossRecordByItem(pendingMap, item) || findBossRecordByItem(savedMap, item);
      const isUpdate = Boolean(existingRecord);
      const existingIndex = records.findIndex((record) => bossRecordMatchesItem(record, item));
      let detail = null;
      try { detail = await fetchBossData(item); } catch (_) { detail = null; }
      const nextRecord = bossListItemToRecord(item, detail, existingIndex >= 0 ? existingIndex : records.length, existingRecord);
      if (existingIndex >= 0) {
        records[existingIndex] = nextRecord;
      } else {
        records.push(nextRecord);
      }
      syncedCount += 1;
      if (isUpdate) updatedMsgCount += 1;
      else insertedCount += 1;
      reportProgress('boss', 'BOSS直聘沟通记录', 'BOSS直聘', syncedCount, totalToSync, {
        inserted: insertedCount,
        updated: updatedMsgCount,
        updatedMsg: updatedMsgCount,
        message: bossSyncMessage(syncedCount, totalToSync, insertedCount, updatedMsgCount)
      });
      await saveBossPartial(records, syncedCount, totalToSync, false, syncedCount >= totalToSync, insertedCount, updatedMsgCount);
    }

    return {
      pageTitle: document.title || '',
      pageUrl: location.href,
      extractedAt: new Date().toISOString(),
      total: records.length,
      synced: syncedCount,
      interrupted: false,
      sourceTotal: totalToSync,
      syncSummary: bossSyncSummary(insertedCount, updatedMsgCount),
      records
    };
  }

  async function prepareBossSync() {
    const list = await fetchBossFriendList();
    if (!Array.isArray(list) || !list.length) throw new Error('没有捕获到 BOSS直聘最近 3 个月的聊天记录。请刷新 BOSS 页面后再点击同步。');
    const store = await chrome.storage.local.get(['jobChatPendingRecords', 'jobChatRecords']);
    const pending = store.jobChatPendingRecords;
    const pendingRecords = pending?.siteKey === 'boss' && Array.isArray(pending.records) ? pending.records : [];
    const savedRecords = Array.isArray(store.jobChatRecords) ? store.jobChatRecords.filter((record) => record?.siteKey === 'boss' || record?.sourceName === 'BOSS直聘') : [];
    const ignored = (await readIgnoredRecords()).filter((record) => record?.siteKey === 'boss' || record?.sourceName === 'BOSS直聘');
    const savedMap = new Map();
    savedRecords.forEach((record) => addBossRecordToMap(savedMap, record));
    const pendingMap = new Map();
    pendingRecords.forEach((record) => addBossRecordToMap(pendingMap, record));
    const ignoredMap = new Map();
    ignored.forEach((record) => addBossRecordToMap(ignoredMap, record));
    const itemsToSync = list.filter((item) => !findBossRecordByItem(ignoredMap, item) && shouldSyncBossItem(item, savedMap, pendingMap));
    await appendRequestLog({ siteKey: 'boss', step: 'prepare:summary', listCount: list.length, savedCount: savedRecords.length, pendingCount: pendingRecords.length, ignoredCount: ignored.length, needSync: itemsToSync.length, insertedCount: itemsToSync.filter((item) => !findBossRecordByItem(pendingMap, item) && !findBossRecordByItem(savedMap, item)).length });
    const insertedCount = itemsToSync.filter((item) => !findBossRecordByItem(pendingMap, item) && !findBossRecordByItem(savedMap, item)).length;
    const updatedMsgCount = itemsToSync.length - insertedCount;
    return {
      list,
      needSync: itemsToSync.length,
      syncSummary: bossSyncSummary(insertedCount, updatedMsgCount)
    };
  }

  globalThis.JobChatBossExtractor = {
    extract: extractBossChatRecords,
    prepare: prepareBossSync
  };
})();
