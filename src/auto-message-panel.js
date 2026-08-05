const CONFIG_STORAGE_KEY = 'jobChatAutoMessageConfig';
const RUN_STORAGE_KEY = 'jobChatAutoGreetingRun';
const DEBUG_LOG_STORAGE_KEY = 'jobChatAutoGreetingLogsByTab';
const DEBUG_ENABLED = new URLSearchParams(location.search).get('debug') === '1';
const PANEL_PARAMS = new URLSearchParams(location.search);
const FLOATING_MODE = PANEL_PARAMS.get('mode') === 'floating';
const OWNER_TAB_ID = Number(PANEL_PARAMS.get('tabId') || 0);
const CONFIG_DEFAULTS = {
  salaryMinK: null,
  salaryMaxK: null,
  experienceMinYears: null,
  experienceMaxYears: null,
  technicalKeywords: '',
  technicalMatchPercent: 50,
  jobKeywords: '',
  jobMatchPercent: 50,
  jobFilterKeywords: '',
  companyFilterKeywords: '',
  greetingCount: 10,
  nonHunterOnly: false,
  requestRatePerMinute: 25
};

const configView = document.getElementById('configView');
const onlineOnlyInput = document.getElementById('onlineOnly');
const nonHunterOnlyInput = document.getElementById('nonHunterOnly');
const greetButton = document.getElementById('greetButton');
const configActions = document.getElementById('configActions');
const statusBox = document.getElementById('status');
const runView = document.getElementById('runView');
const progressBar = document.getElementById('progressBar');
const runState = document.getElementById('runState');
const runTarget = document.getElementById('runTarget');
const runSucceeded = document.getElementById('runSucceeded');
const runProcessed = document.getElementById('runProcessed');
const runSkipped = document.getElementById('runSkipped');
const runFailed = document.getElementById('runFailed');
const runCurrent = document.getElementById('runCurrent');
const runControlButton = document.getElementById('runControlButton');
const runActions = document.getElementById('runActions');
const cancelRunButton = document.getElementById('cancelRunButton');
const backToConfigButton = document.getElementById('backToConfigButton');
const sentMessagesPanel = document.getElementById('sentMessagesPanel');
const sentMessagesList = document.getElementById('sentMessagesList');
const sentMessagesDate = document.getElementById('sentMessagesDate');
const sentMessageInfoCard = document.getElementById('sentMessageInfoCard');
const debugPanel = document.getElementById('debugPanel');
const debugLog = document.getElementById('debugLog');
const clearDebugLogButton = document.getElementById('clearDebugLogButton');
const panelModeButton = document.getElementById('panelModeButton');
const viewTargetExpectRow = document.getElementById('viewTargetExpectRow');
const viewTargetExpectChoices = document.getElementById('viewTargetExpectChoices');
const viewFields = {
  salary: document.getElementById('viewSalary'),
  experience: document.getElementById('viewExperience'),
  technicalKeywords: document.getElementById('viewTechnicalKeywords'),
  technicalMatchPercent: document.getElementById('viewTechnicalMatchPercent'),
  jobKeywords: document.getElementById('viewJobKeywords'),
  jobMatchPercent: document.getElementById('viewJobMatchPercent'),
  jobFilterKeywords: document.getElementById('viewJobFilterKeywords'),
  companyFilterKeywords: document.getElementById('viewCompanyFilterKeywords'),
  greetingCount: document.getElementById('viewGreetingCount'),
  requestRatePerMinute: document.getElementById('viewRequestRatePerMinute')
};

let activeTab = null;
let savedConfig = null;
let onlineOnlyAvailable = false;
let quickEdit = null;
let quickEditSaving = false;
let targetExpectations = [];
let selectedExpectId = '';

function detectSupportedSite(tabUrl) {
  try {
    const hostname = new URL(tabUrl).hostname;
    return /(^|\.)zhipin\.com$/i.test(hostname) || /(^|\.)liepin\.com$/i.test(hostname);
  } catch (_) {
    return false;
  }
}

function currentSiteKey() {
  try {
    const hostname = new URL(activeTab?.url || '').hostname;
    if (/(^|\.)zhipin\.com$/i.test(hostname)) return 'boss';
    if (/(^|\.)liepin\.com$/i.test(hostname)) return 'liepin';
  } catch (_) {}
  return '';
}

