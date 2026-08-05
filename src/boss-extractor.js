(function () {
  const { normalizeText, formatDateTime, extractJobName, htmlDecode, getCookieValue, sleep } = globalThis.JobChatUtils;
  const {
    filterBossRecentList,
    getSyncDelayMs,
    reportProgress,
    isCancelRequested,
    savePartial,
    readIgnoredRecords,
    readPreparedSourceList,
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
      'x-requested-with': 'XMLHttpRequest',
      'traceid': createBossTraceId()
    };
    const token = getCookieValue('bst') || getCookieValue('zp_token');
    if (token) headers.zp_token = token;
    if (contentType) headers['content-type'] = contentType;
    return headers;
  }

  function createBossTraceId() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const values = new Uint8Array(9);
    crypto.getRandomValues(values);
    const suffix = Array.from(values, (value) => alphabet[value % alphabet.length]).join('');
    return `F-${Date.now().toString(16).padStart(13, '0')}${suffix}`;
  }

  async function bossPageRequest(url, init) {
    if (typeof globalThis.JobChatBossPageRequest === 'function') {
      return globalThis.JobChatBossPageRequest(url, init);
    }
    const response = await fetch(url, {
      method: init?.method || 'GET',
      credentials: 'include',
      headers: init?.headers,
      body: init?.body,
      signal: init?.signal
    });
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      requestHeaders: init?.headers || {},
      responseHeaders: Object.fromEntries(response.headers.entries()),
      responseText: await response.text()
    };
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

  function bossRecordKeyPartsFromStoredKey(record) {
    const parts = normalizeText(record?.recordKey).toLowerCase().split('|');
    if (parts[0] !== 'boss') return { bossId: '', jobId: '' };
    return { bossId: normalizeText(parts[1]), jobId: normalizeText(parts[2]) };
  }

  function bossRecordJobId(record) {
    return normalizeText(record?.boss?.jobId || bossRecordKeyPartsFromStoredKey(record).jobId).toLowerCase();
  }

  function bossRelationFriendIdOfItem(item) {
    return normalizeText(item?.friendId || item?.id || item?.relationId || item?.friend?.friendId);
  }

  function bossContactMatchesItem(record, item) {
    const stored = bossRecordKeyPartsFromStoredKey(record);
    const recordBossIds = new Set([
      record?.boss?.peerKey,
      record?.boss?.encryptBossId,
      record?.boss?.encryptFriendId,
      record?.boss?.bossId,
      stored.bossId
    ].map((value) => normalizeText(value).toLowerCase()).filter(Boolean));
    const itemBossIds = [
      item?.encryptBossId,
      item?.encryptUid,
      item?.encryptFriendId
    ].map((value) => normalizeText(value).toLowerCase()).filter(Boolean);
    if (itemBossIds.some((value) => recordBossIds.has(value))) return true;

    const recordRelationFriendId = normalizeText(record?.boss?.relationFriendId);
    if (recordRelationFriendId && recordRelationFriendId === bossRelationFriendIdOfItem(item)) return true;

    const recordFriendId = normalizeText(record?.boss?.friendId);
    const itemFriendIds = [
      item?.friendId,
      item?.uid,
      item?.bossId
    ].map((value) => normalizeText(value)).filter(Boolean);
    if (recordFriendId && itemFriendIds.includes(recordFriendId)) return true;

    const recordSecurityId = normalizeText(record?.boss?.chatSecurityId || record?.boss?.securityId);
    return Boolean(recordSecurityId && recordSecurityId === normalizeText(item?.securityId));
  }

  function bossItemJobId(item) {
    return normalizeText(item?.jobId).toLowerCase();
  }

  function bossJobMatchesItem(record, item) {
    const recordJobId = bossRecordJobId(record);
    const itemJobId = bossItemJobId(item);
    return Boolean(recordJobId && itemJobId && recordJobId === itemJobId);
  }

  function findBossItemForRefresh(record, list) {
    const candidates = (Array.isArray(list) ? list : []).filter((item) => bossContactMatchesItem(record, item));
    return candidates.find((item) => bossJobMatchesItem(record, item)) || candidates[0] || null;
  }

  function bossExpiredJobRecord(record) {
    const message = '最近沟通时间超过30天，无法获取详情';
    return {
      ...record,
      boss: {
        ...(record?.boss || {}),
        jobDetailStatus: 'expired'
      },
      jobInfo: globalThis.JobChatRecords.normalizeJobInfo({
        ...(record?.jobInfo || {}),
        description: message,
        fetchStatus: 'success',
        fetchedAt: new Date().toISOString(),
        errorMessage: message
      }),
      updatedAt: new Date().toISOString()
    };
  }

  function bossDetailJobId(detail) {
    return normalizeText(
      detail?.job?.jobId
      || detail?.data?.jobId
      || detail?.data?.job?.jobId
    ).toLowerCase();
  }

  function refreshBossContactFields(record, item, detail, ownerUserId = '') {
    const data = detail?.data || {};
    const oldBoss = record?.boss || {};
    const boss = {
      ...oldBoss,
      ownerUserId: ownerUserId || oldBoss.ownerUserId || '',
      friendId: data.bossId || item?.uid || item?.bossId || item?.friendId || oldBoss.friendId || '',
      relationFriendId: bossRelationFriendIdOfItem(item) || oldBoss.relationFriendId || '',
      friendSource: item?.friendSource ?? item?.sourceType ?? oldBoss.friendSource ?? '',
      bossId: data.bossId || item?.uid || item?.bossId || oldBoss.bossId || '',
      encryptBossId: data.encryptBossId || item?.encryptBossId || item?.encryptUid || oldBoss.encryptBossId || '',
      peerKey: data.encryptBossId || item?.encryptBossId || item?.encryptUid || item?.encryptFriendId || oldBoss.peerKey || '',
      chatSecurityId: item?.securityId || oldBoss.chatSecurityId || oldBoss.securityId || '',
      jobId: oldBoss.jobId || bossRecordJobId(record) || item?.jobId || ''
    };
    delete boss.securityId;
    delete boss.bossSecurityId;
    delete boss.bossJobSecurityId;
    delete boss.uploadSecurityId;
    delete boss.encryptJobId;
    return { ...record, boss, updatedAt: new Date().toISOString() };
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
    const securityId = record?.boss?.chatSecurityId || record?.boss?.securityId;
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

  function createConversationSyncStats() {
    return { requested: 0, success: 0, failed: 0, skipped: 0, messageFailed: 0 };
  }

  function bossConversationIsCurrent(record, item) {
    return globalThis.JobChatRecords.conversationIsCompleteForLatest(
      record,
      bossLastMsgIdFromItem(item)
    );
  }

  function findBossRecordByItem(map, item) {
    return bossItemKeys(item).map((key) => map.get(key)).find(Boolean) || null;
  }

  function bossRecordMatchesItem(record, item) {
    const recordKeys = new Set();
    addBossRecordKeys(recordKeys, record);
    return bossItemKeys(item).some((key) => recordKeys.has(key));
  }

  function bossItemSyncNeeds(item, savedMap, pendingMap) {
    const existing = findBossRecordByItem(pendingMap, item) || findBossRecordByItem(savedMap, item);
    // 待更新分类互斥：已有记录的岗位详情缺失优先归入“岗位详情同步”；
    // 新记录及其他变更归入“消息状态同步”。
    if (!existing) return { record: true, message: true, jobDetail: true };
    const oldMsgId = bossLastMsgIdFromRecord(existing);
    const newMsgId = bossLastMsgIdFromItem(item);
    const msgChanged = Boolean(newMsgId && oldMsgId !== newMsgId);
    const statusChanged = bossMessageStatusFromRecord(existing) !== bossMessageStatusFromItem(item);
    const jobInfoMissing = !globalThis.JobChatJobSync.isCompleteJobInfo(existing);
    return {
      record: msgChanged || statusChanged || jobInfoMissing,
      message: !jobInfoMissing && (msgChanged || statusChanged),
      jobDetail: jobInfoMissing
    };
  }

  function shouldSyncBossItem(item, savedMap, pendingMap) {
    return bossItemSyncNeeds(item, savedMap, pendingMap).record;
  }

  function bossSyncMessage(synced, total, insertedCount, updatedMsgCount) {
    return `正在同步BOSS直聘沟通记录... 已处理 ${synced} / ${total} 条，消息状态：新增 ${insertedCount} 条，更新 ${updatedMsgCount} 条`;
  }

  function createJobDetailSyncStats() {
    return { requested: 0, success: 0, failed: 0, skipped: 0, riskPauses: 0, stoppedByRiskControl: false };
  }

  function bossJobRetryOptions(options = {}) {
    return {
      delaySeconds: Math.max(1, Math.min(3600, Math.floor(Number(options.retryDelaySeconds || 60)))),
      retryCount: Math.max(1, Math.min(10, Math.floor(Number(options.retryCount || 3))))
    };
  }

  function bossSyncSummary(
    insertedCount,
    updatedMsgCount,
    jobDetail = createJobDetailSyncStats(),
    conversation = createConversationSyncStats()
  ) {
    return {
      inserted: insertedCount,
      updated: updatedMsgCount,
      updatedMsg: updatedMsgCount,
      jobDetail,
      conversation
    };
  }

  async function saveBossPartial(records, synced, total, interrupted, completed, insertedCount = 0, updatedMsgCount = 0, jobDetail, conversation) {
    return savePartial('boss', 'BOSS直聘沟通记录', 'BOSS直聘', records, synced, total, interrupted, completed, {
      syncSummary: bossSyncSummary(insertedCount, updatedMsgCount, jobDetail, conversation)
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

  async function fetchBossLabelFriendList(onLog, beforeRequest) {
    const url = new URL('https://www.zhipin.com/wapi/zprelation/friend/geekFilterByLabel');
    url.searchParams.set('labelId', '0');
    onLog?.({ step: 'geekFilterByLabel:request', message: 'GET /wapi/zprelation/friend/geekFilterByLabel?labelId=0' });
    reportBossSendLog('发送预检 HTTP 请求：GET /wapi/zprelation/friend/geekFilterByLabel?labelId=0');
    await appendRequestLog({ siteKey: 'boss', step: 'geekFilterByLabel:request', method: 'GET', url: url.toString() });
    await beforeRequest?.();
    const response = await fetch(url.toString(), {
      method: 'GET',
      credentials: 'include',
      headers: bossHeaders()
    });
    await appendRequestLog({ siteKey: 'boss', step: 'geekFilterByLabel:http', status: response.status });
    if (!response.ok) {
      onLog?.({ step: 'geekFilterByLabel:response', message: `HTTP ${response.status}` });
      throw new Error(`BOSS直聘列表接口请求失败：HTTP ${response.status}`);
    }
    const data = await response.json();
    const list = parseBossFriendListResult(data);
    onLog?.({ step: 'geekFilterByLabel:response', message: `HTTP ${response.status} · code=${data?.code} · 联系人 ${list.length} 条` });
    reportBossSendLog(`发送预检 HTTP 响应：GET /wapi/zprelation/friend/geekFilterByLabel；HTTP ${response.status}；code=${data?.code}；联系人=${list.length} 条`);
    await appendRequestLog({ siteKey: 'boss', step: 'geekFilterByLabel:response', code: data?.code, message: data?.message || '', response: data });
    if (data?.code !== 0) throw new Error(`BOSS直聘列表接口返回异常：${JSON.stringify(data).slice(0, 300)}`);
    return list;
  }

  function bossFriendIdsFromLabelList(list) {
    if (!Array.isArray(list)) return [];
    const ids = [];
    const seen = new Set();
    list.forEach((item) => {
      const id = bossRelationFriendIdOfItem(item);
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
      const id = bossRelationFriendIdOfItem(item);
      if (id) labelByFriendId.set(id, item);
    });

    const merged = detailList.map((item, index) => {
      const id = bossRelationFriendIdOfItem(item);
      const labelItem = (id && labelByFriendId.get(id)) || labelByOrder[index] || {};
      return {
        ...labelItem,
        ...item,
        friendId: id || bossRelationFriendIdOfItem(labelItem),
        friendSource: item?.friendSource ?? labelItem?.friendSource ?? '',
        encryptFriendId: item?.encryptFriendId || labelItem?.encryptFriendId || '',
        updateTime: item?.updateTime || labelItem?.updateTime || item?.lastMessageInfo?.msgTime || item?.lastTS || ''
      };
    });
    const mergedFriendIds = new Set(merged.map((item) => normalizeText(item?.friendId)).filter(Boolean));
    labelByOrder.forEach((item) => {
      const id = bossRelationFriendIdOfItem(item);
      if (id && mergedFriendIds.has(id)) return;
      merged.push(item);
      if (id) mergedFriendIds.add(id);
    });
    return merged;
  }

  async function fetchBossFriendDetailListWithRequest(request, onLog, beforeRequest, signal) {
    const method = normalizeText(request?.method || 'POST').toUpperCase() || 'POST';
    const body = normalizeText(request?.body || '');
    onLog?.({ step: 'getGeekFriendList:request', message: `${method} /wapi/zprelation/friend/getGeekFriendList.json · friendId ${request?.friendIdCount || 0} 个` });
    reportBossSendLog(`发送预检 HTTP 请求：${method} /wapi/zprelation/friend/getGeekFriendList.json；friendId=${request?.friendIdCount || 0} 个（值已隐藏）`);
    await appendRequestLog({ siteKey: 'boss', step: 'getGeekFriendList:request', method, url: 'https://www.zhipin.com/wapi/zprelation/friend/getGeekFriendList.json', batchIndex: request?.batchIndex, batchTotal: request?.batchTotal, friendIdCount: request?.friendIdCount });
    const init = {
      method,
      credentials: 'include',
      headers: bossHeaders(method === 'POST' ? 'application/x-www-form-urlencoded' : '')
    };
    if (method !== 'GET' && body) init.body = body;
    await beforeRequest?.();
    const response = await fetch('https://www.zhipin.com/wapi/zprelation/friend/getGeekFriendList.json', { ...init, signal });
    await appendRequestLog({ siteKey: 'boss', step: 'getGeekFriendList:http', method, batchIndex: request?.batchIndex, batchTotal: request?.batchTotal, friendIdCount: request?.friendIdCount, status: response.status });
    if (!response.ok) {
      onLog?.({ step: 'getGeekFriendList:response', message: `HTTP ${response.status}` });
      throw new Error(`BOSS直聘岗位列表接口请求失败：HTTP ${response.status}`);
    }
    const data = await response.json();
    const list = parseBossFriendListResult(data);
    onLog?.({ step: 'getGeekFriendList:response', message: `HTTP ${response.status} · code=${data?.code} · 记录 ${list.length} 条` });
    reportBossSendLog(`发送预检 HTTP 响应：${method} /wapi/zprelation/friend/getGeekFriendList.json；HTTP ${response.status}；code=${data?.code}；记录=${list.length} 条`);
    await appendRequestLog({ siteKey: 'boss', step: 'getGeekFriendList:response', method, batchIndex: request?.batchIndex, batchTotal: request?.batchTotal, friendIdCount: request?.friendIdCount, code: data?.code, message: data?.message || '', response: data });
    if (data?.code !== 0) throw new Error(`BOSS直聘岗位列表接口返回异常：${JSON.stringify(data).slice(0, 300)}`);
    return list;
  }

  async function fetchBossFriendDetailList(friendIds, onLog, beforeRequest, signal) {
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
        }, onLog, beforeRequest, signal);
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
        const list = await fetchBossFriendDetailListWithRequest(request, onLog, beforeRequest, signal);
        if (Array.isArray(list)) return list;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error('BOSS直聘岗位列表接口请求失败。');
  }

  async function fetchBossFriendList(recentOnly = true, onLog) {
    const labelList = await fetchBossLabelFriendList(onLog);
    const friendIds = bossFriendIdsFromLabelList(labelList);
    await appendRequestLog({ siteKey: 'boss', step: 'friendIds:parsed', labelCount: Array.isArray(labelList) ? labelList.length : 0, friendIdCount: friendIds.length, firstFriendIds: friendIds.slice(0, 10) });
    if (!friendIds.length) return [];
    let detailList = [];
    try {
      detailList = await fetchBossFriendDetailList(friendIds, onLog);
    } catch (error) {
      throw error;
    }
    const mergedList = mergeBossFriendDetailList(labelList, detailList);
    const recentList = filterBossRecentList(mergedList);
    await appendRequestLog({ siteKey: 'boss', step: 'bossList:filtered', detailCount: Array.isArray(detailList) ? detailList.length : 0, mergedCount: mergedList.length, recentCount: recentList.length });
    return recentOnly ? recentList : mergedList;
  }

  async function fetchBossData(item, onLog, beforeRequest, signal) {
    const bossId = item.encryptBossId || item.encryptUid || item.encryptFriendId || '';
    const securityId = item.securityId || '';
    if (!bossId || !securityId) return null;
    const url = new URL('https://www.zhipin.com/wapi/zpchat/geek/getBossData');
    url.searchParams.set('bossId', bossId);
    url.searchParams.set('bossSource', String(item.friendSource ?? item.sourceType ?? 0));
    url.searchParams.set('securityId', securityId);
    const headers = bossHeaders();
    const requestLog = { method: 'GET', url: url.toString(), credentials: 'include', headers };
    onLog?.({ step: 'getBossData:request', message: `GET ${url.toString()}`, request: requestLog });
    reportBossSendLog('发送预检 HTTP 请求：GET /wapi/zpchat/geek/getBossData；bossId=[已隐藏]；securityId=[已隐藏]');
    await appendRequestLog({ siteKey: 'boss', step: 'getBossData:request', ...requestLog });
    await beforeRequest?.();
    const response = await fetch(url.toString(), {
      method: 'GET',
      credentials: 'include',
      headers,
      signal
    });
    const responseText = await response.text();
    let data = null;
    try { data = JSON.parse(responseText); } catch (_) {}
    const responseBody = data ?? responseText;
    await appendRequestLog({ siteKey: 'boss', step: 'getBossData:response', status: response.status, url: url.toString(), response: responseBody });
    onLog?.({ step: 'getBossData:response', message: `HTTP ${response.status}\n${typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody, null, 2)}`, status: response.status, response: responseBody });
    if (!response.ok) {
      throw new Error(`BOSS直聘岗位详情接口请求失败：HTTP ${response.status}`);
    }
    if (!data) throw new Error('BOSS直聘联系人数据接口未返回 JSON。');
    reportBossSendLog(`发送预检 HTTP 响应：GET /wapi/zpchat/geek/getBossData；HTTP ${response.status}；code=${data?.code}`);
    if (data?.code !== 0) throw new Error(`BOSS直聘联系人数据接口返回异常：code=${data?.code}，${normalizeText(data?.message || '')}`.slice(0, 300));
    return data?.zpData || {};
  }

  function oldestBossHistoryMessageId(messages) {
    return (Array.isArray(messages) ? messages : []).reduce((oldest, message) => {
      const id = normalizeText(message?.mid);
      if (!/^\d+$/.test(id)) return oldest;
      if (!oldest) return id;
      try { return BigInt(id) < BigInt(oldest) ? id : oldest; } catch (_) { return id < oldest ? id : oldest; }
    }, '');
  }

  function normalizeBossConversationMessage(message) {
    if (typeof message?.body?.text !== 'string') return null;
    return globalThis.JobChatRecords.normalizeConversationMessage({
      id: message.mid,
      text: message.body.text,
      fromUserId: message.from?.uid,
      toUserId: message.to?.uid,
      timestamp: message.time
    });
  }

  async function fetchBossConversation(item, currentUserId, options = {}) {
    const bossId = bossIdOfItem(item);
    const securityId = normalizeText(item?.securityId);
    if (!bossId || !securityId) throw new Error('BOSS 完整会话请求缺少 bossId 或 securityId。');

    const messagesById = new Map();
    const seenCursors = new Set();
    let page = 1;
    let maxMsgId = '0';
    const maxPages = 200;

    while (page <= maxPages) {
      if (options.signal?.aborted || await options.shouldStop?.()) throw bossRefreshStoppedError();
      if (page > 1 && !options.beforeRequest) await sleep(await getSyncDelayMs());
      await options.beforeRequest?.();

      const url = new URL('https://www.zhipin.com/wapi/zpchat/geek/historyMsg');
      url.searchParams.set('bossId', bossId);
      url.searchParams.set('maxMsgId', maxMsgId);
      url.searchParams.set('c', '20');
      url.searchParams.set('page', String(page));
      url.searchParams.set('src', String(item?.friendSource ?? item?.sourceType ?? 0));
      url.searchParams.set('securityId', securityId);
      await appendRequestLog({
        siteKey: 'boss',
        step: 'conversationHistory:request',
        method: 'GET',
        page,
        maxMsgId: maxMsgId === '0' ? '0' : '[hidden]'
      });

      const response = await bossPageRequest(url.toString(), {
        method: 'GET',
        headers: bossHeaders(),
        signal: options.signal
      });
      let payload = null;
      try { payload = JSON.parse(response.responseText); } catch (_) {}
      if (!response.ok) {
        const error = new Error(`BOSS 完整会话请求失败：HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      if (!payload) throw new Error('BOSS 完整会话接口未返回 JSON。');
      if (payload.code !== 0) {
        throw new Error(`BOSS 完整会话接口返回异常：code=${payload.code}，${normalizeText(payload.message || '')}`.slice(0, 300));
      }

      const rawMessages = Array.isArray(payload?.zpData?.messages) ? payload.zpData.messages : [];
      rawMessages.forEach((rawMessage) => {
        const message = normalizeBossConversationMessage(rawMessage);
        if (message?.id && message.text) messagesById.set(message.id, message);
      });
      const hasMore = payload?.zpData?.hasMore === true;
      await appendRequestLog({
        siteKey: 'boss',
        step: 'conversationHistory:response',
        status: response.status,
        page,
        rawMessageCount: rawMessages.length,
        textMessageCount: rawMessages.filter((message) => typeof message?.body?.text === 'string').length,
        hasMore
      });
      options.onLog?.({
        step: 'conversationHistory:response',
        message: `完整会话第 ${page} 页：原始 ${rawMessages.length} 条，文本 ${messagesById.size} 条，hasMore=${hasMore}`
      });
      if (!hasMore) {
        return globalThis.JobChatRecords.normalizeConversation({
          version: 1,
          currentUserId,
          messages: [...messagesById.values()],
          sync: {
            complete: true,
            sourceLatestMessageId: bossLastMsgIdFromItem(item),
            syncedAt: new Date().toISOString()
          }
        });
      }

      const responseMinMsgId = normalizeText(payload?.zpData?.minMsgId);
      const nextCursor = /^\d+$/.test(responseMinMsgId)
        ? responseMinMsgId
        : oldestBossHistoryMessageId(rawMessages);
      if (!nextCursor || seenCursors.has(nextCursor) || nextCursor === maxMsgId) {
        throw new Error('BOSS 完整会话分页游标无效，已停止保存不完整会话。');
      }
      seenCursors.add(nextCursor);
      maxMsgId = nextCursor;
      page += 1;
    }

    throw new Error(`BOSS 完整会话超过 ${maxPages} 页，已停止保存不完整会话。`);
  }

  function safeJobDetailError(error) {
    return normalizeText(error?.message || String(error)).slice(0, 500);
  }

  function isBossJobRiskControlError(error) {
    return Boolean(error?.riskControl)
      || error?.status === 403
      || error?.status === 429
      || /安全验证|访问异常|访问频繁|稍后再试|security|risk/i.test(safeJobDetailError(error));
  }

  function isBossRefreshStopped(error, signal) {
    return Boolean(signal?.aborted) || error?.name === 'AbortError';
  }

  function bossRefreshStoppedError() {
    const error = new Error('已停止同步。');
    error.name = 'AbortError';
    return error;
  }

  async function sleepUntilStoppedOrElapsed(milliseconds, shouldStop, signal) {
    if (signal) {
      if (signal.aborted || await shouldStop?.()) return true;
      const aborted = await new Promise((resolve) => {
        let timer;
        const onAbort = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          resolve(true);
        };
        timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve(false);
        }, milliseconds);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
      return aborted || Boolean(await shouldStop?.());
    }
    const deadline = Date.now() + milliseconds;
    while (Date.now() < deadline) {
      if (signal?.aborted || await shouldStop?.()) return true;
      const waitMs = Math.min(250, Math.max(0, deadline - Date.now()));
      const aborted = await new Promise((resolve) => {
        let timer;
        const onAbort = () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          resolve(true);
        };
        timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve(false);
        }, waitMs);
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
      });
      if (aborted) return true;
    }
    return Boolean(signal?.aborted || await shouldStop?.());
  }

  function createBossRequestPacer(rate, shouldStop, signal) {
    const delayMs = Math.ceil(60 * 1000 / Math.max(1, Number(rate || 20)));
    let nextRequestAt = 0;
    return async () => {
      const now = Date.now();
      if (nextRequestAt > now && await sleepUntilStoppedOrElapsed(nextRequestAt - now, shouldStop, signal)) throw bossRefreshStoppedError();
      if (signal?.aborted || await shouldStop?.()) throw bossRefreshStoppedError();
      nextRequestAt = Math.max(Date.now(), nextRequestAt) + delayMs;
    };
  }

  async function resolveBossJobAccess(record, context, options) {
    const detail = context?.detail || await fetchBossData(context?.item, options?.onLog, options?.beforeResolveRequest, options?.signal);
    const data = detail?.data || {};
    return {
      detail,
      item: context?.item,
      jobRef: {
        externalId: normalizeText(data.encryptJobId || context?.item?.encryptJobId || record?.jobRef?.externalId),
        detailAccessToken: normalizeText(data.securityId)
      }
    };
  }

  async function fetchBossJobDetail(jobRef, access, options) {
    const url = new URL('https://www.zhipin.com/wapi/zpgeek/job/detail.json');
    url.searchParams.set('securityId', jobRef.detailAccessToken);
    url.searchParams.set('_', String(Date.now()));
    const headers = bossHeaders();
    const requestLog = { method: 'GET', url: url.toString(), credentials: 'include', headers };
    await appendRequestLog({ siteKey: 'boss', step: 'jobDetail:request', ...requestLog });
    options?.onLog?.({ step: 'jobDetail:request', message: `GET ${url.toString()}（岗位信息会话已按固定 2 秒间隔调度）`, request: requestLog });
    const response = await bossPageRequest(url.toString(), {
      method: 'GET',
      headers,
      signal: options?.signal
    });
    const responseText = response.responseText;
    let payload = null;
    try { payload = JSON.parse(responseText); } catch (_) {}
    const responseBody = payload ?? responseText;
    await appendRequestLog({
      siteKey: 'boss',
      step: 'jobDetail:response',
      status: response.status,
      url: url.toString(),
      requestHeaders: response.requestHeaders,
      responseHeaders: response.responseHeaders,
      response: responseBody
    });
    options?.onLog?.({
      step: 'jobDetail:response',
      message: `实际请求头\n${JSON.stringify(response.requestHeaders, null, 2)}\n响应头\n${JSON.stringify(response.responseHeaders, null, 2)}\nHTTP ${response.status}\n${typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody, null, 2)}`,
      status: response.status,
      requestHeaders: response.requestHeaders,
      responseHeaders: response.responseHeaders,
      response: responseBody
    });
    if (!response.ok) {
      const error = new Error(`岗位详情请求失败：HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    if (!payload) {
      const error = new Error('岗位详情接口未返回 JSON，可能触发安全验证。');
      error.riskControl = true;
      throw error;
    }
    if (payload.code !== 0 && payload.code !== 200301) {
      const error = new Error(`岗位详情接口返回异常：code=${payload.code}，${normalizeText(payload?.message || payload?.zpData?.message || '')}`);
      error.code = payload.code;
      error.riskControl = payload.code === 37;
      throw error;
    }
    return payload;
  }

  function normalizeBossJobResponse(payload, jobRef) {
    if (payload?.code === 200301) {
      return {
        jobRef: {
          externalId: jobRef.externalId,
          detailAccessToken: jobRef.detailAccessToken
        },
        jobInfo: {
          title: '',
          category: '',
          location: '',
          experience: '',
          education: '',
          salary: '',
          description: '',
          address: '',
          skills: [],
          errorMessage: normalizeText(payload?.message || '该职位已不存在')
        },
        companyProfile: null
      };
    }
    const job = payload?.zpData?.jobInfo;
    if (!job || typeof job !== 'object') throw new Error('岗位详情接口未返回 jobInfo。');
    const company = payload?.zpData?.brandComInfo;
    const companyExternalId = normalizeText(company?.encryptBrandId);
    const companyKey = companyExternalId ? `boss|${companyExternalId}` : '';
    return {
      jobRef: {
        externalId: normalizeText(job.encryptId || jobRef.externalId),
        detailAccessToken: jobRef.detailAccessToken
      },
      jobInfo: {
        title: job.jobName,
        category: job.positionName,
        location: job.locationName,
        experience: job.experienceName,
        education: job.degreeName,
        salary: job.salaryDesc,
        description: job.postDescription,
        address: job.address,
        skills: job.showSkills
      },
      companyProfile: companyExternalId ? {
        companyKey,
        siteKey: 'boss',
        externalId: companyExternalId,
        name: normalizeText(company.brandName),
        employeeScale: normalizeText(company.scaleName),
        industry: normalizeText(company.industryName),
        description: globalThis.JobChatRecords.normalizeMultilineText(company.introduce)
      } : null
    };
  }

  async function persistCompanyProfile(profile) {
    if (!profile) return;
    const response = await chrome.runtime.sendMessage({ type: 'JOB_CHAT_COMPANY_PROFILE_UPSERT', profile });
    if (response && response.ok === false) throw new Error(response.error || '公司信息保存失败。');
  }

  function jobDetailStoppedInfo(existingRecord) {
    return globalThis.JobChatRecords.normalizeJobInfo({
      ...(existingRecord?.jobInfo || {}),
      fetchStatus: 'failed',
      fetchedAt: new Date().toISOString(),
      errorMessage: '岗位详情同步已因连续触发安全验证而停止。'
    });
  }

  async function fetchBossOwnerUserId(onLog, beforeRequest, signal) {
    onLog?.({ step: 'getUserInfo:request', message: 'GET /wapi/zpuser/wap/getUserInfo.json' });
    reportBossSendLog('发送预检 HTTP 请求：GET /wapi/zpuser/wap/getUserInfo.json');
    const url = 'https://www.zhipin.com/wapi/zpuser/wap/getUserInfo.json';
    const headers = bossHeaders();
    await appendRequestLog({ siteKey: 'boss', step: 'getUserInfo:request', method: 'GET', url });
    await beforeRequest?.();
    const response = await fetch(url, {
      credentials: 'include', headers, signal
    });
    if (!response.ok) {
      await appendRequestLog({ siteKey: 'boss', step: 'getUserInfo:response', status: response.status, response: await response.text() });
      onLog?.({ step: 'getUserInfo:response', message: `HTTP ${response.status}` });
      return '';
    }
    const data = await response.json();
    await appendRequestLog({ siteKey: 'boss', step: 'getUserInfo:response', status: response.status, response: data });
    onLog?.({ step: 'getUserInfo:response', message: `HTTP ${response.status} · code=${data?.code} · userId=${data?.zpData?.userId ? '[present]' : '[missing]'}` });
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
    const record = {
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
      jobRef: {
        externalId: normalizeText(data.encryptJobId || item.encryptJobId || existingRecord?.jobRef?.externalId),
        detailAccessToken: normalizeText(data.securityId || existingRecord?.jobRef?.detailAccessToken)
      },
      jobInfo: existingRecord?.jobInfo || {},
      boss: {
        ...(existingRecord?.boss || {}),
        ownerUserId: ownerUserId || existingRecord?.boss?.ownerUserId || '',
        friendId: data.bossId || item.uid || item.friendId || existingRecord?.boss?.friendId || '',
        relationFriendId: bossRelationFriendIdOfItem(item) || existingRecord?.boss?.relationFriendId || '',
        friendSource: item.friendSource ?? existingRecord?.boss?.friendSource ?? '',
        encryptFriendId: item.encryptFriendId || existingRecord?.boss?.encryptFriendId || '',
        bossId: data.bossId || item.uid || existingRecord?.boss?.bossId || '',
        encryptBossId: data.encryptBossId || item.encryptBossId || item.encryptUid || existingRecord?.boss?.encryptBossId || '',
        peerKey: data.encryptBossId || item.encryptBossId || item.encryptUid || item.encryptFriendId || existingRecord?.boss?.peerKey || '',
        chatSecurityId: item.securityId || existingRecord?.boss?.chatSecurityId || existingRecord?.boss?.securityId || '',
        jobId: item.jobId || existingRecord?.boss?.jobId || '',
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
    delete record.boss.bossSecurityId;
    delete record.boss.bossJobSecurityId;
    delete record.boss.uploadSecurityId;
    delete record.boss.encryptJobId;
    delete record.bossJobSecurityId;
    delete record.externalJobId;
    delete record.jobDetailAccessToken;
    return record;
  }

  async function extractBossChatRecords(options = {}) {
    const preparedSnapshot = await readPreparedSourceList('boss');
    const list = preparedSnapshot ? preparedSnapshot.list : await fetchBossFriendList();
    await appendRequestLog({
      siteKey: 'boss',
      step: 'sync:listSource',
      source: preparedSnapshot ? 'prepared-snapshot' : 'network-fallback',
      capturedAt: preparedSnapshot?.capturedAt || '',
      listCount: Array.isArray(list) ? list.length : 0
    });
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
    const includeInsert = options.syncSelection?.includeInsert !== false;
    const includeUpdate = options.syncSelection?.includeUpdate !== false;
    const allItemsToSync = list.filter((item) => {
      if (findBossRecordByItem(ignoredMap, item) || !shouldSyncBossItem(item, savedMap, pendingMap)) return false;
      const existingRecord = findBossRecordByItem(pendingMap, item) || findBossRecordByItem(savedMap, item);
      return existingRecord ? includeUpdate : includeInsert;
    });
    const itemsToSync = allItemsToSync;
    const totalToSync = itemsToSync.length;
    const communicationTotal = itemsToSync.filter((item) => bossItemSyncNeeds(item, savedMap, pendingMap).message).length;
    const jobDetailTotal = itemsToSync.filter((item) => bossItemSyncNeeds(item, savedMap, pendingMap).jobDetail).length;
    let syncedCount = 0;
    let insertedCount = 0;
    let updatedMsgCount = 0;
    const jobDetailStats = createJobDetailSyncStats();
    const conversationStats = createConversationSyncStats();
    const currentSyncSummary = () => bossSyncSummary(
      insertedCount,
      updatedMsgCount,
      jobDetailStats,
      conversationStats
    );
    const saveCurrentPartial = (interrupted, completed) => saveBossPartial(
      records,
      syncedCount,
      totalToSync,
      interrupted,
      completed,
      insertedCount,
      updatedMsgCount,
      jobDetailStats,
      conversationStats
    );
    const jobDetailSession = new globalThis.JobChatJobSync.JobDetailSyncSession({
      requestIntervalMs: 2000,
      maxRequestsPerPage: 4
    });
    const progressCategories = () => ({
      communication: {
        completed: insertedCount + updatedMsgCount + conversationStats.messageFailed,
        total: communicationTotal
      },
      jobDetail: {
        completed: jobDetailStats.success + jobDetailStats.failed + jobDetailStats.skipped,
        total: jobDetailTotal
      }
    });

    reportProgress('boss', 'BOSS直聘沟通记录', 'BOSS直聘', syncedCount, totalToSync, {
      inserted: insertedCount,
      updated: updatedMsgCount,
      updatedMsg: updatedMsgCount,
      progressCategories: progressCategories(),
      jobDetailRequired: jobDetailTotal > 0,
      message: bossSyncMessage(syncedCount, totalToSync, insertedCount, updatedMsgCount)
    });
    await saveCurrentPartial(false, syncedCount >= totalToSync);

    for (let i = 0; i < itemsToSync.length; i += 1) {
      const item = itemsToSync[i];
      if (await isCancelRequested()) {
        await saveCurrentPartial(true, false);
        return {
          pageTitle: document.title || '',
          pageUrl: location.href,
          extractedAt: new Date().toISOString(),
          total: records.length,
          synced: syncedCount,
          interrupted: true,
          sourceTotal: allItemsToSync.length,
          syncSummary: currentSyncSummary(),
          records
        };
      }

      if (records.length > 0) await sleep(await getSyncDelayMs());
      const existingRecord = findBossRecordByItem(pendingMap, item) || findBossRecordByItem(savedMap, item);
      const isUpdate = Boolean(existingRecord);
      const syncNeeds = bossItemSyncNeeds(item, savedMap, pendingMap);
      const existingIndex = records.findIndex((record) => bossRecordMatchesItem(record, item));
      let conversation = existingRecord?.conversation;
      if (bossConversationIsCurrent(existingRecord, item)) {
        conversationStats.skipped += 1;
      } else {
        conversationStats.requested += 1;
        try {
          conversation = await fetchBossConversation(item, ownerUserId, {
            shouldStop: isCancelRequested
          });
          conversationStats.success += 1;
        } catch (error) {
          if (await isCancelRequested()) {
            await saveCurrentPartial(true, false);
            return {
              pageTitle: document.title || '',
              pageUrl: location.href,
              extractedAt: new Date().toISOString(),
              total: records.length,
              synced: syncedCount,
              interrupted: true,
              sourceTotal: allItemsToSync.length,
              syncSummary: currentSyncSummary(),
              records
            };
          }
          conversationStats.failed += 1;
          if (syncNeeds.message) conversationStats.messageFailed += 1;
          if (syncNeeds.jobDetail) jobDetailStats.failed += 1;
          syncedCount += 1;
          const errorMessage = safeJobDetailError(error) || '完整会话同步失败。';
          await appendRequestLog({
            siteKey: 'boss',
            step: 'conversationHistory:error',
            recordKey: bossItemRecordKey(item),
            error: errorMessage
          });
          reportProgress('boss', 'BOSS直聘沟通记录', 'BOSS直聘', syncedCount, totalToSync, {
            inserted: insertedCount,
            updated: updatedMsgCount,
            updatedMsg: updatedMsgCount,
            progressCategories: progressCategories(),
            jobDetailRequired: jobDetailTotal > 0,
            message: `完整会话同步失败，已保留旧记录：${errorMessage}`
          });
          await saveCurrentPartial(false, syncedCount >= totalToSync);
          continue;
        }
      }
      let detail = null;
      try { detail = await fetchBossData(item); } catch (_) { detail = null; }
      const baseRecord = {
        ...bossListItemToRecord(item, detail, existingIndex >= 0 ? existingIndex : records.length, existingRecord, ownerUserId),
        ...(conversation ? { conversation } : {})
      };
      const needsJobDetail = !globalThis.JobChatJobSync.isCompleteJobInfo(baseRecord);
      let nextRecord = baseRecord;
      if (jobDetailStats.stoppedByRiskControl) {
        jobDetailStats.skipped += 1;
        nextRecord = { ...baseRecord, jobInfo: jobDetailStoppedInfo(existingRecord) };
      } else {
        const jobResult = await jobDetailSession.syncRecord(baseRecord, { item, detail }, {
          adapter: globalThis.JobChatSiteAdapters.get('boss'),
          policy: 'missing-only',
          shouldStop: isCancelRequested,
          onCompanyProfile: persistCompanyProfile
        });
        if (jobResult.reloadRequired) {
          return {
            pageTitle: document.title || '',
            pageUrl: location.href,
            extractedAt: new Date().toISOString(),
            total: records.length,
            synced: syncedCount,
            interrupted: false,
            sourceTotal: allItemsToSync.length,
            periodicReloadRequired: true,
            syncSummary: currentSyncSummary(),
            records
          };
        }
        if (needsJobDetail && jobResult.requested) jobDetailStats.requested += 1;
        nextRecord = jobResult.record;
        if (jobResult.riskControl) {
          const activeRetryCount = Number(options.riskRetryAttempts?.[baseRecord.recordKey] || options.riskRetryAttempt || 0);
          const retryOptions = bossJobRetryOptions(options);
          if (options.allowRiskReload !== false && activeRetryCount < retryOptions.retryCount) {
            jobDetailStats.riskPauses += 1;
            const retryNumber = activeRetryCount + 1;
            await appendRequestLog({ siteKey: 'boss', step: 'jobDetail:riskReload', attempt: retryNumber, recordKey: bossItemRecordKey(item) });
            await saveCurrentPartial(true, false);
            return {
              pageTitle: document.title || '',
              pageUrl: location.href,
              extractedAt: new Date().toISOString(),
              total: records.length,
              synced: syncedCount,
              interrupted: true,
              sourceTotal: allItemsToSync.length,
              reloadRequired: true,
              retryRecordKey: baseRecord.recordKey || bossItemRecordKey(item),
              syncSummary: currentSyncSummary(),
              records
            };
          }
          jobDetailStats.stoppedByRiskControl = true;
        }
        if (needsJobDetail) {
          if (nextRecord.jobInfo?.fetchStatus === 'success') jobDetailStats.success += 1;
          else jobDetailStats.failed += 1;
        }
      }
      if (existingIndex >= 0) {
        records[existingIndex] = nextRecord;
      } else {
        records.push(nextRecord);
      }
      syncedCount += 1;
      if (!isUpdate) insertedCount += 1;
      else if (syncNeeds.message) updatedMsgCount += 1;
      reportProgress('boss', 'BOSS直聘沟通记录', 'BOSS直聘', syncedCount, totalToSync, {
        inserted: insertedCount,
        updated: updatedMsgCount,
        updatedMsg: updatedMsgCount,
        progressCategories: progressCategories(),
        jobDetailRequired: jobDetailTotal > 0,
        message: bossSyncMessage(syncedCount, totalToSync, insertedCount, updatedMsgCount)
      });
      await saveCurrentPartial(false, syncedCount >= totalToSync);
      if (jobDetailStats.stoppedByRiskControl) {
        await saveCurrentPartial(true, false);
        return {
          pageTitle: document.title || '',
          pageUrl: location.href,
          extractedAt: new Date().toISOString(),
          total: records.length,
          synced: syncedCount,
          interrupted: true,
          sourceTotal: allItemsToSync.length,
          syncSummary: currentSyncSummary(),
          records
        };
      }
    }

    return {
      pageTitle: document.title || '',
      pageUrl: location.href,
      extractedAt: new Date().toISOString(),
      total: records.length,
      synced: syncedCount,
      interrupted: false,
      sourceTotal: allItemsToSync.length,
      syncSummary: currentSyncSummary(),
      periodicReloadRequired: false,
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
    const messageSyncCount = itemsToSync.filter((item) => bossItemSyncNeeds(item, savedMap, pendingMap).message).length;
    const jobDetailSyncCount = itemsToSync.filter((item) => bossItemSyncNeeds(item, savedMap, pendingMap).jobDetail).length;
    await appendRequestLog({ siteKey: 'boss', step: 'prepare:summary', listCount: list.length, savedCount: savedRecords.length, pendingCount: pendingRecords.length, ignoredCount: ignored.length, needSync: itemsToSync.length, insertedCount: itemsToSync.filter((item) => !findBossRecordByItem(pendingMap, item) && !findBossRecordByItem(savedMap, item)).length });
    const insertedCount = itemsToSync.filter((item) => !findBossRecordByItem(pendingMap, item) && !findBossRecordByItem(savedMap, item)).length;
    const updatedMsgCount = itemsToSync.filter((item) => {
      const existingRecord = findBossRecordByItem(pendingMap, item) || findBossRecordByItem(savedMap, item);
      return Boolean(existingRecord) && bossItemSyncNeeds(item, savedMap, pendingMap).message;
    }).length;
    return {
      list: itemsToSync,
      needSync: itemsToSync.length,
      syncSummary: {
        ...bossSyncSummary(insertedCount, updatedMsgCount),
        messageSync: messageSyncCount,
        jobDetailSync: jobDetailSyncCount
      }
    };
  }

  async function refreshBossRecords(records, options = {}) {
    const targets = (Array.isArray(records) ? records : []).map((record) => {
      const oldBoss = record?.boss || {};
      const boss = {
        ...oldBoss,
        chatSecurityId: normalizeText(oldBoss.chatSecurityId || oldBoss.securityId)
      };
      delete boss.securityId;
      return { ...record, boss };
    });
    if (!targets.length) return { records: [], results: [] };
    const beforeRequest = createBossRequestPacer(options.rate, options.shouldStop, options.signal);
    const lookupTargets = targets;
    let selectedLabels = [];
    if (lookupTargets.length) {
      try {
        const labelList = await fetchBossLabelFriendList(options.onLog, beforeRequest);
        selectedLabels = labelList.filter((item) => lookupTargets.some((record) => bossContactMatchesItem(record, item)));
        options.onLog?.({
          step: 'refresh:contactLookup',
          message: `重新校验 ${lookupTargets.length} 条目标的联系人关系 ID，从当前联系人列表精确匹配到 ${selectedLabels.length} 条`
        });
      } catch (error) {
        options.onLog?.({ step: 'refresh:contactLookup', message: `重新拉取联系人列表失败：${error?.message || String(error)}` });
        throw error;
      }
    }
    const expiredRecordKeys = new Set(targets
      .filter((record) => !findBossItemForRefresh(record, selectedLabels))
      .map((record) => String(record.recordKey || '')));
    const selectedFriendIds = bossFriendIdsFromLabelList(selectedLabels);
    options.onLog?.({ step: 'refresh:selectedTargets', message: `按已保存记录顺序更新 ${targets.length} 条目标，仅请求 ${selectedFriendIds.length} 个联系人关系 ID 的详情` });
    let detailList = [];
    try {
      detailList = selectedFriendIds.length ? await fetchBossFriendDetailList(selectedFriendIds, options.onLog, beforeRequest, options.signal) : [];
    } catch (error) {
      if (isBossRefreshStopped(error, options.signal)) {
        targets.forEach((record) => options.onProgress?.({ recordKey: record.recordKey, status: '已停止', completed: 0, total: targets.length }));
        return { records: [], results: [], stopped: true, jobDetail: createJobDetailSyncStats() };
      }
      throw error;
    }
    const list = mergeBossFriendDetailList(selectedLabels, detailList);
    let ownerUserId = '';
    if (expiredRecordKeys.size < targets.length) {
      try {
        ownerUserId = await fetchBossOwnerUserId(options.onLog, beforeRequest, options.signal);
      } catch (error) {
        if (isBossRefreshStopped(error, options.signal)) {
          targets.forEach((record) => options.onProgress?.({ recordKey: record.recordKey, status: '已停止', completed: 0, total: targets.length }));
          return { records: [], results: [], stopped: true, jobDetail: createJobDetailSyncStats() };
        }
        throw error;
      }
    }
    const orderedTargets = [...targets];
    const updated = [];
    const results = [];
    const jobDetailStats = createJobDetailSyncStats();
    const conversationStats = createConversationSyncStats();
    const retryOptions = bossJobRetryOptions(options);
    const jobDetailSession = new globalThis.JobChatJobSync.JobDetailSyncSession({
      requestIntervalMs: 2000,
      maxRequestsPerPage: 4
    });
    const notify = (progress) => { try { options.onProgress?.(progress); } catch (_) {} };
    const completeAsExpired = (record, index) => {
      const message = '最近沟通时间超过30天，无法获取详情';
      const nextRecord = bossExpiredJobRecord(record);
      updated.push(nextRecord);
      jobDetailStats.success += 1;
      results.push({ recordKey: record.recordKey, ok: true, jobInfoStatus: 'success', error: message });
      notify({ recordKey: record.recordKey, status: '成功', error: message, completed: index + 1, total: orderedTargets.length, record: nextRecord });
      options.onLog?.({ step: 'refresh:expired', message: `${record.recordKey}：${message}` });
      return nextRecord;
    };
    for (let index = 0; index < orderedTargets.length; index += 1) {
      if (await options.shouldStop?.()) break;
      const record = orderedTargets[index];
      const activeRetryCount = Number(options.riskRetryAttempts?.[record.recordKey] || options.riskRetryAttempt || 0);
      notify({
        recordKey: record.recordKey,
        status: activeRetryCount ? '重试中' : '同步中',
        error: activeRetryCount ? `正在执行第 ${activeRetryCount}/${retryOptions.retryCount} 次重试。` : '',
        completed: index,
        total: orderedTargets.length
      });
      if (expiredRecordKeys.has(String(record.recordKey || ''))) {
        completeAsExpired(record, index);
        continue;
      }
      const item = findBossItemForRefresh(record, list);
      if (!item) {
        jobDetailStats.failed += 1;
        results.push({ recordKey: record.recordKey, ok: false, error: '目标无法在当前联系人列表中精确匹配。' });
        notify({ recordKey: record.recordKey, status: '失败', error: '目标无法在当前联系人列表中精确匹配。', completed: index + 1, total: orderedTargets.length });
        continue;
      }
      let conversation = record?.conversation;
      let conversationSkipped = false;
      if (bossConversationIsCurrent(record, item)) {
        conversationStats.skipped += 1;
        conversationSkipped = true;
      } else {
        conversationStats.requested += 1;
        try {
          conversation = await fetchBossConversation(item, ownerUserId, {
            beforeRequest,
            shouldStop: options.shouldStop,
            signal: options.signal,
            onLog: options.onLog
          });
          conversationStats.success += 1;
        } catch (error) {
          if (isBossRefreshStopped(error, options.signal)) break;
          conversationStats.failed += 1;
          jobDetailStats.failed += 1;
          const errorMessage = safeJobDetailError(error) || '完整会话同步失败。';
          results.push({ recordKey: record.recordKey, ok: false, error: errorMessage });
          notify({
            recordKey: record.recordKey,
            status: '失败',
            error: errorMessage,
            completed: index + 1,
            total: orderedTargets.length
          });
          options.onLog?.({ step: 'conversationHistory:error', message: `${record.recordKey}：${errorMessage}` });
          continue;
        }
      }
      const recordWithConversation = conversation ? { ...record, conversation } : record;
      const needsJobDetail = Boolean(
        options.forceJobDetail
        || !globalThis.JobChatJobSync.isCompleteJobInfo(record)
      );
      if (!needsJobDetail) {
        jobDetailStats.skipped += 1;
        const nextRecord = {
          ...bossListItemToRecord(item, null, index, recordWithConversation, ownerUserId),
          ...(conversation ? { conversation } : {})
        };
        updated.push(nextRecord);
        results.push({
          recordKey: record.recordKey,
          ok: true,
          skipped: conversationSkipped,
          jobInfoStatus: nextRecord.jobInfo?.fetchStatus,
          error: ''
        });
        notify({
          recordKey: record.recordKey,
          status: conversationSkipped ? '跳过' : '成功',
          error: '',
          completed: index + 1,
          total: orderedTargets.length,
          record: nextRecord
        });
        continue;
      }
      const recordJobId = bossRecordJobId(record);
      const itemJobId = bossItemJobId(item);
      if (recordJobId && itemJobId && recordJobId !== itemJobId) {
        completeAsExpired(recordWithConversation, index);
        continue;
      }
      let detail = null;
      try { detail = await fetchBossData(item, options.onLog, beforeRequest, options.signal); } catch (error) {
        if (isBossRefreshStopped(error, options.signal)) break;
        const errorMessage = safeJobDetailError(error) || '获取 BOSS 数据失败。';
        const contactRecord = bossListItemToRecord(
          item,
          null,
          index,
          recordWithConversation,
          ownerUserId
        );
        updated.push(contactRecord);
        jobDetailStats.failed += 1;
        results.push({ recordKey: record.recordKey, ok: false, error: errorMessage });
        notify({ recordKey: record.recordKey, status: '失败', error: errorMessage, completed: index + 1, total: orderedTargets.length, record: contactRecord });
        continue;
      }
      const detailJobId = bossDetailJobId(detail);
      if (recordJobId && detailJobId && recordJobId !== detailJobId) {
        completeAsExpired(recordWithConversation, index);
        continue;
      }
      const baseRecord = {
        ...bossListItemToRecord(item, detail, index, record, ownerUserId),
        ...(conversation ? { conversation } : {})
      };
      let nextRecord = baseRecord;
      let jobDetailSkipped = false;
      if (jobDetailStats.stoppedByRiskControl) {
        jobDetailStats.skipped += 1;
        jobDetailSkipped = true;
        nextRecord = { ...baseRecord, jobInfo: jobDetailStoppedInfo(record) };
      } else {
        const jobResult = await jobDetailSession.syncRecord(baseRecord, { item, detail }, {
          adapter: globalThis.JobChatSiteAdapters.get('boss'),
          policy: options.forceJobDetail ? 'force' : 'missing',
          shouldStop: options.shouldStop,
          signal: options.signal,
          onLog: options.onLog,
          onCompanyProfile: persistCompanyProfile
        });
        if (jobResult.stopped || await options.shouldStop?.()) break;
        if (jobResult.reloadRequired) {
          return {
            records: updated,
            results,
            stopped: false,
            paused: false,
            periodicReloadRequired: true,
            retryRecordKey: record.recordKey,
            jobDetail: jobDetailStats,
            conversation: conversationStats
          };
        }
        if (jobResult.requested) jobDetailStats.requested += 1;
        nextRecord = jobResult.record;
        if (jobResult.riskControl) {
          if (options.allowRiskReload !== false && activeRetryCount < retryOptions.retryCount) {
            const retryNumber = activeRetryCount + 1;
            jobDetailStats.riskPauses += 1;
            const message = `触发岗位详情安全验证，将刷新 BOSS 标签页后重试（第 ${retryNumber} 次）。`;
            options.onLog?.({ step: 'jobDetail:riskPause', message });
            notify({
              recordKey: record.recordKey,
              status: '重试中',
              error: `接口返回 code=37，正在刷新 BOSS 标签页。`,
              completed: index,
              total: orderedTargets.length
            });
            return {
              records: updated,
              results,
              stopped: false,
              paused: false,
              reloadRequired: true,
              retryRecordKey: record.recordKey,
              jobDetail: jobDetailStats,
              conversation: conversationStats
            };
          }
          jobDetailStats.stoppedByRiskControl = true;
        }
        if (jobResult.skipped) jobDetailStats.skipped += 1;
        else if (nextRecord.jobInfo?.fetchStatus === 'success') jobDetailStats.success += 1;
        else jobDetailStats.failed += 1;
      }
      updated.push(nextRecord);
      const ok = nextRecord.jobInfo?.fetchStatus === 'success';
      const error = nextRecord.jobInfo?.errorMessage || '';
      results.push({
        recordKey: record.recordKey,
        ok,
        skipped: jobDetailSkipped,
        jobInfoStatus: nextRecord.jobInfo?.fetchStatus,
        error
      });
      notify({ recordKey: record.recordKey, status: jobDetailSkipped ? '已停止' : (ok ? '成功' : '失败'), error, completed: index + 1, total: orderedTargets.length, record: nextRecord });
    }
    const stopped = Boolean(options.signal?.aborted || await options.shouldStop?.());
    const paused = !stopped && jobDetailStats.stoppedByRiskControl;
    return {
      records: updated,
      results,
      stopped,
      paused,
      jobDetail: jobDetailStats,
      conversation: conversationStats
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
        const preparedTarget = {
          ...target,
          boss: {
            ...(target?.boss || {}),
            ownerUserId,
            friendId,
            relationFriendId: bossRelationFriendIdOfItem(item) || target?.boss?.relationFriendId || '',
            peerKey,
            chatSecurityId,
            friendSource: item.friendSource ?? item.sourceType ?? '',
            bossId: data.bossId || item.uid || item.bossId || target?.boss?.bossId || '',
            encryptBossId: data.encryptBossId || item.encryptBossId || item.encryptUid || peerKey,
            jobId: item.jobId || target?.boss?.jobId || ''
          }
        };
        delete preparedTarget.boss.bossSecurityId;
        delete preparedTarget.boss.bossJobSecurityId;
        delete preparedTarget.boss.uploadSecurityId;
        delete preparedTarget.boss.encryptJobId;
        delete preparedTarget.bossJobSecurityId;
        return preparedTarget;
      }));
    } finally {
      reportBossSendLog('发送目标刷新完成。');
      bossSendPreparationActive = false;
    }
  }

  globalThis.JobChatBossExtractor = {
    extract: extractBossChatRecords,
    prepare: prepareBossSync,
    prepareSendTargets: prepareBossSendTargets,
    refreshRecords: refreshBossRecords,
    normalizeJobResponse: normalizeBossJobResponse
  };
  globalThis.JobChatSiteAdapters?.register('boss', {
    siteKey: 'boss', supportsJobDetail: true, requiresDetailAccessToken: true, prepareSync: prepareBossSync,
    extractRecords: extractBossChatRecords, refreshRecords: refreshBossRecords,
    resolveJobAccess: resolveBossJobAccess,
    fetchJobDetail: fetchBossJobDetail,
    normalizeJobResponse: normalizeBossJobResponse,
    isRiskControlError: isBossJobRiskControlError
  });
})();
