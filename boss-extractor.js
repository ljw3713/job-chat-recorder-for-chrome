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
  let bossSendPreparationActive = false;

  function reportBossSendLog(message) {
    if (!bossSendPreparationActive) return;
    try { chrome.runtime.sendMessage({ type: 'BOSS_SEND_LOG', message: String(message || '') }); } catch (_) {}
  }

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
    return item?.encryptBossId || item?.encryptUid || item?.encryptFriendId || '';
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
    return bossRecordKeyParts(record?.boss?.peerKey || record?.boss?.encryptBossId || record?.boss?.bossId, record?.boss?.jobId);
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
    [primaryKey, securityId, friendId, record?.recordKey].forEach((key) => addBossKeyVariants(keys, key));
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
    [primaryKey, securityId, friendId, bossIdOfItem(item)].forEach((key) => addBossKeyVariants(keys, key));
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
    reportBossSendLog('发送预检 HTTP 请求：GET /wapi/zprelation/friend/geekFilterByLabel?labelId=0');
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
    reportBossSendLog(`发送预检 HTTP 响应：GET /wapi/zprelation/friend/geekFilterByLabel；HTTP ${response.status}；code=${data?.code}；联系人=${list.length} 条`);
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
    reportBossSendLog(`发送预检 HTTP 请求：${method} /wapi/zprelation/friend/getGeekFriendList.json；friendId=${request?.friendIdCount || 0} 个（值已隐藏）`);
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
    reportBossSendLog(`发送预检 HTTP 响应：${method} /wapi/zprelation/friend/getGeekFriendList.json；HTTP ${response.status}；code=${data?.code}；记录=${list.length} 条`);
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

  async function fetchBossFriendList(recentOnly = true) {
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
    return recentOnly ? recentList : mergedList;
  }

  async function fetchBossData(item) {
    const bossId = item.encryptBossId || item.encryptUid || item.encryptFriendId || '';
    const securityId = item.securityId || '';
    if (!bossId || !securityId) return null;
    const url = new URL('https://www.zhipin.com/wapi/zpchat/geek/getBossData');
    url.searchParams.set('bossId', bossId);
    url.searchParams.set('bossSource', String(item.friendSource ?? item.sourceType ?? 0));
    url.searchParams.set('securityId', securityId);
    reportBossSendLog('发送预检 HTTP 请求：GET /wapi/zpchat/geek/getBossData；bossId=[已隐藏]；securityId=[已隐藏]');
    const response = await fetch(url.toString(), {
      method: 'GET',
      credentials: 'include',
      headers: bossHeaders()
    });
    if (!response.ok) throw new Error(`BOSS直聘岗位详情接口请求失败：HTTP ${response.status}`);
    const data = await response.json();
    reportBossSendLog(`发送预检 HTTP 响应：GET /wapi/zpchat/geek/getBossData；HTTP ${response.status}；code=${data?.code}`);
    if (data?.code !== 0) throw new Error(`BOSS直聘岗位详情接口返回异常：${JSON.stringify(data).slice(0, 300)}`);
    return data?.zpData || {};
  }

  async function fetchBossOwnerUserId() {
    reportBossSendLog('发送预检 HTTP 请求：GET /wapi/zpuser/wap/getUserInfo.json');
    const response = await fetch('https://www.zhipin.com/wapi/zpuser/wap/getUserInfo.json', {
      credentials: 'include', headers: bossHeaders()
    });
    if (!response.ok) return '';
    const data = await response.json();
    reportBossSendLog(`发送预检 HTTP 响应：GET /wapi/zpuser/wap/getUserInfo.json；HTTP ${response.status}；code=${data?.code}`);
    return data?.code === 0 ? normalizeText(data?.zpData?.userId) : '';
  }

  function bossJobText(jobName, salaryDesc) {
    const title = htmlDecode(jobName);
    const salary = normalizeText(salaryDesc);
    if (title && salary) return `${title}（${salary}）`;
    return title || '';
  }

  function bossListItemToRecord(item, detail, index, existingRecord, ownerUserId = '') {
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
        ownerUserId: ownerUserId || existingRecord?.boss?.ownerUserId || '',
        friendId: data.bossId || item.uid || item.friendId || existingRecord?.boss?.friendId || '',
        friendSource: item.friendSource ?? existingRecord?.boss?.friendSource ?? '',
        encryptFriendId: item.encryptFriendId || existingRecord?.boss?.encryptFriendId || '',
        bossId: data.bossId || item.uid || existingRecord?.boss?.bossId || '',
        encryptBossId: data.encryptBossId || item.encryptBossId || item.encryptUid || existingRecord?.boss?.encryptBossId || '',
        peerKey: data.encryptBossId || item.encryptBossId || item.encryptUid || item.encryptFriendId || existingRecord?.boss?.peerKey || '',
        chatSecurityId: item.securityId || existingRecord?.boss?.chatSecurityId || existingRecord?.boss?.securityId || '',
        uploadSecurityId: data.securityId || existingRecord?.boss?.uploadSecurityId || '',
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
    const ownerUserId = await fetchBossOwnerUserId();
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
      const nextRecord = bossListItemToRecord(item, detail, existingIndex >= 0 ? existingIndex : records.length, existingRecord, ownerUserId);
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

  function validBossSendTarget(target) {
    const boss = target?.boss || {};
    return /^\d+$/.test(normalizeText(boss.friendId))
      && /^[A-Za-z0-9_~-]{28}$/.test(normalizeText(boss.peerKey || boss.encryptBossId));
  }

  function targetPeerKey(target) {
    const stored = normalizeText(target?.boss?.peerKey || target?.boss?.encryptBossId || target?.boss?.encryptFriendId);
    if (stored) return stored;
    const parts = normalizeText(target?.recordKey).split('|');
    return parts[0] === 'boss' ? normalizeText(parts[1]) : '';
  }

  async function prepareBossSendTargets(targets, ownerUserId = '') {
    bossSendPreparationActive = true;
    const sourceTargets = Array.isArray(targets) ? targets : [];
    const missingTargets = sourceTargets.filter((target) => !validBossSendTarget(target));
    reportBossSendLog(`发送目标检查：共 ${sourceTargets.length} 条，已有稳定标识 ${sourceTargets.length - missingTargets.length} 条，需要刷新 ${missingTargets.length} 条。`);
    try {
      if (!missingTargets.length) {
        reportBossSendLog('所有目标已有有效 friendId 和 peerKey，跳过联系人列表及 getBossData 请求。');
        return sourceTargets.map((target) => ({
          ...target,
          boss: { ...(target?.boss || {}), ownerUserId: ownerUserId || target?.boss?.ownerUserId || '' }
        }));
      }

      let labelList;
      try {
        labelList = await fetchBossLabelFriendList();
      } catch (error) {
        const errorMessage = error?.message || String(error);
        reportBossSendLog(`自动补全联系人标识失败：${errorMessage}`);
        return sourceTargets.map((target) => (
          validBossSendTarget(target)
            ? {
                ...target,
                boss: { ...(target?.boss || {}), ownerUserId: ownerUserId || target?.boss?.ownerUserId || '' }
              }
            : { ...target, prepareError: `自动补全联系人标识失败：${errorMessage}` }
        ));
      }
      const selectedLabels = [];
      missingTargets.forEach((target) => {
        const peerKey = targetPeerKey(target);
        const storedFriendId = normalizeText(target?.boss?.friendId);
        const label = labelList.find((item) => (
          (peerKey && normalizeText(bossIdOfItem(item)) === peerKey)
          || (storedFriendId && normalizeText(item?.friendId) === storedFriendId)
        ));
        if (!label) return;
        if (!selectedLabels.some((item) => normalizeText(item?.friendId) === normalizeText(label?.friendId))) selectedLabels.push(label);
      });
      const selectedFriendIds = bossFriendIdsFromLabelList(selectedLabels);
      reportBossSendLog(`仅刷新选中目标：匹配到 ${selectedLabels.length} 个联系人，请求 ${selectedFriendIds.length} 个 friendId（值已隐藏）。`);
      let detailList = [];
      if (selectedFriendIds.length) {
        try {
          detailList = await fetchBossFriendDetailList(selectedFriendIds);
        } catch (error) {
          reportBossSendLog(`联系人详情补全失败，继续使用联系人列表字段：${error?.message || String(error)}`);
        }
      }
      const list = mergeBossFriendDetailList(selectedLabels, detailList);

      return Promise.all(sourceTargets.map(async (target) => {
        if (validBossSendTarget(target)) {
          return {
            ...target,
            boss: { ...(target?.boss || {}), ownerUserId: ownerUserId || target?.boss?.ownerUserId || '' }
          };
        }
        const record = { recordKey: target?.recordKey || '', boss: target?.boss || {}, siteKey: 'boss', sourceName: 'BOSS直聘' };
        const item = list.find((candidate) => bossRecordMatchesItem(record, candidate));
        if (!item) {
          reportBossSendLog(`目标精确匹配失败：${record.recordKey}`);
          return { ...target, prepareError: '目标无法在当前账号联系人列表中精确匹配。' };
        }
        let detail = null;
        try { detail = await fetchBossData(item); } catch (error) {
          reportBossSendLog(`首次补齐目标时 getBossData 失败：${record.recordKey}；${error?.message || String(error)}`);
        }
        const data = detail?.data || {};
        const friendId = data.bossId || item.uid || item.bossId || item.friendId || target?.boss?.bossId || target?.boss?.friendId || '';
        const peerKey = data.encryptBossId || item.encryptBossId || item.encryptUid || item.encryptFriendId || targetPeerKey(target);
        const chatSecurityId = item.securityId || '';
        const friendIdValid = /^\d+$/.test(normalizeText(friendId));
        const peerKeyValid = /^[A-Za-z0-9_~-]{28}$/.test(normalizeText(peerKey));
        reportBossSendLog(`目标字段校验：${record.recordKey}；friendId有效=${friendIdValid}；friendId长度=${normalizeText(friendId).length}；peerKey有效=${peerKeyValid}；peerKey长度=${normalizeText(peerKey).length}；chatSecurityId存在=${Boolean(chatSecurityId)}`);
        reportBossSendLog(`目标精确匹配成功：${record.recordKey}`);
        return {
          ...target,
          boss: {
            ...(target?.boss || {}),
            ownerUserId,
            friendId,
            peerKey,
            chatSecurityId,
            uploadSecurityId: data.securityId || target?.boss?.uploadSecurityId || '',
            friendSource: item.friendSource ?? item.sourceType ?? '',
            bossId: data.bossId || item.uid || item.bossId || target?.boss?.bossId || '',
            encryptBossId: data.encryptBossId || item.encryptBossId || item.encryptUid || peerKey,
            jobId: item.jobId || target?.boss?.jobId || '',
            encryptJobId: data.encryptJobId || item.encryptJobId || target?.boss?.encryptJobId || ''
          }
        };
      }));
    } finally {
      reportBossSendLog('发送目标刷新完成。');
      bossSendPreparationActive = false;
    }
  }

  globalThis.JobChatBossExtractor = {
    extract: extractBossChatRecords,
    prepare: prepareBossSync,
    prepareSendTargets: prepareBossSendTargets
  };
})();