function showStatus(message, isError = false) {
  statusBox.textContent = message;
  statusBox.classList.toggle('error', isError);
}

function renderDebugLogs(logsByTab) {
  if (!DEBUG_ENABLED || !activeTab?.id) return;
  const entries = Array.isArray(logsByTab?.[String(activeTab.id)]) ? logsByTab[String(activeTab.id)] : [];
  debugLog.textContent = entries.length
    ? entries.map((entry) => `[${entry.time || '--:--:--'}] ${entry.message || ''}`).join('\n')
    : '暂无日志';
  debugLog.scrollTop = debugLog.scrollHeight;
}

async function configureDebugLogging() {
  debugPanel.hidden = !DEBUG_ENABLED;
  if (!activeTab?.id) return;
  await chrome.runtime.sendMessage({
    type: 'JOB_CHAT_AUTO_GREETING_LOG_ENABLE',
    tabId: activeTab.id,
    enabled: DEBUG_ENABLED
  });
  if (!DEBUG_ENABLED) return;
  const store = await chrome.storage.session.get([DEBUG_LOG_STORAGE_KEY]);
  renderDebugLogs(store[DEBUG_LOG_STORAGE_KEY]);
}

function normalizeConfig(config = {}) {
  const normalized = { ...CONFIG_DEFAULTS, ...config };
  delete normalized.greetingRatePerMinute;
  delete normalized.jobFilterMatchPercent;
  return normalized;
}

function validateConfig(config, requireTarget = true) {
  if (requireTarget && currentSiteKey() && !String(config.targetExpectId || '').trim()) {
    throw new Error('请选择目标职位。');
  }
  if (config.salaryMinK != null && config.salaryMaxK != null && config.salaryMinK > config.salaryMaxK) {
    throw new Error('工资范围的最小值不能大于最大值。');
  }
  if (config.experienceMinYears != null && config.experienceMaxYears != null
    && config.experienceMinYears > config.experienceMaxYears) {
    throw new Error('年限的最小值不能大于最大值。');
  }
  if (config.greetingCount == null || !Number.isInteger(config.greetingCount) || config.greetingCount < 1) {
    throw new Error('打招呼数量必须是大于等于 1 的整数。');
  }
  ['technicalMatchPercent', 'jobMatchPercent'].forEach((key) => {
    if (!Number.isFinite(config[key]) || config[key] < 0 || config[key] > 100) throw new Error('关键字匹配度必须是 0 到 100 之间的数字。');
  });
  if (!Number.isInteger(config.requestRatePerMinute) || config.requestRatePerMinute < 1 || config.requestRatePerMinute > 60) {
    throw new Error('请求速率必须是 1 到 60 之间的整数。');
  }
}

function selectConfiguredExpectation(config = {}) {
  const normalized = normalizeConfig(config);
  const siteTarget = normalized.targetExpectBySite?.[currentSiteKey()];
  selectedExpectId = String(siteTarget?.id || normalized.targetExpectId || '');
}

function renderTargetExpectChoices() {
  const visible = Boolean(currentSiteKey());
  viewTargetExpectRow.hidden = !visible;
  viewTargetExpectChoices.replaceChildren();
  if (!visible) return;
  if (!targetExpectations.length) {
    viewTargetExpectChoices.textContent = '暂无可用目标职位';
    return;
  }
  targetExpectations.forEach((expectation) => {
      const label = document.createElement('label');
      label.className = 'expect-option';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'target-expect';
      input.value = expectation.encryptId;
      input.checked = expectation.encryptId === selectedExpectId;
      input.addEventListener('change', async () => {
        if (!input.checked) return;
        selectedExpectId = expectation.encryptId;
        if (savedConfig) {
          const siteKey = currentSiteKey();
          savedConfig = {
            ...savedConfig,
            targetExpectId: expectation.encryptId,
            targetExpectName: expectation.positionName,
            targetExpectBySite: {
              ...(savedConfig.targetExpectBySite || {}),
              [siteKey]: {
                id: expectation.encryptId,
                name: expectation.positionName,
                ...(expectation.data ? { data: expectation.data } : {})
              }
            }
          };
          await chrome.storage.local.set({ [CONFIG_STORAGE_KEY]: savedConfig });
        }
        renderTargetExpectChoices();
      });
      label.append(input, document.createTextNode(expectation.positionName));
      viewTargetExpectChoices.appendChild(label);
  });
}

