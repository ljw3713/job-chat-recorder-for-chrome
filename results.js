const meta = document.getElementById('meta');
const jsonBox = document.getElementById('jsonBox');
const tableBox = document.getElementById('tableBox');
const copyTableBtn = document.getElementById('copyTableBtn');
const copyJsonBtn = document.getElementById('copyJsonBtn');
const downloadCsvBtn = document.getElementById('downloadCsvBtn');
const downloadJsonBtn = document.getElementById('downloadJsonBtn');
const todayOnly = document.getElementById('todayOnly');
const sourceFilter = document.getElementById('sourceFilter');
const companyFilter = document.getElementById('companyFilter');
const dateFieldFilter = document.getElementById('dateFieldFilter');
const dateFrom = document.getElementById('dateFrom');
const dateTo = document.getElementById('dateTo');
const sortBy = document.getElementById('sortBy');
const pageHeading = document.getElementById('pageHeading');
const statusBox = document.getElementById('statusBox');
const statusText = document.getElementById('statusText');
const saveBtn = document.getElementById('saveBtn');
const overviewBtn = document.getElementById('overviewBtn');
const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
const ignoreSelectedBtn = document.getElementById('ignoreSelectedBtn');
const ignoredRecordsBtn = document.getElementById('ignoredRecordsBtn');
const cancelSyncBtn = document.getElementById('cancelSyncBtn');
const resumeSyncBtn = document.getElementById('resumeSyncBtn');
const pageHint = document.getElementById('pageHint');
const syncRateLimit = document.getElementById('syncRateLimit');
const startSyncBtn = document.getElementById('startSyncBtn');
const importCsvBtn = document.getElementById('importCsvBtn');
const importCsvInput = document.getElementById('importCsvInput');
const ignoredModal = document.getElementById('ignoredModal');
const ignoredRecordsBox = document.getElementById('ignoredRecordsBox');
const closeIgnoredModalBtn = document.getElementById('closeIgnoredModalBtn');

const mode = new URLSearchParams(location.search).get('mode') === 'sync' ? 'sync' : 'overview';
const { normalizeText, formatDate } = globalThis.JobChatUtils;
const { recruiterInfo, communicationDate, makeRecordKey } = globalThis.JobChatRecords;
const ResultsDb = globalThis.JobChatResultsDb;

let latestData = null;
let extractionStatus = null;
let allRecords = [];
let currentRecords = [];
let ignoredRecords = [];
let selectedKeys = new Set();

const tableHeaders = ['来源', '公司名', '岗位名', '申请时间', '更新时间', '备注', '招聘者信息', '原消息'];
const exportHeaders = ['唯一索引id', ...tableHeaders];

function recordKeyOf(record) {
  return normalizeText(record?.recordKey || makeRecordKey(record));
}

function normalizeRecord(record, index) {
  const updatedDate = communicationDate(record);
  const applicationDate = normalizeText(record.applicationDate || record.createdDate) || updatedDate;
  const normalized = {
    note: '',
    ...record,
    index: record.index || index + 1,
    sourceName: normalizeText(record.sourceName || ''),
    siteKey: normalizeText(record.siteKey || ''),
    companyName: normalizeText(record.companyName),
    jobName: normalizeText(record.jobName),
    recruiterName: normalizeText(record.recruiterName),
    recruiterTitle: normalizeText(record.recruiterTitle),
    lastMessage: normalizeText(record.lastMessage),
    note: normalizeText(record.note || ''),
    applicationDate,
    updatedDate: normalizeText(record.updatedDate || updatedDate)
  };
  normalized.recordKey = makeRecordKey(normalized);
  return normalized;
}

function isTodayRecord(record) {
  return record.updatedDate === formatDate(new Date());
}

function isLiepinContext() {
  return extractionStatus?.siteKey === 'liepin' || latestData?.siteKey === 'liepin';
}

