(function () {
  if (!location.hostname.endsWith('liepin.com')) return;

  const EXPECT_PATH = 'com.liepin.csearch.pc.get-valid-expect-info';
  const RECOMMEND_PATH = 'com.liepin.csearch.home-recommend-job-new';
  const OPEN_CHAT_PATH = 'com.liepin.im.c.chat.open-chat';
  let activeRun = null;

  function text(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function keywords(value) {
    return [...new Set(String(value || '').split('|').map((item) => text(item).toLowerCase()).filter(Boolean))];
  }

  function percent(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : fallback;
  }

  function keywordScore(source, configured) {
    const terms = keywords(configured);
    if (!terms.length) return 100;
    const haystack = text(source).toLowerCase();
    return terms.filter((term) => haystack.includes(term)).length / terms.length * 100;
  }

  function configuredRange(minimum, maximum) {
    if (minimum == null && maximum == null) return null;
    return {
      min: minimum == null ? -Infinity : Number(minimum),
      max: maximum == null ? Infinity : Number(maximum)
    };
  }

  function overlaps(actual, wanted) {
    return !wanted || Boolean(actual && actual.max >= wanted.min && actual.min <= wanted.max);
  }

  function salaryRange(value) {
    const match = text(value).match(/(\d+(?:\.\d+)?)\s*(?:-|~|—|至)\s*(\d+(?:\.\d+)?)\s*[kK]/);
    if (match) return { min: Number(match[1]), max: Number(match[2]) };
    const single = text(value).match(/(\d+(?:\.\d+)?)\s*[kK]/);
    return single ? { min: Number(single[1]), max: Number(single[1]) } : null;
  }

  function experienceRange(value) {
    const source = text(value);
    if (!source) return null;
    if (/经验不限|不限/.test(source)) return { min: 0, max: Infinity };
    const range = source.match(/(\d+(?:\.\d+)?)\s*(?:-|~|—|至)\s*(\d+(?:\.\d+)?)\s*年/);
    if (range) return { min: Number(range[1]), max: Number(range[2]) };
    const single = source.match(/(\d+(?:\.\d+)?)\s*年/);
    if (!single) return null;
    const valueNumber = Number(single[1]);
    if (/以上|及以上|起/.test(source)) return { min: valueNumber, max: Infinity };
    if (/以内|以下/.test(source)) return { min: 0, max: valueNumber };
    return { min: valueNumber, max: valueNumber };
  }

  function isApiRiskPayload(payload) {
    const message = text(payload?.msg || payload?.message);
    return /操作过于频繁|请求过于频繁|休息一会|安全验证|验证码|访问受限|登录后/.test(message);
  }

  function makeTraceId() {
    return crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function xsrfToken() {
    const raw = globalThis.JobChatUtils?.getCookieValue?.('XSRF-TOKEN') || '';
    try { return decodeURIComponent(raw); } catch (_) { return raw; }
  }

  function apiHeaders(contentType) {
    const headers = {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': contentType,
      'X-Client-Type': 'web',
      'X-Requested-With': 'XMLHttpRequest',
      'X-Fscp-Bi-Stat': JSON.stringify({ location: location.href }),
      'X-Fscp-Fe-Version': '',
      'X-Fscp-Std-Info': JSON.stringify({ client_id: '40106' }),
      'X-Fscp-Trace-Id': makeTraceId(),
      'X-Fscp-Version': '1.1'
    };
    const token = xsrfToken();
    if (token) headers['X-XSRF-TOKEN'] = token;
    return headers;
  }

  function visibleHeaders(headers) {
    const result = { ...(headers || {}) };
    for (const key of Object.keys(result)) {
      if (/^(cookie|authorization|x-xsrf-token)$/i.test(key)) result[key] = '[已隐藏]';
    }
    return result;
  }

  function requestDebugText(method, url, headers, body) {
    return [
      `请求 ${method} ${url}`,
      `Headers: ${JSON.stringify(visibleHeaders(headers), null, 2)}`,
      `Body: ${body || ''}`
    ].join('\n');
  }

  function responseDebugText(method, url, response, body) {
    return [
      `响应 ${method} ${url}`,
      `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
      `Headers: ${JSON.stringify(Object.fromEntries(response.headers.entries()), null, 2)}`,
      `Body: ${body || ''}`
    ].join('\n');
  }

  async function requestJson(path, options = {}) {
    const url = `https://api-c.liepin.com/api/${path}`;
    const method = 'POST';
    const headers = apiHeaders(options.json ? 'application/json;charset=UTF-8' : 'application/x-www-form-urlencoded');
    const body = options.body == null ? null : (options.json ? JSON.stringify(options.body) : new URLSearchParams(options.body).toString());
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(options.timeoutMs || 30000)));
    try {
      await debugLog(requestDebugText(method, url, headers, body));
      const response = await fetch(url, {
        method,
        credentials: 'include',
        mode: 'cors',
        headers,
        body,
        signal: controller.signal
      });
      const responseText = await response.text();
      await debugLog(responseDebugText(method, url, response, responseText));
      let payload;
      try { payload = responseText ? JSON.parse(responseText) : {}; } catch (_) {
        throw new Error(`${options.label || '猎聘接口'}未返回有效 JSON。`);
      }
      if (!response.ok) {
        const error = new Error(`${options.label || '猎聘接口'}失败：HTTP ${response.status}`);
        error.payload = payload;
        throw error;
      }
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') {
        const timeoutError = new Error(`${options.label || '猎聘接口'}等待响应超时。`);
        timeoutError.name = 'TimeoutError';
        await debugLog(`请求异常 ${method} ${url}\n${timeoutError.name}: ${timeoutError.message}`);
        throw timeoutError;
      }
      await debugLog(`请求异常 ${method} ${url}\n${error?.name || 'Error'}: ${error?.message || String(error)}`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchExpectations() {
    const payload = await requestJson(EXPECT_PATH, { label: '目标职位请求' });
    if (payload?.flag !== 1) throw new Error(payload?.msg || payload?.message || '目标职位接口返回异常。');
    return (Array.isArray(payload?.data?.validExpects) ? payload.data.validExpects : [])
      .map((item) => ({
        encryptId: text(item?.expectId),
        positionName: text(item?.expectJobtitleName),
        data: { ...item }
      }))
      .filter((item) => item.encryptId && item.positionName);
  }

  function selectedExpectation(expectations, config) {
    const id = text(config?.targetExpectId);
    const found = expectations.find((item) => item.encryptId === id);
    if (!found) throw new Error('请选择有效的猎聘目标职位后再启动自动打招呼。');
    return found;
  }

  async function fetchRecommendedJobs(expectation) {
    const selectedExpect = { ...(expectation.data || {}), tabTitle: expectation.positionName };
    const payload = await requestJson(RECOMMEND_PATH, {
      label: '推荐岗位请求',
      json: true,
      body: {
        data: {
          operateKind: 'LOGIN',
          sortType: 'PC_HP_MIX',
          selectedExpect: JSON.stringify(selectedExpect),
          existFallbackResult: false
        }
      }
    });
    if (payload?.flag !== 1) throw new Error(payload?.msg || payload?.message || '推荐岗位接口返回异常。');
    const list = payload?.data?.data;
    if (!Array.isArray(list)) throw new Error('推荐岗位接口缺少岗位列表。');
    return list;
  }

  function candidateParts(candidate) {
    return {
      job: candidate?.job || {},
      recruiter: candidate?.recruiter || {},
      company: candidate?.comp || {}
    };
  }

  function candidateKey(candidate) {
    const { job, recruiter } = candidateParts(candidate);
    return `${text(recruiter.recruiterId).toLowerCase()}|${text(job.jobId).toLowerCase()}`;
  }

  function validateCandidate(candidate) {
    const { job, recruiter } = candidateParts(candidate);
    if (!/^\d+$/.test(text(job.jobId))) return '推荐岗位缺少有效 jobId';
    if (!text(job.jobKind)) return '推荐岗位缺少 jobKind';
    if (!text(job.link)) return '推荐岗位缺少详情链接';
    if (!text(recruiter.recruiterId)) return '推荐岗位缺少 recruiterId';
    if (!text(recruiter.imId)) return '推荐岗位缺少招聘者 imId';
    if (!text(job.dataPromId)) return '推荐岗位缺少 dataPromId';
    return '';
  }

  function listFilterReason(candidate, config, onlineOnly) {
    const { job, recruiter, company } = candidateParts(candidate);
    if (recruiter.chatted === true) return '已与招聘者沟通过';
    if (onlineOnly && recruiter.imStatus !== true) return '招聘者不在线';
    if (config.nonHunterOnly && text(job.jobKind) === '1') return '猎头岗位';
    const wantedSalary = configuredRange(config.salaryMinK, config.salaryMaxK);
    if (wantedSalary && !overlaps(salaryRange(job.salary), wantedSalary)) {
      return salaryRange(job.salary) ? '工资范围不匹配' : '推荐列表薪资无法解析';
    }
    const wantedExperience = configuredRange(config.experienceMinYears, config.experienceMaxYears);
    if (wantedExperience && !overlaps(experienceRange(job.requireWorkYears), wantedExperience)) {
      return experienceRange(job.requireWorkYears) ? '年限不匹配' : '推荐列表年限无法解析';
    }
    const companyName = text(company.fullCompanyName).toLowerCase();
    if (keywords(config.companyFilterKeywords).some((term) => companyName.includes(term))) {
      return '命中公司关键字过滤器';
    }
    return '';
  }

  function detailFilterReason(normalized, config) {
    const job = normalized?.jobInfo || {};
    const description = text(job.description);
    if (description.includes('该职位已暂停招聘')) return '该职位已暂停招聘';
    if (keywords(config.technicalKeywords).length
      && keywordScore(description, config.technicalKeywords) < percent(config.technicalMatchPercent, 50)) {
      return '技术关键字匹配度不足';
    }
    if (keywords(config.jobKeywords).length
      && keywordScore(description, config.jobKeywords) < percent(config.jobMatchPercent, 50)) {
      return '职位关键字匹配度不足';
    }
    const descriptionLower = description.toLowerCase();
    if (keywords(config.jobFilterKeywords).some((term) => descriptionLower.includes(term))) {
      return '命中岗位关键字过滤器';
    }
    return '';
  }

  function headIdFromJob(job) {
    return text(new URLSearchParams(text(job?.dataPromId)).get('head_id'));
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

  async function waitForRate(run, label) {
    const intervalMs = Math.ceil(60000 / Math.max(1, Number(run.config.requestRatePerMinute || 25)));
    while (true) {
      await waitWhilePaused(run);
      const delay = Math.max(0, run.lastRequestAt + intervalMs - Date.now());
      if (!delay) break;
      await report(run, { statusText: `请求限速，等待 ${Math.ceil(delay / 1000)} 秒后继续` });
      if (!await waitForRateDelay(run, delay)) break;
    }
    await waitWhilePaused(run);
    run.lastRequestAt = Date.now();
    await report(run, { statusText: `正在请求${label}` });
  }

  async function report(run, extra = {}) {
    Object.assign(run.progress, extra);
    await chrome.runtime.sendMessage({
      type: 'JOB_CHAT_AUTO_GREETING_PROGRESS',
      runId: run.runId,
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

  async function fetchDetail(run, candidate) {
    const { job, company } = candidateParts(candidate);
    let parsed;
    try { parsed = new URL(text(job.link)); } catch (_) { parsed = null; }
    if (!parsed || parsed.protocol !== 'https:' || !/(^|\.)liepin\.com$/i.test(parsed.hostname)) {
      throw new Error('推荐岗位详情链接无效。');
    }
    await waitForRate(run, '岗位详情');
    const contactType = text(job.jobKind) === '1' ? 'hunter' : 'hr';
    const access = {
      detailUrl: parsed.href,
      contactType,
      jobKind: text(job.jobKind),
      homePage: text(company.link),
      preview: {
        jobTitle: text(job.title),
        jobDqName: text(job.dq || job.dqCityName),
        reqWorkYear: text(job.requireWorkYears),
        reqEdu: text(job.requireEduLevel),
        jobSalary: text(job.salary),
        jobCompany: text(company.fullCompanyName || company.compName)
      },
      previousJobInfo: {}
    };
    const payload = await globalThis.JobChatLiepinExtractor.fetchJobDetail(
      { externalId: text(job.jobId), detailAccessToken: '' },
      access,
      {
        onLog(entry) {
          if (entry?.request) {
            return debugLog(requestDebugText(entry.request.method || 'GET', entry.request.url, entry.request.headers, entry.request.body));
          }
          if (entry?.response) {
            const response = entry.response;
            return debugLog([
              `响应 GET ${response.url || access.detailUrl}`,
              `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
              `Headers: ${JSON.stringify(response.headers || {}, null, 2)}`,
              `Body: ${response.body || ''}`
            ].join('\n'));
          }
          if (entry?.error) {
            return debugLog(`请求异常 GET ${entry?.request?.url || access.detailUrl}\n${entry.error.name || 'Error'}: ${entry.error.message || String(entry.error)}`);
          }
          return debugLog(entry?.message || '猎聘岗位详情请求日志缺失。');
        }
      }
    );
    return globalThis.JobChatLiepinExtractor.normalizeJobResponse(
      payload,
      { externalId: text(job.jobId), detailAccessToken: '' },
      access
    );
  }

  async function openChat(run, candidate) {
    const { job, recruiter } = candidateParts(candidate);
    const headId = headIdFromJob(job);
    if (!headId) throw new Error('推荐岗位缺少有效 head_id。');
    await waitForRate(run, '打招呼接口');
    return requestJson(OPEN_CHAT_PATH, {
      label: '打招呼请求',
      body: {
        head_id: headId,
        ck_id: '',
        jobId: text(job.jobId),
        jobKind: text(job.jobKind),
        recruiterId: text(recruiter.recruiterId),
        shieldComp: 'true'
      }
    });
  }

  function makeRecord(candidate, normalized) {
    const { job, recruiter, company } = candidateParts(candidate);
    const now = new Date();
    const iso = now.toISOString();
    const dateTime = globalThis.JobChatUtils?.formatDateTime(now) || iso;
    const jobInfo = globalThis.JobChatRecords.normalizeJobInfo({
      ...(normalized?.jobInfo || {}),
      salary: text(job.salary),
      experience: text(job.requireWorkYears),
      fetchStatus: 'success',
      fetchedAt: iso,
      errorMessage: ''
    });
    const oppositeImId = text(recruiter.imId);
    const oppositeUserId = text(recruiter.recruiterId);
    return globalThis.JobChatRecords.normalizeStoredRecord({
      recordKey: `liepin|${oppositeImId.toLowerCase()}`,
      siteKey: 'liepin',
      sourceName: '猎聘',
      companyName: text(company.fullCompanyName || company.compName || normalized?.companyProfile?.name),
      companyKey: normalized?.companyProfile?.companyKey || '',
      jobName: text(job.title),
      recruiterName: text(recruiter.recruiterName),
      recruiterTitle: text(recruiter.recruiterTitle),
      lastMessage: '已发送猎聘默认招呼语',
      messageStatus: '已发送',
      applicationDate: dateTime,
      updatedDate: dateTime,
      jobRef: { externalId: text(job.jobId), detailAccessToken: '' },
      jobInfo,
      liepin: {
        imId: globalThis.JobChatUtils?.getCookieValue?.('imId_0') || '',
        oppositeImId,
        oppositeUserId,
        oppositeImUserType: text(recruiter.imUserType || '2'),
        recruiterId: oppositeUserId,
        jobId: text(job.jobId),
        jobKind: text(job.jobKind),
        contactType: text(job.jobKind) === '1' ? 'hunter' : 'hr',
        jobDetailUrl: text(job.link),
        autoGreeting: true
      },
      updatedAt: iso,
      createdAt: iso
    });
  }

  async function releaseReservation(run, candidate, outcome, error) {
    const { job, recruiter } = candidateParts(candidate);
    await chrome.runtime.sendMessage({
      type: 'JOB_CHAT_AUTO_GREETING_OUTCOME',
      runId: run.runId,
      siteKey: 'liepin',
      candidateKey: candidateKey(candidate),
      jobId: text(job.jobId),
      recruiterId: text(recruiter.recruiterId),
      outcome,
      error: String(error || '')
    }).catch(() => {});
  }

  async function processCandidate(run, candidate) {
    const { job, recruiter, company } = candidateParts(candidate);
    await waitWhilePaused(run);
    await report(run, { currentJobName: text(job.title), statusText: '正在检查推荐岗位' });
    const invalidReason = validateCandidate(candidate);
    if (invalidReason) {
      run.progress.skipped += 1;
      await report(run, { statusText: `已跳过：${invalidReason}` });
      return;
    }
    const listReason = listFilterReason(candidate, run.config, run.onlineOnly);
    if (listReason) {
      run.progress.skipped += 1;
      await report(run, { statusText: `已跳过：${listReason}` });
      return;
    }

    const duplicateCheck = await chrome.runtime.sendMessage({
      type: 'JOB_CHAT_AUTO_GREETING_RESERVE',
      runId: run.runId,
      siteKey: 'liepin',
      candidateKey: candidateKey(candidate),
      jobId: text(job.jobId),
      recruiterId: text(recruiter.recruiterId),
      checkOnly: true
    });
    if (!duplicateCheck?.ok) throw new Error(duplicateCheck?.error || '无法检查重复打招呼记录。');
    if (!duplicateCheck.reserved) {
      run.progress.skipped += 1;
      await report(run, { statusText: '已跳过：该岗位或招聘者已有沟通记录' });
      return;
    }

    let normalized;
    while (!normalized) {
      try {
        normalized = await fetchDetail(run, candidate);
      } catch (error) {
        if (!globalThis.JobChatLiepinExtractor?.isRiskControlError?.(error)) {
          run.progress.failed += 1;
          await report(run, { statusText: error?.message || String(error) });
          return;
        }
        run.paused = true;
        await report(run, {
          status: 'paused',
          statusText: `${error?.message || '猎聘岗位详情触发安全验证。'} 任务已暂停，请处理页面后手动继续`
        });
        await waitWhilePaused(run);
      }
    }
    const detailReason = detailFilterReason(normalized, run.config);
    if (detailReason) {
      run.progress.skipped += 1;
      await report(run, { statusText: `已跳过：${detailReason}` });
      return;
    }

    const reservation = await chrome.runtime.sendMessage({
      type: 'JOB_CHAT_AUTO_GREETING_RESERVE',
      runId: run.runId,
      siteKey: 'liepin',
      candidateKey: candidateKey(candidate),
      jobId: text(job.jobId),
      recruiterId: text(recruiter.recruiterId)
    });
    if (!reservation?.ok) throw new Error(reservation?.error || '无法检查重复打招呼记录。');
    if (!reservation.reserved) {
      run.progress.skipped += 1;
      await report(run, { statusText: '已跳过：该岗位或招聘者已有沟通记录' });
      return;
    }
    run.reservedCandidate = candidate;

    let result;
    while (result?.flag !== 1) {
      try {
        result = await openChat(run, candidate);
      } catch (error) {
        run.progress.failed += 1;
        await releaseReservation(run, candidate, 'unknown', error?.message || String(error));
        run.reservedCandidate = null;
        await report(run, { statusText: '发送结果未知，已记录且不会自动重试' });
        return;
      }
      if (result?.flag === 1) break;
      const message = result?.msg || result?.message || '猎聘打招呼接口返回异常。';
      if (isApiRiskPayload(result)) {
        run.paused = true;
        await report(run, { status: 'paused', statusText: `${message} 任务已暂停，请稍后手动继续` });
        await waitWhilePaused(run);
        result = null;
        continue;
      }
      run.progress.failed += 1;
      await releaseReservation(run, candidate, 'failed', message);
      run.reservedCandidate = null;
      await report(run, { statusText: message });
      return;
    }

    const record = makeRecord(candidate, normalized);
    const saved = await chrome.runtime.sendMessage({
      type: 'JOB_CHAT_AUTO_GREETING_SUCCESS',
      runId: run.runId,
      siteKey: 'liepin',
      candidateKey: candidateKey(candidate),
      jobId: text(job.jobId),
      recruiterId: text(recruiter.recruiterId),
      record,
      companyProfile: normalized?.companyProfile,
      sentItem: {
        companyName: record.companyName,
        companyDetail: normalized?.companyProfile?.description || '',
        companyIndustry: text(company.compIndustry || normalized?.companyProfile?.industry),
        companyScale: text(company.compScale || normalized?.companyProfile?.employeeScale),
        jobName: text(job.title),
        jobDetail: record.jobInfo?.description || '',
        salary: text(job.salary),
        jobLocation: text(job.dq || job.dqCityName),
        jobExperience: text(job.requireWorkYears),
        jobEducation: text(job.requireEduLevel),
        jobSkills: Array.isArray(record.jobInfo?.skills) ? record.jobInfo.skills : [],
        jobAddress: record.jobInfo?.address || '',
        message: record.lastMessage,
        sentAt: record.updatedAt
      }
    });
    if (!saved?.ok) throw new Error(saved?.error || '打招呼成功，但同步记录保存失败。');
    run.reservedCandidate = null;
    run.progress.succeeded += 1;
    await report(run, { statusText: '打招呼成功，记录已保存' });
  }

  async function runAutoGreeting(message) {
    const initialProgress = message.initialProgress && typeof message.initialProgress === 'object'
      ? message.initialProgress : {};
    const run = {
      runId: message.runId,
      config: message.config || {},
      onlineOnly: Boolean(message.onlineOnly),
      paused: false,
      cancelled: false,
      resume: null,
      rateWake: null,
      reservedCandidate: null,
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
        statusText: '正在读取猎聘推荐岗位'
      }
    };
    activeRun = run;
    try {
      await report(run);
      const expectations = await fetchExpectations();
      const expectation = selectedExpectation(expectations, run.config);
      await waitForRate(run, '推荐岗位列表');
      const candidates = await fetchRecommendedJobs(expectation);
      const seen = new Set();
      run.progress.totalDiscovered = candidates.length;
      await report(run);
      for (const candidate of candidates) {
        if (run.progress.succeeded >= Number(run.config.greetingCount || 1)) break;
        await waitWhilePaused(run);
        const key = candidateKey(candidate);
        if (!key || seen.has(key)) {
          run.progress.skipped += 1;
          run.progress.processed += 1;
          await report(run, { statusText: '已跳过：本轮重复岗位' });
          continue;
        }
        seen.add(key);
        try { await processCandidate(run, candidate); }
        catch (error) {
          if (error?.name === 'AutoGreetingCancelledError' || run.cancelled) throw error;
          run.progress.failed += 1;
          await report(run, { statusText: error?.message || String(error) });
        }
        run.progress.processed += 1;
        await report(run);
      }
      const reached = run.progress.succeeded >= Number(run.config.greetingCount || 1);
      await report(run, {
        status: 'completed',
        currentJobName: '',
        statusText: reached ? '' : '当前推荐岗位已处理完毕'
      });
    } catch (error) {
      if (error?.name === 'AutoGreetingCancelledError' || run.cancelled) {
        if (run.reservedCandidate) {
          await releaseReservation(run, run.reservedCandidate, 'failed', '任务在发送请求前取消');
        }
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
    if (message?.type === 'JOB_CHAT_AUTO_GREETING_EXPECT_LIST_GET') {
      fetchExpectations()
        .then((expectations) => sendResponse({ ok: true, expectations }))
        .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
      return true;
    }
    if (message?.type === 'JOB_CHAT_AUTO_GREETING_START') {
      if (activeRun) { sendResponse({ ok: false, error: '当前标签页已有自动打招呼任务。' }); return; }
      if (!text(message.config?.targetExpectId)) {
        sendResponse({ ok: false, error: '请选择猎聘目标职位。' });
        return;
      }
      runAutoGreeting(message);
      sendResponse({ ok: true });
      return;
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