async function loadTargetExpectations() {
  if (!currentSiteKey()) { renderTargetExpectChoices(); return; }
  const response = await chrome.runtime.sendMessage({ type: 'JOB_CHAT_AUTO_GREETING_EXPECT_LIST_GET', tabId: activeTab.id });
  if (!response?.ok) throw new Error(response?.error || '无法读取目标职位。');
  targetExpectations = Array.isArray(response.expectations) ? response.expectations : [];
  if (!targetExpectations.some((item) => item.encryptId === selectedExpectId)) selectedExpectId = '';
  renderTargetExpectChoices();
}

function rangeText(minimum, maximum, unit) {
  if (minimum == null && maximum == null) return '未设置';
  if (minimum == null) return `不高于 ${maximum}${unit}`;
  if (maximum == null) return `不低于 ${minimum}${unit}`;
  return `${minimum}${unit} - ${maximum}${unit}`;
}

function keywordText(value) {
  return String(value || '').trim() || '未设置';
}

function renderConfigView(config) {
  onlineOnlyInput.disabled = !onlineOnlyAvailable;
  nonHunterOnlyInput.disabled = !onlineOnlyAvailable;
  nonHunterOnlyInput.checked = Boolean(config.nonHunterOnly);
  viewFields.salary.textContent = rangeText(config.salaryMinK, config.salaryMaxK, 'K');
  viewFields.experience.textContent = rangeText(config.experienceMinYears, config.experienceMaxYears, '年');
  viewFields.technicalKeywords.textContent = keywordText(config.technicalKeywords);
  viewFields.technicalMatchPercent.textContent = `${config.technicalMatchPercent}%`;
  viewFields.jobKeywords.textContent = keywordText(config.jobKeywords);
  viewFields.jobMatchPercent.textContent = `${config.jobMatchPercent}%`;
  viewFields.jobFilterKeywords.textContent = keywordText(config.jobFilterKeywords);
  viewFields.companyFilterKeywords.textContent = keywordText(config.companyFilterKeywords);
  viewFields.greetingCount.textContent = config.greetingCount == null ? '未设置' : `${config.greetingCount} 人`;
  viewFields.requestRatePerMinute.textContent = `${config.requestRatePerMinute} 次/分钟`;
  renderTargetExpectChoices();
  greetButton.disabled = !currentSiteKey();
}

function createQuickNumber(value, label, minimum = 0) {
  const input = document.createElement('input');
  input.className = 'quick-input';
  input.type = 'number';
  input.min = String(minimum);
  input.step = '1';
  input.value = value == null ? '' : String(value);
  input.setAttribute('aria-label', label);
  return input;
}

function appendQuickRange(container, minimum, maximum, unit, labels) {
  const range = document.createElement('span');
  range.className = 'quick-range';
  const minimumInput = createQuickNumber(minimum, labels[0]);
  const separator = document.createElement('span');
  separator.textContent = '—';
  separator.className = 'range-separator';
  const maximumInput = createQuickNumber(maximum, labels[1]);
  range.append(minimumInput, separator, maximumInput);
  container.appendChild(range);
  const unitHint = document.createElement('span');
  unitHint.className = 'quick-unit';
  unitHint.textContent = `单位：${unit}`;
  container.appendChild(unitHint);
  return [minimumInput, maximumInput];
}

