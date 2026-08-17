(function () {
  if (!location.hostname.endsWith('zhipin.com')) return;
  if (globalThis.__jobChatBossAutoGreetingInstalled) return;
  globalThis.__jobChatBossAutoGreetingInstalled = true;

  let activeRun = null;
  let startingRun = false;
  let sourceWake = null;
  const candidateQueue = [];
  const candidateIds = new Set();
  let listHasMore = false;

  function postCommand(command) {
    window.postMessage({ source: 'job-chat-recorder-boss-content', command }, '*');
  }

  function text(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function keywords(value) {
    return [...new Set(String(value || '').split('|').map((item) => text(item).toLowerCase()).filter(Boolean))];
  }

  function keywordScore(source, configured) {
    const terms = keywords(configured);
    if (!terms.length) return 100;
    const haystack = text(source).toLowerCase();
    const matched = terms.filter((term) => haystack.includes(term)).length;
    return matched / terms.length * 100;
  }

  function numericRange(value) {
    const numbers = String(value || '').match(/\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) || [];
    if (!numbers.length) return null;
    return { min: numbers[0], max: numbers[1] ?? numbers[0] };
  }

  function configuredRange(minimum, maximum) {
    if (minimum == null && maximum == null) return null;
    return { min: minimum == null ? -Infinity : Number(minimum), max: maximum == null ? Infinity : Number(maximum) };
  }

  function overlaps(actual, wanted) {
    return !wanted || Boolean(actual && actual.max >= wanted.min && actual.min <= wanted.max);
  }

  function percent(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : fallback;
  }

  function listFilterReason(candidate, config, onlineOnly) {
    if (onlineOnly && candidate.bossOnline !== true) return '招聘者不在线';
    if (config.nonHunterOnly && candidate.goldHunter === 1) return '猎头岗位';
    if (!overlaps(numericRange(candidate.salaryDesc), configuredRange(config.salaryMinK, config.salaryMaxK))) return '工资范围不匹配';
    if (!overlaps(numericRange(candidate.jobExperience), configuredRange(config.experienceMinYears, config.experienceMaxYears))) return '年限不匹配';
    const companyName = text(candidate.brandName).toLowerCase();
    if (keywords(config.companyFilterKeywords).some((term) => companyName.includes(term))) return '命中公司关键字过滤器';
    return '';
  }

  function detailFilterReason(payload, config) {
    const job = payload?.zpData?.jobInfo || {};
    const description = text(job.postDescription);
    if (keywords(config.technicalKeywords).length && keywordScore(description, config.technicalKeywords) < percent(config.technicalMatchPercent, 50)) return '技术关键字匹配度不足';
    if (keywords(config.jobKeywords).length && keywordScore(description, config.jobKeywords) < percent(config.jobMatchPercent, 50)) return '职位关键字匹配度不足';
    if (keywords(config.jobFilterKeywords).some((term) => description.toLowerCase().includes(term))) return '命中岗位关键字过滤器';
    return '';
  }

  async function aiMatchJob(run, job) {
    if (!run.config.aiMatchEnabled) return { matched: true, reason: '' };
    while (true) {
      await waitWhilePaused(run);
      await report(run, { statusText: '正在进行 AI匹配' });
      const response = await chrome.runtime.sendMessage({
        type: 'JOB_CHAT_AUTO_GREETING_AI_MATCH',
        runId: run.runId,
        siteKey: 'boss',
        job
      });
      if (response?.ok) return { matched: Boolean(response.matched), reason: text(response.reason) };
      if (response?.fatal) {
        const error = new Error(response.error || 'AI匹配失败。');
        error.name = 'AutoGreetingFatalError';
        throw error;
      }
      run.paused = true;
      await report(run, {
        status: 'paused',
        statusText: `${response?.error || 'AI匹配暂时不可用。'} 任务已暂停，请稍后继续`
      });
      await waitWhilePaused(run);
    }
  }

  function parseResponse(result, label) {
    let payload;
    try { payload = result?.responseText ? JSON.parse(result.responseText) : {}; } catch (_) {
      throw new Error(`${label}未返回有效 JSON。`);
    }
    if (!result?.ok) {
      const error = new Error(`${label}失败：HTTP ${result?.status || 0}`);
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function enqueueCandidates(jobs, reset) {
    if (reset) {
      candidateQueue.length = 0;
      candidateIds.clear();
    }
    (Array.isArray(jobs) ? jobs : []).forEach((job) => {
      const id = text(job?.encryptJobId);
      if (!id || candidateIds.has(id)) return;
      candidateIds.add(id);
      candidateQueue.push(job);
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== 'job-chat-recorder-boss-hook') return;
    const payload = event.data.payload || {};
    if (payload.type !== 'BOSS_AUTO_GREETING_SOURCE') return;
    sourceWake?.(text(payload.requestUrl));
  });

  function requestRecommendedSourceUrl(timeoutMs = 1500) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (requestUrl) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (sourceWake === finish) sourceWake = null;
        resolve(text(requestUrl));
      };
      const timeout = setTimeout(() => {
        finish('');
      }, timeoutMs);
      sourceWake = finish;
      postCommand({ type: 'BOSS_AUTO_GREETING_SOURCE_GET' });
    });
  }

  function validateRecommendedSourceUrl(requestUrl) {
    let parsed;
    try { parsed = new URL(requestUrl, location.href); } catch (_) { parsed = null; }
    if (parsed?.hostname !== 'www.zhipin.com' || parsed.pathname !== '/wapi/zpgeek/pc/recommend/job/list.json') {
      throw new Error('未获取到页面最近一次推荐岗位请求，请刷新 BOSS 推荐岗位页面后重试。');
    }
    return parsed.href;
  }

  function validateJobListUrl(requestUrl, searchMode = false) {
    if (!searchMode) return validateRecommendedSourceUrl(requestUrl);
    let parsed;
    try { parsed = new URL(requestUrl, location.href); } catch (_) { parsed = null; }
    if (parsed?.hostname !== 'www.zhipin.com' || parsed.pathname !== '/wapi/zpgeek/search/joblist.json') {
      throw new Error('检索岗位请求地址无效。');
    }
    return parsed.href;
  }

  function replaceRawQueryParameter(urlText, name, value, preserveRawValue = false) {
    const hashIndex = urlText.indexOf('#');
    const withoutHash = hashIndex >= 0 ? urlText.slice(0, hashIndex) : urlText;
    const hash = hashIndex >= 0 ? urlText.slice(hashIndex) : '';
    const queryIndex = withoutHash.indexOf('?');
    const base = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
    const query = queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : '';
    let found = false;
    const parts = query ? query.split('&').map((part) => {
      const equalsIndex = part.indexOf('=');
      const rawName = equalsIndex >= 0 ? part.slice(0, equalsIndex) : part;
      let decodedName = rawName;
      try { decodedName = decodeURIComponent(rawName.replace(/\+/g, ' ')); } catch (_) {}
      if (decodedName !== name) return part;
      found = true;
      return `${rawName}=${preserveRawValue ? String(value) : encodeURIComponent(String(value))}`;
    }) : [];
    if (!found) parts.push(`${encodeURIComponent(name)}=${preserveRawValue ? String(value) : encodeURIComponent(String(value))}`);
    return `${base}?${parts.join('&')}${hash}`;
  }

  function recommendedPageUrl(sourceUrl, page) {
    let requestUrl = validateRecommendedSourceUrl(sourceUrl);
    return replaceRawQueryParameter(requestUrl, 'page', page);
  }

  function filterCodes(value, multiple = false) {
    const values = multiple ? (Array.isArray(value) ? value : []) : [value];
    const codes = [...new Set(values.map((item) => text(item?.code ?? item)).filter((code) => code && code !== '0'))];
    const grouped = new Map();
    const plain = [];
    codes.forEach((code) => {
      const match = code.match(/^([^:,]+):([^,_:]+)$/);
      if (!match) { plain.push(code); return; }
      const children = grouped.get(match[1]) || [];
      children.push(match[2]);
      grouped.set(match[1], children);
    });
    return [...plain, ...[...grouped.entries()].map(([parent, children]) => `${parent}:${children.join('_')}`)].join(',');
  }

  function applyRecommendedFilters(urlText, filters = {}) {
    let requestUrl = urlText;
    const fields = [
      ['city', filterCodes(filters.city)],
      ['jobType', filterCodes(filters.jobType)],
      ['salary', filterCodes(filters.salary)],
      ['experience', filterCodes(filters.experience, true)],
      ['degree', filterCodes(filters.degree, true)],
      ['industry', filterCodes(filters.industry, true)],
      ['scale', filterCodes(filters.scale, true)]
    ];
    // Filter values are locally generated numeric codes and commas only. Keep
    // their comma-separated wire format identical to BOSS page requests.
    fields.forEach(([name, value]) => { requestUrl = replaceRawQueryParameter(requestUrl, name, value, true); });
    return requestUrl;
  }

  function recommendedListUrlForExpect(encryptExpectId, filters = {}) {
    const id = text(encryptExpectId);
    if (!id) throw new Error('请选择目标职位后再启动自动打招呼。');
    const baseUrl = `${location.origin}/wapi/zpgeek/pc/recommend/job/list.json?page=1&pageSize=15&city=&encryptExpectId=${encodeURIComponent(id)}&mixExpectType=&expectInfo=&jobType=&salary=&experience=&degree=&industry=&scale=&_=${Date.now()}`;
    return applyRecommendedFilters(baseUrl, filters);
  }

  function searchListUrl() {
    return `${location.origin}/wapi/zpgeek/search/joblist.json?_=${Date.now()}`;
  }

  function searchListBody(config, page) {
    const filters = config?.bossRecommendFilters || {};
    const fields = [
      ['page', page], ['pageSize', 15], ['query', text(config?.bossSearchQuery)],
      ['city', filterCodes(filters.city)], ['jobType', filterCodes(filters.jobType)],
      ['experience', filterCodes(filters.experience, true)], ['degree', filterCodes(filters.degree, true)],
      ['scale', filterCodes(filters.scale, true)], ['salary', filterCodes(filters.salary)],
      ['industry', filterCodes(filters.industry, true)], ['stage', filterCodes(filters.stage, true)],
      ['position', filterCodes(filters.position, true)], ['multiSubway', filterCodes(filters.multiSubway, true)],
      ['multiBusinessDistrict', filterCodes(filters.multiBusinessDistrict, true)], ['scene', '1']
    ];
    return fields.map(([name, value]) => `${name}=${String(value ?? '')}`).join('&');
  }

  function recommendedCandidate(job) {
    const securityId = text(job?.securityId);
    const lid = text(job?.lid);
    const encryptJobId = text(job?.encryptJobId);
    if (!securityId || !lid || !encryptJobId) return null;
    return {
      securityId,
      lid,
      encryptJobId,
      bossOnline: job?.bossOnline === true,
      goldHunter: Number(job?.goldHunter || 0),
      bossName: text(job?.bossName),
      bossTitle: text(job?.bossTitle),
      encryptBossId: text(job?.encryptBossId),
      jobName: text(job?.jobName),
      salaryDesc: text(job?.salaryDesc),
      jobExperience: text(job?.jobExperience),
      brandName: text(job?.brandName)
    };
  }

  async function waitWhilePaused(run) {
    if (!run.timeLimitPaused && Number(run.deadlineAt) > 0 && Date.now() >= Number(run.deadlineAt)) {
      run.timeLimitPaused = true;
      run.paused = true;
      await report(run, { status: 'paused', statusText: '已达到30分钟执行时限，任务已暂停' });
    }
    while (run.paused && !run.cancelled) {
      await new Promise((resolve) => { run.resume = resolve; });
    }
    if (run.cancelled) {
      const error = new Error('任务已取消。');
      error.name = 'AutoGreetingCancelledError';
      throw error;
    }
  }

  function waitForRateDelay(run, milliseconds) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (woken) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (run.rateWake === wake) run.rateWake = null;
        resolve(Boolean(woken));
      };
      const wake = () => finish(true);
      const timer = setTimeout(() => finish(false), milliseconds);
      run.rateWake = wake;
    });
  }

  async function report(run, extra = {}) {
    Object.assign(run.progress, extra);
    await chrome.runtime.sendMessage({
      type: 'JOB_CHAT_AUTO_GREETING_PROGRESS',
      runId: run.runId,
      recommendedListUrl: run.recommendedListUrl,
      deadlineAt: run.deadlineAt,
      timeLimitPaused: run.timeLimitPaused,
      progress: run.progress
    }).catch(() => {});
  }

  function debugLog(message) {
    return chrome.runtime.sendMessage({
      type: 'JOB_CHAT_AUTO_GREETING_DEBUG_LOG',
      message: String(message || '')
    }).catch(() => {});
  }

  async function pacedPageRequest(run, url, init, label) {
    const rate = Math.max(1, Number(run.config.requestRatePerMinute || 25));
    const intervalMs = Math.ceil(60000 / rate);
    const { onStart, ...requestInit } = init || {};
    const method = String(requestInit.method || 'GET').toUpperCase();
    let requestUrl = url;
    while (true) {
      await waitWhilePaused(run);
      const delay = Math.max(0, run.lastRequestAt + intervalMs - Date.now());
      if (delay) {
        await report(run, { statusText: `请求限速，等待 ${Math.ceil(delay / 1000)} 秒后继续` });
        if (await waitForRateDelay(run, delay)) continue;
        await waitWhilePaused(run);
      }
      run.lastRequestAt = Date.now();
      await report(run, { statusText: `正在请求${label}` });
      if (typeof onStart === 'function') onStart();
      await debugLog([
        `请求 ${method} ${requestUrl}`,
        method === 'POST' && requestInit.body != null ? `Request payload\n${String(requestInit.body)}` : ''
      ].filter(Boolean).join('\n'));
      try {
        const requestAbortController = new AbortController();
        run.requestAbortController = requestAbortController;
        const result = await globalThis.JobChatBossPageRequest(requestUrl, {
          ...requestInit,
          signal: requestAbortController.signal
        });
        if (run.requestAbortController === requestAbortController) run.requestAbortController = null;
        await debugLog([
          `响应 ${method} ${requestUrl}`,
          `HTTP ${Number(result?.status || 0)} ${String(result?.statusText || '')}`.trim(),
          String(result?.responseText ?? '')
        ].join('\n'));
        let payload = null;
        try { payload = result?.responseText ? JSON.parse(result.responseText) : null; } catch (_) {}
        if (result?.ok && payload?.code === 0) {
          chrome.runtime.sendMessage({ type: 'JOB_CHAT_AUTO_GREETING_RISK_RECOVERED', runId: run.runId }).catch(() => {});
        }
        if (result?.ok && payload?.code === 1 && String(payload?.message || '').includes('操作过于频繁')) {
          await report(run, { statusText: '请求过于频繁，等待5秒后重试' });
          await debugLog(`${label}返回 code=1（操作过于频繁），5 秒后重试当前请求。`);
          await waitForRateDelay(run, 5000);
          await waitWhilePaused(run);
          try {
            if (new URL(requestUrl, location.href).searchParams.has('_')) {
              requestUrl = replaceRawQueryParameter(requestUrl, '_', Date.now());
            }
          } catch (_) {}
          continue;
        }
        return result;
      } catch (error) {
        run.requestAbortController = null;
        await debugLog([
          `请求异常 ${method} ${requestUrl}`,
          `${error?.name || 'Error'}: ${error?.message || String(error)}`
        ].join('\n'));
        throw error;
      }
    }
  }

  function greetingTextFromResponse(payload) {
    const keys = ['greetingText', 'greetingContent', 'messageContent', 'msgContent', 'content', 'text', 'msg'];
    const queue = [payload?.zpData, payload?.data];
    const visited = new Set();
    while (queue.length) {
      const value = queue.shift();
      if (!value || typeof value !== 'object' || visited.has(value)) continue;
      visited.add(value);
      for (const key of keys) {
        const raw = value[key];
        const candidate = typeof raw === 'string' ? text(raw) : '';
        if (candidate) return candidate;
      }
      Object.values(value).forEach((child) => {
        if (child && typeof child === 'object') queue.push(child);
      });
    }
    return '';
  }

  function makeRecord(candidate, payload, normalized, sentMessage) {
    const now = new Date();
    const dateTime = globalThis.JobChatUtils?.formatDateTime(now) || now.toISOString();
    const detail = payload?.zpData || {};
    const job = detail.jobInfo || {};
    const boss = detail.bossInfo || {};
    const company = detail.brandComInfo || {};
    const jobId = text(job.encryptId || candidate.encryptJobId);
    const encryptBossId = text(boss.encryptBossId || job.encryptUserId || candidate.encryptBossId);
    return globalThis.JobChatRecords.normalizeStoredRecord({
      siteKey: 'boss',
      sourceName: 'BOSS直聘',
      companyName: text(company.brandName || candidate.brandName),
      companyKey: normalized.companyProfile?.companyKey || '',
      jobName: text(job.jobName || candidate.jobName),
      recruiterName: text(boss.name || boss.bossName || candidate.bossName),
      recruiterTitle: text(boss.title || boss.bossTitle || candidate.bossTitle),
      lastMessage: sentMessage || '已发送 BOSS 默认招呼语',
      messageStatus: '已发送',
      applicationDate: dateTime,
      updatedDate: dateTime,
      jobRef: { externalId: jobId, detailAccessToken: text(detail.securityId) },
      jobInfo: { ...normalized.jobInfo, fetchStatus: 'success', fetchedAt: now.toISOString(), errorMessage: '' },
      companyKey: normalized.companyProfile?.companyKey || '',
      boss: {
        encryptBossId,
        peerKey: encryptBossId,
        bossId: text(boss.bossId),
        jobId,
        chatSecurityId: '',
        friendId: '',
        friendSource: ''
      },
      updatedAt: now.toISOString(),
      createdAt: now.toISOString()
    });
  }

  async function restartAfterRiskControl(run, phase, jobId = '') {
    if (jobId) {
      await chrome.runtime.sendMessage({
        type: 'JOB_CHAT_AUTO_GREETING_OUTCOME',
        runId: run.runId,
        jobId,
        outcome: 'failed',
        error: `code=37：${phase}`
      }).catch(() => {});
      run.reservedJobId = '';
      run.postStartedJobId = '';
    }
    await report(run, { status: 'refreshing', statusText: `检测到环境异常（code=37），正在刷新页面重试：${phase}` });
    await chrome.runtime.sendMessage({
      type: 'JOB_CHAT_AUTO_GREETING_RISK_CONTROL',
      runId: run.runId,
      recommendedListUrl: run.recommendedListUrl,
      phase
    });
    const error = new Error('检测到环境异常，任务交由刷新流程继续。');
    error.name = 'AutoGreetingRiskControlError';
    throw error;
  }

  async function loadRecommendedPage(run, sourceUrl, page, reset = false) {
    const searchMode = run.config?.bossSourceMode === 'search';
    const requestUrl = searchMode ? sourceUrl : recommendedPageUrl(sourceUrl, page);
    const init = searchMode
      ? { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body: searchListBody(run.config, page), timeoutMs: 30000 }
      : { timeoutMs: 30000 };
    const payload = parseResponse(
      await pacedPageRequest(run, requestUrl, init, `${searchMode ? '检索' : '推荐'}岗位第 ${page} 页`),
      `${searchMode ? '检索' : '推荐'}岗位请求`
    );
    if (payload.code === 37) await restartAfterRiskControl(run, '推荐岗位请求');
    if (payload.code !== 0) throw new Error(payload.message || `推荐岗位接口返回 code=${payload.code}`);
    if (!Array.isArray(payload?.zpData?.jobList)) throw new Error('推荐岗位接口缺少岗位列表。');
    const jobs = payload.zpData.jobList.map(recommendedCandidate).filter(Boolean);
    listHasMore = payload.zpData.hasMore === true;
    enqueueCandidates(jobs, reset);
    return jobs.length;
  }

  async function processCandidate(run, candidate) {
    await waitWhilePaused(run);
    await report(run, { currentJobName: text(candidate.jobName), statusText: '正在检查推荐岗位' });
    const listReason = listFilterReason(candidate, run.config, run.onlineOnly);
    if (listReason) {
      run.progress.skipped += 1;
      await report(run, { statusText: `已跳过：${listReason}` });
      return;
    }

    await report(run, { statusText: '正在获取岗位详情' });
    let payload;
    try {
      const detailUrl = new URL('/wapi/zpgeek/job/detail.json', location.origin);
      detailUrl.searchParams.set('securityId', candidate.securityId);
      detailUrl.searchParams.set('lid', candidate.lid);
      detailUrl.searchParams.set('_', String(Date.now()));
      payload = parseResponse(await pacedPageRequest(run, detailUrl.toString(), { timeoutMs: 30000 }, '岗位详情'), '岗位详情请求');
      if (payload.code === 37) await restartAfterRiskControl(run, '岗位详情请求');
      if (payload.code !== 0) throw new Error(payload.message || `岗位详情接口返回 code=${payload.code}`);
    } catch (error) {
      if (error?.payload?.code === 37) await restartAfterRiskControl(run, '岗位详情请求');
      if (error?.name === 'AutoGreetingRiskControlError') throw error;
      run.progress.failed += 1;
      await report(run, { statusText: error?.message || String(error) });
      return;
    }

    const reason = detailFilterReason(payload, run.config);
    if (reason) {
      run.progress.skipped += 1;
      await report(run, { statusText: `已跳过：${reason}` });
      return;
    }

    const detail = payload.zpData || {};
    const jobId = text(detail.jobInfo?.encryptId);
    const securityId = text(detail.securityId);
    const lid = text(detail.lid);
    if (!jobId || !securityId || !lid) {
      run.progress.failed += 1;
      await report(run, { statusText: '岗位详情缺少打招呼所需参数' });
      return;
    }

    const duplicateCheck = await chrome.runtime.sendMessage({
      type: 'JOB_CHAT_AUTO_GREETING_RESERVE', runId: run.runId, jobId, checkOnly: true
    });
    if (!duplicateCheck?.ok) throw new Error(duplicateCheck?.error || '无法检查重复打招呼记录。');
    if (!duplicateCheck.reserved) {
      run.progress.skipped += 1;
      await report(run, { statusText: '已跳过：该岗位已有沟通或发送记录' });
      return;
    }

    const normalized = globalThis.JobChatBossExtractor.normalizeJobResponse(payload, { externalId: jobId, detailAccessToken: '' });
    const aiResult = await aiMatchJob(run, {
      title: normalized.jobName || candidate.jobName,
      description: normalized.jobInfo?.description || text(detail.jobInfo?.postDescription),
      skills: Array.isArray(normalized.jobInfo?.skills) ? normalized.jobInfo.skills : [],
      salary: normalized.jobInfo?.salary || candidate.salaryDesc,
      experience: normalized.jobInfo?.experience || candidate.jobExperience,
      education: normalized.jobInfo?.education || text(detail.jobInfo?.degreeName),
      location: normalized.jobInfo?.location || text(detail.jobInfo?.locationName),
      companyName: normalized.companyName || candidate.brandName,
      companyIndustry: normalized.companyProfile?.industry || '',
      companyScale: normalized.companyProfile?.employeeScale || ''
    });
    if (!aiResult.matched) {
      run.progress.skipped += 1;
      await report(run, { statusText: `已跳过：AI匹配未通过${aiResult.reason ? `（${aiResult.reason}）` : ''}` });
      return;
    }
    await report(run, { statusText: `AI匹配通过${aiResult.reason ? `：${aiResult.reason}` : ''}` });

    const reservation = await chrome.runtime.sendMessage({
      type: 'JOB_CHAT_AUTO_GREETING_RESERVE', runId: run.runId, jobId
    });
    if (!reservation?.ok) throw new Error(reservation?.error || '无法检查重复打招呼记录。');
    if (!reservation.reserved) {
      run.progress.skipped += 1;
      await report(run, { statusText: '已跳过：该岗位已有沟通或发送记录' });
      return;
    }
    run.reservedJobId = jobId;
    run.postStartedJobId = '';

    const addUrl = new URL('/wapi/zpgeek/friend/add.json', location.origin);
    addUrl.searchParams.set('securityId', securityId);
    addUrl.searchParams.set('jobId', jobId);
    addUrl.searchParams.set('lid', lid);
    let addResult;
    try {
      addResult = await pacedPageRequest(run, addUrl.toString(), {
        method: 'POST',
        timeoutMs: 30000,
        onStart: () => { run.postStartedJobId = jobId; }
      }, '打招呼接口');
    } catch (error) {
      run.progress.failed += 1;
      await chrome.runtime.sendMessage({ type: 'JOB_CHAT_AUTO_GREETING_OUTCOME', runId: run.runId, jobId, outcome: 'unknown', error: error?.message || String(error) }).catch(() => {});
      run.reservedJobId = '';
      run.postStartedJobId = '';
      await report(run, { statusText: '发送结果未知，已记录且不会自动重试' });
      return;
    }
    let earlyAddPayload = null;
    try { earlyAddPayload = addResult?.responseText ? JSON.parse(addResult.responseText) : null; } catch (_) {}
    if (earlyAddPayload?.code === 37) await restartAfterRiskControl(run, '打招呼请求', jobId);
    if (!addResult?.ok) {
      run.progress.failed += 1;
      const errorMessage = `打招呼请求失败：HTTP ${addResult?.status || 0}`;
      await chrome.runtime.sendMessage({ type: 'JOB_CHAT_AUTO_GREETING_OUTCOME', runId: run.runId, jobId, outcome: 'failed', error: errorMessage }).catch(() => {});
      run.reservedJobId = '';
      run.postStartedJobId = '';
      await report(run, { statusText: errorMessage });
      return;
    }
    let addPayload;
    try { addPayload = parseResponse(addResult, '打招呼请求'); }
    catch (error) {
      run.progress.failed += 1;
      await chrome.runtime.sendMessage({ type: 'JOB_CHAT_AUTO_GREETING_OUTCOME', runId: run.runId, jobId, outcome: 'unknown', error: error?.message || String(error) }).catch(() => {});
      run.reservedJobId = '';
      run.postStartedJobId = '';
      await report(run, { statusText: '发送响应无法确认，已记录且不会自动重试' });
      return;
    }
    if (addPayload.code === 37) await restartAfterRiskControl(run, '打招呼请求', jobId);
    if (addPayload.code !== 0) {
      run.progress.failed += 1;
      await chrome.runtime.sendMessage({ type: 'JOB_CHAT_AUTO_GREETING_OUTCOME', runId: run.runId, jobId, outcome: 'failed', error: addPayload.message || `code=${addPayload.code}` }).catch(() => {});
      run.reservedJobId = '';
      run.postStartedJobId = '';
      await report(run, { statusText: addPayload.message || `发送失败（code=${addPayload.code}）` });
      return;
    }

    const sentMessage = greetingTextFromResponse(addPayload);
    const record = makeRecord(candidate, payload, normalized, sentMessage);
    const saved = await chrome.runtime.sendMessage({
      type: 'JOB_CHAT_AUTO_GREETING_SUCCESS', runId: run.runId, jobId,
      record,
      companyProfile: normalized.companyProfile,
      sentItem: {
        companyName: record.companyName,
        companyDetail: normalized.companyProfile?.description || '',
        companyIndustry: normalized.companyProfile?.industry || '',
        companyScale: normalized.companyProfile?.employeeScale || '',
        jobName: record.jobName,
        jobDetail: record.jobInfo?.description || '',
        salary: record.jobInfo?.salary || candidate.salaryDesc || '',
        jobLocation: record.jobInfo?.location || '',
        jobExperience: record.jobInfo?.experience || '',
        jobEducation: record.jobInfo?.education || '',
        jobSkills: Array.isArray(record.jobInfo?.skills) ? record.jobInfo.skills : [],
        jobAddress: record.jobInfo?.address || '',
        message: record.lastMessage,
        sentAt: record.updatedAt,
        aiMatchResult: run.config.aiMatchEnabled ? (aiResult.reason || '匹配通过') : ''
      }
    });
    if (!saved?.ok) throw new Error(saved?.error || '打招呼成功，但同步记录保存失败。');
    run.reservedJobId = '';
    run.postStartedJobId = '';
    run.progress.succeeded += 1;
    await report(run, { statusText: '打招呼成功，记录已保存' });
  }

  async function runAutoGreeting(message) {
    const initialProgress = message.initialProgress && typeof message.initialProgress === 'object'
      ? message.initialProgress
      : {};
    const run = {
      runId: message.runId,
      recommendedListUrl: validateJobListUrl(message.recommendedListUrl, message.config?.bossSourceMode === 'search'),
      config: message.config || {},
      onlineOnly: Boolean(message.onlineOnly),
      paused: false,
      cancelled: false,
      reservedJobId: '',
      postStartedJobId: '',
      resume: null,
      rateWake: null,
      requestAbortController: null,
      deadlineAt: Number(message.deadlineAt || Date.now() + 30 * 60 * 1000),
      timeLimitPaused: Boolean(initialProgress.timeLimitPaused),
      lastRequestAt: 0,
      progress: {
        status: 'running',
        processed: Number(initialProgress.processed || 0),
        succeeded: Number(initialProgress.succeeded || 0),
        skipped: Number(initialProgress.skipped || 0),
        failed: Number(initialProgress.failed || 0),
        totalDiscovered: Number(initialProgress.totalDiscovered || 0),
        currentJobName: '',
        statusText: initialProgress.succeeded ? '页面已刷新，继续处理岗位' : (message.config?.bossSourceMode === 'search' ? '正在检索岗位' : '正在读取推荐岗位')
      }
    };
    activeRun = run;
    candidateQueue.length = 0;
    candidateIds.clear();
    listHasMore = false;
    let nextPage = 1;
    let emptyPages = 0;
    try {
      await report(run);
      while (run.progress.succeeded < Number(run.config.greetingCount || 1)) {
        await waitWhilePaused(run);
        if (!candidateQueue.length) {
          if (nextPage > 1 && (!listHasMore || emptyPages >= 3)) break;
          const loaded = await loadRecommendedPage(run, run.recommendedListUrl, nextPage, nextPage === 1);
          nextPage += 1;
          emptyPages = loaded ? 0 : emptyPages + 1;
          continue;
        }
        const candidate = candidateQueue.shift();
        run.progress.totalDiscovered = candidateIds.size;
        try { await processCandidate(run, candidate); }
        catch (error) {
          if (error?.name === 'AutoGreetingRiskControlError') throw error;
          if (error?.name === 'AutoGreetingFatalError') throw error;
          if (error?.name === 'AutoGreetingCancelledError' || run.cancelled) {
            if (run.reservedJobId && !run.postStartedJobId) {
              await chrome.runtime.sendMessage({
                type: 'JOB_CHAT_AUTO_GREETING_OUTCOME',
                runId: run.runId,
                jobId: run.reservedJobId,
                outcome: 'failed',
                error: '任务在发送请求前取消'
              }).catch(() => {});
              run.reservedJobId = '';
            }
            throw error;
          }
          run.progress.failed += 1;
          await report(run, { statusText: error?.message || String(error) });
        }
        run.progress.processed += 1;
        await report(run);
      }
      const targetReached = run.progress.succeeded >= Number(run.config.greetingCount || 1);
      await report(run, { status: 'completed', currentJobName: '', statusText: targetReached ? '' : '当前推荐岗位已处理完毕' });
    } catch (error) {
      if (error?.name === 'AutoGreetingRiskControlError') {
        // 后台会刷新当前标签页，并用同一个 runId 和持久化进度重启任务。
      } else if (error?.name === 'AutoGreetingCancelledError' || run.cancelled) {
        await report(run, { status: 'cancelled', currentJobName: '', statusText: '自动打招呼任务已取消' });
      } else {
        await report(run, { status: 'failed', statusText: error?.message || String(error) });
      }
    } finally {
      activeRun = null;
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'JOB_CHAT_AUTO_GREETING_STATUS') {
      sendResponse({ ok: true, active: Boolean(activeRun), runId: activeRun?.runId || '' });
      return;
    }
    if (message?.type === 'JOB_CHAT_AUTO_GREETING_START') {
      if (activeRun || startingRun) { sendResponse({ ok: false, error: '当前标签页已有自动打招呼任务。' }); return; }
      try {
        // The first start builds a complete URL from the saved filter snapshot.
        // Once that URL has been persisted, including page-reload recovery, paging
        // must preserve every original parameter and change only `page`.
        const recommendedListUrl = message.recommendedListUrl || (message.config?.bossSourceMode === 'search'
          ? searchListUrl()
          : recommendedListUrlForExpect(message.config?.targetExpectId, message.config?.bossRecommendFilters));
        runAutoGreeting({ ...message, recommendedListUrl });
        sendResponse({ ok: true, recommendedListUrl });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
      return;
    }
    if (message?.type === 'JOB_CHAT_AUTO_GREETING_EXPECT_LIST_GET') {
      globalThis.JobChatBossPageRequest('/wapi/zpgeek/pc/recommend/expect/list.json', { timeoutMs: 30000 })
        .then((result) => parseResponse(result, '目标职位请求'))
        .then((payload) => {
          if (payload.code !== 0) throw new Error(payload.message || `目标职位接口返回 code=${payload.code}`);
          const expectations = (Array.isArray(payload?.zpData?.expectList) ? payload.zpData.expectList : [])
            .map((item) => ({ encryptId: text(item?.encryptId), positionName: text(item?.positionName) }))
            .filter((item) => item.encryptId && item.positionName);
          sendResponse({ ok: true, expectations });
        })
        .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
      return true;
    }
    if (message?.type === 'JOB_CHAT_AUTO_GREETING_FILTER_OPTIONS_GET') {
      const stamp = Date.now();
      const request = (url, label) => globalThis.JobChatBossPageRequest(url, { timeoutMs: 30000 })
        .then((result) => parseResponse(result, label));
      Promise.all([
        request('/wapi/zpgeek/common/data/city/site.json', '城市条件请求'),
        request(`/wapi/zpgeek/pc/all/filter/conditions.json?_=${stamp}`, '筛选条件请求'),
        request(`/wapi/zpCommon/data/industryFilterExemption?_=${stamp}`, '行业条件请求'),
        request(`/wapi/zpCommon/data/getCityShowPosition?_=${stamp}`, '职位类型请求')
      ]).then(([cityPayload, conditionPayload, industryPayload, positionPayload]) => {
        if (cityPayload.code !== 0 || conditionPayload.code !== 0 || industryPayload.code !== 0 || positionPayload.code !== 0) {
          throw new Error('筛选条件接口返回异常。');
        }
        const option = (item) => ({ code: text(item?.code), name: text(item?.name) });
        const cityMap = new Map();
        (Array.isArray(cityPayload?.zpData?.siteGroup) ? cityPayload.zpData.siteGroup : []).forEach((group) => {
          (Array.isArray(group?.cityList) ? group.cityList : []).forEach((city) => {
            const item = option(city);
            if (item.code && item.name && !cityMap.has(item.code)) cityMap.set(item.code, item);
          });
        });
        const list = (name) => (Array.isArray(conditionPayload?.zpData?.[name]) ? conditionPayload.zpData[name] : [])
          .map(option).filter((item) => item.code && item.code !== '0' && item.name);
        const industries = (Array.isArray(industryPayload?.zpData) ? industryPayload.zpData : []).map((group) => ({
          code: text(group?.code),
          name: text(group?.name),
          children: (Array.isArray(group?.subLevelModelList) ? group.subLevelModelList : [])
            .map(option).filter((item) => item.code && item.name)
        })).filter((group) => group.name && group.children.length);
        const collectPositionLeaves = (nodes) => (Array.isArray(nodes) ? nodes : []).flatMap((node) => {
          const children = collectPositionLeaves(node?.subLevelModelList);
          return children.length ? children : [option(node)].filter((item) => item.code && item.name);
        });
        const positions = (Array.isArray(positionPayload?.zpData?.position) ? positionPayload.zpData.position : []).map((group) => ({
          code: text(group?.code), name: text(group?.name), children: collectPositionLeaves(group?.subLevelModelList)
        })).filter((group) => group.name && group.children.length);
        sendResponse({ ok: true, options: {
          cities: [...cityMap.values()], jobTypes: list('jobTypeList'), salaries: list('salaryList'),
          experiences: list('experienceList'), degrees: list('degreeList'), scales: list('scaleList'),
          stages: list('stageList'), industries, positions
        } });
      }).catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
      return true;
    }
    if (message?.type === 'JOB_CHAT_AUTO_GREETING_LOCATION_FILTER_OPTIONS_GET') {
      const cityCode = text(message.cityCode);
      if (!/^\d+$/.test(cityCode)) { sendResponse({ ok: false, error: '请选择有效城市后再读取区域和地铁。' }); return; }
      const stamp = Date.now();
      const request = (url, label) => globalThis.JobChatBossPageRequest(url, { timeoutMs: 30000 })
        .then((result) => parseResponse(result, label));
      Promise.all([
        request(`/wapi/zpgeek/businessDistrict.json?cityCode=${cityCode}&_=${stamp}`, '区域条件请求'),
        request(`/wapi/zpCommon/data/getSubwayByCity?cityCode=${cityCode}&_=${stamp}`, '地铁条件请求')
      ]).then(([districtPayload, subwayPayload]) => {
        if (districtPayload.code !== 0 || subwayPayload.code !== 0) throw new Error('区域或地铁条件接口返回异常。');
        const groupList = (list) => (Array.isArray(list) ? list : []).map((parent) => {
          const parentCode = text(parent?.code);
          const parentName = text(parent?.name);
          const children = (Array.isArray(parent?.subLevelModelList) ? parent.subLevelModelList : []).map((child) => ({
            code: `${parentCode}:${text(child?.code)}`, name: text(child?.name)
          })).filter((item) => item.code !== ':' && item.name);
          return { code: parentCode, name: parentName, children: [{ code: parentCode, name: `全${parentName}` }, ...children] };
        }).filter((group) => group.code && group.name);
        sendResponse({ ok: true, options: {
          districts: groupList(districtPayload?.zpData?.businessDistrict?.subLevelModelList),
          subways: groupList(subwayPayload?.zpData?.subwayList)
        } });
      }).catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
      return true;
    }
    if (message?.type === 'JOB_CHAT_AUTO_GREETING_PAUSE') {
      if (!activeRun) { sendResponse({ ok: false, error: '当前标签页没有运行中的任务。' }); return; }
      activeRun.paused = true;
      report(activeRun, { status: 'paused', statusText: '已暂停，将在当前请求完成后停止继续处理' });
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === 'JOB_CHAT_AUTO_GREETING_RESUME') {
      if (!activeRun) { sendResponse({ ok: false, error: '当前标签页没有可继续的任务。' }); return; }
      activeRun.paused = false;
      activeRun.timeLimitPaused = false;
      activeRun.deadlineAt = Date.now() + 30 * 60 * 1000;
      activeRun.progress.status = 'running';
      activeRun.progress.statusText = '继续处理推荐岗位，已重新开始30分钟计时';
      activeRun.resume?.();
      activeRun.resume = null;
      report(activeRun);
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === 'JOB_CHAT_AUTO_GREETING_CANCEL') {
      if (!activeRun?.paused) { sendResponse({ ok: false, error: '请先暂停任务再取消。' }); return; }
      activeRun.cancelled = true;
      activeRun.paused = false;
      activeRun.resume?.();
      activeRun.resume = null;
      activeRun.rateWake?.();
      activeRun.rateWake = null;
      activeRun.requestAbortController?.abort();
      activeRun.requestAbortController = null;
      report(activeRun, { status: 'cancelling', statusText: '正在取消任务' });
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === 'JOB_CHAT_AUTO_GREETING_WAKE') {
      activeRun?.rateWake?.();
      sendResponse({ ok: true, active: Boolean(activeRun) });
    }
  });
})();
