(function () {
  const hookVersion = '2026-07-28-page-request-v1';
  if (window.__JOB_CHAT_BOSS_HOOK_VERSION__ === hookVersion) {
    try { window.postMessage({ source: 'job-chat-recorder-boss-hook', payload: { type: 'BOSS_HOOK_READY' } }, '*'); } catch (_) {}
    return;
  }
  window.__JOB_CHAT_BOSS_HOOK_VERSION__ = hookVersion;
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

  let httpToken = '';
  let pcDeviceId = '';
  function tokenFromHeaders(headers) {
    if (!headers) return '';
    if (headers instanceof Headers) return headers.get('token') || '';
    if (Array.isArray(headers)) return (headers.find(([name]) => String(name).toLowerCase() === 'token') || [])[1] || '';
    return headers.token || headers.Token || '';
  }
  function rememberToken(value) {
    const token = safeText(value).replace(/\|0$/, '').trim();
    if (token && token !== httpToken) {
      httpToken = token;
      console.info('[JobChat BOSS send] 已从当前页面捕获认证 token。');
    }
  }

  function randomTraceId() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const values = new Uint8Array(9);
    crypto.getRandomValues(values);
    const suffix = Array.from(values, (value) => alphabet[value % alphabet.length]).join('');
    return `F-${Date.now().toString(16).padStart(13, '0')}${suffix}`;
  }

  function tokenFromAuthFrame(value) {
    try {
      const data = value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : value instanceof Uint8Array
          ? value
          : new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength);
      if (data[0] !== 0x10) return '';
      let offset = 1;
      while (data[offset] & 0x80) offset += 1;
      offset += 1;
      const readU16 = () => { const length = (data[offset] << 8) | data[offset + 1]; offset += 2; return length; };
      const magicLength = readU16(); offset += magicLength + 4;
      const connectionLength = readU16(); offset += connectionLength;
      const tokenLength = readU16();
      if (!Number.isFinite(tokenLength) || offset + tokenLength > data.length) return '';
      return new TextDecoder().decode(data.slice(offset, offset + tokenLength));
    } catch (_) { return ''; }
  }

  function bytesFromBinary(value) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (value instanceof Uint8Array) return value;
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength);
    return null;
  }

  function readWireVarint(data, state) {
    let value = 0n;
    let shift = 0n;
    while (state.offset < data.length && shift < 70n) {
      const byte = data[state.offset++];
      value |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) return value;
      shift += 7n;
    }
    throw new Error('无效 protobuf Varint。');
  }

  function protobufField(data, wantedField, wantedWire) {
    const state = { offset: 0 };
    while (state.offset < data.length) {
      const key = Number(readWireVarint(data, state));
      const fieldNumber = key >>> 3;
      const wireType = key & 7;
      if (wireType === 0) {
        const value = readWireVarint(data, state);
        if (fieldNumber === wantedField && wireType === wantedWire) return value;
      } else if (wireType === 1) {
        if (state.offset + 8 > data.length) throw new Error('无效 fixed64。');
        const value = data.slice(state.offset, state.offset + 8);
        state.offset += 8;
        if (fieldNumber === wantedField && wireType === wantedWire) return value;
      } else if (wireType === 2) {
        const length = Number(readWireVarint(data, state));
        if (length < 0 || state.offset + length > data.length) throw new Error('无效 bytes 字段。');
        const value = data.slice(state.offset, state.offset + length);
        state.offset += length;
        if (fieldNumber === wantedField && wireType === wantedWire) return value;
      } else if (wireType === 5) {
        if (state.offset + 4 > data.length) throw new Error('无效 fixed32。');
        const value = data.slice(state.offset, state.offset + 4);
        state.offset += 4;
        if (fieldNumber === wantedField && wireType === wantedWire) return value;
      } else {
        throw new Error(`不支持的 protobuf wire type：${wireType}`);
      }
    }
    return null;
  }

  function pcDeviceIdFromRegisterFrame(value) {
    try {
      const data = bytesFromBinary(value);
      if (!data || data[0] !== 0x33) return '';
      const frameState = { offset: 1 };
      const payloadLength = Number(readWireVarint(data, frameState));
      const payloadEnd = frameState.offset + payloadLength;
      if (payloadEnd !== data.length || frameState.offset + 8 > payloadEnd) return '';
      const routeLength = (data[frameState.offset] << 8) | data[frameState.offset + 1];
      const messageOffset = frameState.offset + 2 + routeLength + 2;
      if (messageOffset > payloadEnd) return '';
      const root = data.slice(messageOffset, payloadEnd);
      if (protobufField(root, 1, 0) !== 2n) return '';
      const register = protobufField(root, 4, 2);
      const client = register && protobufField(register, 3, 2);
      const device = client && protobufField(client, 5, 2);
      return device?.length ? new TextDecoder().decode(device) : '';
    } catch (_) { return ''; }
  }

  function findPcDeviceId(value, depth = 0) {
    if (depth > 6 || value == null) return '';
    if (typeof value === 'string') {
      const text = value.trim();
      if (!text) return '';
      try {
        const params = new URLSearchParams(text);
        for (const [key, item] of params.entries()) {
          if (/^(?:attrs\[)?pc_device_id\]?$/i.test(key) && item) return item;
        }
      } catch (_) {}
      const match = text.match(/(?:attrs(?:%5B|\[))?pc_device_id(?:%5D|\])?["'=:%\s]+([^&"',}\s]+)/i);
      if (match?.[1]) {
        try { return decodeURIComponent(match[1]); } catch (_) { return match[1]; }
      }
      if ((text.startsWith('{') || text.startsWith('[')) && text.length < 200000) {
        try { return findPcDeviceId(JSON.parse(text), depth + 1); } catch (_) {}
      }
      return '';
    }
    if (typeof FormData !== 'undefined' && value instanceof FormData) {
      for (const [key, item] of value.entries()) {
        if (/^(?:attrs\[)?pc_device_id\]?$/i.test(key) && item) return String(item);
      }
      return '';
    }
    if (typeof URLSearchParams !== 'undefined' && value instanceof URLSearchParams) return findPcDeviceId(value.toString(), depth + 1);
    if (typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (/^pc_device_id$/i.test(key) && item) return String(item);
        const nested = findPcDeviceId(item, depth + 1);
        if (nested) return nested;
      }
    }
    return '';
  }

  function storePcDeviceId(value) {
    const found = safeText(value).trim();
    if (pcDeviceId || !found || found.length > 512) return;
    pcDeviceId = found;
    console.info('[JobChat BOSS send] 已从当前页面捕获 pc_device_id。');
  }

  function rememberPcDeviceId(...values) {
    if (pcDeviceId) return;
    for (const value of values) {
      const found = findPcDeviceId(value);
      if (!found) continue;
      storePcDeviceId(found);
      return;
    }
  }

  function readPcDeviceIdFromPageStorage() {
    if (pcDeviceId) return pcDeviceId;
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        rememberPcDeviceId(key, localStorage.getItem(key));
        if (pcDeviceId) break;
      }
    } catch (_) {}
    return pcDeviceId;
  }

  function isTargetMethod(method, url) {
    if (!isTarget(url)) return false;
    if (url.includes('/wapi/zprelation/friend/geekFilterByLabel')) return method === 'GET';
    if (url.includes('/wapi/zprelation/friend/getGeekFriendList.json')) return true;
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
      rememberToken(tokenFromHeaders(init.headers) || tokenFromHeaders(input?.headers));
      rememberPcDeviceId(url, body);
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
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__jobChatRecorder = { method: String(method || 'GET').toUpperCase(), url: String(url || '') };
    rememberPcDeviceId(url);
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const info = this.__jobChatRecorder || {};
    rememberPcDeviceId(info.url, body);
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
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (String(name).toLowerCase() === 'token') rememberToken(value);
    return originalSetRequestHeader.call(this, name, value);
  };

  // 职位页未必会发出带 token 的 HTTP 请求；页面新建聊天 WebSocket 时，
  // 其 0x10 认证帧包含同一运行时 token。值只保留在页面内存。
  const originalWebSocketSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      rememberToken(tokenFromAuthFrame(data));
      storePcDeviceId(pcDeviceIdFromRegisterFrame(data));
    }
    return originalWebSocketSend.call(this, data);
  };

  let activeBatch = null;
  const activePageRequests = new Map();

  async function ensureHttpToken(signal) {
    if (httpToken) return httpToken;
    try {
      const response = await originalFetch.call(window, '/wapi/zpuser/wap/getUserInfo.json', {
        method: 'GET',
        credentials: 'include',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'X-Requested-With': 'XMLHttpRequest',
          traceId: randomTraceId()
        },
        signal
      });
      const payload = await response.json();
      rememberToken(payload?.zpData?.token);
    } catch (_) {}
    return httpToken;
  }

  async function performPageRequest(command) {
    const parsedUrl = new URL(command.url, location.origin);
    if (parsedUrl.origin !== location.origin) throw new Error('只允许请求当前 BOSS 站点。');
    const allowedPaths = new Set(['/wapi/zpgeek/job/detail.json']);
    if (!allowedPaths.has(parsedUrl.pathname)) throw new Error('不允许的 BOSS 页面请求。');

    const controller = new AbortController();
    activePageRequests.set(command.requestId, controller);
    try {
      const headers = new Headers(command.headers || {});
      headers.set('X-Requested-With', 'XMLHttpRequest');
      headers.set('traceId', randomTraceId());
      const token = await ensureHttpToken(controller.signal);
      if (!token) throw new Error('无法获取 BOSS 页面运行时 token，请刷新页面后重试。');
      headers.set('token', token);
      const requestHeaders = Object.fromEntries(headers.entries());
      const response = await originalFetch.call(window, parsedUrl.toString(), {
        method: String(command.method || 'GET').toUpperCase(),
        credentials: 'include',
        headers,
        body: command.body ?? undefined,
        signal: controller.signal
      });
      const responseText = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        url: response.url,
        requestHeaders,
        responseHeaders: Object.fromEntries(response.headers.entries()),
        responseText
      };
    } finally {
      activePageRequests.delete(command.requestId);
    }
  }

  function sendLog(message) {
    const text = String(message || '');
    console.info('[JobChat BOSS send]', text);
    emit({ type: 'BOSS_SEND_LOG', message: text });
  }
  const sensitiveLogKey = /(?:token|cookie|security|peer|friend|bossid|userid|encrypt|authorization|wt2)/i;
  function redactLogValue(value, key = '') {
    if (sensitiveLogKey.test(key)) return '[已隐藏]';
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactLogValue(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 60).map(([name, item]) => [name, redactLogValue(item, name)]));
    if (typeof value === 'string') return value.length > 1000 ? `${value.slice(0, 1000)}…` : value;
    return value;
  }
  function safeRequestDescription(url) {
    const parsed = new URL(url, location.origin);
    const params = Array.from(parsed.searchParams.entries()).map(([key, value]) => `${key}=${sensitiveLogKey.test(key) ? '[已隐藏]' : value}`).join('&');
    return `${parsed.pathname}${params ? `?${params}` : ''}`;
  }
  function safeRequestBody(body) {
    if (body == null || body === '') return '';
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      return Array.from(body.entries()).map(([key, value]) => `${key}=${sensitiveLogKey.test(key) ? '[已隐藏]' : String(value)}`).join('&');
    }
    const text = body instanceof URLSearchParams ? body.toString() : String(body);
    try {
      const params = new URLSearchParams(text);
      const entries = Array.from(params.entries());
      if (entries.length) return entries.map(([key, value]) => `${key}=${sensitiveLogKey.test(key) ? '[已隐藏]' : value}`).join('&');
    } catch (_) {}
    return text.length > 1000 ? `${text.slice(0, 1000)}…` : text;
  }
  function safeRequestHeaders(headers) {
    if (!headers) return '';
    try {
      const entries = headers instanceof Headers ? Array.from(headers.entries()) : Array.isArray(headers) ? headers : Object.entries(headers);
      return entries.map(([key, value]) => `${key}=${sensitiveLogKey.test(key) ? '[已隐藏]' : String(value)}`).join(';');
    } catch (_) { return ''; }
  }
  async function requestJson(url, init) {
    const method = String(init?.method || 'GET').toUpperCase();
    const endpoint = safeRequestDescription(url);
    const body = safeRequestBody(init?.body);
    const headers = safeRequestHeaders(init?.headers);
    sendLog(`HTTP 请求：${method} ${endpoint}${body ? `；body=${body}` : ''}${headers ? `；headers=${headers}` : ''}`);
    let response;
    try {
      response = await fetch(url, { credentials: 'include', ...(init || {}) });
    } catch (error) {
      sendLog(`HTTP 网络错误：${method} ${endpoint}；${error?.message || String(error)}`);
      throw new Error(`BOSS 请求失败：${method} ${endpoint}；${error?.message || String(error)}`);
    }
    const rawText = await response.text();
    let data;
    try { data = rawText ? JSON.parse(rawText) : {}; } catch (_) { data = { rawText: rawText.slice(0, 1000) }; }
    sendLog(`HTTP 响应：${method} ${endpoint}；HTTP ${response.status}；${JSON.stringify(redactLogValue(data))}`);
    if (!response.ok) throw new Error(`BOSS 请求失败：${method} ${endpoint}（HTTP ${response.status}）。`);
    if (data?.code !== 0) throw new Error(`BOSS 请求返回异常：${method} ${endpoint}；${data?.message || '未知错误。'}`);
    return data?.zpData || {};
  }
  async function fetchPcDeviceId() {
    const captured = readPcDeviceIdFromPageStorage();
    if (captured) return captured;
    sendLog('未捕获到 BOSS 页面 WebSocket 注册帧中的 pc_device_id。');
    return '';
  }
  function safeProgress(payload) { emit({ ...payload, type: 'BOSS_SEND_PROGRESS' }); }
  function validTarget(target, userId) {
    const boss = target?.boss || {};
    if (target?.prepareError) return target.prepareError;
    if (!/^\d+$/.test(String(boss.friendId || ''))) return '缺少有效 friendId';
    if (!/^[A-Za-z0-9_~-]{28}$/.test(String(boss.peerKey || boss.encryptBossId || ''))) return '缺少有效 peerKey';
    if (boss.ownerUserId && String(boss.ownerUserId) !== String(userId)) return '账号不匹配';
    return '';
  }
  function targetFailureMessage(reason) {
    if (/账号不匹配/.test(reason)) return '联系人属于其他 BOSS 账号，请重新同步记录再发送';
    if (/friendId|peerKey|联系人列表|精确匹配|标识/.test(reason)) return '标识不全，需要重新同步记录再发送';
    return reason || '标识不全，需要重新同步记录再发送';
  }
  function randomConnectionId() {
    const values = new Uint8Array(8); crypto.getRandomValues(values);
    return `ws-${Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  }
  async function getRuntimeContext(fallbackPcDeviceId = '') {
    const user = await requestJson('/wapi/zpuser/wap/getUserInfo.json');
    const userId = String(user.userId || '');
    if (!userId) throw new Error('请登录或者刷新Boss直聘页');
    rememberToken(user.token);
    if (!httpToken) throw new Error('请登录或者刷新Boss直聘页');
    const [wt, config] = await Promise.all([
      requestJson('/wapi/zppassport/get/wt'), requestJson('/wapi/zpchat/config/ws')
    ]);
    const hosts = Array.isArray(config.result) ? config.result : [config.result || config.host || ''];
    const host = String(hosts.find(Boolean) || '').replace(/^wss?:\/\//i, '').replace(/\/.*$/, '');
    let currentPcDeviceId = await fetchPcDeviceId();
    if (!currentPcDeviceId && fallbackPcDeviceId) {
      storePcDeviceId(fallbackPcDeviceId);
      currentPcDeviceId = pcDeviceId;
      sendLog('当前页面未建立原生聊天连接，使用扩展为此浏览器保存的稳定 pc_device_id。');
    }
    const wt2 = String(wt.wt2 || '');
    if (!wt2 || !host || !currentPcDeviceId) throw new Error('请登录或者刷新Boss直聘页');
    return { userId, publicIp: String(user.clientIP || ''), wt2, host, pcDeviceId: currentPcDeviceId, httpToken };
  }
  async function refreshTarget(target) {
    const boss = target.boss || {};
    const friendId = String(boss.friendId || '');
    const peerKey = String(boss.peerKey || boss.encryptBossId || '');
    if (!/^\d+$/.test(friendId) || !/^[A-Za-z0-9_~-]{28}$/.test(peerKey)) throw new Error('目标缺少有效 friendId 或 peerKey。');
    return { friendId, peerKey, chatSecurityId: boss.chatSecurityId || '', friendSource: boss.friendSource || 0 };
  }
  function connectAndSend(context, targets, message, rate, batch) {
    return new Promise((resolve, reject) => {
      const protocol = globalThis.JobChatBossProtocol;
      if (!protocol) { reject(new Error('消息协议模块未加载。')); return; }
      const socket = new WebSocket(`wss://${context.host}/chatws`, context.wt2);
      batch.socket = socket;
      let stage = 'auth'; let sequence = 2; let index = 0; let current = null; let lastSentAt = 0; let settled = false;
      const pending = new Map(); const minInterval = Math.ceil(60000 / rate);
      const close = (error) => { if (settled) return; settled = true; batch.socket = null; try { socket.close(); } catch (_) {} error ? reject(error) : resolve(); };
      const sendNext = async () => {
        if (settled || batch.cancelled) { close(); return; }
        if (index >= targets.length) { close(); return; }
        const target = targets[index++];
        safeProgress({ recordKey: target.recordKey, status: '等待' });
        const invalidReason = validTarget(target, context.userId);
        if (invalidReason) {
          const errorMessage = targetFailureMessage(invalidReason);
          safeProgress({ recordKey: target.recordKey, status: '失败', errorCode: 'TARGET_INVALID', errorMessage });
          sendLog(`跳过第 ${index} / ${targets.length} 个联系人：${errorMessage}（${invalidReason}）`);
          sendNext();
          return;
        }
        sendLog(`正在初始化第 ${index} / ${targets.length} 个联系人。`);
        let fresh;
        try { fresh = await refreshTarget(target); } catch (error) {
          const errorMessage = targetFailureMessage(error?.message || String(error));
          safeProgress({ recordKey: target.recordKey, status: '失败', errorCode: 'TARGET_REFRESH_FAILED', errorMessage });
          sendLog(`目标初始化失败：${errorMessage}`);
          sendNext();
          return;
        }
        const wait = Math.max(0, lastSentAt + minInterval - Date.now());
        setTimeout(() => {
          if (settled || batch.cancelled) { close(); return; }
          const cmid = BigInt(Date.now()) * 1000n + BigInt(sequence);
          current = { recordKey: target.recordKey, sequence, cmid };
          pending.set(sequence, current); safeProgress({ recordKey: target.recordKey, status: '等待' }); sendLog(`正在发送第 ${index} / ${targets.length} 条消息。`);
          const sentSequence = sequence;
          try {
            socket.send(protocol.textFrame({ sequence, userId: context.userId, friendId: fresh.friendId, peerKey: fresh.peerKey, cmid, message }));
          } catch (error) {
            pending.delete(sentSequence);
            current = null;
            const errorMessage = error?.message || String(error);
            safeProgress({ recordKey: target.recordKey, status: '失败', errorCode: 'SEND_FAILED', errorMessage });
            sendLog(`第 ${index} / ${targets.length} 条消息发送失败：${errorMessage}`);
            sendNext();
            return;
          }
          lastSentAt = Date.now(); sequence += 1;
          setTimeout(() => {
            if (!settled && current?.cmid === cmid) {
              pending.delete(sentSequence);
              safeProgress({ recordKey: target.recordKey, status: '失败', errorCode: 'ACK_TIMEOUT', errorMessage: '等待发送确认超时，结果未知且不会重试。' });
              sendLog('等待发送确认超时，结果未知且不会重试。');
              current = null;
              sendNext();
            }
          }, 15000);
        }, wait);
      };
      socket.onopen = () => { sendLog('WebSocket 已连接，正在认证。'); socket.send(protocol.authFrame({ connectionId: randomConnectionId(), httpToken: context.httpToken, wt2: context.wt2 })); };
      socket.onmessage = async (event) => {
        let parsed; try { parsed = protocol.parseFrame(event.data instanceof Blob ? await event.data.arrayBuffer() : event.data); } catch (error) { close(error); return; }
        if (parsed.type === 0x20 && stage === 'auth' && parsed.payload.length === 2 && !parsed.payload[0] && !parsed.payload[1]) { stage = 'register'; sendLog('认证成功，正在注册聊天连接。'); socket.send(protocol.registerFrame(context)); return; }
        if (parsed.type === 0x32) { const push = protocol.pushSequence(parsed.payload); if (push != null) socket.send(protocol.ackFrame(push)); return; }
        if (parsed.type === 0x40) {
          const ack = protocol.parseAck(parsed.payload);
          if (stage === 'register' && ack?.sequence === 1) { stage = 'ready'; sendLog('聊天连接已就绪。'); sendNext(); return; }
          const item = pending.get(ack?.sequence);
          if (item && ack?.cmid === item.cmid) { pending.delete(ack.sequence); current = null; safeProgress({ recordKey: item.recordKey, status: ack.mid !== 0n ? '成功' : '失败', errorCode: ack.mid !== 0n ? '' : 'SERVER_REJECTED', errorMessage: ack.mid !== 0n ? '' : '服务端拒绝消息。', sentMessage: ack.mid !== 0n ? message : '' }); sendLog(ack.mid !== 0n ? '消息发送成功，正在更新本地记录。' : '服务端拒绝该消息。'); sendNext(); }
        }
      };
      socket.onerror = () => close(new Error('BOSS WebSocket 连接失败。'));
      socket.onclose = () => { if (batch.cancelled) { close(); return; } if (!settled && (current || index < targets.length)) close(new Error('BOSS WebSocket 已断开，未确认消息发送失败。')); };
    });
  }
  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.data?.source !== 'job-chat-recorder-boss-content') return;
    const command = event.data.command || {};
    if (command.type === 'BOSS_PAGE_REQUEST_ABORT') {
      activePageRequests.get(command.requestId)?.abort();
      return;
    }
    if (command.type === 'BOSS_PAGE_REQUEST') {
      try {
        const result = await performPageRequest(command);
        emit({ type: 'BOSS_PAGE_REQUEST_RESULT', requestId: command.requestId, ok: true, result });
      } catch (error) {
        emit({
          type: 'BOSS_PAGE_REQUEST_RESULT',
          requestId: command.requestId,
          ok: false,
          errorName: error?.name || 'Error',
          errorMessage: error?.message || String(error)
        });
      }
      return;
    }
    if (command.type === 'BOSS_STOP_BATCH') {
      if (activeBatch) {
        activeBatch.cancelled = true;
        try { activeBatch.socket?.close(); } catch (_) {}
        sendLog('已请求停止发送，当前未发送的消息不会继续发送。');
      }
      return;
    }
    if (command.type !== 'BOSS_SEND_BATCH') return;
    try {
      if (activeBatch) throw new Error('已有发送批次正在运行。');
      activeBatch = { cancelled: false, socket: null };
      const context = await getRuntimeContext(command.fallbackPcDeviceId);
      if (activeBatch.cancelled) { emit({ type: 'BOSS_SEND_STOPPED' }); sendLog('发送已停止。'); return; }
      const targets = Array.isArray(command.targets) ? command.targets : [];
      emit({ type: 'BOSS_SEND_STARTED', total: targets.length }); sendLog(`开始发送，共 ${targets.length} 条，速率为每分钟 ${Number(command.rate || 2)} 条。`);
      await connectAndSend(context, targets, String(command.message || ''), Number(command.rate || 2), activeBatch);
      emit({ type: activeBatch.cancelled ? 'BOSS_SEND_STOPPED' : 'BOSS_SEND_FINISHED' });
      sendLog(activeBatch.cancelled ? '发送已停止。' : '发送批次已完成。');
    } catch (error) { sendLog(`发送失败：${error?.message || String(error)}`); emit({ type: 'BOSS_SEND_ERROR', errorMessage: error?.message || String(error) }); }
    finally { activeBatch = null; }
  });
  emit({ type: 'BOSS_HOOK_READY' });
})();
