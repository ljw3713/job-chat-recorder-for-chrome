(function () {
  const { normalizeText } = globalThis.JobChatUtils;
  const { normalizeJobRef, normalizeJobInfo, isCompleteJobInfo } = globalThis.JobChatRecords;

  function stoppedError() {
    const error = new Error('岗位信息同步已停止。');
    error.code = 'JOB_SYNC_STOPPED';
    return error;
  }

  function isStopped(error, signal) {
    return Boolean(signal?.aborted || error?.name === 'AbortError' || error?.code === 'JOB_SYNC_STOPPED');
  }

  async function waitUntilElapsed(milliseconds, shouldStop, signal) {
    const deadline = Date.now() + Math.max(0, Number(milliseconds || 0));
    while (Date.now() < deadline) {
      if (signal?.aborted || await shouldStop?.()) throw stoppedError();
      await new Promise((resolve, reject) => {
        const waitMs = Math.min(250, Math.max(0, deadline - Date.now()));
        let timer;
        const onAbort = () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          reject(stoppedError());
        };
        timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, waitMs);
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
      });
    }
  }

  class JobDetailSyncSession {
    constructor(options = {}) {
      this.requestIntervalMs = Math.max(0, Number(options.requestIntervalMs ?? 2000));
      this.maxRequestsPerPage = Math.max(1, Math.floor(Number(options.maxRequestsPerPage ?? 4)));
      this.requestCount = 0;
    }

    needsPageReload() {
      return this.requestCount >= this.maxRequestsPerPage;
    }

    async beforeRequest(options = {}) {
      if (this.needsPageReload()) return false;
      await waitUntilElapsed(this.requestIntervalMs, options.shouldStop, options.signal);
      if (options.signal?.aborted || await options.shouldStop?.()) throw stoppedError();
      this.requestCount += 1;
      return true;
    }

    syncRecord(record, context = {}, options = {}) {
      return syncRecord(record, context, { ...options, requestSession: this });
    }
  }

  function failedJobInfo(oldJobInfo, errorMessage) {
    return normalizeJobInfo({
      ...oldJobInfo,
      fetchStatus: 'failed',
      fetchedAt: new Date().toISOString(),
      errorMessage
    });
  }

  async function syncRecord(record, context = {}, options = {}) {
    const adapter = options.adapter;
    if (!adapter?.resolveJobAccess || !adapter?.fetchJobDetail || !adapter?.normalizeJobResponse) {
      throw new Error('当前网站未配置岗位信息同步适配器。');
    }
    if (options.policy !== 'force' && isCompleteJobInfo(record)) {
      return { record, status: 'skipped', skipped: true, requested: false, errorMessage: '' };
    }
    if (options.signal?.aborted || await options.shouldStop?.()) {
      return { record, status: 'stopped', stopped: true, errorMessage: '' };
    }

    if (options.requestSession?.needsPageReload()) {
      return { record, status: 'reload-required', reloadRequired: true, requested: false, errorMessage: '' };
    }

    let nextJobRef = normalizeJobRef(record?.jobRef);
    let requested = false;
    try {
      const access = await adapter.resolveJobAccess(record, context, options);
      nextJobRef = normalizeJobRef(access?.jobRef);
      if (!nextJobRef.externalId) throw new Error('未获取到岗位外部标识。');
      if (!nextJobRef.detailAccessToken) throw new Error('未获取到岗位详情访问凭证。');
      if (options.signal?.aborted || await options.shouldStop?.()) throw stoppedError();
      if (options.requestSession) {
        const allowed = await options.requestSession.beforeRequest(options);
        if (!allowed) return { record, status: 'reload-required', reloadRequired: true, requested: false, errorMessage: '' };
      }
      requested = true;
      const payload = await adapter.fetchJobDetail(nextJobRef, access, options);
      const normalized = adapter.normalizeJobResponse(payload, nextJobRef, access);
      const jobRef = normalizeJobRef(normalized?.jobRef || nextJobRef);
      const jobInfo = normalizeJobInfo({
        ...(normalized?.jobInfo || {}),
        fetchStatus: 'success',
        fetchedAt: new Date().toISOString(),
        errorMessage: normalizeText(normalized?.jobInfo?.errorMessage || '')
      });
      const companyProfile = normalized?.companyProfile || null;
      if (companyProfile) await options.onCompanyProfile?.(companyProfile);
      return {
        record: {
          ...record,
          jobRef,
          jobInfo,
          companyKey: normalizeText(companyProfile?.companyKey || record?.companyKey || '')
        },
        companyProfile,
        status: 'success',
        requested,
        errorMessage: ''
      };
    } catch (error) {
      if (isStopped(error, options.signal)) return { record, status: 'stopped', stopped: true, error, errorMessage: '' };
      const errorMessage = (normalizeText(error?.message || error) || '岗位信息同步失败。').slice(0, 500);
      return {
        record: {
          ...record,
          jobRef: nextJobRef,
          jobInfo: failedJobInfo(record?.jobInfo, errorMessage)
        },
        status: 'failed',
        requested,
        error,
        errorMessage,
        riskControl: Boolean(adapter.isRiskControlError?.(error))
      };
    }
  }

  async function syncRecords(records, contextForRecord, options = {}) {
    const source = Array.isArray(records) ? records : [];
    const output = [];
    const results = [];
    for (let index = 0; index < source.length; index += 1) {
      if (options.signal?.aborted || await options.shouldStop?.()) {
        return { records: output, results, stopped: true };
      }
      const record = source[index];
      const context = typeof contextForRecord === 'function' ? await contextForRecord(record, index) : (contextForRecord || {});
      const result = await syncRecord(record, context, options);
      results.push(result);
      if (result.record) output.push(result.record);
      await options.onProgress?.({ ...result, index, completed: index + 1, total: source.length });
      if (result.stopped) return { records: output, results, stopped: true };
    }
    return { records: output, results, stopped: false };
  }

  globalThis.JobChatJobSync = {
    JobDetailSyncSession,
    syncRecord,
    syncRecords,
    isCompleteJobInfo,
    normalizeJobInfo,
    normalizeJobRef
  };
})();
