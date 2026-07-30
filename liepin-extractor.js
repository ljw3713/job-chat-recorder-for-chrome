(function () {
  const { normalizeText, formatDateTime, getCookieValue, sleep } = globalThis.JobChatUtils;
  const {
    filterLiepinRecentContacts,
    getSyncDelayMs,
    reportProgress,
    isCancelRequested,
    savePartial,
    readIgnoredRecords,
    readPreparedSourceList,
    appendRequestLog
  } = globalThis.JobChatContentCommon;
  const { normalizeJobInfo, isCompleteJobInfo, normalizeMultilineText } = globalThis.JobChatRecords;
  let liepinSendBatch = null;

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

  function createJobDetailSyncStats() {
    return { requested: 0, success: 0, failed: 0, skipped: 0, riskPauses: 0, stoppedByRiskControl: false };
  }

  function liepinSyncMessage(synced, total, insertedCount, updatedMsgCount, jobDetailStats = {}) {
    const detailCompleted = Number(jobDetailStats.success || 0) + Number(jobDetailStats.failed || 0) + Number(jobDetailStats.skipped || 0);
    return `正在同步猎聘沟通记录... 已处理 ${synced} / ${total} 条，消息状态：新增 ${insertedCount} 条，更新 ${updatedMsgCount} 条；岗位详情 ${detailCompleted} 条`;
  }

  function liepinSyncSummary(insertedCount, updatedMsgCount, jobDetailStats = createJobDetailSyncStats()) {
    return {
      inserted: insertedCount,
      updated: updatedMsgCount,
      updatedMsg: updatedMsgCount,
      jobDetail: { ...jobDetailStats }
    };
  }

  async function saveLiepinPartial(records, synced, total, interrupted, completed, insertedCount = 0, updatedMsgCount = 0, jobDetailStats = createJobDetailSyncStats()) {
    return savePartial('liepin', '猎聘沟通记录', '猎聘', records, synced, total, interrupted, completed, {
      syncSummary: liepinSyncSummary(insertedCount, updatedMsgCount, jobDetailStats)
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

  function liepinApiStep(path) {
    if (path.endsWith('.contact.get-contact-list')) return 'getContactList';
    if (path.endsWith('.chat.job-preview')) return 'jobPreview';
    return path;
  }

  function responseHeaders(response) {
    try { return Object.fromEntries(response.headers.entries()); } catch (_) { return {}; }
  }

  async function postLiepinApi(path, params) {
    const url = `https://api-c.liepin.com/api/${path}`;
    const headers = liepinHeaders();
    const body = new URLSearchParams(params).toString();
    const step = liepinApiStep(path);
    await appendRequestLog({
      siteKey: 'liepin',
      step: `${step}:request`,
      request: {
        method: 'POST',
        url,
        credentials: 'include',
        mode: 'cors',
        headers,
        body,
        params: { ...params }
      }
    });

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        mode: 'cors',
        headers,
        body
      });
    } catch (error) {
      await appendRequestLog({
        siteKey: 'liepin',
        step: `${step}:networkError`,
        request: { method: 'POST', url, body },
        error: error?.message || String(error)
      });
      throw error;
    }

    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (error) {
      await appendRequestLog({
        siteKey: 'liepin',
        step: `${step}:response`,
        response: {
          status: response.status,
          statusText: response.statusText,
          url: response.url || url,
          headers: responseHeaders(response),
          body: responseText,
          jsonParseError: error?.message || String(error)
        }
      });
      throw new Error(`猎聘接口未返回有效 JSON：HTTP ${response.status}`);
    }

    await appendRequestLog({
      siteKey: 'liepin',
      step: `${step}:response`,
      response: {
        status: response.status,
        statusText: response.statusText,
        url: response.url || url,
        headers: responseHeaders(response),
        body: data
      }
    });

    if (!response.ok) throw new Error(`猎聘接口请求失败：HTTP ${response.status}`);
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

  function classifyLiepinContact(homePage) {
    try {
      const pathname = new URL(normalizeText(homePage), 'https://www.liepin.com').pathname;
      if (/^\/company\/[^/]+\/?$/i.test(pathname)) return 'hr';
      if (/^\/hunter\/[^/]+\/?$/i.test(pathname)) return 'hunter';
    } catch (_) {}
    return 'unknown';
  }

  function liepinJobDetailUrl(jobId, contactType) {
    const id = normalizeText(jobId);
    if (!/^\d+$/.test(id)) throw new Error('猎聘岗位预览未返回有效 jobId。');
    if (contactType === 'hr') return `https://www.liepin.com/job/19${id}.shtml`;
    if (contactType === 'hunter') return `https://www.liepin.com/a/${id}.shtml`;
    throw new Error('无法根据联系人主页判断公司 HR 或猎头。');
  }

  function previewJobInfo(preview, existingJobInfo = {}, options = {}) {
    const emptyPreview = Boolean(options.emptyPreview);
    return normalizeJobInfo({
      ...existingJobInfo,
      title: preview?.jobTitle || existingJobInfo?.title || '',
      location: preview?.jobDqName || existingJobInfo?.location || '',
      experience: preview?.reqWorkYear || existingJobInfo?.experience || '',
      education: preview?.reqEdu || existingJobInfo?.education || '',
      salary: preview?.jobSalary || existingJobInfo?.salary || '',
      fetchStatus: emptyPreview ? 'success' : (existingJobInfo?.fetchStatus || ''),
      fetchedAt: emptyPreview ? new Date().toISOString() : (existingJobInfo?.fetchedAt || ''),
      errorMessage: emptyPreview ? '' : (existingJobInfo?.errorMessage || '')
    });
  }

  function isLiepinEmptyJobPreview(record) {
    return record?.liepin?.jobPreviewStatus === 'empty';
  }

  function liepinNeedsJobDetail(record) {
    return !isLiepinEmptyJobPreview(record) && !isCompleteJobInfo(record);
  }

  async function buildLiepinRecord(item, imId, index, existingRecord) {
    const key = liepinContactKey(item);
    const payloadInfo = parseLiepinLastPayload(item.lastPayload);
    let preview = {};
    let previewError = '';
    let previewSucceeded = false;
    try {
      preview = await fetchLiepinJobPreview(item.imId || imId, item.oppositeImId);
      previewSucceeded = true;
    } catch (error) {
      previewError = error?.message || String(error);
      await appendRequestLog({ siteKey: 'liepin', step: 'jobPreview:error', contactKey: key, error: error?.message || String(error) });
    }

    const previewJobId = normalizeText(preview.jobId);
    const emptyPreview = previewSucceeded && !previewJobId;
    if (emptyPreview) {
      await appendRequestLog({
        siteKey: 'liepin',
        step: 'jobPreview:empty',
        contactKey: key,
        oppositeImId: item.oppositeImId || '',
        message: '岗位预览接口成功，但当前联系人没有关联岗位；跳过岗位详情请求。'
      });
    }
    const jobTitle = preview.jobTitle || payloadInfo.jobTitle || '';
    const jobSalary = preview.jobSalary || payloadInfo.jobSalary || '';
    const companyName = preview.jobCompany || item.company || payloadInfo.jobCompany || existingRecord?.companyName || '';
    const lastMessage = payloadInfo.message || normalizeText(item.lastPayload || '') || existingRecord?.lastMessage || '';
    const jobId = normalizeText(previewJobId || existingRecord?.liepin?.jobId || existingRecord?.jobRef?.externalId);
    const jobKind = normalizeText(preview.jobKind || existingRecord?.liepin?.jobKind);
    const homePage = item.homePage || existingRecord?.liepin?.homePage || '';
    const contactType = classifyLiepinContact(homePage);
    let jobDetailUrl = '';
    try { jobDetailUrl = jobId ? liepinJobDetailUrl(jobId, contactType) : ''; } catch (_) {}
    const jobChanged = Boolean(jobId && existingRecord?.jobRef?.externalId && jobId !== normalizeText(existingRecord.jobRef.externalId));
    const existingJobInfo = jobChanged ? {} : (existingRecord?.jobInfo || {});
    const existingPreview = jobChanged || emptyPreview ? {} : (existingRecord?.liepin?.jobPreview || {});

    return {
      ...(existingRecord || {}),
      index,
      time: formatDateTime(new Date(Number(item.latestMsgTime))),
      updatedAt: new Date().toISOString(),
      recruiterName: normalizeText(item.name) || existingRecord?.recruiterName || '',
      companyName: normalizeText(companyName),
      recruiterTitle: normalizeText(item.title) || existingRecord?.recruiterTitle || '',
      jobName: liepinJobText(jobTitle, jobSalary) || existingRecord?.jobName || '',
      lastMessage,
      messageStatus: liepinMessageStatusFromItem(item),
      jobRef: {
        externalId: jobId,
        detailAccessToken: ''
      },
      jobInfo: previewJobInfo(preview, existingJobInfo, { emptyPreview }),
      liepin: {
        ...(existingRecord?.liepin || {}),
        imId: item.imId || imId,
        oppositeImId: item.oppositeImId || existingRecord?.liepin?.oppositeImId || '',
        oppositeUserId: item.oppositeUserId || existingRecord?.liepin?.oppositeUserId || '',
        latestMsgId: item.latestMsgId || '',
        latestMsgTime: item.latestMsgTime || '',
        oppositeRead: normalizeText(item.oppositeRead || ''),
        contactKey: key,
        homePage,
        jobId,
        jobKind,
        contactType,
        jobDetailUrl,
        jobPreviewError: previewError,
        jobPreviewStatus: previewError ? 'failed' : (emptyPreview ? 'empty' : 'available'),
        jobPreview: {
          jobId,
          jobKind,
          jobTitle: normalizeText(preview.jobTitle || existingPreview.jobTitle || ''),
          jobDqName: normalizeText(preview.jobDqName || existingPreview.jobDqName || ''),
          reqWorkYear: normalizeText(preview.reqWorkYear || existingPreview.reqWorkYear || ''),
          reqEdu: normalizeText(preview.reqEdu || existingPreview.reqEdu || ''),
          jobSalary: normalizeText(preview.jobSalary || existingPreview.jobSalary || ''),
          compStage: normalizeText(preview.compStage || existingPreview.compStage || ''),
          jobCompany: normalizeText(preview.jobCompany || existingPreview.jobCompany || '')
        }
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

  async function resolveLiepinJobAccess(record, context = {}) {
    const preview = context.preview || record?.liepin?.jobPreview || {};
    const jobId = normalizeText(preview.jobId || record?.liepin?.jobId || record?.jobRef?.externalId);
    const jobKind = normalizeText(preview.jobKind || record?.liepin?.jobKind);
    const homePage = context?.item?.homePage || record?.liepin?.homePage || '';
    const contactType = classifyLiepinContact(homePage);
    let detailUrl;
    try {
      if (!jobId && record?.liepin?.jobPreviewError) {
        throw new Error(`猎聘岗位预览请求失败：${record.liepin.jobPreviewError}`);
      }
      detailUrl = liepinJobDetailUrl(jobId, contactType);
    } catch (error) {
      await appendRequestLog({
        siteKey: 'liepin',
        step: 'jobPreview:validationError',
        contactKey: record?.liepin?.contactKey || liepinContactKey(context?.item),
        imId: record?.liepin?.imId || context?.item?.imId || '',
        oppositeImId: record?.liepin?.oppositeImId || context?.item?.oppositeImId || '',
        jobId,
        jobKind,
        homePage,
        contactType,
        preview,
        error: error?.message || String(error)
      });
      throw error;
    }
    const expectedKind = contactType === 'hr' ? '2' : '1';
    if (jobKind && jobKind !== expectedKind) {
      await appendRequestLog({
        siteKey: 'liepin',
        step: 'jobDetail:contactTypeConflict',
        jobId,
        jobKind,
        contactType,
        homePage
      });
    }
    return {
      jobRef: { externalId: jobId, detailAccessToken: '' },
      detailUrl,
      contactType,
      jobKind,
      homePage,
      preview: {
        ...(record?.liepin?.jobPreview || {}),
        ...preview
      },
      previousJobInfo: normalizeJobInfo(record?.jobInfo)
    };
  }

  function liepinPageError(message, code, extra = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, extra);
    return error;
  }

  async function fetchLiepinJobDetail(jobRef, access, options = {}) {
    const url = access?.detailUrl || liepinJobDetailUrl(jobRef.externalId, access?.contactType);
    const request = {
      method: 'GET',
      url,
      credentials: 'include',
      redirect: 'follow',
      headers: { Accept: 'text/html,application/xhtml+xml' }
    };
    await appendRequestLog({ siteKey: 'liepin', step: 'jobDetail:request', request });
    options.onLog?.({ step: 'jobDetail:request', message: `GET ${url}` });
    let response;
    try {
      response = await fetch(url, { ...request, signal: options.signal });
    } catch (error) {
      await appendRequestLog({
        siteKey: 'liepin',
        step: 'jobDetail:networkError',
        request,
        error: error?.message || String(error)
      });
      throw error;
    }
    const html = await response.text();
    await appendRequestLog({
      siteKey: 'liepin',
      step: 'jobDetail:response',
      response: {
        status: response.status,
        statusText: response.statusText,
        url: response.url || url,
        headers: responseHeaders(response),
        body: html
      }
    });
    options.onLog?.({ step: 'jobDetail:response', message: `HTTP ${response.status} · ${response.url || url}` });
    if (!response.ok) {
      throw liepinPageError(`猎聘岗位详情请求失败：HTTP ${response.status}`, 'detail_http_failed', {
        status: response.status,
        riskControl: response.status === 403 || response.status === 429
      });
    }
    const finalPath = (() => { try { return new URL(response.url || url).pathname; } catch (_) { return ''; } })();
    if (/login|passport|verify|captcha|security/i.test(finalPath)
      || /登录后查看|安全验证|验证码|访问过于频繁/.test(html.slice(0, 20000))) {
      throw liepinPageError('猎聘岗位详情页要求登录或安全验证。', 'auth_required', { riskControl: true });
    }
    if (!/<!doctype\s+html|<html[\s>]/i.test(html)) {
      throw liepinPageError('猎聘岗位详情未返回 HTML。', 'detail_invalid_html');
    }
    return { html, url, finalUrl: response.url || url, access };
  }

  function directTextElements(container, selector = 'span') {
    if (!container) return [];
    return [...container.children]
      .filter((element) => element.matches(selector))
      .map((element) => normalizeText(element.textContent))
      .filter(Boolean);
  }

  function firstText(root, selectors) {
    for (const selector of selectors) {
      const text = normalizeText(root.querySelector(selector)?.textContent);
      if (text) return text;
    }
    return '';
  }

  function extractLabeledValue(root, labels) {
    if (!root) return '';
    const candidates = [...root.querySelectorAll('li, p, dd, div, span')];
    for (const candidate of candidates) {
      const text = normalizeText(candidate.textContent);
      for (const label of labels) {
        const match = text.match(new RegExp(`^${label}\\s*[：:]\\s*(.+)$`));
        if (match?.[1]) return normalizeText(match[1]);
      }
    }
    return '';
  }

  function companyExternalId(companyRoot, homePage, contactType) {
    const href = companyRoot?.querySelector('a[href*="/company/"]')?.getAttribute('href') || '';
    for (const candidate of [href, contactType === 'hr' ? homePage : '']) {
      const match = normalizeText(candidate).match(/\/company\/([^/?#]+)/i);
      if (match?.[1]) return match[1];
    }
    return '';
  }

  function uniqueParagraphText(roots) {
    const seen = new Set();
    const parts = [];
    roots.filter(Boolean).forEach((root) => {
      const candidates = root.querySelectorAll('p, dd, li');
      const source = candidates.length ? [...candidates] : [root];
      source.forEach((element) => {
        const text = normalizeMultilineText(element.textContent);
        if (!text || seen.has(text)) return;
        seen.add(text);
        parts.push(text);
      });
    });
    return normalizeMultilineText(parts.join('\n'));
  }

  function normalizeLiepinJobResponse(payload, jobRef, access = {}) {
    const doc = new DOMParser().parseFromString(payload?.html || '', 'text/html');
    const preview = access.preview || {};
    const stoppedTitle = firstText(doc, ['.apply-stop-title']);
    if (stoppedTitle) {
      const previous = access.previousJobInfo || {};
      const stoppedNote = '该职位已暂停招聘';
      const previousDescription = normalizeMultilineText(previous.description);
      const description = previousDescription.includes(stoppedNote)
        ? previousDescription
        : normalizeMultilineText([previousDescription, stoppedNote].filter(Boolean).join('\n\n'));
      return {
        jobRef: { externalId: normalizeText(jobRef.externalId), detailAccessToken: '' },
        jobInfo: {
          title: normalizeText(preview.jobTitle || previous.title),
          category: normalizeText(previous.category),
          location: normalizeText(preview.jobDqName || previous.location),
          experience: normalizeText(preview.reqWorkYear || previous.experience),
          education: normalizeText(preview.reqEdu || previous.education),
          salary: normalizeText(preview.jobSalary || previous.salary),
          description,
          address: normalizeText(previous.address),
          skills: Array.isArray(previous.skills) ? previous.skills : []
        },
        companyProfile: null
      };
    }
    const apply = doc.querySelector('.job-apply-container');
    const intro = doc.querySelector('.job-intro-container');
    if (!apply || !intro) {
      throw liepinPageError('猎聘岗位详情页缺少主岗位容器。', 'detail_selector_missing');
    }
    const pageJobElement = apply.querySelector('[data-jobId][data-jobKind]');
    const pageJobId = normalizeText(pageJobElement?.getAttribute('data-jobId'));
    if (pageJobId && pageJobId !== normalizeText(jobRef.externalId)) {
      throw liepinPageError('猎聘详情页岗位 ID 与预览岗位 ID 不一致。', 'job_id_mismatch');
    }
    const properties = directTextElements(apply.querySelector('.job-properties'))
      .filter((text) => !/^招\d+人$/.test(text) && !/更新$/.test(text));
    const description = normalizeMultilineText(
      intro.querySelector('[data-selector="job-intro-content"]')?.textContent
      || intro.querySelector('.paragraph dd')?.textContent
      || ''
    );
    const skillRoot = intro.querySelector('.labels');
    const skills = skillRoot
      ? [...skillRoot.querySelectorAll('span, li, a')].map((element) => normalizeText(element.textContent)).filter(Boolean)
      : [];
    const companyInfo = doc.querySelector('.company-info-container');
    const companyIntro = doc.querySelector('.company-intro-container');
    const companyRoot = companyInfo || companyIntro;
    const externalId = companyExternalId(companyRoot, access.homePage, access.contactType);
    const companyName = firstText(companyRoot || doc, [
      '.company-name',
      '[data-selector="company-name"]',
      'h3',
      'h2',
      'a[href*="/company/"]'
    ]) || normalizeText(preview.jobCompany);
    const companyKey = externalId ? `liepin|${externalId}` : '';
    return {
      jobRef: { externalId: normalizeText(jobRef.externalId), detailAccessToken: '' },
      jobInfo: {
        title: firstText(apply, ['.name-box > .name', '.name']) || preview.jobTitle,
        category: extractLabeledValue(intro, ['职位职能', '职能']),
        location: properties[0] || preview.jobDqName,
        experience: properties[1] || preview.reqWorkYear,
        education: properties[2] || preview.reqEdu,
        salary: firstText(apply, ['.salary']) || preview.jobSalary,
        description,
        address: extractLabeledValue(intro, ['工作地址', '职位地址']),
        skills
      },
      companyProfile: externalId ? {
        companyKey,
        siteKey: 'liepin',
        externalId,
        name: companyName,
        employeeScale: extractLabeledValue(companyInfo, ['公司规模', '规模']),
        industry: extractLabeledValue(companyInfo, ['所属行业', '行业']),
        description: uniqueParagraphText([companyIntro, companyInfo])
      } : null
    };
  }

  function isLiepinJobRiskControlError(error) {
    return Boolean(error?.riskControl || error?.status === 403 || error?.status === 429);
  }

  async function persistCompanyProfile(profile) {
    if (!profile) return;
    const response = await chrome.runtime.sendMessage({ type: 'JOB_CHAT_COMPANY_PROFILE_UPSERT', profile });
    if (response && response.ok === false) throw new Error(response.error || '公司信息保存失败。');
  }

  async function getFilteredContacts(imId, options = {}) {
    const preparedContacts = Array.isArray(options.contacts) ? options.contacts : null;
    const contacts = preparedContacts || filterLiepinRecentContacts(await fetchLiepinContacts(imId));
    const store = await chrome.storage.local.get(['jobChatPendingRecords', 'jobChatRecords']);
    const pending = store.jobChatPendingRecords;
    const pendingRecords = pending?.siteKey === 'liepin' && Array.isArray(pending.records) ? pending.records : [];
    const savedRecords = Array.isArray(store.jobChatRecords) ? store.jobChatRecords.filter((record) => record?.siteKey === 'liepin' || record?.sourceName === '猎聘') : [];
    const ignoredRecords = (await readIgnoredRecords()).filter((record) => record?.siteKey === 'liepin' || record?.sourceName === '猎聘');

    const savedByKey = indexLiepinRecords(savedRecords);
    const pendingByKey = indexLiepinRecords(pendingRecords);
    const ignoredKeys = new Set();
    ignoredRecords.forEach((record) => addLiepinRecordKeys(ignoredKeys, record));
    const includeInsert = options.syncSelection?.includeInsert !== false;
    const includeUpdate = options.syncSelection?.includeUpdate !== false;
    const contactsToSync = contacts.filter((item) => {
      const keys = liepinItemKeys(item);
      if (keys.some((key) => ignoredKeys.has(key))) return false;
      const existingRecord = findLiepinRecordForItem(pendingByKey, item) || findLiepinRecordForItem(savedByKey, item);
      if (!existingRecord) return includeInsert;
      if (!includeUpdate) return false;
      const latestMsgId = normalizeText(item?.latestMsgId || '');
      const latestMsgChanged = Boolean(latestMsgId && liepinLatestMsgId(existingRecord) !== latestMsgId);
      const statusChanged = liepinMessageStatusFromRecord(existingRecord) !== liepinMessageStatusFromItem(item);
      return latestMsgChanged || statusChanged || liepinNeedsJobDetail(existingRecord);
    });
    return { contacts, contactsToSync, pendingRecords, savedByKey, pendingByKey };
  }

  function liepinItemSyncNeeds(item, savedByKey, pendingByKey) {
    const existingRecord = findLiepinRecordForItem(pendingByKey, item) || findLiepinRecordForItem(savedByKey, item);
    if (!existingRecord) return { message: true, jobDetail: true };
    const latestMsgId = normalizeText(item?.latestMsgId || '');
    const jobDetail = liepinNeedsJobDetail(existingRecord);
    const messageChanged = Boolean(
      (latestMsgId && liepinLatestMsgId(existingRecord) !== latestMsgId)
      || liepinMessageStatusFromRecord(existingRecord) !== liepinMessageStatusFromItem(item)
    );
    return {
      message: !jobDetail && messageChanged,
      jobDetail
    };
  }

  async function extractLiepinChatRecords(options = {}) {
    const imId = getLiepinImId();
    if (!imId) throw new Error('没有在当前猎聘页面 Cookie / 缓存中找到 imId_0。请确认已登录猎聘，并刷新页面后重试。');

    const preparedSnapshot = await readPreparedSourceList('liepin');
    const filteredOptions = {
      ...options,
      contacts: preparedSnapshot?.list
    };
    const { contactsToSync, pendingRecords, savedByKey, pendingByKey } = await getFilteredContacts(imId, filteredOptions);
    const records = [...pendingRecords];
    const totalToSync = contactsToSync.length;
    const communicationTotal = contactsToSync.filter((item) => liepinItemSyncNeeds(item, savedByKey, pendingByKey).message).length;
    const jobDetailTotal = contactsToSync.filter((item) => liepinItemSyncNeeds(item, savedByKey, pendingByKey).jobDetail).length;
    let syncedCount = 0;
    let insertedCount = 0;
    let updatedMsgCount = 0;
    const jobDetailStats = createJobDetailSyncStats();
    const jobDetailSession = new globalThis.JobChatJobSync.JobDetailSyncSession({
      requestIntervalMs: 2000,
      maxRequestsPerPage: Number.MAX_SAFE_INTEGER
    });
    const progressCategories = () => ({
      communication: { completed: insertedCount + updatedMsgCount, total: communicationTotal },
      jobDetail: {
        completed: jobDetailStats.success + jobDetailStats.failed + jobDetailStats.skipped,
        total: jobDetailTotal
      }
    });

    reportProgress('liepin', '猎聘沟通记录', '猎聘', syncedCount, totalToSync, {
      inserted: insertedCount,
      updated: updatedMsgCount,
      updatedMsg: updatedMsgCount,
      progressCategories: progressCategories(),
      jobDetailRequired: jobDetailTotal > 0,
      message: liepinSyncMessage(syncedCount, totalToSync, insertedCount, updatedMsgCount, jobDetailStats)
    });
    await saveLiepinPartial(records, syncedCount, totalToSync, false, syncedCount >= totalToSync, insertedCount, updatedMsgCount, jobDetailStats);

    for (let i = 0; i < contactsToSync.length; i += 1) {
      const item = contactsToSync[i];

      if (await isCancelRequested()) {
        await saveLiepinPartial(records, syncedCount, totalToSync, true, false, insertedCount, updatedMsgCount, jobDetailStats);
        return {
          pageTitle: document.title || '',
          pageUrl: location.href,
          extractedAt: new Date().toISOString(),
          total: records.length,
          synced: syncedCount,
          interrupted: true,
          sourceTotal: totalToSync,
          syncSummary: liepinSyncSummary(insertedCount, updatedMsgCount, jobDetailStats),
          records
        };
      }

      if (records.length > 0) await sleep(await getSyncDelayMs());

      const existingRecord = findLiepinRecordForItem(pendingByKey, item) || findLiepinRecordForItem(savedByKey, item);
      const isUpdate = Boolean(existingRecord);
      const syncNeeds = liepinItemSyncNeeds(item, savedByKey, pendingByKey);
      const existingIndex = records.findIndex((record) => liepinItemKeys(item).some((itemKey) => {
        const recordKeys = new Set();
        addLiepinRecordKeys(recordKeys, record);
        return recordKeys.has(itemKey);
      }));
      const baseRecord = await buildLiepinRecord(
        item,
        imId,
        existingIndex >= 0 ? existingIndex + 1 : records.length + 1,
        existingRecord
      );
      const emptyPreview = isLiepinEmptyJobPreview(baseRecord);
      const needsJobDetail = liepinNeedsJobDetail(baseRecord);
      const jobResult = emptyPreview
        ? { record: baseRecord, status: 'success', skipped: true, requested: false, errorMessage: '' }
        : await jobDetailSession.syncRecord(baseRecord, { item }, {
          adapter: globalThis.JobChatSiteAdapters.get('liepin'),
          policy: 'missing-only',
          shouldStop: isCancelRequested,
          onCompanyProfile: persistCompanyProfile
        });
      if (jobResult.stopped) {
        await saveLiepinPartial(records, syncedCount, totalToSync, true, false, insertedCount, updatedMsgCount, jobDetailStats);
        return {
          pageTitle: document.title || '',
          pageUrl: location.href,
          extractedAt: new Date().toISOString(),
          total: records.length,
          synced: syncedCount,
          interrupted: true,
          sourceTotal: totalToSync,
          syncSummary: liepinSyncSummary(insertedCount, updatedMsgCount, jobDetailStats),
          records
        };
      }
      if (emptyPreview && syncNeeds.jobDetail) {
        jobDetailStats.success += 1;
      } else if (needsJobDetail) {
        if (jobResult.requested) jobDetailStats.requested += 1;
        if (jobResult.record?.jobInfo?.fetchStatus === 'success') jobDetailStats.success += 1;
        else jobDetailStats.failed += 1;
      }
      const nextRecord = {
        ...jobResult.record,
        liepin: {
          ...(jobResult.record?.liepin || {}),
          jobDetailUrl: jobResult.record?.liepin?.jobDetailUrl || ''
        }
      };
      if (existingIndex >= 0) {
        records[existingIndex] = nextRecord;
      } else {
        records.push(nextRecord);
      }
      syncedCount += 1;
      if (!isUpdate) insertedCount += 1;
      else if (syncNeeds.message) updatedMsgCount += 1;
      reportProgress('liepin', '猎聘沟通记录', '猎聘', syncedCount, totalToSync, {
        inserted: insertedCount,
        updated: updatedMsgCount,
        updatedMsg: updatedMsgCount,
        progressCategories: progressCategories(),
        jobDetailRequired: jobDetailTotal > 0,
        message: liepinSyncMessage(syncedCount, totalToSync, insertedCount, updatedMsgCount, jobDetailStats)
      });
      await saveLiepinPartial(records, syncedCount, totalToSync, false, syncedCount >= totalToSync, insertedCount, updatedMsgCount, jobDetailStats);
    }

    return {
      pageTitle: document.title || '',
      pageUrl: location.href,
      extractedAt: new Date().toISOString(),
      total: records.length,
      synced: syncedCount,
      interrupted: false,
      sourceTotal: totalToSync,
      syncSummary: liepinSyncSummary(insertedCount, updatedMsgCount, jobDetailStats),
      records
    };
  }

  async function prepareLiepinSync() {
    const imId = getLiepinImId();
    if (!imId) throw new Error('没有在当前猎聘页面 Cookie / 缓存中找到 imId_0。请确认已登录猎聘，并刷新页面后重试。');
    const { contacts, contactsToSync, savedByKey, pendingByKey } = await getFilteredContacts(imId);
    const insertedCount = contactsToSync.filter((item) => !findLiepinRecordForItem(pendingByKey, item) && !findLiepinRecordForItem(savedByKey, item)).length;
    const updatedMsgCount = contactsToSync.filter((item) => {
      const existingRecord = findLiepinRecordForItem(pendingByKey, item) || findLiepinRecordForItem(savedByKey, item);
      return Boolean(existingRecord) && liepinItemSyncNeeds(item, savedByKey, pendingByKey).message;
    }).length;
    const jobDetailSyncCount = contactsToSync.filter((item) => {
      const existingRecord = findLiepinRecordForItem(pendingByKey, item) || findLiepinRecordForItem(savedByKey, item);
      return Boolean(existingRecord) && liepinItemSyncNeeds(item, savedByKey, pendingByKey).jobDetail;
    }).length;
    return {
      list: contactsToSync,
      needSync: contactsToSync.length,
      syncSummary: {
        ...liepinSyncSummary(insertedCount, updatedMsgCount),
        messageSync: insertedCount + updatedMsgCount,
        jobDetailSync: jobDetailSyncCount
      }
    };
  }

  async function refreshLiepinRecords(records, options = {}) {
    const targets = Array.isArray(records) ? records : [];
    if (!targets.length) return { records: [], results: [], jobDetail: createJobDetailSyncStats() };
    const imId = getLiepinImId();
    if (!imId) throw new Error('没有在当前猎聘页面 Cookie / 缓存中找到 imId_0。请确认已登录猎聘。');
    let contactsByKey = null;
    const findContact = async (record) => {
      if (record?.liepin?.homePage && record?.liepin?.oppositeImId && record?.liepin?.oppositeUserId) {
        return {
          imId: record.liepin.imId || imId,
          oppositeImId: record.liepin.oppositeImId,
          oppositeUserId: record.liepin.oppositeUserId,
          homePage: record.liepin.homePage,
          latestMsgId: record.liepin.latestMsgId,
          latestMsgTime: record.liepin.latestMsgTime,
          oppositeRead: record.liepin.oppositeRead,
          name: record.recruiterName,
          title: record.recruiterTitle,
          company: record.companyName
        };
      }
      if (!contactsByKey) {
        contactsByKey = indexLiepinRecords((await fetchLiepinContacts(imId)).map((item) => ({
          recordKey: `liepin|${normalizeText(item.oppositeImId).toLowerCase()}`,
          liepin: {
            oppositeImId: item.oppositeImId,
            contactKey: liepinContactKey(item),
            latestMsgId: item.latestMsgId
          },
          item
        })));
      }
      return findLiepinRecordForItem(contactsByKey, {
        oppositeImId: record?.liepin?.oppositeImId,
        id: record?.liepin?.contactKey,
        latestMsgId: record?.liepin?.latestMsgId
      })?.item || null;
    };
    const updated = [];
    const results = [];
    const jobDetailStats = createJobDetailSyncStats();
    const session = new globalThis.JobChatJobSync.JobDetailSyncSession({
      requestIntervalMs: 2000,
      maxRequestsPerPage: Number.MAX_SAFE_INTEGER
    });
    for (let index = 0; index < targets.length; index += 1) {
      if (options.signal?.aborted || await options.shouldStop?.()) break;
      const record = targets[index];
      options.onProgress?.({ recordKey: record.recordKey, status: '同步中', error: '', completed: index, total: targets.length });
      const item = await findContact(record);
      if (!item) {
        const error = '无法在猎聘联系列表中匹配该记录。';
        jobDetailStats.failed += 1;
        results.push({ recordKey: record.recordKey, ok: false, error });
        options.onProgress?.({ recordKey: record.recordKey, status: '失败', error, completed: index + 1, total: targets.length });
        continue;
      }
      let baseRecord;
      try {
        baseRecord = await buildLiepinRecord(item, imId, record.index || index + 1, record);
      } catch (error) {
        const errorMessage = error?.message || String(error);
        jobDetailStats.failed += 1;
        results.push({ recordKey: record.recordKey, ok: false, error: errorMessage });
        options.onProgress?.({ recordKey: record.recordKey, status: '失败', error: errorMessage, completed: index + 1, total: targets.length });
        continue;
      }
      const emptyPreview = isLiepinEmptyJobPreview(baseRecord);
      const jobResult = emptyPreview
        ? { record: baseRecord, status: 'success', skipped: true, requested: false, errorMessage: '' }
        : await session.syncRecord(baseRecord, { item }, {
          adapter: globalThis.JobChatSiteAdapters.get('liepin'),
          policy: 'force',
          shouldStop: options.shouldStop,
          signal: options.signal,
          onLog: options.onLog,
          onCompanyProfile: persistCompanyProfile
        });
      if (jobResult.stopped) break;
      if (jobResult.requested) jobDetailStats.requested += 1;
      if (emptyPreview || jobResult.record?.jobInfo?.fetchStatus === 'success') jobDetailStats.success += 1;
      else jobDetailStats.failed += 1;
      const nextRecord = { ...jobResult.record, recordKey: record.recordKey };
      updated.push(nextRecord);
      const ok = nextRecord.jobInfo?.fetchStatus === 'success';
      const error = nextRecord.jobInfo?.errorMessage || '';
      results.push({ recordKey: record.recordKey, ok, jobInfoStatus: nextRecord.jobInfo?.fetchStatus, error });
      options.onProgress?.({
        recordKey: record.recordKey,
        status: ok ? '成功' : '失败',
        error,
        completed: index + 1,
        total: targets.length,
        record: nextRecord
      });
    }
    const stopped = Boolean(options.signal?.aborted || await options.shouldStop?.());
    return { records: updated, results, stopped, paused: false, jobDetail: jobDetailStats };
  }

  function emitLiepinSendProgress(payload) {
    chrome.runtime.sendMessage({
      type: 'LIEPIN_SEND_PROGRESS',
      progress: payload
    }).catch(() => {});
  }

  function emitLiepinSendLog(message) {
    chrome.runtime.sendMessage({
      type: 'LIEPIN_SEND_LOG',
      message: String(message || '')
    }).catch(() => {});
  }

  async function postLiepinSendForm(url, params, operation) {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        mode: 'cors',
        headers: liepinHeaders(),
        body: new URLSearchParams(params).toString()
      });
    } catch (error) {
      throw new Error(`${operation}网络请求失败：${error?.message || String(error)}`);
    }
    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (_) {
      throw new Error(`${operation}未返回有效 JSON（HTTP ${response.status}）。`);
    }
    if (!response.ok) throw new Error(`${operation}请求失败：HTTP ${response.status}。`);
    if (data?.flag !== 1) {
      throw new Error(`${operation}返回异常：${normalizeText(data?.msg || data?.message) || `flag=${String(data?.flag)}`}。`);
    }
    return data.data || {};
  }

  async function getLiepinImClientId(imId) {
    const store = await chrome.storage.local.get(['jobChatLiepinImClientIds']);
    const cached = store.jobChatLiepinImClientIds && typeof store.jobChatLiepinImClientIds === 'object'
      ? { ...store.jobChatLiepinImClientIds }
      : {};
    const saved = normalizeText(cached[imId]);
    if (saved) {
      emitLiepinSendLog('已使用当前猎聘账号缓存的 imClientId。');
      return saved;
    }
    emitLiepinSendLog('正在获取当前猎聘账号的 imClientId。');
    const data = await postLiepinSendForm(
      'https://api-im.liepin.com/api/com.liepin.cbp.im.get-user-info',
      {
        imUserType: '0',
        imId,
        imApp: '1',
        deviceType: '0'
      },
      '获取猎聘用户信息'
    );
    const responseImId = normalizeText(data.imId);
    const imClientId = normalizeText(data.imClientId);
    if (!imClientId) throw new Error('猎聘用户信息缺少 imClientId。');
    if (responseImId && responseImId !== imId) throw new Error('猎聘页面当前账号与用户信息接口返回账号不一致。');
    cached[imId] = imClientId;
    await chrome.storage.local.set({ jobChatLiepinImClientIds: cached });
    emitLiepinSendLog('已保存当前猎聘账号的 imClientId。');
    return imClientId;
  }

  async function resolveLiepinOppositeUser(target, imId) {
    const liepin = target?.liepin || {};
    const saved = normalizeText(liepin.oppositeUserId);
    if (saved) {
      return {
        oppositeUserId: saved,
        oppositeImUserType: normalizeText(liepin.oppositeImUserType) || '2'
      };
    }
    const oppositeImId = normalizeText(liepin.oppositeImId);
    emitLiepinSendLog('当前记录缺少 oppositeUserId，正在从聊天列表补全。');
    const data = await postLiepinSendForm(
      'https://api-c.liepin.com/api/com.liepin.im.c.chat.chat-list',
      {
        imUserType: '0',
        imId,
        imApp: '1',
        oppositeImId,
        maxMessageId: '',
        pageSize: '20'
      },
      '获取猎聘聊天列表'
    );
    const first = Array.isArray(data.list) ? data.list[0] : null;
    if (!first) throw new Error('猎聘聊天列表为空，无法补全 oppositeUserId。');
    if (normalizeText(first.oppositeImId) !== oppositeImId) {
      throw new Error('猎聘聊天列表返回的联系人与当前记录不一致。');
    }
    const oppositeUserId = normalizeText(first.oppositeUserId);
    if (!oppositeUserId) throw new Error('猎聘聊天列表缺少 oppositeUserId。');
    emitLiepinSendProgress({
      type: 'LIEPIN_SEND_PROGRESS',
      recordKey: target.recordKey,
      status: '等待',
      oppositeUserId
    });
    emitLiepinSendLog('已补全并保存当前联系人的 oppositeUserId。');
    return {
      oppositeUserId,
      oppositeImUserType: normalizeText(first.oppositeImUserType) || '2'
    };
  }

  function liepinTextPayload(message) {
    return JSON.stringify({
      ext: {
        extType: 1,
        extBody: {
          bizType: '1',
          bizData: { quote: {} },
          bsData: {}
        }
      },
      bodies: [{ msg: message, type: 'txt' }],
      push: '1'
    });
  }

  async function sendLiepinText(target, context, message) {
    const liepin = target?.liepin || {};
    const oppositeImId = normalizeText(liepin.oppositeImId);
    if (!oppositeImId) throw new Error('记录缺少 oppositeImId，需要重新同步记录后再发送。');
    const recordImId = normalizeText(liepin.imId);
    if (recordImId && recordImId !== context.imId) {
      throw new Error('联系人属于其他猎聘账号，请切换账号或重新同步记录后再发送。');
    }
    const opposite = await resolveLiepinOppositeUser(target, context.imId);
    const requestMsgTime = Date.now();
    const data = await postLiepinSendForm(
      'https://api-c.liepin.com/api/com.liepin.im.c.chat.send-push',
      {
        imUserType: '0',
        imId: context.imId,
        imApp: '1',
        save: '',
        count: '1',
        imClientId: context.imClientId,
        oppositeImId,
        oppositeUserId: opposite.oppositeUserId,
        oppositeImUserType: opposite.oppositeImUserType,
        chatType: '0',
        msgTime: String(requestMsgTime),
        msgType: 'txt',
        payload: liepinTextPayload(message)
      },
      '发送猎聘消息'
    );
    const msgId = normalizeText(data.msgId);
    if (!msgId) throw new Error('猎聘发送接口未返回 msgId，发送结果未知且不会重试。');
    return {
      msgId,
      msgTime: Number(data.msgTime || requestMsgTime),
      oppositeUserId: opposite.oppositeUserId
    };
  }

  async function waitForLiepinSend(batch, delayMs) {
    const deadline = Date.now() + Math.max(0, delayMs);
    while (!batch.cancelled && Date.now() < deadline) {
      await sleep(Math.min(250, deadline - Date.now()));
    }
  }

  async function runLiepinSendBatch(targets, message, rate, batch) {
    try {
      const imId = getLiepinImId();
      if (!imId) throw new Error('没有找到当前猎聘账号的 imId_0，请确认已登录并刷新猎聘页面。');
      const imClientId = await getLiepinImClientId(imId);
      const context = { imId, imClientId };
      const requestedRate = Number(rate);
      const normalizedRate = Number.isFinite(requestedRate) ? Math.max(1, Math.floor(requestedRate)) : 10;
      const intervalMs = Math.ceil(60000 / normalizedRate);
      let lastStartedAt = 0;
      emitLiepinSendProgress({ type: 'LIEPIN_SEND_STARTED', total: targets.length });
      emitLiepinSendLog(`开始发送，共 ${targets.length} 条，速率为每分钟 ${normalizedRate} 条。`);
      for (let index = 0; index < targets.length; index += 1) {
        if (batch.cancelled) break;
        const target = targets[index];
        emitLiepinSendProgress({ type: 'LIEPIN_SEND_PROGRESS', recordKey: target.recordKey, status: '等待' });
        await waitForLiepinSend(batch, Math.max(0, lastStartedAt + intervalMs - Date.now()));
        if (batch.cancelled) break;
        lastStartedAt = Date.now();
        emitLiepinSendLog(`正在发送第 ${index + 1} / ${targets.length} 条消息。`);
        try {
          const result = await sendLiepinText(target, context, message);
          emitLiepinSendProgress({
            type: 'LIEPIN_SEND_PROGRESS',
            recordKey: target.recordKey,
            status: '成功',
            sentMessage: message,
            msgId: result.msgId,
            msgTime: result.msgTime,
            oppositeUserId: result.oppositeUserId
          });
          emitLiepinSendLog(`第 ${index + 1} / ${targets.length} 条消息发送成功。`);
        } catch (error) {
          const errorMessage = error?.message || String(error);
          emitLiepinSendProgress({
            type: 'LIEPIN_SEND_PROGRESS',
            recordKey: target.recordKey,
            status: '失败',
            errorCode: 'LIEPIN_SEND_FAILED',
            errorMessage
          });
          emitLiepinSendLog(`第 ${index + 1} / ${targets.length} 条消息发送失败：${errorMessage}`);
        }
      }
      emitLiepinSendProgress({
        type: batch.cancelled ? 'LIEPIN_SEND_STOPPED' : 'LIEPIN_SEND_FINISHED'
      });
      emitLiepinSendLog(batch.cancelled ? '发送已停止。' : '发送批次已完成。');
    } catch (error) {
      const errorMessage = error?.message || String(error);
      emitLiepinSendLog(`发送任务失败：${errorMessage}`);
      emitLiepinSendProgress({ type: 'LIEPIN_SEND_ERROR', errorMessage });
    } finally {
      if (liepinSendBatch === batch) liepinSendBatch = null;
    }
  }

  function startLiepinSendBatch(targets, message, rate) {
    if (liepinSendBatch) throw new Error('已有猎聘发送批次正在运行。');
    const normalizedTargets = Array.isArray(targets) ? targets : [];
    const text = normalizeText(message);
    if (!normalizedTargets.length) throw new Error('没有可发送的猎聘记录。');
    if (!text) throw new Error('请输入要发送的消息。');
    if (text.length > 1000) throw new Error('猎聘消息不能超过 1000 个字符。');
    const batch = { cancelled: false };
    liepinSendBatch = batch;
    runLiepinSendBatch(normalizedTargets, text, rate, batch);
    return { total: normalizedTargets.length };
  }

  function stopLiepinSendBatch() {
    if (liepinSendBatch) liepinSendBatch.cancelled = true;
  }

  globalThis.JobChatLiepinExtractor = {
    extract: extractLiepinChatRecords,
    prepare: prepareLiepinSync,
    refreshRecords: refreshLiepinRecords,
    startSendBatch: startLiepinSendBatch,
    stopSendBatch: stopLiepinSendBatch
  };
  globalThis.JobChatSiteAdapters?.register('liepin', {
    siteKey: 'liepin',
    supportsJobDetail: true,
    requiresDetailAccessToken: false,
    prepareSync: prepareLiepinSync,
    extractRecords: extractLiepinChatRecords,
    refreshRecords: refreshLiepinRecords,
    resolveJobAccess: resolveLiepinJobAccess,
    fetchJobDetail: fetchLiepinJobDetail,
    normalizeJobResponse: normalizeLiepinJobResponse,
    isRiskControlError: isLiepinJobRiskControlError
  });
})();