function enterQuickEdit(key, row) {
  if (!savedConfig || quickEdit || !row) return;
  const valueCell = row.matches('dd') ? row : row.querySelector('dd');
  if (!valueCell) return;
  valueCell.textContent = '';
  row.classList.add('quick-editing');
  let inputs = [];

  if (key === 'salary') {
    inputs = appendQuickRange(
      valueCell,
      savedConfig.salaryMinK,
      savedConfig.salaryMaxK,
      'K',
      ['最低工资', '最高工资']
    );
  } else if (key === 'experience') {
    inputs = appendQuickRange(
      valueCell,
      savedConfig.experienceMinYears,
      savedConfig.experienceMaxYears,
      '年',
      ['最低年限', '最高年限']
    );
  } else if (key === 'greetingCount' || key === 'requestRatePerMinute' || key.endsWith('MatchPercent')) {
    const minimum = key === 'greetingCount' || key === 'requestRatePerMinute' ? 1 : 0;
    inputs = [createQuickNumber(savedConfig[key], key === 'greetingCount' ? '打招呼数量' : '数值', minimum)];
    if (key.endsWith('MatchPercent')) inputs[0].max = '100';
    if (key === 'requestRatePerMinute') inputs[0].max = '60';
    valueCell.appendChild(inputs[0]);
  } else {
    const textarea = document.createElement('textarea');
    textarea.className = 'quick-textarea';
    textarea.rows = 3;
    textarea.wrap = 'soft';
    textarea.placeholder = '多个关键字使用 | 分割';
    textarea.value = String(savedConfig[key] || '');
    valueCell.appendChild(textarea);
    inputs = [textarea];
  }

  quickEdit = { key, row, inputs };
  greetButton.classList.add('editing');
  greetButton.setAttribute('aria-disabled', 'true');
  showStatus('');
  inputs[0]?.focus();
}

function quickNumberValue(input) {
  if (input.value === '') return null;
  const value = Number(input.value);
  return Number.isFinite(value) ? value : null;
}

async function saveQuickEdit() {
  if (!quickEdit || quickEditSaving) return false;
  quickEditSaving = true;
  const currentEdit = quickEdit;
  try {
    const nextConfig = { ...savedConfig };
    if (currentEdit.key === 'salary') {
      nextConfig.salaryMinK = quickNumberValue(currentEdit.inputs[0]);
      nextConfig.salaryMaxK = quickNumberValue(currentEdit.inputs[1]);
    } else if (currentEdit.key === 'experience') {
      nextConfig.experienceMinYears = quickNumberValue(currentEdit.inputs[0]);
      nextConfig.experienceMaxYears = quickNumberValue(currentEdit.inputs[1]);
    } else if (currentEdit.key === 'greetingCount' || currentEdit.key === 'requestRatePerMinute' || currentEdit.key.endsWith('MatchPercent')) {
      nextConfig[currentEdit.key] = quickNumberValue(currentEdit.inputs[0]);
    } else {
      nextConfig[currentEdit.key] = currentEdit.inputs[0].value.trim();
    }
    validateConfig(nextConfig, false);
    await chrome.storage.local.set({ [CONFIG_STORAGE_KEY]: nextConfig });
    savedConfig = nextConfig;

    quickEdit = null;
    currentEdit.row.classList.remove('quick-editing');
    greetButton.classList.remove('editing');
    greetButton.removeAttribute('aria-disabled');
    renderConfigView(savedConfig);
    showStatus('');
    return true;
  } catch (error) {
    showStatus(error?.message || String(error), true);
    return false;
  } finally {
    quickEditSaving = false;
  }
}

function cancelQuickEdit() {
  if (!quickEdit) return;
  const row = quickEdit.row;
  quickEdit = null;
  row.classList.remove('quick-editing');
  greetButton.classList.remove('editing');
  greetButton.removeAttribute('aria-disabled');
  renderConfigView(savedConfig);
  showStatus('');
}

function showConfigView(config) {
  savedConfig = normalizeConfig(config);
  renderConfigView(savedConfig);
  runView.hidden = true;
  configView.hidden = false;
  configActions.hidden = false;
}

let sentInfoHideTimer = null;

function closeSentInfoCard() {
  clearTimeout(sentInfoHideTimer);
  sentMessageInfoCard.classList.remove('show');
}

function scheduleSentInfoCardHide() {
  clearTimeout(sentInfoHideTimer);
  sentInfoHideTimer = setTimeout(closeSentInfoCard, 220);
}

function appendSentInfoText(card, className, value) {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = value;
  card.appendChild(element);
}

