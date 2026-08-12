(function () {
  const { normalizeText } = globalThis.JobChatUtils;
  const { normalizeRecordDate, makeRecordKey, normalizeStoredRecord, mergeConversation } = globalThis.JobChatRecords;

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

  function bossExternalIdentity(record) {
    const siteKey = normalizeText(record?.siteKey || '');
    const sourceName = normalizeText(record?.sourceName || '');
    if (siteKey !== 'boss' && sourceName !== 'BOSS直聘') return '';
    const bossId = normalizeText(record?.boss?.encryptBossId || record?.boss?.peerKey || record?.boss?.bossId).toLowerCase();
    const externalId = normalizeText(record?.jobRef?.externalId).toLowerCase();
    return bossId && externalId ? `${bossId}|${externalId}` : '';
  }

  function mergeRecordLists(existing, incoming) {
    const byKey = new Map();
    const byBossExternalIdentity = new Map();
    normalizeStoredRecords(existing).forEach((record) => {
      byKey.set(record.recordKey, record);
      const externalIdentity = bossExternalIdentity(record);
      if (externalIdentity) byBossExternalIdentity.set(externalIdentity, record);
    });

    let inserted = 0;
    let updated = 0;

    incoming.forEach((record) => {
      const externalIdentity = bossExternalIdentity(record);
      const old = byKey.get(record.recordKey) || (externalIdentity ? byBossExternalIdentity.get(externalIdentity) : null);
      if (old) {
        const conversation = mergeConversation(old.conversation, record.conversation);
        if (old.recordKey !== record.recordKey) byKey.delete(old.recordKey);
        const mergedRecord = {
          ...old,
          ...record,
          boss: { ...(old.boss || {}), ...(record.boss || {}) },
          jobRef: { ...(old.jobRef || {}), ...(record.jobRef || {}) },
          jobInfo: record.jobInfo || old.jobInfo || {},
          ...(conversation ? { conversation } : {}),
          note: old.note || record.note || '',
          applicationDate: old.applicationDate || record.applicationDate,
          updatedDate: record.updatedDate || old.updatedDate,
          createdAt: old.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        byKey.set(record.recordKey, mergedRecord);
        const mergedExternalIdentity = bossExternalIdentity(mergedRecord);
        if (mergedExternalIdentity) byBossExternalIdentity.set(mergedExternalIdentity, mergedRecord);
        updated += 1;
      } else {
        const insertedRecord = {
          ...record,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        byKey.set(record.recordKey, insertedRecord);
        if (externalIdentity) byBossExternalIdentity.set(externalIdentity, insertedRecord);
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
        jobDetail: summary.jobDetail || undefined,
        conversation: summary.conversation || undefined,
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
        jobDetail: summary.jobDetail || undefined,
        conversation: summary.conversation || undefined,
        saved: false,
        interrupted: Boolean(partial.interrupted),
        completed: Boolean(partial.completed),
        synced: Number(partial.synced || incoming.length),
        sourceTotal: Number(partial.sourceTotal || partial.total || incoming.length)
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
        jobDetail: pending?.syncSummary?.jobDetail || undefined,
        conversation: pending?.syncSummary?.conversation || undefined,
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