function isInterruptibleContext() {
  const key = extractionStatus?.siteKey || latestData?.siteKey || '';
  return key === 'liepin' || key === 'boss';
}

function configurePageMode() {
  if (mode === 'sync') {
    saveBtn.style.display = '';
    if (importCsvBtn) importCsvBtn.style.display = 'none';
    overviewBtn.textContent = '查看总记录';
    pageHint.textContent = '同步结果页：可先删除不需要的记录，再保存到总记录。岗位和备注列可双击编辑。';
  } else {
    saveBtn.style.display = 'none';
    if (importCsvBtn) importCsvBtn.style.display = '';
    overviewBtn.textContent = '刷新总览';
    pageHint.textContent = '记录总览页：显示所有已保存记录，可筛选、排序、批量删除、导出当前页面结果。岗位和备注列可双击编辑。';
  }
}

function configureTodayOnly() {
  if (!todayOnly) return;
  todayOnly.disabled = false;
  todayOnly.closest('.filter-box')?.classList.remove('disabled');
}

function updateSyncButtons() {
  if (!cancelSyncBtn || !resumeSyncBtn) return;
  const isSync = mode === 'sync';
  const isSupported = isInterruptibleContext();
  const isLoading = extractionStatus?.state === 'loading';
  const isReady = extractionStatus?.state === 'ready';
  const interrupted = Boolean(latestData?.syncSummary?.interrupted || extractionStatus?.interrupted);
  const completed = Boolean(latestData?.syncSummary?.completed);

  if (syncRateLimit) syncRateLimit.closest('.filter-box').style.display = isSync && isSupported ? '' : 'none';
  if (startSyncBtn) startSyncBtn.style.display = isSync && isSupported && isReady ? '' : 'none';
  cancelSyncBtn.style.display = isSync && isSupported && isLoading ? '' : 'none';
  resumeSyncBtn.style.display = isSync && isSupported && interrupted && !isLoading && !completed ? '' : 'none';
}

function progressMessage(status) {
  if (status?.siteKey === 'liepin' || status?.siteKey === 'boss') {
    const synced = Number(status.synced || 0);
    const total = Number(status.total || 0);
    const sourceName = status.sourceName || (status.siteKey === 'boss' ? 'BOSS直聘' : '猎聘');
    return `正在提取${sourceName}沟通记录... 已同步 ${synced} / ${total} 条`;
  }
  return status?.message || '正在提取沟通记录...';
}

function setStatus(state, message) {
  if (!statusBox || !statusText) return;
  if (!state || state === 'done') {
    statusBox.className = 'status-card';
    statusText.textContent = '';
    return;
  }
  statusBox.className = `status-card show ${state === 'error' ? 'error' : state === 'ready' ? 'ready' : ''}`;
  statusText.textContent = message || (state === 'loading' ? '正在提取沟通记录...' : state === 'ready' ? '已获取待同步列表。' : '提取失败。');
}


function renderReady(status) {
  const title = status?.siteTitle || '招聘沟通记录';
  const source = status?.sourceName || '-';
  pageHeading.textContent = title;
  document.title = title;
  meta.innerHTML = `来源：${escapeHtml(source)} · 待同步：${boldNumber(status?.total || 0)} 条`;
  extractionStatus = status || extractionStatus;
  configureTodayOnly();
  setStatus('ready', status?.message || '已获取待同步列表，请点击“同步”。');
  updateSyncButtons();
  tableBox.innerHTML = `<div class="empty">已获取待同步记录 ${escapeHtml(status?.total || 0)} 条。设置每秒同步限制后点击“同步”。</div>`;
  jsonBox.textContent = JSON.stringify({ sourceName: source, total: status?.total || 0, state: 'ready' }, null, 2);
}