function showSentInfoCard(target, entry, type) {
  clearTimeout(sentInfoHideTimer);
  sentMessageInfoCard.replaceChildren();
  const isCompany = type === 'company';
  const title = document.createElement('h3');
  title.textContent = String(isCompany ? (entry.companyName || '公司详情') : (entry.jobName || '岗位详情'));
  sentMessageInfoCard.appendChild(title);
  if (isCompany) {
    const summary = [entry.companyIndustry ? `行业：${entry.companyIndustry}` : '', entry.companyScale ? `规模：${entry.companyScale}` : ''].filter(Boolean).join(' · ');
    if (summary) appendSentInfoText(sentMessageInfoCard, 'job-info-meta', summary);
    appendSentInfoText(sentMessageInfoCard, 'detail', String(entry.companyDetail || '暂无公司介绍。'));
  } else {
    const summary = [entry.salary, entry.jobLocation, entry.jobExperience, entry.jobEducation].filter(Boolean).join(' · ');
    if (summary) appendSentInfoText(sentMessageInfoCard, 'job-info-meta', summary);
    const skills = Array.isArray(entry.jobSkills) ? entry.jobSkills.filter(Boolean) : [];
    if (skills.length) {
      const skillBox = document.createElement('div');
      skillBox.className = 'keywords';
      skills.forEach((skill) => {
        const chip = document.createElement('span');
        chip.className = 'keyword';
        chip.textContent = String(skill);
        skillBox.appendChild(chip);
      });
      sentMessageInfoCard.appendChild(skillBox);
    }
    appendSentInfoText(sentMessageInfoCard, 'detail', String(entry.jobDetail || '暂无岗位详情。'));
    if (entry.jobAddress) appendSentInfoText(sentMessageInfoCard, 'job-info-meta', `地址：${entry.jobAddress}`);
  }
  sentMessageInfoCard.classList.add('show');
  const targetRect = target.getBoundingClientRect();
  const cardRect = sentMessageInfoCard.getBoundingClientRect();
  const preferredLeft = targetRect.left + targetRect.width / 2 - cardRect.width;
  const left = Math.max(12, Math.min(window.innerWidth - cardRect.width - 12, preferredLeft));
  const top = targetRect.bottom + cardRect.height <= window.innerHeight ? targetRect.bottom : Math.max(12, targetRect.top - cardRect.height);
  sentMessageInfoCard.style.left = `${left}px`;
  sentMessageInfoCard.style.top = `${top}px`;
}

function renderSentMessages(messages) {
  sentMessagesList.replaceChildren();
  const entries = Array.isArray(messages) ? messages : [];
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'sent-message-empty';
    empty.textContent = '暂无已发送信息';
    sentMessagesList.appendChild(empty);
    return;
  }
  entries.slice(-100).reverse().forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'sent-message';
    const main = document.createElement('div');
    main.className = 'sent-message-main';
    const company = document.createElement('span');
    company.className = 'sent-message-company';
    company.textContent = String(entry.companyName || '未知公司').trim();
    company.tabIndex = 0;
    company.title = '悬浮查看公司详情';
    const job = document.createElement('span');
    job.className = 'sent-message-job';
    job.textContent = String(entry.jobName || '未知岗位').trim();
    job.tabIndex = 0;
    job.title = '悬浮查看岗位详情';
    const salary = document.createElement('span');
    salary.className = 'sent-message-salary';
    salary.textContent = String(entry.salary || '薪资未提供');
    main.append(company, job, salary);
    row.append(main);
    company.addEventListener('mouseenter', () => showSentInfoCard(company, entry, 'company'));
    company.addEventListener('mouseleave', scheduleSentInfoCardHide);
    company.addEventListener('focus', () => showSentInfoCard(company, entry, 'company'));
    company.addEventListener('blur', scheduleSentInfoCardHide);
    job.addEventListener('mouseenter', () => showSentInfoCard(job, entry, 'job'));
    job.addEventListener('mouseleave', scheduleSentInfoCardHide);
    job.addEventListener('focus', () => showSentInfoCard(job, entry, 'job'));
    job.addEventListener('blur', scheduleSentInfoCardHide);
    sentMessagesList.appendChild(row);
  });
}

