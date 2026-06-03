(() => {
  if (location.hostname.endsWith('zhipin.com')) {
    try {
      const injectHook = () => {
        const hook = document.createElement('script');
        hook.src = chrome.runtime.getURL('boss-hook.js');
        hook.onload = () => hook.remove();
        (document.documentElement || document.head).appendChild(hook);
      };
      if (document.documentElement || document.head) injectHook();
      else document.addEventListener('DOMContentLoaded', injectHook, { once: true });
    } catch (_) {}

    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (event.data?.source !== 'job-chat-recorder-boss-hook') return;
      const payload = event.data.payload || {};
      if (payload.type === 'BOSS_GEEK_FRIEND_LIST') {
        chrome.storage.local.set({ jobChatBossFriendListCapture: payload });
      }
    });
  }

  const normalizeText = (text) => String(text || '').replace(/\s+/g, ' ').trim();

  function extractJobName(message) {
    const text = normalizeText(message);
    const patterns = [
      /我对\s*(.*?)\s*很感兴趣/,
      /我对\s*(.*?)\s*感兴趣/,
      /对\s*(.*?)\s*很感兴趣/
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) return normalizeText(match[1]);
    }
    return '';
  }

  function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function threeMonthsAgo() {
    const date = new Date();
    date.setMonth(date.getMonth() - 3);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function isWithinLastThreeMonthsTimestamp(ts) {
    if (!ts) return false;
    const date = new Date(Number(ts));
    if (Number.isNaN(date.getTime())) return false;
    return date >= threeMonthsAgo();
  }

  function filterBossRecentList(list) {
    if (!Array.isArray(list)) return [];
    return list.filter((item) => isWithinLastThreeMonthsTimestamp(item?.updateTime || item?.lastMessageInfo?.msgTime || item?.lastTS));
  }

  function filterLiepinRecentContacts(list) {
    if (!Array.isArray(list)) return [];
    return list.filter((item) => isWithinLastThreeMonthsTimestamp(item?.latestMsgTime));
  }

  function isTodayTimestamp(ts) {
    if (!ts) return false;
    const date = new Date(Number(ts));
    if (Number.isNaN(date.getTime())) return false;
    return formatDate(date) === formatDate(new Date());
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function getSyncDelayMs() {
    try {
      const store = await chrome.storage.local.get(['jobChatSyncRateLimit']);
      const rate = Math.max(1, Math.min(10, Number(store.jobChatSyncRateLimit || 2)));
      return Math.ceil(1000 / rate);
    } catch (_) {
      return 500;
    }
  }

  function reportProgress(siteKey, siteTitle, sourceName, synced, total) {
    try {
      chrome.runtime.sendMessage({
        type: 'JOB_CHAT_EXTRACTION_PROGRESS',
        progress: {
          siteKey,
          siteTitle,
          sourceName,
          synced,
          total,
          message: `正在提取${sourceName}沟通记录... 已同步 ${synced} / ${total} 条`
        }
      });
    } catch (_) {}
  }

  async function isCancelRequested() {
    try {
      const store = await chrome.storage.local.get(['jobChatCancelRequested', 'jobChatLiepinCancelRequested']);
      return Boolean(store.jobChatCancelRequested || store.jobChatLiepinCancelRequested);
    } catch (_) {
      return false;
    }
  }

  async function savePartial(siteKey, siteTitle, sourceName, records, synced, total, interrupted, completed) {
    try {
      await chrome.runtime.sendMessage({
        type: 'JOB_CHAT_PARTIAL_RESULTS',
        data: {
          siteKey,
          siteTitle,
          sourceName,
          pageTitle: document.title || '',
          pageUrl: location.href,
          extractedAt: new Date().toISOString(),
          synced,
          total,
          interrupted: Boolean(interrupted),
          completed: Boolean(completed),
          records
        }
      });
    } catch (_) {}
  }


  function reportLiepinProgress(synced, total) {
    try {
      chrome.runtime.sendMessage({
        type: 'JOB_CHAT_EXTRACTION_PROGRESS',
        progress: {
          siteKey: 'liepin',
          siteTitle: '猎聘沟通记录',
          sourceName: '猎聘',
          synced,
          total,
          message: `正在提取猎聘沟通记录... 已同步 ${synced} / ${total} 条`
        }
      });
    } catch (_) {}
  }


  async function isLiepinCancelRequested() {
    return isCancelRequested();
  }

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
    try {
      await chrome.runtime.sendMessage({
        type: 'JOB_CHAT_LIEPIN_PARTIAL_RESULTS',
        data: {
          pageTitle: document.title || '',
          pageUrl: location.href,
          extractedAt: new Date().toISOString(),
          synced,
          total,
          interrupted: Boolean(interrupted),
          completed: Boolean(completed),
          records
        }
      });
    } catch (_) {}
  }

  function htmlDecode(text) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = String(text || '');
    return normalizeText(textarea.value || text || '');
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

    return {
      index: index + 1,
      time,
      recruiterName,
      companyName,
      recruiterTitle,
      jobName,
      lastMessage
    };
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
    // 点击同步时始终重新请求 BOSS 联系人标签列表，
    // 不读取 prepare 阶段写入的 jobChatPreparedSourceList，避免使用旧列表。
    let list = await fetchBossFriendList();

    if (!Array.isArray(list) || !list.length) {
      const domData = extractBossDomChatRecords();
      if (domData.records.length) {
        throw new Error('没有获取到 BOSS直聘最近 3 个月的聊天列表。请刷新 BOSS 消息页，等左侧聊天列表加载完成后再点击同步。');
      }
      throw new Error('没有获取到 BOSS直聘聊天列表。请确认已登录并打开消息页，然后刷新页面重试。');
    }

    const store = await chrome.storage.local.get(['jobChatPendingRecords', 'jobChatRecords']);
    const pending = store.jobChatPendingRecords;
    const pendingRecords = pending?.siteKey === 'boss' && Array.isArray(pending.records) ? pending.records : [];
    const savedRecords = Array.isArray(store.jobChatRecords) ? store.jobChatRecords.filter((record) => record?.siteKey === 'boss' || record?.sourceName === 'BOSS直聘') : [];

    const savedMap = new Map();
    savedRecords.forEach((record) => {
      addBossRecordToMap(savedMap, record);
    });

    const pendingMap = new Map();
    pendingRecords.forEach((record) => {
      addBossRecordToMap(pendingMap, record);
    });

    const records = [...pendingRecords];
    const itemsToSync = list.filter((item) => {
      return shouldSyncBossItem(item, savedMap, pendingMap);
    });
    const totalToSync = records.length + itemsToSync.length;

    reportProgress('boss', 'BOSS直聘沟通记录', 'BOSS直聘', records.length, totalToSync);
    await savePartial('boss', 'BOSS直聘沟通记录', 'BOSS直聘', records, records.length, totalToSync, false, records.length >= totalToSync);

    for (let i = 0; i < itemsToSync.length; i += 1) {
      const item = itemsToSync[i];
      const key = String(bossFriendKey(item));

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
      try {
        detail = await fetchBossData(item);
      } catch (_) {
        detail = null;
      }
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

  function getCookieValue(name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : '';
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

    if (!response.ok) {
      throw new Error(`猎聘接口请求失败：HTTP ${response.status}`);
    }

    const data = await response.json();
    if (data?.flag !== 1) {
      throw new Error(`猎聘接口返回异常：${JSON.stringify(data).slice(0, 300)}`);
    }
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
    // 只拉取第一页，每页 100 条，避免分页循环导致频繁请求触发风控。
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
    const data = await postLiepinApi('com.liepin.im.c.chat.job-preview', {
      imUserType: '0',
      imId,
      imApp: '1',
      oppositeImId
    });
    return data || {};
  }

  async function extractLiepinChatRecords() {
    const imId = getLiepinImId();
    if (!imId) {
      throw new Error('没有在当前猎聘页面 Cookie / 缓存中找到 imId_0。请确认已登录猎聘，并刷新页面后重试。');
    }

    // 点击同步时始终重新请求猎聘联系人列表，
    // 不读取 prepare 阶段写入的 jobChatPreparedSourceList，避免使用旧列表。
    const contacts = filterLiepinRecentContacts(await fetchLiepinContacts(imId));
    const store = await chrome.storage.local.get(['jobChatPendingRecords', 'jobChatRecords']);
    const pending = store.jobChatPendingRecords;
    const pendingRecords = pending?.siteKey === 'liepin' && Array.isArray(pending.records) ? pending.records : [];
    const savedRecords = Array.isArray(store.jobChatRecords) ? store.jobChatRecords.filter((record) => record?.siteKey === 'liepin' || record?.sourceName === '猎聘') : [];

    const savedKeys = new Set();
    savedRecords.forEach((record) => {
      addLiepinRecordKeys(savedKeys, record);
    });

    const pendingKeys = new Set();
    pendingRecords.forEach((record) => {
      addLiepinRecordKeys(pendingKeys, record);
    });

    const records = [...pendingRecords];
    const contactsToSync = contacts.filter((item) => {
      const keys = liepinItemKeys(item);
      return !keys.some((key) => savedKeys.has(key) || pendingKeys.has(key));
    });
    const totalToSync = records.length + contactsToSync.length;

    reportLiepinProgress(records.length, totalToSync);
    await saveLiepinPartial(records, records.length, totalToSync, false, records.length >= totalToSync);

    for (let i = 0; i < contactsToSync.length; i += 1) {
      const item = contactsToSync[i];
      const key = liepinContactKey(item);

      if (await isLiepinCancelRequested()) {
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
      try {
        preview = await fetchLiepinJobPreview(item.imId || imId, item.oppositeImId);
      } catch (_) {
        preview = {};
      }

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
      reportLiepinProgress(records.length, totalToSync);
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

  function isBossChatPage() {
    return location.hostname === 'www.zhipin.com' && location.pathname === '/web/geek/chat';
  }

  function detectSiteByLocation() {
    const hostname = location.hostname;
    if (/(^|\.)zhipin\.com$/i.test(hostname)) return 'boss';
    if (/(^|\.)liepin\.com$/i.test(hostname)) return 'liepin';
    return 'unsupported';
  }




  async function writePreparedSourceList(siteKey, list) {
    try {
      await chrome.storage.local.set({
        jobChatPreparedSourceList: {
          siteKey,
          pageUrl: location.href,
          capturedAt: new Date().toISOString(),
          list: Array.isArray(list) ? list : []
        }
      });
    } catch (_) {}
  }

  async function readPreparedSourceList(siteKey) {
    try {
      const store = await chrome.storage.local.get(['jobChatPreparedSourceList']);
      const prepared = store.jobChatPreparedSourceList;
      if (!prepared || prepared.siteKey !== siteKey || !Array.isArray(prepared.list)) return [];
      return prepared.list;
    } catch (_) {
      return [];
    }
  }
  async function prepareByCurrentSite(siteKey) {
    const detected = detectSiteByLocation();
    if (siteKey === 'boss' && detected === 'boss') {
      if (!isBossChatPage()) throw new Error('当前不是 BOSS直聘消息页面。需要跳转到“消息”页面才能提取。');
      const list = await fetchBossFriendList();
      if (!Array.isArray(list) || !list.length) throw new Error('没有捕获到 BOSS直聘最近 3 个月的聊天记录。请刷新 BOSS 消息页，等左侧聊天列表加载完成后再点击同步。');
      await writePreparedSourceList('boss', list);
      const existing = await readExistingBossPending();
      const existingMap = new Map();
      existing.forEach((record) => {
        addBossRecordToMap(existingMap, record);
      });
      const needSync = list.filter((item) => shouldSyncBossItem(item, existingMap, new Map())).length;
      return { pageTitle: document.title || '', pageUrl: location.href, total: 0, sourceTotal: needSync, sourceListTotal: list.length, records: [] };
    }
    if (siteKey === 'liepin' && detected === 'liepin') {
      const imId = getLiepinImId();
      if (!imId) throw new Error('没有在当前猎聘页面 Cookie / 缓存中找到 imId_0。请确认已登录猎聘，并刷新页面后重试。');
      const contacts = filterLiepinRecentContacts(await fetchLiepinContacts(imId));
      await writePreparedSourceList('liepin', contacts);
      const existing = await readExistingLiepinPending();
      const existingKeys = new Set();
      existing.forEach((record) => {
        addLiepinRecordKeys(existingKeys, record);
      });
      const needSync = contacts.filter((item) => {
        const keys = liepinItemKeys(item);
        return !keys.some((key) => existingKeys.has(key));
      }).length;
      return { pageTitle: document.title || '', pageUrl: location.href, total: 0, sourceTotal: needSync, sourceListTotal: contacts.length, records: [] };
    }
    return extractByCurrentSite(siteKey);
  }

  async function extractByCurrentSite(siteKey) {
    const detected = detectSiteByLocation();
    if (siteKey === 'boss' && detected === 'boss') {
      if (!isBossChatPage()) throw new Error('当前不是 BOSS直聘消息页面。需要跳转到“消息”页面才能提取。');
      return extractBossChatRecords();
    }
    if (siteKey === 'liepin' && detected === 'liepin') return extractLiepinChatRecords();
    if (detected === 'boss') {
      if (!isBossChatPage()) throw new Error('当前不是 BOSS直聘消息页面。需要跳转到“消息”页面才能提取。');
      return extractBossChatRecords();
    }
    if (detected === 'liepin') return extractLiepinChatRecords();
    throw new Error('暂不支持当前网站。目前支持 zhipin.com（BOSS直聘）、liepin.com（猎聘）。');
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'JOB_CHAT_PREPARE_SYNC') {
      prepareByCurrentSite(message?.siteKey)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
      return true;
    }
    if (message?.type !== 'JOB_CHAT_EXTRACT_RECORDS' && message?.type !== 'BOSS_EXTRACT_CHAT_RECORDS') return;
    extractByCurrentSite(message?.siteKey)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  });
})();