function renderLoading(status) {
  const title = status?.siteTitle || '招聘沟通记录';
  const source = status?.sourceName || '-';
  pageHeading.textContent = title;
  document.title = title;
  meta.textContent = `来源：${source}`;
  extractionStatus = status || extractionStatus;
  configureTodayOnly();
  setStatus('loading', progressMessage(status));
  updateSyncButtons();
  if (!allRecords.length) {
    tableBox.innerHTML = '<div class="empty">正在加载数据，请稍候...</div>';
    jsonBox.textContent = 'loading...';
  }
}

function renderError(status) {
  const title = status?.siteTitle || '招聘沟通记录';
  const source = status?.sourceName || '-';
  pageHeading.textContent = title;
  document.title = title;
  meta.textContent = `来源：${source}`;
  extractionStatus = status || extractionStatus;
  configureTodayOnly();
  setStatus('error', status?.message || '提取失败。');
  updateRefreshBossButton();
  if (isMissingBossFriendIdsError()) {
    tableBox.innerHTML = '<div class="empty">没有捕获到 BOSS 聊天列表参数。可以点击上方“刷新 BOSS 消息页并继续”，插件会刷新原消息页，捕获到参数后自动继续同步。</div>';
  } else {
    tableBox.innerHTML = '<div class="empty">提取失败，请返回招聘网站页面后重新点击插件。</div>';
  }
  jsonBox.textContent = JSON.stringify({ error: status?.message || '提取失败。' }, null, 2);
}