function renderRun(run) {
  if (!run || Number(run.tabId) !== Number(activeTab?.id)) return false;
  const target = Math.max(1, Number(run.config?.greetingCount || 1));
  const succeeded = Number(run.succeeded || 0);
  const statusLabels = { running: '正在运行', paused: '已暂停', refreshing: '正在刷新重试', cancelling: '正在取消', cancelled: '已取消', completed: '已完成', failed: '运行失败' };
  if (savedConfig) {
    renderConfigView(savedConfig);
    configView.hidden = false;
  } else {
    configView.hidden = true;
  }
  runView.hidden = false;
  runState.textContent = statusLabels[run.status] || run.status || '准备中';
  runTarget.textContent = `目标 ${target} 条`;
  runSucceeded.textContent = String(succeeded);
  runProcessed.textContent = String(Number(run.processed || 0));
  runSkipped.textContent = String(Number(run.skipped || 0));
  runFailed.textContent = String(Number(run.failed || 0));
  runCurrent.textContent = [run.currentJobName, run.statusText].filter(Boolean).join(' · ');
  const startedAt = new Date(run.startedAt);
  sentMessagesDate.textContent = Number.isNaN(startedAt.getTime())
    ? ''
    : `· ${startedAt.toLocaleString('zh-CN', { hour12: false })}`;
  renderSentMessages(run.sentMessages);
  sentMessagesPanel.hidden = false;
  const percentage = Math.min(100, Math.round(succeeded / target * 100));
  progressBar.style.width = `${percentage}%`;
  progressBar.parentElement.setAttribute('aria-valuenow', String(percentage));
  const controllable = run.status === 'running' || run.status === 'paused';
  const executing = controllable || run.status === 'refreshing' || run.status === 'cancelling';
  configActions.hidden = true;
  runControlButton.disabled = false;
  cancelRunButton.disabled = false;
  runActions.hidden = !executing;
  runControlButton.hidden = run.status === 'cancelling';
  runControlButton.textContent = run.status === 'paused' ? '继续' : '暂停';
  cancelRunButton.hidden = run.status !== 'paused';
  runActions.style.gridTemplateColumns = run.status === 'paused' ? 'minmax(0, 1fr) minmax(0, 1.5fr)' : '1fr';
  backToConfigButton.hidden = executing;
  showStatus(run.status === 'failed' ? run.statusText || '运行失败' : '', run.status === 'failed');
  return true;
}

