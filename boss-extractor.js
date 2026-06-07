(function () {
  const { normalizeText, formatDate, extractJobName, htmlDecode, getCookieValue, sleep } = globalThis.JobChatUtils;
  const {
    filterBossRecentList,
    getSyncDelayMs,
    reportProgress,
    isCancelRequested,
    savePartial,
    readIgnoredRecords
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
    return normalizedBossId || normalizedJobId || '';
  }

  function bossItemRecordKey(item) {
    return bossRecordKeyParts(bossIdOfItem(item), item?.jobId);
  }

  function bossRecordRecordKey(record) {
    return bossRecordKeyParts(record?.boss?.encryptBossId || record?.boss?.bossId, record?.boss?.jobId);
  }

  function bossFriendKey(item) {
    return bossItemRecordKey(item) || bossIdOfItem(item) || item?.uid || item?.jobId || item?.lastMessageInfo?.msgId || item?.encryptFriendId || item?.friendId || '';
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
    if (primaryKey) {
      addBossKeyVariants(keys, primaryKey);
      return;
    }
    [
      record?.boss?.contactKey,
      record?.boss?.encryptBossId,
      record?.boss?.bossId,
      record?.recordKey
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
    if (primaryKey) {
      addBossKeyVariants(keys, primaryKey);
      return [...keys];
    }
    [
      item?.encryptBossId,
      item?.encryptUid,
      item?.uid,
      item?.jobId,
      item?.lastMessageInfo?.msgId,
      item?.encryptFriendId,
      item?.friendId
    ].forEach((key) => addBossKeyVariants(keys, key));
    return [...keys];
  }

  function bossLastMsgIdFromRecord(record) {
    return normalizeText(record?.boss?.lastMsgId || record?.boss?.lastMessageInfo?.msgId);
  }

  function bossLastMsgIdFromItem(item) {
    return normalizeText(item?.lastMessageInfo?.msgId);
  }

  function findBossRecordByItem(map, item) {
    return bossItemKeys(item).map((key) => map.get(key)).find(Boolean) || null;
  }

  function shouldSyncBossItem(item, savedMap, pendingMap) {
    if (findBossRecordByItem(pendingMap, item)) return false;
    const saved = findBossRecordByItem(savedMap, item);
    if (!saved) return true;
    const oldMsgId = bossLastMsgIdFromRecord(saved);
    const newMsgId = bossLastMsgIdFromItem(item);
    return Boolean(oldMsgId && newMsgId && oldMsgId !== newMsgId);
  }

  async function readExistingBossPending() {
    try {
      const store = await chrome.storage.local.get(['jobChatPendingRecords', 'jobChatRecords']);
      const pending = store.jobChatPendingRecords;
      const pendingRecords = pending?.siteKey === 'boss' && Array.isArray(pending.records) ? pending.records : [];
      const savedRecords = Array.isArray(store.jobChatRecords) ? store.jobChatRecords.filter((record) => record?.siteKey === 'boss' || record?.sourceName === 'BOSS直聘') : [];
      return [...savedRecords, ...pendingRecords];
    } catch (_) {
      return [];
    }
  }

  function parseBossFriendListResult(data) {
    return data?.zpData?.friendList || data?.zpData?.result || data?.result || [];
  }

  async function fetchBossLabelFriendList() {
    const url = new URL('https://www.zhipin.com/wapi/zprelation/friend/geekFilterByLabel');
    url.searchParams.set('labelId', '0');
    const response = await fetch(url.toString(), {
      method: 'GET',
      credentials: 'include',
      headers: bossHeaders()
    });
    if (!response.ok) throw new Error(`BOSS直聘列表接口请求失败：HTTP ${response.status}`);
    const data = await response.json();
    if (data?.code !== 0) throw new Error(`BOSS直聘列表接口返回异常：${JSON.stringify(data).slice(0, 300)}`);
    return filterBossRecentList(parseBossFriendListResult(data));
  }

  function bossFriendIdsFromLabelList(list) {
    if (!Array.isArray(list)) return [];
    const ids = [];
    const seen = new Set();
    list.forEach((item) => {
      const id = normalizeText(item?.friendId);
      if (!id || seen.has(id)) return;
      seen.add(id);
      ids.push(id);
    });
    return ids;
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

  async function fetchBossFriendDetailList(friendIds) {
    const body = new URLSearchParams({ friendIds: friendIds.join(',') }).toString();
    const response = await fetch('https://www.zhipin.com/wapi/zprelation/friend/getGeekFriendList.json', {
      method: 'POST',
      credentials: 'include',
      headers: bossHeaders('application/x-www-form-urlencoded'),
      body
    });
    if (!response.ok) throw new Error(`BOSS直聘岗位列表接口请求失败：HTTP ${response.status}`);
    const data = await response.json();
    if (data?.code !== 0) throw new Error(`BOSS直聘岗位列表接口返回异常：${JSON.stringify(data).slice(0, 300)}`);
    return parseBossFriendListResult(data);
  }

  async function fetchBossFriendList() {
    const labelList = await fetchBossLabelFriendList();
    const friendIds = bossFriendIdsFromLabelList(labelList);
    if (!friendIds.length) return [];
    const detailList = await fetchBossFriendDetailList(friendIds);
    return filterBossRecentList(mergeBossFriendDetailList(labelList, detailList));
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

  function bossListItemToRecord(item, detail, index) {
    const data = detail?.data || {};
    const job = detail?.job || {};
    const lastMessage = htmlDecode(item.lastMessageInfo?.showText || item.lastMsg || '');
    const fallbackJobName = htmlDecode(extractJobName(lastMessage));
    const jobName = bossJobText(job.jobName || item.jobName || fallbackJobName, job.salaryDesc || '');
    const companyName = htmlDecode(data.companyName || job.brandName || item.brandName || '');
    const ts = Number(item.lastMessageInfo?.msgTime || item.updateTime || item.lastTS || Date.now());
    return {
      index: index + 1,
      time: formatDate(new Date(ts)),
      recruiterName: htmlDecode(data.name || item.name || ''),
      companyName,
      recruiterTitle: htmlDecode(data.title || item.title || item.bossTitle || ''),
      jobName,
      lastMessage,
      boss: {
        friendId: item.friendId || '',
        friendSource: item.friendSource ?? '',
        encryptFriendId: item.encryptFriendId || '',
        bossId: data.bossId || item.uid || '',
        encryptBossId: data.encryptBossId || item.encryptBossId || item.encryptUid || '',
        securityId: data.securityId || item.securityId || '',
        jobId: item.jobId || '',
        encryptJobId: data.encryptJobId || item.encryptJobId || '',
        lastMsgId: item.lastMessageInfo?.msgId || '',
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
    const totalToSync = records.length + itemsToSync.length;

    reportProgress('boss', 'BOSS直聘沟通记录', 'BOSS直聘', records.length, totalToSync);
    await savePartial('boss', 'BOSS直聘沟通记录', 'BOSS直聘', records, records.length, totalToSync, false, records.length >= totalToSync);

    for (let i = 0; i < itemsToSync.length; i += 1) {
      const item = itemsToSync[i];
      if (await isCancelRequested()) {
        await savePartial('boss', 'BOSS直聘沟通记录', 'BOSS直聘', records, records.length, totalToSync, true, false);
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
      let detail = null;
      try { detail = await fetchBossData(item); } catch (_) { detail = null; }
      records.push(bossListItemToRecord(item, detail, records.length));
      reportProgress('boss', 'BOSS直聘沟通记录', 'BOSS直聘', records.length, totalToSync);
      await savePartial('boss', 'BOSS直聘沟通记录', 'BOSS直聘', records, records.length, totalToSync, false, records.length >= totalToSync);
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

  async function prepareBossSync() {
    const list = await fetchBossFriendList();
    if (!Array.isArray(list) || !list.length) throw new Error('没有捕获到 BOSS直聘最近 3 个月的聊天记录。请刷新 BOSS 页面后再点击同步。');
    const existing = await readExistingBossPending();
    const ignored = (await readIgnoredRecords()).filter((record) => record?.siteKey === 'boss' || record?.sourceName === 'BOSS直聘');
    const existingMap = new Map();
    existing.forEach((record) => addBossRecordToMap(existingMap, record));
    const ignoredMap = new Map();
    ignored.forEach((record) => addBossRecordToMap(ignoredMap, record));
    const needSync = list.filter((item) => !findBossRecordByItem(ignoredMap, item) && shouldSyncBossItem(item, existingMap, new Map())).length;
    return { list, needSync };
  }

  globalThis.JobChatBossExtractor = {
    extract: extractBossChatRecords,
    prepare: prepareBossSync
  };
})();