function populateSelect(select, values, emptyLabel) {
  const selected = select.value;
  const unique = [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  select.innerHTML = `<option value="">${emptyLabel}</option>` + unique.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  if (unique.includes(selected)) select.value = selected;
}

function populateFilters() {
  populateSelect(sourceFilter, allRecords.map((r) => r.sourceName), '全部来源');
  populateSelect(companyFilter, allRecords.map((r) => r.companyName), '全部公司');
}

function applyFilters() {
  let records = [...allRecords];
  if (todayOnly.checked) records = records.filter(isTodayRecord);
  const source = sourceFilter.value;
  if (source) records = records.filter((r) => r.sourceName === source);
  const company = companyFilter.value;
  if (company) records = records.filter((r) => r.companyName === company);
  const dateField = dateFieldFilter.value || 'updatedDate';
  const from = dateFrom.value;
  const to = dateTo.value;
  if (from) records = records.filter((r) => String(r[dateField] || '') >= from);
  if (to) records = records.filter((r) => String(r[dateField] || '') <= to);

  const [field, direction] = (sortBy.value || 'updatedDate-desc').split('-');
  records.sort((a, b) => {
    const result = String(a[field] || '').localeCompare(String(b[field] || ''));
    return direction === 'asc' ? result : -result;
  });
  currentRecords = records;
  return records;
}

function toOutputRows() {
  return currentRecords.map((r) => ({
    recordKey: normalizeText(r.recordKey || makeRecordKey(r)),
    sourceName: normalizeText(r.sourceName),
    companyName: normalizeText(r.companyName),
    jobName: normalizeText(r.jobName),
    applicationDate: normalizeText(r.applicationDate),
    updatedDate: normalizeText(r.updatedDate),
    note: normalizeText(r.note),
    recruiterInfo: recruiterInfo(r),
    lastMessage: normalizeText(r.lastMessage)
  }));
}

function getTodayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isSyncedToday(record) {
  if (!record?.updatedAt) return false;
  const date = new Date(record.updatedAt);
  if (Number.isNaN(date.getTime())) return false;
  return formatDate(date) === getTodayString();
}

function updateMeta() {
  updateSyncButtons();
  const total = allRecords.length;
  const visible = currentRecords.length;
  const source = latestData?.sourceName || '-';
  const summary = latestData?.syncSummary;
  const syncText = summary?.saved ? ` · 保存结果：新增 ${summary.inserted || 0} 条，更新 ${summary.updated || 0} 条` : '';
  const title = mode === 'sync' ? (latestData?.siteTitle || '同步结果') : '招聘沟通记录总览';
  pageHeading.textContent = title;
  document.title = title;

  if (mode === 'sync') {
    meta.innerHTML = `本次同步共 ${boldNumber(total)} 条 · 当前显示：${boldNumber(visible)} 条 · 最近同步时间：${escapeHtml(latestData?.extractedAt || '-')} · 来源：${escapeHtml(source)}${syncText.replace(/(\d+)/g, '<strong>$1</strong>')}`;
    return;
  }

  const todaySynced = allRecords.filter(isSyncedToday).length;
  meta.innerHTML = `总记录共 ${boldNumber(total)} 条 · 当前显示：${boldNumber(visible)} 条 · 今日同步 ${boldNumber(todaySynced)} 条 · 最近同步时间：${escapeHtml(latestData?.extractedAt || '-')}`;
}

function updateJsonBox() {
  jsonBox.textContent = JSON.stringify(toOutputRows(), null, 2);
}

function toTsv(includeHeader = true) {
  const rows = toOutputRows().map((r) => [r.recordKey, r.sourceName, r.companyName, r.jobName, r.applicationDate, r.updatedDate, r.note, r.recruiterInfo, r.lastMessage]);
  return ResultsDb.tsv(exportHeaders, rows, includeHeader);
}

function toCsv() {
  const rows = toOutputRows().map((r) => [r.recordKey, r.sourceName, r.companyName, r.jobName, r.applicationDate, r.updatedDate, r.note, r.recruiterInfo, r.lastMessage]);
  return ResultsDb.csv(exportHeaders, rows);
}

async function persistCurrentRecords() {
  const records = allRecords.map((record, index) => ({ ...record, index: index + 1 }));
  allRecords = records;
  if (mode === 'sync') {
    latestData = await ResultsDb.saveSyncRecords(latestData, records);
  } else {
    latestData = await ResultsDb.saveOverviewRecords(latestData, records);
  }
}

async function persistIgnoredRecords() {
  const byKey = new Map();
  ignoredRecords.forEach((record) => {
    const recordKey = recordKeyOf(record);
    if (!recordKey) return;
    byKey.set(recordKey, { ...record, recordKey });
  });
  ignoredRecords = Array.from(byKey.values()).map((record, index) => ({ ...record, index: index + 1 }));
  await ResultsDb.saveIgnoredRecords(ignoredRecords);
}

function normalizedIgnoredRecords() {
  const byKey = new Map();
  ignoredRecords.forEach((record) => {
    const recordKey = recordKeyOf(record);
    if (!recordKey) return;
    byKey.set(recordKey, { ...record, recordKey });
  });
  return Array.from(byKey.values()).map((record, index) => ({ ...record, index: index + 1 }));
}

async function ignoreSelectedRecords() {
  if (!selectedKeys.size) return;
  const selected = allRecords.filter((record) => selectedKeys.has(record.recordKey));
  if (!selected.length) return;
  if (!confirm(`确认忽略选中的 ${selected.length} 条记录？`)) return;

  const ignoredByKey = new Map(ignoredRecords.map((record) => [record.recordKey, record]));
  selected.forEach((record) => {
    ignoredByKey.set(record.recordKey, {
      ...record,
      ignoredAt: record.ignoredAt || new Date().toISOString()
    });
  });
  ignoredRecords = Array.from(ignoredByKey.values());
  allRecords = allRecords.filter((record) => !selectedKeys.has(record.recordKey));
  const ignoredKeys = new Set(selected.map((record) => record.recordKey));
  selectedKeys.clear();

  ignoredRecords = normalizedIgnoredRecords();
  const records = allRecords.map((record, index) => ({ ...record, index: index + 1 }));
  allRecords = records;
  latestData = { ...(latestData || {}), total: records.length, records };

  const totalRecords = await ResultsDb.loadTotalRecords();
  const keptTotalRecords = totalRecords.filter((record) => !ignoredKeys.has(recordKeyOf(record))).map((record, index) => ({ ...record, index: index + 1 }));
  const storageUpdate = {
    jobChatIgnoredRecords: ignoredRecords,
    jobChatRecords: keptTotalRecords
  };
  if (mode === 'sync') {
    storageUpdate.jobChatPendingRecords = latestData;
    storageUpdate.bossChatStatsLatest = latestData;
  } else {
    storageUpdate.jobChatRecords = records;
    storageUpdate.bossChatStatsLatest = latestData;
  }
  await ResultsDb.saveMultiple(storageUpdate);

  populateFilters();
  renderTable();
}

function ignoredCreatedTime(record) {
  return normalizeText(record.createdAt || record.importedAt || record.ignoredAt || record.applicationDate || record.updatedDate || '-');
}

function renderIgnoredRecordsModal() {
  if (!ignoredRecordsBox) return;
  if (!ignoredRecords.length) {
    ignoredRecordsBox.innerHTML = '<div class="empty">暂无忽略记录。</div>';
    return;
  }
  ignoredRecordsBox.innerHTML = `
    <table>
      <thead>
        <tr>
          <th class="source">来源</th>
          <th class="company">公司</th>
          <th class="job">岗位</th>
          <th class="date">创建时间</th>
          <th class="action">操作</th>
        </tr>
      </thead>
      <tbody>
        ${ignoredRecords.map((record) => `
          <tr>
            <td class="source-cell">${escapeHtml(record.sourceName)}</td>
            <td class="company-cell">${escapeHtml(record.companyName)}</td>
            <td class="job-cell">${escapeHtml(record.jobName)}</td>
            <td class="date-cell">${escapeHtml(ignoredCreatedTime(record))}</td>
            <td class="action-cell"><button class="secondary restore-ignored-record" data-key="${escapeHtml(record.recordKey)}">恢复</button></td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  ignoredRecordsBox.querySelectorAll('.restore-ignored-record').forEach((button) => {
    button.addEventListener('click', () => restoreIgnoredRecord(button.dataset.key));
  });
}

async function restoreIgnoredRecord(recordKey) {
  const record = ignoredRecords.find((item) => item.recordKey === recordKey);
  if (!record) return;
  ignoredRecords = ignoredRecords.filter((item) => item.recordKey !== recordKey);
  const restored = { ...record };
  delete restored.ignoredAt;
  const byKey = new Map(allRecords.map((item) => [item.recordKey, item]));
  byKey.set(recordKey, restored);
  allRecords = Array.from(byKey.values()).map((item, index) => ({ ...item, index: index + 1 }));
  selectedKeys.delete(recordKey);
  await persistIgnoredRecords();
  await persistCurrentRecords();
  populateFilters();
  renderTable();
  renderIgnoredRecordsModal();
}

function saveEditableValue(recordKey, field, value) {
  const record = allRecords.find((item) => item.recordKey === recordKey);
  if (!record) return;
  record[field] = normalizeText(value);
  if (field === 'jobName') record.recordKey = makeRecordKey(record);
  persistCurrentRecords();
  renderTable();
}

function bindEditableCells() {
  tableBox.querySelectorAll('.editable').forEach((cell) => {
    cell.addEventListener('dblclick', () => {
      cell.dataset.original = cell.textContent;
      cell.contentEditable = 'true';
      cell.classList.add('editing');
      cell.focus();
      const range = document.createRange();
      range.selectNodeContents(cell);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    cell.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); cell.blur(); }
      if (event.key === 'Escape') { event.preventDefault(); cell.textContent = cell.dataset.original || ''; cell.blur(); }
    });
    cell.addEventListener('blur', () => {
      if (cell.contentEditable !== 'true') return;
      cell.contentEditable = 'false';
      cell.classList.remove('editing');
      const value = normalizeText(cell.textContent);
      cell.textContent = value;
      saveEditableValue(cell.dataset.key, cell.dataset.field, value);
    });
  });

  tableBox.querySelectorAll('.row-select').forEach((checkbox) => {
    checkbox.checked = selectedKeys.has(checkbox.value);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedKeys.add(checkbox.value);
      else selectedKeys.delete(checkbox.value);
      updateSelectAllCheckbox();
      updateDeleteButton();
    });
  });

  const selectAll = document.getElementById('selectAllRows');
  if (selectAll) {
    selectAll.addEventListener('change', () => {
      currentRecords.forEach((record) => {
        if (selectAll.checked) selectedKeys.add(record.recordKey);
        else selectedKeys.delete(record.recordKey);
      });
      renderTable();
    });
  }
  updateSelectAllCheckbox();
}