async function getActiveTab() {
  if (FLOATING_MODE && Number.isInteger(OWNER_TAB_ID) && OWNER_TAB_ID > 0) {
    return chrome.tabs.get(OWNER_TAB_ID).catch(() => null);
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function refreshOnlineOnly() {
  activeTab = await getActiveTab();
  const available = Boolean(activeTab?.id && detectSupportedSite(activeTab.url || ''));
  onlineOnlyAvailable = available;
  onlineOnlyInput.disabled = !available;
  nonHunterOnlyInput.disabled = !available;
  if (!available) {
    onlineOnlyInput.checked = false;
    if (savedConfig && !quickEdit) renderConfigView(savedConfig);
    return;
  }
  const response = await chrome.runtime.sendMessage({
    type: 'JOB_CHAT_ONLINE_ONLY_GET',
    tabId: activeTab.id
  });
  if (!response?.ok) throw new Error(response?.error || '无法读取仅在线设置。');
  onlineOnlyInput.checked = Boolean(response.enabled);
  if (savedConfig && !quickEdit) renderConfigView(savedConfig);
}

async function refreshPanelContext() {
  await refreshOnlineOnly();
  await configureDebugLogging();
  selectConfiguredExpectation(savedConfig || {});
  targetExpectations = [];
  await loadTargetExpectations();
  if (savedConfig && !quickEdit) renderConfigView(savedConfig);
}

async function initialize() {
  try {
    panelModeButton.textContent = FLOATING_MODE ? '停靠' : '浮动';
    const store = await chrome.storage.local.get([CONFIG_STORAGE_KEY, RUN_STORAGE_KEY]);
    const storedConfig = store[CONFIG_STORAGE_KEY];
    const hasStoredConfig = Boolean(storedConfig && typeof storedConfig === 'object' && !Array.isArray(storedConfig));
    const normalizedStoredConfig = normalizeConfig(hasStoredConfig ? storedConfig : {});
    savedConfig = normalizedStoredConfig;
    await refreshOnlineOnly();
    // activeTab is assigned by refreshOnlineOnly. Enable logging after that,
    // but before requesting expectations, so the first request is captured.
    await configureDebugLogging();
    selectConfiguredExpectation(normalizedStoredConfig);
    await loadTargetExpectations();
    const runStatus = activeTab?.id
      ? await chrome.runtime.sendMessage({ type: 'JOB_CHAT_AUTO_GREETING_STATUS_GET', tabId: activeTab.id })
      : null;
    if (runStatus?.ok && Number(runStatus.run?.tabId) === Number(activeTab?.id)
      && ['completed', 'failed', 'cancelled'].includes(String(runStatus.run?.status || ''))) {
      renderRun(runStatus.run);
      return;
    }
    if (runStatus?.ok && Number(runStatus.run?.tabId) === Number(activeTab?.id)) {
      runView.hidden = true;
      showConfigView(normalizedStoredConfig);
      return;
    }
    showConfigView(normalizedStoredConfig);
  } catch (error) {
    showConfigView(savedConfig || CONFIG_DEFAULTS);
    showStatus(error?.message || String(error), true);
  }
}

onlineOnlyInput.addEventListener('change', async () => {
  const enabled = onlineOnlyInput.checked;
  onlineOnlyInput.disabled = true;
  showStatus('');
  try {
    activeTab = await getActiveTab();
    if (!activeTab?.id || !detectSupportedSite(activeTab.url || '')) {
      throw new Error('请先打开 BOSS直聘或猎聘页面。');
    }
    const response = await chrome.runtime.sendMessage({
      type: 'JOB_CHAT_ONLINE_ONLY_SET',
      tabId: activeTab.id,
      enabled
    });
    if (!response?.ok) throw new Error(response?.error || '无法保存仅在线设置。');
    onlineOnlyInput.checked = Boolean(response.enabled);
    showStatus('');
  } catch (error) {
    onlineOnlyInput.checked = !enabled;
    showStatus(error?.message || String(error), true);
  } finally {
    onlineOnlyInput.disabled = false;
  }
});

nonHunterOnlyInput.addEventListener('change', async () => {
  const enabled = nonHunterOnlyInput.checked;
  nonHunterOnlyInput.disabled = true;
  showStatus('');
  try {
    if (!activeTab?.id || !currentSiteKey()) throw new Error('请先打开 BOSS直聘或猎聘页面。');
    const nextConfig = { ...savedConfig, nonHunterOnly: enabled };
    validateConfig(nextConfig, false);
    await chrome.storage.local.set({ [CONFIG_STORAGE_KEY]: nextConfig });
    savedConfig = nextConfig;
  } catch (error) {
    nonHunterOnlyInput.checked = !enabled;
    showStatus(error?.message || String(error), true);
  } finally {
    nonHunterOnlyInput.disabled = !onlineOnlyAvailable;
  }
});

configView.addEventListener('dblclick', (event) => {
  const target = event.target.closest('[data-edit-key]');
  if (!target || !configView.contains(target)) return;
  enterQuickEdit(target.dataset.editKey, target);
});

document.addEventListener('pointerdown', (event) => {
  if (!quickEdit || quickEdit.row.contains(event.target)) return;
  if (greetButton.contains(event.target)) return;
  saveQuickEdit();
}, true);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && quickEdit) cancelQuickEdit();
});

greetButton.addEventListener('click', async () => {
  if (quickEdit) {
    showStatus('正在编辑。');
    return;
  }
  if (!activeTab?.id || !currentSiteKey()) {
    showStatus('请先打开 BOSS直聘或猎聘页面。', true);
    return;
  }
  greetButton.disabled = true;
  showStatus('正在启动…');
  try {
    const siteTarget = savedConfig?.targetExpectBySite?.[currentSiteKey()];
    const runConfig = {
      ...savedConfig,
      targetExpectId: String(siteTarget?.id || selectedExpectId || ''),
      targetExpectName: String(siteTarget?.name || targetExpectations.find((item) => item.encryptId === selectedExpectId)?.positionName || '')
    };
    validateConfig(runConfig);
    const response = await chrome.runtime.sendMessage({
      type: 'JOB_CHAT_AUTO_GREETING_START', tabId: activeTab.id, config: runConfig
    });
    if (!response?.ok) throw new Error(response?.error || '无法启动自动打招呼。');
    renderRun(response.run);
  } catch (error) {
    showStatus(error?.message || String(error), true);
  } finally {
    greetButton.disabled = false;
  }
});

