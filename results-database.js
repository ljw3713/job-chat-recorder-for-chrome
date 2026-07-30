(function () {
  const { normalizeText } = globalThis.JobChatUtils;
  const { makeRecordKey } = globalThis.JobChatRecords;

  function tsv(headers, rows, includeHeader = true) {
    const lines = includeHeader ? [headers, ...rows] : rows;
    return lines.map((row) => row.map((cell) => String(cell ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
  }

  function csvEscape(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function csv(headers, rows) {
    return [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      const next = text[i + 1];
      if (inQuotes) {
        if (ch === '"' && next === '"') { cell += '"'; i += 1; }
        else if (ch === '"') inQuotes = false;
        else cell += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { row.push(cell); cell = ''; }
        else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
        else if (ch !== '\r') cell += ch;
      }
    }
    row.push(cell);
    if (row.length > 1 || row[0]) rows.push(row);
    return rows;
  }

  function cloneJsonObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    try {
      const cloned = JSON.parse(JSON.stringify(value));
      return cloned && typeof cloned === 'object' && !Array.isArray(cloned) ? cloned : {};
    } catch (_) {
      return {};
    }
  }

  function stripPublicData(record) {
    const data = cloneJsonObject(record);
    [
      'index',
      'recordKey',
      'sourceName',
      'companyName',
      'jobName',
      'applicationDate',
      'updatedDate',
      'note',
      'messageStatus',
      'recruiterName',
      'recruiterTitle',
      'lastMessage'
    ].forEach((field) => delete data[field]);
    return data;
  }

  function csvInternalData(record) {
    return JSON.stringify(stripPublicData(record));
  }

  function parseCsvInternalData(value, rowNumber) {
    const text = normalizeText(value);
    if (!text) return null;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      throw new Error(`CSV 第 ${rowNumber} 行“内部数据”不是有效 JSON。`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`CSV 第 ${rowNumber} 行“内部数据”必须是 JSON 对象。`);
    }
    return cloneJsonObject(parsed);
  }

  function rowsFromImportedCsv(text, options = {}) {
    const rows = parseCsv(text.replace(/^\ufeff/, ''));
    if (!rows.length) return [];
    const headers = rows[0].map((h) => normalizeText(h));
    const get = (row, name) => row[headers.indexOf(name)] || '';
    const hasInternalDataColumn = headers.includes('内部数据');
    const hasInternalData = hasInternalDataColumn
      && rows.slice(1).some((row) => normalizeText(get(row, '内部数据')));
    if (hasInternalData && !options.allowInternalData) {
      throw new Error('CSV 包含“内部数据”，仅总览页 URL 使用 debug=true 时允许导入。');
    }
    return rows.slice(1).filter((row) => row.some((cell) => normalizeText(cell))).map((row, index) => {
      const sourceName = get(row, '来源');
      const recruiter = get(row, '招聘者') || get(row, '招聘者信息');
      const [recruiterName, recruiterTitle] = recruiter.split('/').map((v) => normalizeText(v));
      const internalData = options.allowInternalData
        ? parseCsvInternalData(get(row, '内部数据'), index + 2)
        : null;
      const record = {
        ...(internalData || {}),
        index: index + 1,
        recordKey: get(row, '唯一索引id'),
        sourceName,
        siteKey: sourceName === '猎聘' ? 'liepin' : sourceName === 'BOSS直聘' ? 'boss' : '',
        companyName: get(row, '公司名'),
        jobName: get(row, '岗位名'),
        applicationDate: get(row, '申请时间'),
        updatedDate: get(row, '更新时间'),
        note: get(row, '备注'),
        messageStatus: get(row, '状态') || get(row, '消息状态'),
        recruiterName,
        recruiterTitle: recruiterTitle || '',
        lastMessage: get(row, '原消息'),
        importedAt: internalData?.importedAt || new Date().toISOString(),
        updatedAt: internalData?.updatedAt || new Date().toISOString(),
        _csvHasInternalData: hasInternalDataColumn && Boolean(internalData)
      };
      record.recordKey = normalizeText(record.recordKey) || makeRecordKey(record);
      return record;
    });
  }

  function mergeImportedRecord(existingRecord, importedRecord, options = {}) {
    const existing = existingRecord || {};
    const imported = importedRecord || {};
    const hasInternalData = Boolean(options.allowInternalData && imported._csvHasInternalData);
    const merged = {
      ...existing,
      ...imported
    };
    delete merged._csvHasInternalData;

    if (hasInternalData) {
      if (existing.boss || imported.boss) {
        merged.boss = {
          ...(existing.boss || {}),
          ...(imported.boss || {}),
          lastMessageInfo: {
            ...(existing.boss?.lastMessageInfo || {}),
            ...(imported.boss?.lastMessageInfo || {})
          }
        };
      }
      if (existing.liepin || imported.liepin) {
        merged.liepin = {
          ...(existing.liepin || {}),
          ...(imported.liepin || {})
        };
      }
    } else {
      if (existing.boss) merged.boss = existing.boss;
      else delete merged.boss;
      if (existing.liepin) merged.liepin = existing.liepin;
      else delete merged.liepin;
    }

    if (!hasInternalData) {
      if (existing.jobRef !== undefined) merged.jobRef = existing.jobRef;
      else delete merged.jobRef;
      if (existing.jobInfo !== undefined) merged.jobInfo = existing.jobInfo;
      else delete merged.jobInfo;
      if (existing.companyKey !== undefined) merged.companyKey = existing.companyKey;
      else delete merged.companyKey;
    }
    return merged;
  }

  async function loadResultsState() {
    return chrome.storage.local.get([
      'jobChatPendingRecords',
      'jobChatExtractionStatus',
      'jobChatRecords',
      'bossChatStatsLatest',
      'jobChatIgnoredRecords',
      'jobChatCompanyProfiles'
    ]);
  }

  async function saveSyncRecords(latestData, records) {
    const data = { ...(latestData || {}), total: records.length, records };
    await chrome.storage.local.set({ jobChatPendingRecords: data, bossChatStatsLatest: data });
    return data;
  }

  async function saveOverviewRecords(latestData, records) {
    const data = { ...(latestData || {}), total: records.length, records };
    await chrome.storage.local.set({ jobChatRecords: records, bossChatStatsLatest: data });
    return data;
  }

  async function saveIgnoredRecords(records) {
    await chrome.storage.local.set({ jobChatIgnoredRecords: records });
  }

  async function loadTotalRecords() {
    const store = await chrome.storage.local.get(['jobChatRecords']);
    return Array.isArray(store.jobChatRecords) ? store.jobChatRecords : [];
  }

  async function saveMultiple(values) {
    await chrome.storage.local.set(values);
  }

  function normalizeSyncRateSettings(rawSettings, legacyRate) {
    const unit = ['second', 'minute', 'hour'].includes(rawSettings?.unit) ? rawSettings.unit : 'second';
    const count = Math.max(1, Math.min(3600, Math.floor(Number(rawSettings?.count || legacyRate || 2))));
    return { unit, count };
  }

  async function loadSyncRateSettings() {
    const store = await chrome.storage.local.get(['jobChatSyncRateSettings', 'jobChatSyncRateLimit']);
    return normalizeSyncRateSettings(store.jobChatSyncRateSettings, store.jobChatSyncRateLimit);
  }

  async function saveSyncRateSettings(settings) {
    await chrome.storage.local.set({ jobChatSyncRateSettings: normalizeSyncRateSettings(settings) });
  }

  function normalizeBossSendRate(value) {
    const rate = Number(value);
    return Number.isFinite(rate) ? Math.max(1, Math.floor(rate)) : 10;
  }
  async function loadBossSendRate() {
    const store = await chrome.storage.local.get(['jobChatBossSendRate']);
    return normalizeBossSendRate(store.jobChatBossSendRate);
  }
  async function saveBossSendRate(value) { await chrome.storage.local.set({ jobChatBossSendRate: normalizeBossSendRate(value) }); }
  async function loadSendRate(siteKey) {
    const store = await chrome.storage.local.get(['jobChatSendRates', 'jobChatBossSendRate']);
    const rates = store.jobChatSendRates && typeof store.jobChatSendRates === 'object'
      ? store.jobChatSendRates
      : {};
    return normalizeBossSendRate(rates[siteKey] ?? store.jobChatBossSendRate);
  }
  async function saveSendRate(siteKey, value) {
    const store = await chrome.storage.local.get(['jobChatSendRates']);
    const rates = store.jobChatSendRates && typeof store.jobChatSendRates === 'object'
      ? { ...store.jobChatSendRates }
      : {};
    rates[siteKey] = normalizeBossSendRate(value);
    await chrome.storage.local.set({ jobChatSendRates: rates });
  }

  globalThis.JobChatResultsDb = {
    tsv,
    csv,
    csvInternalData,
    rowsFromImportedCsv,
    mergeImportedRecord,
    loadResultsState,
    saveSyncRecords,
    saveOverviewRecords,
    saveIgnoredRecords,
    loadTotalRecords,
    saveMultiple,
    loadSyncRateSettings,
    saveSyncRateSettings,
    loadBossSendRate,
    saveBossSendRate,
    loadSendRate,
    saveSendRate
  };
})();