function updateSelectAllCheckbox() {
  const selectAll = document.getElementById('selectAllRows');
  if (!selectAll) return;
  const total = currentRecords.length;
  const selected = currentRecords.filter((record) => selectedKeys.has(record.recordKey)).length;
  selectAll.checked = total > 0 && selected === total;
  selectAll.indeterminate = selected > 0 && selected < total;
}

function updateDeleteButton() {
  if (!deleteSelectedBtn) return;
  deleteSelectedBtn.textContent = selectedKeys.size ? `删除选中（${selectedKeys.size}）` : '删除选中';
  deleteSelectedBtn.disabled = selectedKeys.size === 0;
  if (ignoreSelectedBtn) {
    ignoreSelectedBtn.textContent = selectedKeys.size ? `忽略选中（${selectedKeys.size}）` : '忽略选中';
    ignoreSelectedBtn.disabled = selectedKeys.size === 0;
  }
  if (ignoredRecordsBtn) {
    ignoredRecordsBtn.style.display = mode === 'overview' ? '' : 'none';
    ignoredRecordsBtn.textContent = ignoredRecords.length ? `忽略记录（${ignoredRecords.length}）` : '忽略记录';
  }
}

function renderTable() {
  const records = applyFilters();
  updateMeta();
  updateJsonBox();
  updateDeleteButton();
  if (!records.length) {
    tableBox.innerHTML = '<div class="empty">没有符合条件的记录。</div>';
    return;
  }
  tableBox.innerHTML = `
    <table>
      <thead>
        <tr>
          <th class="select"><input id="selectAllRows" type="checkbox" title="全选当前页面" /></th>
          <th class="source">来源</th>
          <th class="company">公司</th>
          <th class="job">岗位</th>
          <th class="date">申请时间</th>
          <th class="date">更新时间</th>
          <th class="note">备注</th>
          <th class="recruiter">招聘者信息</th>
          <th class="message">原消息</th>
        </tr>
      </thead>
      <tbody>
        ${records.map((r) => `
          <tr>
            <td class="select-cell"><input class="row-select" type="checkbox" value="${escapeHtml(r.recordKey)}" /></td>
            <td class="source-cell">${escapeHtml(r.sourceName)}</td>
            <td class="company-cell">${escapeHtml(r.companyName)}</td>
            <td class="job-cell editable" data-key="${escapeHtml(r.recordKey)}" data-field="jobName" title="双击编辑岗位信息">${escapeHtml(r.jobName)}</td>
            <td class="date-cell">${escapeHtml(r.applicationDate)}</td>
            <td class="date-cell">${escapeHtml(r.updatedDate)}</td>
            <td class="note-cell editable" data-key="${escapeHtml(r.recordKey)}" data-field="note" title="双击编辑备注">${escapeHtml(r.note || '')}</td>
            <td class="recruiter-cell">${escapeHtml(recruiterInfo(r))}</td>
            <td class="message-cell">${escapeHtml(r.lastMessage)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  bindEditableCells();
}

async function loadAndRenderLatest() {
  const result = await ResultsDb.loadResultsState();
  extractionStatus = result.jobChatExtractionStatus || null;
  ignoredRecords = Array.isArray(result.jobChatIgnoredRecords) ? result.jobChatIgnoredRecords.map(normalizeRecord) : [];

  if (mode === 'sync') {
    latestData = result.jobChatPendingRecords || result.bossChatStatsLatest || { total: 0, records: [] };
    const ignoredKeys = new Set(ignoredRecords.map((record) => record.recordKey));
    allRecords = (latestData.records || []).map(normalizeRecord).filter((record) => !ignoredKeys.has(record.recordKey));
    if (allRecords.length !== (latestData.records || []).length) {
      latestData = { ...latestData, total: allRecords.length, records: allRecords };
      await ResultsDb.saveSyncRecords(latestData, allRecords);
    }

    if (extractionStatus?.state === 'ready') {
      configurePageMode();
      configureTodayOnly();
      populateFilters();
      renderReady(extractionStatus);
      return;
    }

    if (extractionStatus?.state === 'loading') {
      configurePageMode();
      configureTodayOnly();
      populateFilters();
      selectedKeys = new Set([...selectedKeys].filter((key) => allRecords.some((record) => record.recordKey === key)));
      if (allRecords.length) renderTable();
      renderLoading(extractionStatus);
      return;
    }

    if (extractionStatus?.state === 'error') {
      renderError(extractionStatus);
      return;
    }
  } else {
    const records = Array.isArray(result.jobChatRecords) ? result.jobChatRecords : [];
    const ignoredKeys = new Set(ignoredRecords.map((record) => record.recordKey));
    const visibleRecords = records.map(normalizeRecord).filter((record) => !ignoredKeys.has(record.recordKey));
    latestData = { ...(result.bossChatStatsLatest || {}), siteTitle: '招聘沟通记录总览', sourceName: '全部来源', total: visibleRecords.length, records: visibleRecords };
    allRecords = visibleRecords;
  }

  configurePageMode();
  configureTodayOnly();
  populateFilters();
  setStatus(null, '');
  selectedKeys = new Set([...selectedKeys].filter((key) => allRecords.some((record) => record.recordKey === key)));
  renderTable();
}


async function importCsvFile(file) {
  const text = await file.text();
  const imported = ResultsDb.rowsFromImportedCsv(text).map(normalizeRecord);
  if (!imported.length) throw new Error('CSV 中没有可导入的记录。');
  const byKey = new Map(allRecords.map((record) => [record.recordKey, record]));
  let inserted = 0;
  let updated = 0;
  imported.forEach((record) => {
    if (byKey.has(record.recordKey)) updated += 1;
    else inserted += 1;
    byKey.set(record.recordKey, { ...(byKey.get(record.recordKey) || {}), ...record });
  });
  allRecords = Array.from(byKey.values()).map((record, index) => ({ ...record, index: index + 1 }));
  await persistCurrentRecords();
  populateFilters();
  renderTable();
  alert(`导入完成：新增 ${inserted} 条，更新 ${updated} 条。`);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.jobChatExtractionStatus || changes.bossChatStatsLatest || changes.jobChatRecords || changes.jobChatPendingRecords || changes.jobChatIgnoredRecords) {
    loadAndRenderLatest();
  }
});

