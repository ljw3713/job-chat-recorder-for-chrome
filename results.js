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
const cancelSyncBtn = document.getElementById('cancelSyncBtn');
const resumeSyncBtn = document.getElementById('resumeSyncBtn');
const pageHint = document.getElementById('pageHint');
const refreshBossBtn = document.getElementById('refreshBossBtn');
const syncRateLimit = document.getElementById('syncRateLimit');
const startSyncBtn = document.getElementById('startSyncBtn');
const importCsvBtn = document.getElementById('importCsvBtn');
const importCsvInput = document.getElementById('importCsvInput');

const mode = new URLSearchParams(location.search).get('mode') === 'sync' ? 'sync' : 'overview';

let latestData = null;
let extractionStatus = null;
let allRecords = [];
let currentRecords = [];
let selectedKeys = new Set();

const tableHeaders = ['来源', '公司名', '岗位名', '申请时间', '更新时间', '备注', '招聘者信息', '原消息'];
const exportHeaders = ['唯一索引id', ...tableHeaders];

function normalizeText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function boldNumber(value) {
  return `<strong>${escapeHtml(value)}</strong>`;
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function communicationDate(record) {
  const raw = normalizeText(record?.time || record?.updatedDate || record?.applicationDate);
  const now = new Date();
  if (!raw) return '';
  if (/^\d{1,2}:\d{2}$/.test(raw)) return formatDate(now);
  if (raw.includes('昨天')) return formatDate(addDays(now, -1));
  if (raw.includes('前天')) return formatDate(addDays(now, -2));
  let match = raw.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (match) return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
  match = raw.match(/(?:^|\D)(\d{1,2})[-/.月](\d{1,2})(?:日)?(?:\D|$)/);
  if (match) return `${now.getFullYear()}-${String(match[1]).padStart(2, '0')}-${String(match[2]).padStart(2, '0')}`;
  return raw;
}

function recruiterInfo(record) {
  const name = normalizeText(record?.recruiterName);
  const title = normalizeText(record?.recruiterTitle);
  if (name && title) return `${name} / ${title}`;
  return name || title || '';
}

function makeRecordKey(record) {
  const siteKey = normalizeText(record?.siteKey || '');
  const sourceName = normalizeText(record?.sourceName || '');
  const bossId = normalizeText(record?.boss?.encryptBossId || record?.boss?.bossId || '');
  const bossJobId = normalizeText(record?.boss?.jobId || '');
  if ((siteKey === 'boss' || sourceName === 'BOSS直聘') && bossId && bossJobId) return `boss|${bossId.toLowerCase()}|${bossJobId.toLowerCase()}`;
  if ((siteKey === 'boss' || sourceName === 'BOSS直聘') && bossId) return `boss|${bossId.toLowerCase()}`;
  const oppositeImId = normalizeText(record?.liepin?.oppositeImId || '');
  if ((siteKey === 'liepin' || sourceName === '猎聘') && oppositeImId) return `liepin|${oppositeImId.toLowerCase()}`;
  return normalizeText(record.recordKey) || [sourceName || siteKey || '', record.companyName, record.jobName, recruiterInfo(record)]
    .map((v) => normalizeText(v).toLowerCase())
    .join('|');
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



function isMissingBossFriendIdsError() {
  const message = normalizeText(extractionStatus?.message || '');
  return mode === 'sync' && extractionStatus?.siteKey === 'boss' && extractionStatus?.state === 'error' && message.includes('没有捕获到 BOSS直聘聊天列表接口参数');
}

function updateRefreshBossButton() {
  if (!refreshBossBtn) return;
  refreshBossBtn.style.display = isMissingBossFriendIdsError() ? '' : 'none';
}

function updateSyncButtons() {
  updateRefreshBossButton();
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
  const lines = includeHeader ? [exportHeaders, ...rows] : rows;
  return lines.map((row) => row.map((cell) => String(cell ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv() {
  const rows = toOutputRows().map((r) => [r.recordKey, r.sourceName, r.companyName, r.jobName, r.applicationDate, r.updatedDate, r.note, r.recruiterInfo, r.lastMessage]);
  return [exportHeaders, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
}

async function persistCurrentRecords() {
  const records = allRecords.map((record, index) => ({ ...record, index: index + 1 }));
  allRecords = records;
  if (mode === 'sync') {
    latestData = { ...(latestData || {}), total: records.length, records };
    await chrome.storage.local.set({ jobChatPendingRecords: latestData, bossChatStatsLatest: latestData });
  } else {
    latestData = { ...(latestData || {}), total: records.length, records };
    await chrome.storage.local.set({ jobChatRecords: records, bossChatStatsLatest: latestData });
  }
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
  const result = await chrome.storage.local.get(['jobChatPendingRecords', 'jobChatExtractionStatus', 'jobChatRecords', 'bossChatStatsLatest']);
  extractionStatus = result.jobChatExtractionStatus || null;

  if (mode === 'sync') {
    latestData = result.jobChatPendingRecords || result.bossChatStatsLatest || { total: 0, records: [] };
    allRecords = (latestData.records || []).map(normalizeRecord);

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
    latestData = { ...(result.bossChatStatsLatest || {}), siteTitle: '招聘沟通记录总览', sourceName: '全部来源', total: records.length, records };
    allRecords = records.map(normalizeRecord);
  }

  configurePageMode();
  configureTodayOnly();
  populateFilters();
  setStatus(null, '');
  selectedKeys = new Set([...selectedKeys].filter((key) => allRecords.some((record) => record.recordKey === key)));
  renderTable();
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
    const recruiter = get(row, '招聘者信息');
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

async function importCsvFile(file) {
  const text = await file.text();
  const imported = rowsFromImportedCsv(text).map(normalizeRecord);
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
  if (changes.jobChatExtractionStatus || changes.bossChatStatsLatest || changes.jobChatRecords || changes.jobChatPendingRecords) {
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



if (syncRateLimit) {
  chrome.storage.local.get(['jobChatSyncRateLimit']).then((store) => {
    syncRateLimit.value = String(store.jobChatSyncRateLimit || 2);
  });
  syncRateLimit.addEventListener('change', async () => {
    const rate = Math.max(1, Math.min(10, Number(syncRateLimit.value || 2)));
    syncRateLimit.value = String(rate);
    await chrome.storage.local.set({ jobChatSyncRateLimit: rate });
  });
}

if (startSyncBtn) {
  startSyncBtn.addEventListener('click', async () => {
    startSyncBtn.disabled = true;
    const rate = Math.max(1, Math.min(10, Number(syncRateLimit?.value || 2)));
    await chrome.storage.local.set({ jobChatSyncRateLimit: rate });
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


if (refreshBossBtn) {
  refreshBossBtn.addEventListener('click', async () => {
    refreshBossBtn.disabled = true;
    refreshBossBtn.textContent = '正在刷新并等待捕获...';
    const response = await chrome.runtime.sendMessage({ type: 'REFRESH_BOSS_AND_RESUME' });
    if (!response?.ok) alert(response?.error || '刷新并继续同步失败');
    refreshBossBtn.disabled = false;
    refreshBossBtn.textContent = '刷新 BOSS 消息页并继续';
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