runControlButton.addEventListener('click', async () => {
  const action = runControlButton.textContent === '继续' ? 'RESUME' : 'PAUSE';
  runControlButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: `JOB_CHAT_AUTO_GREETING_${action}`, tabId: activeTab?.id });
    if (!response?.ok) throw new Error(response?.error || '无法控制任务。');
  } catch (error) {
    showStatus(error?.message || String(error), true);
  } finally {
    runControlButton.disabled = false;
  }
});

cancelRunButton.addEventListener('click', async () => {
  cancelRunButton.disabled = true;
  runControlButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'JOB_CHAT_AUTO_GREETING_CANCEL',
      tabId: activeTab?.id
    });
    if (!response?.ok) throw new Error(response?.error || '无法取消任务。');
  } catch (error) {
    showStatus(error?.message || String(error), true);
    cancelRunButton.disabled = false;
    runControlButton.disabled = false;
  }
});

backToConfigButton.addEventListener('click', () => {
  showConfigView(savedConfig || CONFIG_DEFAULTS);
});

panelModeButton.addEventListener('click', async () => {
  panelModeButton.disabled = true;
  showStatus('');
  try {
    if (!activeTab?.id) throw new Error('没有找到关联的招聘标签页。');
    if (!FLOATING_MODE) {
      const response = await chrome.runtime.sendMessage({
        type: 'JOB_CHAT_AUTO_GREETING_PANEL_FLOAT',
        tabId: activeTab.id,
        debug: DEBUG_ENABLED
      });
      if (!response?.ok) throw new Error(response?.error || '无法打开浮动窗口。');
      return;
    }
    if (!chrome.sidePanel?.open) throw new Error('当前 Chrome 版本不支持停靠到侧边栏。');
    const path = `auto-message-panel.html${DEBUG_ENABLED ? '?debug=1' : ''}`;
    await chrome.sidePanel.setOptions({ tabId: activeTab.id, path, enabled: true });
    await chrome.sidePanel.open({ tabId: activeTab.id });
    const popupWindow = await chrome.windows.getCurrent();
    const response = await chrome.runtime.sendMessage({
      type: 'JOB_CHAT_AUTO_GREETING_PANEL_DOCK',
      tabId: activeTab.id,
      windowId: popupWindow.id,
      debug: DEBUG_ENABLED
    });
    if (!response?.ok) throw new Error(response?.error || '无法关闭浮动窗口。');
  } catch (error) {
    showStatus(error?.message || String(error), true);
  } finally {
    panelModeButton.disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[CONFIG_STORAGE_KEY] && !quickEdit) {
    savedConfig = normalizeConfig(changes[CONFIG_STORAGE_KEY].newValue || {});
    selectConfiguredExpectation(savedConfig);
    renderConfigView(savedConfig);
  }
  if (areaName === 'local' && changes[RUN_STORAGE_KEY]) {
    renderRun(changes[RUN_STORAGE_KEY].newValue);
  }
  if (areaName === 'session' && changes[DEBUG_LOG_STORAGE_KEY]) {
    renderDebugLogs(changes[DEBUG_LOG_STORAGE_KEY].newValue);
  }
});

clearDebugLogButton.addEventListener('click', async () => {
  if (!activeTab?.id) return;
  await chrome.runtime.sendMessage({ type: 'JOB_CHAT_AUTO_GREETING_LOG_CLEAR', tabId: activeTab.id });
});

debugLog.addEventListener('pointerdown', () => {
  debugLog.focus({ preventScroll: true });
});

debugLog.addEventListener('keydown', (event) => {
  if (!(event.key.toLowerCase() === 'a' && (event.ctrlKey || event.metaKey))) return;
  event.preventDefault();
  const range = document.createRange();
  range.selectNodeContents(debugLog);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
});

sentMessageInfoCard.addEventListener('mouseenter', () => clearTimeout(sentInfoHideTimer));
sentMessageInfoCard.addEventListener('mouseleave', scheduleSentInfoCardHide);

chrome.tabs.onActivated.addListener(() => {
  refreshPanelContext().catch((error) => showStatus(error?.message || String(error), true));
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.active || (!changeInfo.url && changeInfo.status !== 'complete')) return;
  refreshPanelContext().catch((error) => showStatus(error?.message || String(error), true));
});

initialize();
