(function () {
  const { normalizeText } = globalThis.JobChatUtils;
  const { normalizeRecordDate, makeRecordKey, normalizeStoredRecord } = globalThis.JobChatRecords;

  function prepareRecord(rawRecord, site) {
    const updatedDate = normalizeRecordDate(rawRecord.time || rawRecord.updatedDate || rawRecord.applicationDate);
    const record = {
      ...rawRecord,
      sourceName: site.source,
      siteKey: site.key,
      applicationDate: normalizeRecordDate(rawRecord.applicationDate || rawRecord.createdDate || rawRecord.time || updatedDate),
      updatedDate,
      time: updatedDate,
      note: normalizeText(rawRecord.note || ''),
      companyName: normalizeText(rawRecord.companyName),
      jobName: normalizeText(rawRecord.jobName),
      recruiterName: normalizeText(rawRecord.recruiterName),
      recruiterTitle: normalizeText(rawRecord.recruiterTitle),
      lastMessage: normalizeText(rawRecord.lastMessage),
      messageStatus: normalizeText(rawRecord.messageStatus || ''),
      updatedAt: new Date().toISOString()
    };
    record.recordKey = makeRecordKey(record);
    return record;
  }

  function normalizeStoredRecords(records) {
    return (records || []).map(normalizeStoredRecord);
  }

  function recordKeySet(records) {
    const keys = new Set();
    normalizeStoredRecords(records || []).forEach((record) => {
      if (record.recordKey) keys.add(record.recordKey);
    });
    return keys;
  }

  function mergeRecordLists(existing, incoming) {
    const byKey = new Map();
    normalizeStoredRecords(existing).forEach((record) => byKey.set(record.recordKey, record));

    let inserted = 0;
    let updated = 0;

    incoming.forEach((record) => {
      const old = byKey.get(record.recordKey);
      if (old) {
        byKey.set(record.recordKey, {
          ...old,
          ...record,
          note: old.note || record.note || '',
          applicationDate: old.applicationDate || record.applicationDate,
          updatedDate: record.updatedDate || old.updatedDate,
          createdAt: old.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        updated += 1;
      } else {
        byKey.set(record.recordKey, {
          ...record,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        inserted += 1;
      }
    });

    const records = Array.from(byKey.values())
      .sort((a, b) => String(b.updatedDate || '').localeCompare(String(a.updatedDate || '')))
      .map((record, index) => ({ ...record, index: index + 1 }));

    return { records, inserted, updated };
  }

  function siteByKey(key) {
    return (globalThis.JobChatSupportedSites || []).find((item) => item.key === key);
  }

  async function savePendingExtraction(extractedData, site) {
    const incoming = (extractedData.records || []).map((item) => prepareRecord(item, site));
    const summary = extractedData.syncSummary || {};
    const pendingData = {
      pageTitle: extractedData.pageTitle || '',
      pageUrl: extractedData.pageUrl || '',
      extractedAt: new Date().toISOString(),
      siteKey: site.key,
      siteTitle: site.title,
      sourceName: site.source,
      total: incoming.length,
      records: incoming.map((record, index) => ({ ...record, index: index + 1 })),
      syncSummary: {
        fetched: incoming.length,
        inserted: Number(summary.inserted || 0),
        updated: Number(summary.updated || 0),
        updatedMsg: Number(summary.updatedMsg || summary.updated || 0),
        saved: false,
        interrupted: Boolean(extractedData.interrupted),
        completed: !extractedData.interrupted,
        synced: Number(summary.synced || extractedData.synced || incoming.length),
        sourceTotal: Number(extractedData.sourceTotal || extractedData.total || incoming.length)
      }
    };

    await chrome.storage.local.set({
      jobChatPendingRecords: pendingData,
      bossChatStatsLatest: pendingData
    });

    return pendingData;
  }

  async function savePartialExtraction(partial) {
    const site = siteByKey(partial.siteKey) || siteByKey('liepin');
    const incoming = (partial.records || []).map((item) => prepareRecord(item, site));
    const summary = partial.syncSummary || {};
    const pendingData = {
      pageTitle: partial.pageTitle || '',
      pageUrl: partial.pageUrl || '',
      extractedAt: partial.extractedAt || new Date().toISOString(),
      siteKey: site.key,
      siteTitle: partial.siteTitle || site.title,
      sourceName: partial.sourceName || site.source,
      total: incoming.length,
      records: incoming.map((record, index) => ({ ...record, index: index + 1 })),
      syncSummary: {
        fetched: incoming.length,
        inserted: Number(summary.inserted || 0),
        updated: Number(summary.updated || 0),
        updatedMsg: Number(summary.updatedMsg || summary.updated || 0),
        saved: false,
        interrupted: Boolean(partial.interrupted),
        completed: Boolean(partial.completed),
        synced: Number(partial.synced || incoming.length),
        sourceTotal: Number(partial.total || incoming.length)
      }
    };

    await chrome.storage.local.set({
      jobChatPendingRecords: pendingData,
      bossChatStatsLatest: pendingData
    });

    return pendingData;
  }

  async function saveLiepinPartialExtraction(partial) {
    return savePartialExtraction({ ...partial, siteKey: 'liepin', siteTitle: '猎聘沟通记录', sourceName: '猎聘' });
  }

  async function savePendingToTotal() {
    const store = await chrome.storage.local.get(['jobChatPendingRecords', 'jobChatRecords', 'jobChatIgnoredRecords']);
    const pending = store.jobChatPendingRecords || { records: [] };
    const ignoredKeys = recordKeySet(store.jobChatIgnoredRecords || []);
    const incoming = normalizeStoredRecords(pending.records || []).filter((record) => !ignoredKeys.has(record.recordKey));
    const existing = normalizeStoredRecords(store.jobChatRecords || []).filter((record) => !ignoredKeys.has(record.recordKey));
    const merged = mergeRecordLists(existing, incoming);
    const totalData = {
      ...(pending || {}),
      extractedAt: new Date().toISOString(),
      total: merged.records.length,
      records: merged.records,
      syncSummary: {
        fetched: incoming.length,
        inserted: merged.inserted,
        updated: merged.updated,
        updatedMsg: Number(pending?.syncSummary?.updatedMsg || pending?.syncSummary?.updated || merged.updated || 0),
        saved: true
      }
    };
    await chrome.storage.local.set({
      jobChatRecords: merged.records,
      bossChatStatsLatest: totalData,
      jobChatPendingRecords: { ...(pending || {}), syncSummary: totalData.syncSummary, savedAt: new Date().toISOString() }
    });
    return totalData;
  }

  globalThis.JobChatBackgroundDb = {
    savePendingExtraction,
    savePartialExtraction,
    saveLiepinPartialExtraction,
    savePendingToTotal
  };
})();