[todayOnly, sourceFilter, companyFilter, dateFieldFilter, dateFrom, dateTo, sortBy].forEach((el) => el?.addEventListener('change', () => {
  selectedKeys.clear();
  renderTable();
}));

saveBtn.addEventListener('click', async () => {
  await persistCurrentRecords();
  const response = await chrome.runtime.sendMessage({ type: 'SAVE_PENDING_TO_TOTAL' });
  if (!response?.ok) {
    alert(response?.error || '保存失败');
    return;
  }
  saveBtn.textContent = '已保存到总记录';
  setTimeout(() => (saveBtn.textContent = '保存到总记录'), 1500);
  await loadAndRenderLatest();
});

overviewBtn.addEventListener('click', async () => {
  if (mode === 'sync') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('results.html?mode=overview'), active: true });
  } else {
    await loadAndRenderLatest();
  }
});

deleteSelectedBtn.addEventListener('click', async () => {
  if (!selectedKeys.size) return;
  if (!confirm(`确认删除选中的 ${selectedKeys.size} 条记录？`)) return;
  allRecords = allRecords.filter((record) => !selectedKeys.has(record.recordKey));
  selectedKeys.clear();
  await persistCurrentRecords();
  populateFilters();
  renderTable();
});

if (ignoreSelectedBtn) {
  ignoreSelectedBtn.addEventListener('click', ignoreSelectedRecords);
}

