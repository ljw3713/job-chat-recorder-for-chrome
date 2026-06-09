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

  function rowsFromImportedCsv(text) {
    const rows = parseCsv(text.replace(/^\ufeff/, ''));
    if (!rows.length) return [];
    const headers = rows[0].map((h) => normalizeText(h));
    const get = (row, name) => row[headers.indexOf(name)] || '';
    return rows.slice(1).filter((row) => row.some((cell) => normalizeText(cell))).map((row, index) => {
      const sourceName = get(row, '来源');
      const recruiter = get(row, '招聘者') || get(row, '招聘者信息');
      const [recruiterName, recruiterTitle] = recruiter.split('/').map((v) => normalizeText(v));
      const record = {
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
        importedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      record.recordKey = normalizeText(record.recordKey) || makeRecordKey(record);
      return record;
    });
  }

  async function loadResultsState() {
    return chrome.storage.local.get(['jobChatPendingRecords', 'jobChatExtractionStatus', 'jobChatRecords', 'bossChatStatsLatest', 'jobChatIgnoredRecords']);
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

  globalThis.JobChatResultsDb = {
    tsv,
    csv,
    rowsFromImportedCsv,
    loadResultsState,
    saveSyncRecords,
    saveOverviewRecords,
    saveIgnoredRecords,
    loadTotalRecords,
    saveMultiple,
    loadSyncRateSettings,
    saveSyncRateSettings
  };
})();
