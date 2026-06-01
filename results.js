const meta = document.getElementById('meta');
const jsonBox = document.getElementById('jsonBox');
const tableBox = document.getElementById('tableBox');
const copyTableBtn = document.getElementById('copyTableBtn');
const copyJsonBtn = document.getElementById('copyJsonBtn');
const downloadCsvBtn = document.getElementById('downloadCsvBtn');
const downloadJsonBtn = document.getElementById('downloadJsonBtn');
const todayOnly = document.getElementById('todayOnly');
const pageHeading = document.getElementById('pageHeading');
let latestData = null;

const tableHeaders = ['公司名', '岗位名', '沟通日期', '备注', '招聘者信息', '原消息'];

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function normalizeText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

// BOSS 直聘沟通列表中，当天记录通常显示为 "12:09" 这种 HH:mm；非当天一般显示 "昨天" 或日期。
function isTodayRecord(record) {
  return /^\d{1,2}:\d{2}$/.test(normalizeText(record?.time));
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

// 把 BOSS 列表里的时间显示统一转为日期：
// - 当天通常是 HH:mm，转为今天日期
// - “昨天”转为昨天日期
// - “前天”转为前天日期
// - MM-DD / M-D 转为当前年份的日期
// - YYYY-MM-DD / YYYY/MM/DD 原样规范为 YYYY-MM-DD
function communicationDate(record) {
  const raw = normalizeText(record?.time);
  const now = new Date();

  if (!raw) return '';
  if (/^\d{1,2}:\d{2}$/.test(raw)) return formatDate(now);
  if (raw.includes('昨天')) return formatDate(addDays(now, -1));
  if (raw.includes('前天')) return formatDate(addDays(now, -2));

  let match = raw.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (match) {
    const [, y, m, d] = match;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  match = raw.match(/(?:^|\D)(\d{1,2})[-/.月](\d{1,2})(?:日)?(?:\D|$)/);
  if (match) {
    const [, m, d] = match;
    return `${now.getFullYear()}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  return raw;
}

function recruiterInfo(record) {
  const name = normalizeText(record?.recruiterName);
  const title = normalizeText(record?.recruiterTitle);
  if (name && title) return `${name} / ${title}`;
  return name || title || '';
}

function getVisibleRecords() {
  const records = latestData?.records || [];
  return todayOnly.checked ? records.filter(isTodayRecord) : records;
}

function toOutputRows() {
  return getVisibleRecords().map((r) => ({
    companyName: normalizeText(r.companyName),
    jobName: normalizeText(r.jobName),
    communicationTime: communicationDate(r),
    note: normalizeText(r.note),
    recruiterInfo: recruiterInfo(r),
    lastMessage: normalizeText(r.lastMessage)
  }));
}

function toTsv(includeHeader = true) {
  const rows = toOutputRows().map((r) => [r.companyName, r.jobName, r.communicationTime, r.note, r.recruiterInfo, r.lastMessage]);
  const lines = includeHeader ? [tableHeaders, ...rows] : rows;
  return lines.map((row) => row.map((cell) => String(cell ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv() {
  const rows = toOutputRows().map((r) => [r.companyName, r.jobName, r.communicationTime, r.note, r.recruiterInfo, r.lastMessage]);
  return [tableHeaders, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
}

async function persistLatestData() {
  await chrome.storage.local.set({ bossChatStatsLatest: latestData });
}

function getDisplaySiteInfo() {
  const pageUrl = latestData?.pageUrl || '';
  let hostname = '';
  try { hostname = new URL(pageUrl).hostname; } catch (_) {}

  if (latestData?.sourceName || latestData?.siteTitle) {
    return {
      title: latestData.siteTitle || `${latestData.sourceName}沟通记录`,
      source: latestData.sourceName || latestData.siteTitle || '-'
    };
  }

  if (/(^|\.)zhipin\.com$/i.test(hostname)) {
    return { title: 'BOSS直聘沟通记录', source: 'BOSS直聘' };
  }

  return { title: '招聘沟通记录', source: latestData?.pageTitle || latestData?.pageUrl || '-' };
}

function updateMeta() {
  const total = latestData?.total || latestData?.records?.length || 0;
  const visible = getVisibleRecords().length;
  const suffix = todayOnly.checked ? ` · 当前显示：${visible} 条` : '';
  const siteInfo = getDisplaySiteInfo();
  pageHeading.textContent = siteInfo.title;
  document.title = siteInfo.title;
  meta.textContent = `共 ${total} 条${suffix} · 提取时间：${latestData?.extractedAt || '-'} · 来源：${siteInfo.source}`;
}

function updateJsonBox() {
  jsonBox.textContent = JSON.stringify(toOutputRows(), null, 2);
}

function saveEditableValue(recordIndex, field, value) {
  const record = (latestData?.records || []).find((item) => Number(item.index) === Number(recordIndex));
  if (!record) return;
  record[field] = normalizeText(value);
  latestData.total = latestData.records.length;
  persistLatestData();
  updateJsonBox();
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
      if (event.key === 'Enter') {
        event.preventDefault();
        cell.blur();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        cell.textContent = cell.dataset.original || '';
        cell.blur();
      }
    });

    cell.addEventListener('blur', () => {
      if (cell.contentEditable !== 'true') return;
      cell.contentEditable = 'false';
      cell.classList.remove('editing');
      const value = normalizeText(cell.textContent);
      cell.textContent = value;
      saveEditableValue(cell.dataset.index, cell.dataset.field, value);
    });
  });
}

function renderTable() {
  const records = getVisibleRecords();
  updateMeta();
  updateJsonBox();

  if (!records.length) {
    tableBox.innerHTML = '<div class="empty">没有符合条件的记录。</div>';
    return;
  }

  tableBox.innerHTML = `
    <table>
      <thead>
        <tr>
          <th class="company">公司</th>
          <th class="job">岗位</th>
          <th class="time">沟通日期</th>
          <th class="note">备注</th>
          <th class="recruiter">招聘者信息</th>
          <th class="message">原消息</th>
        </tr>
      </thead>
      <tbody>
        ${records.map((r) => `
          <tr>
            <td class="company-cell">${escapeHtml(r.companyName)}</td>
            <td class="job-cell editable" data-index="${escapeHtml(r.index)}" data-field="jobName" title="双击编辑岗位信息">${escapeHtml(r.jobName)}</td>
            <td class="time-cell">${escapeHtml(communicationDate(r))}</td>
            <td class="note-cell editable" data-index="${escapeHtml(r.index)}" data-field="note" title="双击编辑备注">${escapeHtml(r.note || '')}</td>
            <td class="recruiter-cell">${escapeHtml(recruiterInfo(r))}</td>
            <td class="message-cell">${escapeHtml(r.lastMessage)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  bindEditableCells();
}

async function init() {
  const result = await chrome.storage.local.get('bossChatStatsLatest');
  latestData = result.bossChatStatsLatest || { total: 0, records: [] };
  latestData.records = (latestData.records || []).map((record) => ({ note: '', ...record }));
  latestData.total = latestData.records.length;
  renderTable();
}

todayOnly.addEventListener('change', renderTable);

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
  a.download = `boss-chat-records-${todayOnly.checked ? 'today-' : ''}${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

downloadJsonBtn.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(toOutputRows(), null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `boss-chat-records-${todayOnly.checked ? 'today-' : ''}${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

init();