if (ignoredRecordsBtn) {
  ignoredRecordsBtn.addEventListener('click', () => {
    renderIgnoredRecordsModal();
    ignoredModal?.classList.add('show');
  });
}

if (closeIgnoredModalBtn) {
  closeIgnoredModalBtn.addEventListener('click', () => ignoredModal?.classList.remove('show'));
}

if (ignoredModal) {
  ignoredModal.addEventListener('click', (event) => {
    if (event.target === ignoredModal) ignoredModal.classList.remove('show');
  });
}



if (syncRateLimit) {
  ResultsDb.loadSyncRateLimit().then((rate) => {
    syncRateLimit.value = String(rate || 2);
  });
  syncRateLimit.addEventListener('change', async () => {
    const rate = Math.max(1, Math.min(10, Number(syncRateLimit.value || 2)));
    syncRateLimit.value = String(rate);
    await ResultsDb.saveSyncRateLimit(rate);
  });
}

if (startSyncBtn) {
  startSyncBtn.addEventListener('click', async () => {
    startSyncBtn.disabled = true;
    const rate = Math.max(1, Math.min(10, Number(syncRateLimit?.value || 2)));
    await ResultsDb.saveSyncRateLimit(rate);
    const response = await chrome.runtime.sendMessage({ type: 'START_PREPARED_SYNC' });
    if (!response?.ok) alert(response?.error || '同步失败');
    startSyncBtn.disabled = false;
  });
}

