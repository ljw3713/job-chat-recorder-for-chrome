(function () {
  const { normalizeText, formatDate, addDays } = globalThis.JobChatUtils;

  function recruiterInfo(record) {
    const name = normalizeText(record?.recruiterName);
    const title = normalizeText(record?.recruiterTitle);
    if (name && title) return `${name} / ${title}`;
    return name || title || '';
  }

  function normalizeRecordDate(rawValue) {
    const raw = normalizeText(rawValue);
    const now = new Date();
    if (!raw) return formatDate(now);
    if (/^\d{1,2}:\d{2}$/.test(raw)) return formatDate(now);
    if (raw.includes('昨天')) return formatDate(addDays(now, -1));
    if (raw.includes('前天')) return formatDate(addDays(now, -2));
    let match = raw.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?(?:[\sT]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
    if (match) {
      const date = `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
      if (match[4] && match[5]) return `${date} ${String(match[4]).padStart(2, '0')}:${String(match[5]).padStart(2, '0')}:${String(match[6] || 0).padStart(2, '0')}`;
      return date;
    }
    match = raw.match(/(?:^|\D)(\d{1,2})[-/.月](\d{1,2})(?:日)?(?:\D|$)/);
    if (match) return `${now.getFullYear()}-${String(match[1]).padStart(2, '0')}-${String(match[2]).padStart(2, '0')}`;
    return raw;
  }

  function displayRecordDate(rawValue) {
    if (!normalizeText(rawValue)) return '';
    return normalizeRecordDate(rawValue).slice(0, 10);
  }

  function communicationDate(record) {
    const raw = normalizeText(record?.time || record?.updatedDate || record?.applicationDate);
    if (!raw) return '';
    return normalizeRecordDate(raw);
  }

  function makeRecordKey(record) {
    const siteKey = normalizeText(record?.siteKey || '');
    const sourceName = normalizeText(record?.sourceName || '');
    const bossId = normalizeText(record?.boss?.encryptBossId || record?.boss?.bossId || '');
    const bossJobId = normalizeText(record?.boss?.jobId || '');
    if ((siteKey === 'boss' || sourceName === 'BOSS直聘') && bossId && bossJobId) return `boss|${bossId.toLowerCase()}|${bossJobId.toLowerCase()}`;
    if ((siteKey === 'boss' || sourceName === 'BOSS直聘') && bossId) return `boss|${bossId.toLowerCase()}`;
    const bossSecurityId = normalizeText(record?.boss?.securityId || '');
    if ((siteKey === 'boss' || sourceName === 'BOSS直聘') && bossSecurityId) return `boss|${bossSecurityId.toLowerCase()}`;
    const bossFriendId = normalizeText(record?.boss?.encryptFriendId || record?.boss?.friendId || '');
    if ((siteKey === 'boss' || sourceName === 'BOSS直聘') && bossFriendId) return `boss|${bossFriendId.toLowerCase()}`;
    const oppositeImId = normalizeText(record?.liepin?.oppositeImId || '');
    if ((siteKey === 'liepin' || sourceName === '猎聘') && oppositeImId) return `liepin|${oppositeImId.toLowerCase()}`;
    if (record?.recordKey) return normalizeText(record.recordKey);
    return [sourceName || siteKey || '', record.companyName, record.jobName, recruiterInfo(record)]
      .map((v) => normalizeText(v).toLowerCase())
      .join('|');
  }

  function normalizeStoredRecord(record, index = 0) {
    const updatedDate = normalizeRecordDate(record?.updatedDate || record?.time || record?.applicationDate);
    const normalized = {
      ...record,
      index: record?.index || index + 1,
      note: normalizeText(record?.note || ''),
      applicationDate: normalizeRecordDate(record?.applicationDate || record?.createdDate || record?.time || updatedDate),
      updatedDate,
      sourceName: normalizeText(record?.sourceName || ''),
      siteKey: normalizeText(record?.siteKey || ''),
      companyName: normalizeText(record?.companyName),
      jobName: normalizeText(record?.jobName),
      recruiterName: normalizeText(record?.recruiterName),
      recruiterTitle: normalizeText(record?.recruiterTitle),
      lastMessage: normalizeText(record?.lastMessage),
      messageStatus: normalizeText(record?.messageStatus || '')
    };
    normalized.recordKey = makeRecordKey(normalized);
    return normalized;
  }

  globalThis.JobChatRecords = {
    recruiterInfo,
    normalizeRecordDate,
    displayRecordDate,
    communicationDate,
    makeRecordKey,
    normalizeStoredRecord
  };
})();