if (importCsvBtn && importCsvInput) {
  importCsvBtn.addEventListener('click', () => importCsvInput.click());
  importCsvInput.addEventListener('change', async () => {
    const file = importCsvInput.files?.[0];
    importCsvInput.value = '';
    if (!file) return;
    try { await importCsvFile(file); } catch (error) { alert(error?.message || String(error)); }
  });
}

if (cancelSyncBtn) {
  cancelSyncBtn.addEventListener('click', async () => {
    cancelSyncBtn.disabled = true;
    cancelSyncBtn.textContent = '正在中断...';
    await chrome.runtime.sendMessage({ type: 'CANCEL_CURRENT_SYNC' });
    setTimeout(() => {
      cancelSyncBtn.disabled = false;
      cancelSyncBtn.textContent = '中断同步';
    }, 1500);
  });
}

if (resumeSyncBtn) {
  resumeSyncBtn.addEventListener('click', async () => {
    resumeSyncBtn.disabled = true;
    resumeSyncBtn.textContent = '正在继续...';
    const response = await chrome.runtime.sendMessage({ type: 'RESUME_CURRENT_SYNC' });
    if (!response?.ok) alert(response?.error || '继续同步失败');
    resumeSyncBtn.disabled = false;
    resumeSyncBtn.textContent = '继续同步';
  });
}

copyTableBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(toTsv(true));
  copyTableBtn.textContent = '已复制表格';
  setTimeout(() => (copyTableBtn.textContent = '复制表格'), 1200);
});

copyJsonBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(JSON.stringify(toOutputRows(), null, 2));
  copyJsonBtn.textContent = '已复制 JSON';
  setTimeout(() => (copyJsonBtn.textContent = '复制 JSON'), 1200);
});

downloadCsvBtn.addEventListener('click', () => {
  const blob = new Blob(['\ufeff' + toCsv()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `job-chat-records-${mode}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

downloadJsonBtn.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(toOutputRows(), null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `job-chat-records-${mode}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

configurePageMode();
loadAndRenderLatest();
