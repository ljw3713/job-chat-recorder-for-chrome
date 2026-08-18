const CONFIG_STORAGE_KEY = 'jobChatAutoMessageConfig';
const DEEPSEEK_API_KEY_STORAGE_KEY = 'jobChatDeepSeekApiKey';
const RUN_STORAGE_KEY = 'jobChatAutoGreetingRun';
const DEBUG_LOG_STORAGE_KEY = 'jobChatAutoGreetingLogsByTab';
const BOSS_FILTER_OPTIONS_CACHE_KEY = 'jobChatBossFilterOptionsCache';
const BOSS_FILTER_OPTIONS_CACHE_VERSION = 2;
const BOSS_FILTER_OPTIONS_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
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
  aiMatchEnabled: false,
  aiResumeEnabled: false,
  aiResume: '',
  aiResumePromptTemplate: '候选人的简历如下：\n${resume}\n\n请根据候选人的技能、工作经历、项目经验和岗位要求，判断该岗位是否适合候选人。不满足关键要求时判定为不匹配。',
  aiExpectedJobEnabled: false,
  aiExpectedJob: '',
  aiExpectedJobPromptTemplate: '候选人期待的岗位是：\n${expectedJob}\n\n请判断当前岗位的职位方向、工作内容和要求是否符合上述期待。方向明显不一致时判定为不匹配。',
  aiOtherPrompt: '',
  jobKeywords: '',
  jobMatchPercent: 50,
  jobFilterKeywords: '',
  companyFilterKeywords: '',
  greetingCount: 10,
  nonHunterOnly: false,
  requestRatePerMinute: 25,
  bossSourceMode: 'recommend',
  bossSearchQuery: '',
  liepinRecommendSortType: 'PC_HP_NEW',
  bossRecommendFilters: { city: null, jobType: null, salary: null, experience: [], degree: [], industry: [], scale: [], stage: [], position: [], multiSubway: [], multiBusinessDistrict: [] }
};

const configView = document.getElementById('configView');
const onlineOnlyInput = document.getElementById('onlineOnly');
const nonHunterOnlyInput = document.getElementById('nonHunterOnly');
const greetButton = document.getElementById('greetButton');
const configActions = document.getElementById('configActions');
const statusBox = document.getElementById('status');
const editLockedToast = document.getElementById('editLockedToast');
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
const liepinRecommendSortRow = document.getElementById('liepinRecommendSortRow');
const liepinRecommendSortChoices = document.getElementById('liepinRecommendSortChoices');
const bossSourceModeTabs = document.getElementById('bossSourceModeTabs');
const bossSearchQuery = document.getElementById('bossSearchQuery');
const bossRecommendFilterSection = document.getElementById('bossRecommendFilterSection');
const bossRecommendFilterList = document.getElementById('bossRecommendFilterList');
const aiMatchEnabledInput = document.getElementById('aiMatchEnabled');
const aiMatchToggleButton = document.getElementById('aiMatchToggle');
const aiMatchPanel = document.getElementById('aiMatchPanel');
const deepSeekApiKeyInput = document.getElementById('deepSeekApiKey');
const aiResumeEnabledInput = document.getElementById('aiResumeEnabled');
const aiResumeInput = document.getElementById('aiResume');
const aiResumePromptInput = document.getElementById('aiResumePromptTemplate');
const aiExpectedJobEnabledInput = document.getElementById('aiExpectedJobEnabled');
const aiExpectedJobInput = document.getElementById('aiExpectedJob');
const aiExpectedJobPromptInput = document.getElementById('aiExpectedJobPromptTemplate');
const aiOtherPromptInput = document.getElementById('aiOtherPrompt');
const aiPromptPreview = document.getElementById('aiPromptPreview');
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
let deepSeekApiKey = '';
let aiConfigSaveTimer = null;
let apiKeySaveTimer = null;
let renderedRunStatus = '';
let renderedRunTabId = 0;

function isConfigEditingLocked() {
  return ['running', 'paused', 'refreshing', 'cancelling'].includes(renderedRunStatus);
}
let editLockedToastTimer = null;

function showEditLockedNotice() {
  clearTimeout(editLockedToastTimer);
  editLockedToast.classList.remove('show');
  void editLockedToast.offsetWidth;
  editLockedToast.classList.add('show');
  editLockedToastTimer = setTimeout(() => editLockedToast.classList.remove('show'), 1800);
}
let onlineOnlyAvailable = false;
let quickEdit = null;
let quickEditSaving = false;
let targetExpectations = [];
let selectedExpectId = '';
let bossFilterOptions = null;
let bossFilterOptionsError = '';
let bossRecommendFiltersLocked = false;
let bossLocationFilterOptions = null;
let bossLocationFilterCityCode = '';

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
  normalized.aiMatchEnabled = Boolean(normalized.aiMatchEnabled);
  normalized.aiResumeEnabled = Boolean(normalized.aiResumeEnabled);
  normalized.aiResume = String(normalized.aiResume || '');
  normalized.aiResumePromptTemplate = String(normalized.aiResumePromptTemplate || CONFIG_DEFAULTS.aiResumePromptTemplate);
  normalized.aiExpectedJobEnabled = Boolean(normalized.aiExpectedJobEnabled);
  normalized.aiExpectedJob = String(normalized.aiExpectedJob || '');
  normalized.aiExpectedJobPromptTemplate = String(normalized.aiExpectedJobPromptTemplate || CONFIG_DEFAULTS.aiExpectedJobPromptTemplate);
  normalized.aiOtherPrompt = String(normalized.aiOtherPrompt || '');
  const filter = normalized.bossRecommendFilters && typeof normalized.bossRecommendFilters === 'object'
    ? normalized.bossRecommendFilters : {};
  const option = (value) => {
    const code = String(value?.code ?? '').trim();
    const name = String(value?.name ?? '').trim();
    return code && code !== '0' ? { code, name } : null;
  };
  const options = (value) => [...new Map((Array.isArray(value) ? value : []).map(option).filter(Boolean).map((item) => [item.code, item])).values()];
  normalized.bossRecommendFilters = {
    city: option(filter.city), jobType: option(filter.jobType), salary: option(filter.salary),
    experience: options(filter.experience), degree: options(filter.degree),
    industry: options(filter.industry), scale: options(filter.scale), stage: options(filter.stage),
    position: options(filter.position), multiSubway: options(filter.multiSubway),
    multiBusinessDistrict: options(filter.multiBusinessDistrict)
  };
  normalized.bossSourceMode = normalized.bossSourceMode === 'search' ? 'search' : 'recommend';
  normalized.bossSearchQuery = String(normalized.bossSearchQuery || '').trim();
  normalized.liepinRecommendSortType = normalized.liepinRecommendSortType === 'PC_HP_MIX' ? 'PC_HP_MIX' : 'PC_HP_NEW';
  delete normalized.greetingRatePerMinute;
  delete normalized.jobFilterMatchPercent;
  return normalized;
}

function composeAiPrompt(config) {
  const parts = [];
  if (config.aiResumeEnabled && config.aiResume.trim()) {
    parts.push(config.aiResumePromptTemplate.replaceAll('${resume}', config.aiResume.trim()).trim());
  }
  if (config.aiExpectedJobEnabled && config.aiExpectedJob.trim()) {
    parts.push(config.aiExpectedJobPromptTemplate.replaceAll('${expectedJob}', config.aiExpectedJob.trim()).trim());
  }
  if (config.aiOtherPrompt.trim()) parts.push(config.aiOtherPrompt.trim());
  if (parts.length) parts.push('待匹配岗位信息：\n${jobInfo}');
  return parts.filter(Boolean).join('\n\n');
}

function aiConfigFromInputs() {
  return normalizeConfig({
    ...savedConfig,
    aiMatchEnabled: aiMatchEnabledInput.checked,
    aiResumeEnabled: aiResumeEnabledInput.checked,
    aiResume: aiResumeInput.value,
    aiResumePromptTemplate: aiResumePromptInput.value,
    aiExpectedJobEnabled: aiExpectedJobEnabledInput.checked,
    aiExpectedJob: aiExpectedJobInput.value,
    aiExpectedJobPromptTemplate: aiExpectedJobPromptInput.value,
    aiOtherPrompt: aiOtherPromptInput.value
  });
}

function renderAiDependentState(config) {
  const locked = isConfigEditingLocked();
  aiMatchEnabledInput.disabled = locked;
  aiMatchToggleButton.disabled = false;
  deepSeekApiKeyInput.disabled = locked;
  aiResumeEnabledInput.disabled = locked;
  aiResumeInput.disabled = locked;
  aiResumePromptInput.disabled = locked || !config.aiResumeEnabled;
  aiExpectedJobEnabledInput.disabled = locked;
  aiExpectedJobInput.disabled = locked;
  aiExpectedJobPromptInput.disabled = locked || !config.aiExpectedJobEnabled;
  aiOtherPromptInput.disabled = locked;
  aiPromptPreview.value = composeAiPrompt(config) || '尚未配置参与匹配的提示词。';
}

function renderAiConfig(config) {
  aiMatchEnabledInput.checked = config.aiMatchEnabled;
  deepSeekApiKeyInput.value = deepSeekApiKey;
  aiResumeEnabledInput.checked = config.aiResumeEnabled;
  aiResumeInput.value = config.aiResume;
  aiResumePromptInput.value = config.aiResumePromptTemplate;
  aiExpectedJobEnabledInput.checked = config.aiExpectedJobEnabled;
  aiExpectedJobInput.value = config.aiExpectedJob;
  aiExpectedJobPromptInput.value = config.aiExpectedJobPromptTemplate;
  aiOtherPromptInput.value = config.aiOtherPrompt;
  renderAiDependentState(config);
}

async function persistAiConfig() {
  clearTimeout(aiConfigSaveTimer);
  aiConfigSaveTimer = null;
  if (!savedConfig) return;
  await chrome.storage.local.set({ [CONFIG_STORAGE_KEY]: savedConfig });
}

async function persistDeepSeekApiKey() {
  clearTimeout(apiKeySaveTimer);
  apiKeySaveTimer = null;
  deepSeekApiKey = deepSeekApiKeyInput.value.trim();
  await chrome.storage.local.set({ [DEEPSEEK_API_KEY_STORAGE_KEY]: deepSeekApiKey });
}

function hasFilterOptions(options) {
  return Boolean(options && Array.isArray(options.cities) && Array.isArray(options.jobTypes)
    && Array.isArray(options.salaries) && Array.isArray(options.experiences)
    && Array.isArray(options.degrees) && Array.isArray(options.industries) && Array.isArray(options.scales)
    && Array.isArray(options.stages) && Array.isArray(options.positions)
    && options.cities.length && options.jobTypes.length && options.salaries.length
    && options.experiences.length && options.degrees.length && options.industries.length && options.scales.length
    && options.stages.length && options.positions.length);
}

function filterLabel(value, multiple = false) {
  if (multiple) return value?.length ? value.map((item) => item.name).filter(Boolean).join('、') : '不限';
  return value?.name || '不限';
}

function filterDefinitions() {
  if (!bossFilterOptions) return [];
  return [
    { key: 'city', title: '城市', choices: bossFilterOptions.cities, searchable: true },
    { key: 'jobType', title: '求职类型', choices: bossFilterOptions.jobTypes },
    { key: 'salary', title: '推荐薪资', choices: bossFilterOptions.salaries },
    { key: 'experience', title: '推荐经验', choices: bossFilterOptions.experiences, multiple: true },
    { key: 'degree', title: '学历要求', choices: bossFilterOptions.degrees, multiple: true },
    { key: 'industry', title: '公司行业', groups: bossFilterOptions.industries, multiple: true, searchable: true },
    { key: 'scale', title: '公司规模', choices: bossFilterOptions.scales, multiple: true },
    { key: 'stage', title: '融资阶段', choices: bossFilterOptions.stages, multiple: true, searchOnly: true },
    { key: 'position', title: '职位类型', groups: bossFilterOptions.positions, multiple: true, searchable: true, searchOnly: true },
    ...(bossLocationFilterOptions ? [
      { key: 'multiBusinessDistrict', title: '区域', groups: bossLocationFilterOptions.districts, multiple: true, searchable: true, searchOnly: true, hierarchical: true },
      { key: 'multiSubway', title: '地铁', groups: bossLocationFilterOptions.subways, multiple: true, searchable: true, searchOnly: true, hierarchical: true }
    ] : [])
  ];
}

function createFilterOption(definition, item, selected) {
  const label = document.createElement('label');
  label.className = 'recommend-filter-option';
  const input = document.createElement('input');
  input.type = definition.multiple ? 'checkbox' : 'radio';
  input.name = `boss-recommend-${definition.key}`;
  input.dataset.filterKey = definition.key;
  input.value = item.code;
  input.checked = selected;
  input.disabled = bossRecommendFiltersLocked;
  const textNode = document.createElement('span');
  textNode.textContent = item.name;
  label.append(input, textNode);
  return label;
}

function renderBossRecommendFilters(config) {
  const visible = currentSiteKey() === 'boss';
  bossRecommendFilterSection.hidden = !visible;
  bossRecommendFilterSection.classList.toggle('is-disabled', bossRecommendFiltersLocked);
  bossRecommendFilterList.replaceChildren();
  if (!visible) return;
  if (!bossFilterOptions) {
    const message = document.createElement('p');
    message.className = 'recommend-filter-hint';
    message.textContent = bossFilterOptionsError || '正在读取筛选条件…';
    bossRecommendFilterList.appendChild(message);
    return;
  }
  const filters = config.bossRecommendFilters || CONFIG_DEFAULTS.bossRecommendFilters;
  filterDefinitions().filter((definition) => !definition.searchOnly || config.bossSourceMode === 'search').forEach((definition) => {
    const details = document.createElement('details');
    details.className = 'recommend-filter';
    details.dataset.filterKey = definition.key;
    const summary = document.createElement('summary');
    const title = document.createElement('span');
    title.textContent = definition.title;
    const value = document.createElement('span');
    value.className = 'recommend-filter-value';
    value.textContent = filterLabel(filters[definition.key], definition.multiple);
    summary.append(title, value);
    const options = document.createElement('div');
    options.className = 'recommend-filter-options';
    if (definition.searchable) {
      const search = document.createElement('input');
      search.className = 'recommend-filter-search';
      search.type = 'search';
      search.placeholder = `搜索${definition.title}`;
      search.disabled = bossRecommendFiltersLocked;
      search.addEventListener('input', () => {
        const term = search.value.trim().toLowerCase();
        options.querySelectorAll('.recommend-filter-option').forEach((label) => {
          label.hidden = Boolean(term) && !label.textContent.toLowerCase().includes(term);
        });
        options.querySelectorAll('.recommend-filter-group').forEach((group) => {
          group.hidden = [...group.querySelectorAll('.recommend-filter-option')].every((label) => label.hidden);
        });
      });
      options.appendChild(search);
    }
    const selectedCodes = new Set((definition.multiple ? filters[definition.key] : [filters[definition.key]])
      .filter(Boolean).map((item) => String(item.code)));
    options.appendChild(createFilterOption(definition, { code: '0', name: '不限' }, selectedCodes.size === 0));
    if (definition.groups) {
      definition.groups.forEach((group) => {
        const groupNode = document.createElement(definition.hierarchical ? 'details' : 'div');
        groupNode.className = definition.hierarchical ? 'recommend-filter-group recommend-filter-subgroup' : 'recommend-filter-group';
        groupNode.dataset.groupCode = group.code;
        const groupTitle = document.createElement(definition.hierarchical ? 'summary' : 'span');
        groupTitle.className = 'recommend-filter-group-title';
        groupTitle.textContent = group.name;
        groupNode.appendChild(groupTitle);
        const childBox = definition.hierarchical ? document.createElement('div') : groupNode;
        if (definition.hierarchical) childBox.className = 'recommend-filter-subgroup-options';
        group.children.forEach((item) => childBox.appendChild(createFilterOption(definition, item, selectedCodes.has(item.code))));
        if (definition.hierarchical) groupNode.appendChild(childBox);
        options.appendChild(groupNode);
      });
    } else {
      definition.choices.forEach((item) => options.appendChild(createFilterOption(definition, item, selectedCodes.has(item.code))));
    }
    details.append(summary, options);
    bossRecommendFilterList.appendChild(details);
  });
}

function setBossRecommendFiltersLocked(locked) {
  bossRecommendFiltersLocked = Boolean(locked);
  bossRecommendFilterSection.classList.toggle('is-disabled', bossRecommendFiltersLocked);
  bossRecommendFilterSection.querySelectorAll('.recommend-filter-option input, .recommend-filter-search')
    .forEach((control) => { control.disabled = bossRecommendFiltersLocked; });
}

async function saveBossRecommendFilter(key, changedInput) {
  if (!savedConfig) return;
  const definition = filterDefinitions().find((item) => item.key === key);
  if (!definition) return;
  const choices = definition.groups
    ? definition.groups.flatMap((group) => group.children)
    : definition.choices;
  const byCode = new Map(choices.map((item) => [item.code, item]));
  const oldFilters = savedConfig.bossRecommendFilters || CONFIG_DEFAULTS.bossRecommendFilters;
  const openFilterNode = bossRecommendFilterList.querySelector('.recommend-filter[open]');
  const openFilterKey = openFilterNode?.dataset.filterKey || '';
  const openOptionsNode = openFilterNode?.querySelector('.recommend-filter-options');
  const optionsScrollTop = Number(openOptionsNode?.scrollTop || 0);
  const openGroupCodes = [...(openFilterNode?.querySelectorAll('.recommend-filter-subgroup[open]') || [])]
    .map((group) => group.dataset.groupCode).filter(Boolean);
  const searchValue = openOptionsNode?.querySelector('.recommend-filter-search')?.value || '';
  let value;
  if (definition.multiple) {
    const selected = changedInput.value === '0' && changedInput.checked
      ? []
      : [...bossRecommendFilterList.querySelectorAll(`input[data-filter-key="${key}"]:checked`)]
        .map((input) => input.value).filter((code) => code !== '0');
    value = [...new Set(selected)].map((code) => byCode.get(code)).filter(Boolean);
  } else {
    value = changedInput.value === '0' ? null : (byCode.get(changedInput.value) || null);
  }
  const nextFilters = { ...oldFilters, [key]: value };
  if (key === 'city' && String(oldFilters.city?.code || '') !== String(value?.code || '')) {
    nextFilters.multiSubway = [];
    nextFilters.multiBusinessDistrict = [];
  }
  if (key === 'multiBusinessDistrict' && value.length) nextFilters.multiSubway = [];
  if (key === 'multiSubway' && value.length) nextFilters.multiBusinessDistrict = [];
  savedConfig = normalizeConfig({ ...savedConfig, bossRecommendFilters: nextFilters });
  await chrome.storage.local.set({ [CONFIG_STORAGE_KEY]: savedConfig });
  if (key === 'city') await loadBossLocationFilterOptions();
  renderConfigView(savedConfig);
  const openFilter = openFilterKey && bossRecommendFilterList.querySelector(`.recommend-filter[data-filter-key="${openFilterKey}"]`);
  if (openFilter) {
    openFilter.open = true;
    openGroupCodes.forEach((code) => {
      const group = [...openFilter.querySelectorAll('.recommend-filter-subgroup')]
        .find((item) => item.dataset.groupCode === code);
      if (group) group.open = true;
    });
    const nextOptions = openFilter.querySelector('.recommend-filter-options');
    const nextSearch = nextOptions?.querySelector('.recommend-filter-search');
    if (nextSearch && searchValue) {
      nextSearch.value = searchValue;
      nextSearch.dispatchEvent(new Event('input'));
    }
    if (nextOptions) nextOptions.scrollTop = optionsScrollTop;
  }
}

async function loadBossFilterOptions() {
  if (currentSiteKey() !== 'boss') {
    bossFilterOptions = null;
    bossFilterOptionsError = '';
    return;
  }
  bossFilterOptionsError = '';
  const now = Date.now();
  const store = await chrome.storage.local.get([BOSS_FILTER_OPTIONS_CACHE_KEY]);
  const cached = store[BOSS_FILTER_OPTIONS_CACHE_KEY];
  if (cached?.version === BOSS_FILTER_OPTIONS_CACHE_VERSION && hasFilterOptions(cached.data)
    && Number(cached.expiresAt) > now) {
    bossFilterOptions = cached.data;
    return;
  }
  try {
    const response = await chrome.runtime.sendMessage({ type: 'JOB_CHAT_AUTO_GREETING_FILTER_OPTIONS_GET', tabId: activeTab.id });
    if (!response?.ok || !hasFilterOptions(response.options)) throw new Error(response?.error || '无法读取推荐岗位筛选条件。');
    bossFilterOptions = response.options;
    const fetchedAt = Date.now();
    await chrome.storage.local.set({ [BOSS_FILTER_OPTIONS_CACHE_KEY]: {
      version: BOSS_FILTER_OPTIONS_CACHE_VERSION,
      fetchedAt,
      expiresAt: fetchedAt + BOSS_FILTER_OPTIONS_CACHE_TTL,
      data: bossFilterOptions
    } });
  } catch (error) {
    if (cached?.version === BOSS_FILTER_OPTIONS_CACHE_VERSION && hasFilterOptions(cached.data)) {
      bossFilterOptions = cached.data;
      bossFilterOptionsError = '筛选数据更新失败，当前使用上次缓存数据。';
    } else {
      bossFilterOptions = null;
      bossFilterOptionsError = error?.message || String(error);
    }
  }
}

async function loadBossLocationFilterOptions() {
  const cityCode = String(savedConfig?.bossRecommendFilters?.city?.code || '');
  if (currentSiteKey() !== 'boss' || savedConfig?.bossSourceMode !== 'search' || !cityCode) {
    bossLocationFilterOptions = null;
    bossLocationFilterCityCode = '';
    return;
  }
  if (bossLocationFilterCityCode === cityCode && bossLocationFilterOptions) return;
  const response = await chrome.runtime.sendMessage({
    type: 'JOB_CHAT_AUTO_GREETING_LOCATION_FILTER_OPTIONS_GET', tabId: activeTab.id, cityCode
  });
  if (!response?.ok || !Array.isArray(response.options?.districts) || !Array.isArray(response.options?.subways)) {
    throw new Error(response?.error || '无法读取区域和地铁条件。');
  }
  bossLocationFilterOptions = response.options;
  bossLocationFilterCityCode = cityCode;
}

function validateConfig(config, requireTarget = true) {
  if (requireTarget && currentSiteKey() === 'boss' && config.bossSourceMode === 'search' && !String(config.bossSearchQuery || '').trim()) {
    throw new Error('请输入检索关键词。');
  }
  if (requireTarget && currentSiteKey() && currentSiteKey() !== 'boss' && !String(config.targetExpectId || '').trim()) {
    throw new Error('请选择目标职位。');
  }
  if (requireTarget && currentSiteKey() === 'boss' && config.bossSourceMode !== 'search' && !String(config.targetExpectId || '').trim()) {
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
  if (config.aiMatchEnabled) {
    if (!deepSeekApiKey.trim()) throw new Error('启用 AI匹配前，请填写 DeepSeek API Key。');
    const hasResume = config.aiResumeEnabled && config.aiResume.trim();
    const hasExpectedJob = config.aiExpectedJobEnabled && config.aiExpectedJob.trim();
    const hasOther = config.aiOtherPrompt.trim();
    if (!hasResume && !hasExpectedJob && !hasOther) throw new Error('请至少配置简历、期待岗位或其他匹配要求。');
    if (config.aiResumeEnabled) {
      if (!config.aiResume.trim()) throw new Error('已启用“我的简历”，请填写简历内容。');
      if (!config.aiResumePromptTemplate.trim()) throw new Error('请填写简历匹配提示词。');
      if (!config.aiResumePromptTemplate.includes('${resume}')) throw new Error('简历匹配提示词必须包含 ${resume}。');
    }
    if (config.aiExpectedJobEnabled) {
      if (!config.aiExpectedJob.trim()) throw new Error('已启用“期待岗位”，请填写期待岗位。');
      if (!config.aiExpectedJobPromptTemplate.trim()) throw new Error('请填写期待岗位提示词。');
      if (!config.aiExpectedJobPromptTemplate.includes('${expectedJob}')) throw new Error('期待岗位提示词必须包含 ${expectedJob}。');
    }
  }
}

function selectConfiguredExpectation(config = {}) {
  const normalized = normalizeConfig(config);
  const siteTarget = normalized.targetExpectBySite?.[currentSiteKey()];
  selectedExpectId = String(siteTarget?.id || normalized.targetExpectId || '');
}

function renderTargetExpectChoices() {
  const visible = Boolean(currentSiteKey());
  const locked = isConfigEditingLocked();
  viewTargetExpectRow.hidden = !visible;
  viewTargetExpectChoices.replaceChildren();
  if (!visible) return;
  const searchMode = currentSiteKey() === 'boss' && savedConfig?.bossSourceMode === 'search';
  viewTargetExpectRow.classList.toggle('source-tabs-active', currentSiteKey() === 'boss');
  bossSourceModeTabs.hidden = currentSiteKey() !== 'boss';
  bossSourceModeTabs.querySelectorAll('[data-source-mode]').forEach((tab) => {
    const active = tab.dataset.sourceMode === (searchMode ? 'search' : 'recommend');
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.disabled = locked;
  });
  bossSearchQuery.hidden = !searchMode;
  viewTargetExpectChoices.hidden = searchMode;
  bossSearchQuery.disabled = locked;
  bossSearchQuery.value = savedConfig?.bossSearchQuery || '';
  if (searchMode) return;
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
      input.disabled = locked;
      input.addEventListener('change', async () => {
        if (!input.checked || isConfigEditingLocked()) return;
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

function renderLiepinRecommendSort(config) {
  const visible = currentSiteKey() === 'liepin';
  const locked = ['running', 'paused', 'refreshing', 'cancelling'].includes(renderedRunStatus);
  liepinRecommendSortRow.hidden = !visible;
  liepinRecommendSortChoices.querySelectorAll('input[name="liepin-recommend-sort"]').forEach((input) => {
    input.checked = input.value === config.liepinRecommendSortType;
    input.disabled = locked;
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
  const locked = isConfigEditingLocked();
  onlineOnlyInput.disabled = !onlineOnlyAvailable || locked;
  nonHunterOnlyInput.disabled = !onlineOnlyAvailable || locked;
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
  renderAiConfig(config);
  renderTargetExpectChoices();
  renderLiepinRecommendSort(config);
  renderBossRecommendFilters(config);
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
  if (!savedConfig || quickEdit || !row || isConfigEditingLocked()) return;
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
  setBossRecommendFiltersLocked(false);
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
  const isAiMatch = type === 'ai-match';
  const title = document.createElement('h3');
  title.textContent = String(isCompany ? (entry.companyName || '公司详情') : (isAiMatch ? 'AI匹配结果' : (entry.jobName || '岗位详情')));
  sentMessageInfoCard.appendChild(title);
  if (isCompany) {
    const summary = [entry.companyIndustry ? `行业：${entry.companyIndustry}` : '', entry.companyScale ? `规模：${entry.companyScale}` : ''].filter(Boolean).join(' · ');
    if (summary) appendSentInfoText(sentMessageInfoCard, 'job-info-meta', summary);
    appendSentInfoText(sentMessageInfoCard, 'detail', String(entry.companyDetail || '暂无公司介绍。'));
  } else if (isAiMatch) {
    appendSentInfoText(sentMessageInfoCard, 'detail', String(entry.aiMatchResult || '匹配通过'));
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

function renderSentMessages(messages, aiMatchEnabled = false) {
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
    main.classList.toggle('ai-match-enabled', aiMatchEnabled);
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
    if (aiMatchEnabled) {
      const aiResult = document.createElement('span');
      aiResult.className = 'sent-message-ai-result';
      aiResult.textContent = String(entry.aiMatchResult || '匹配通过').trim();
      aiResult.tabIndex = 0;
      main.appendChild(aiResult);
      aiResult.addEventListener('mouseenter', () => showSentInfoCard(aiResult, entry, 'ai-match'));
      aiResult.addEventListener('mouseleave', scheduleSentInfoCardHide);
      aiResult.addEventListener('focus', () => showSentInfoCard(aiResult, entry, 'ai-match'));
      aiResult.addEventListener('blur', scheduleSentInfoCardHide);
    }
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
  if (!run) return false;
  renderedRunTabId = Number(run.tabId || 0);
  const target = Math.max(1, Number(run.config?.greetingCount || 1));
  const succeeded = Number(run.succeeded || 0);
  const statusLabels = { running: '正在运行', paused: '已暂停', refreshing: '正在刷新重试', cancelling: '正在取消', cancelled: '已取消', completed: '已完成', failed: '运行失败' };
  renderedRunStatus = String(run.status || '');
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
  renderSentMessages(run.sentMessages, Boolean(run.config?.aiMatchEnabled));
  sentMessagesPanel.hidden = false;
  const percentage = Math.min(100, Math.round(succeeded / target * 100));
  progressBar.style.width = `${percentage}%`;
  progressBar.parentElement.setAttribute('aria-valuenow', String(percentage));
  const controllable = run.status === 'running' || run.status === 'paused';
  const executing = controllable || run.status === 'refreshing' || run.status === 'cancelling';
  setBossRecommendFiltersLocked(executing);
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
  onlineOnlyInput.disabled = !available || isConfigEditingLocked();
  nonHunterOnlyInput.disabled = !available || isConfigEditingLocked();
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
  const hasRun = await refreshRunView();
  if (!hasRun) showConfigView(savedConfig || CONFIG_DEFAULTS);
  await configureDebugLogging();
  selectConfiguredExpectation(savedConfig || {});
  targetExpectations = [];
  await loadTargetExpectations();
  await loadBossFilterOptions();
  await loadBossLocationFilterOptions();
  if (savedConfig && !quickEdit) renderConfigView(savedConfig);
  if (bossFilterOptionsError) showStatus(bossFilterOptionsError, !bossFilterOptions);
}

async function refreshRunView() {
  if (!activeTab?.id) return false;
  const store = await chrome.storage.local.get([RUN_STORAGE_KEY]);
  return renderRun(store[RUN_STORAGE_KEY]);
}

async function initialize() {
  try {
    panelModeButton.textContent = FLOATING_MODE ? '停靠' : '浮动';
    const store = await chrome.storage.local.get([CONFIG_STORAGE_KEY, RUN_STORAGE_KEY, DEEPSEEK_API_KEY_STORAGE_KEY]);
    const storedConfig = store[CONFIG_STORAGE_KEY];
    const hasStoredConfig = Boolean(storedConfig && typeof storedConfig === 'object' && !Array.isArray(storedConfig));
    const normalizedStoredConfig = normalizeConfig(hasStoredConfig ? storedConfig : {});
    savedConfig = normalizedStoredConfig;
    deepSeekApiKey = String(store[DEEPSEEK_API_KEY_STORAGE_KEY] || '');
    await refreshOnlineOnly();
    // activeTab is assigned by refreshOnlineOnly. Enable logging after that,
    // but before requesting expectations, so the first request is captured.
    await configureDebugLogging();
    selectConfiguredExpectation(normalizedStoredConfig);
    await loadTargetExpectations();
    await loadBossFilterOptions();
    await loadBossLocationFilterOptions();
    const runStatus = activeTab?.id
      ? await chrome.runtime.sendMessage({ type: 'JOB_CHAT_AUTO_GREETING_STATUS_GET', tabId: activeTab.id })
      : null;
    if (runStatus?.ok) {
      if (renderRun(runStatus.run)) return;
      showConfigView(normalizedStoredConfig);
      if (bossFilterOptionsError) showStatus(bossFilterOptionsError, !bossFilterOptions);
      return;
    }
    if (renderRun(store[RUN_STORAGE_KEY])) return;
    showConfigView(normalizedStoredConfig);
    if (bossFilterOptionsError) showStatus(bossFilterOptionsError, !bossFilterOptions);
  } catch (error) {
    showConfigView(savedConfig || CONFIG_DEFAULTS);
    showStatus(error?.message || String(error), true);
  }
}

onlineOnlyInput.addEventListener('change', async () => {
  if (isConfigEditingLocked()) {
    renderConfigView(savedConfig);
    showEditLockedNotice();
    return;
  }
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
    onlineOnlyInput.disabled = !onlineOnlyAvailable || isConfigEditingLocked();
  }
});

nonHunterOnlyInput.addEventListener('change', async () => {
  if (isConfigEditingLocked()) {
    renderConfigView(savedConfig);
    showEditLockedNotice();
    return;
  }
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
    nonHunterOnlyInput.disabled = !onlineOnlyAvailable || isConfigEditingLocked();
  }
});

bossRecommendFilterList.addEventListener('change', (event) => {
  if (bossRecommendFiltersLocked) return;
  const input = event.target.closest('input[data-filter-key]');
  if (!input) return;
  if (input.checked && ['multiBusinessDistrict', 'multiSubway'].includes(input.dataset.filterKey)) {
    const separatorIndex = input.value.indexOf(':');
    const parentCode = separatorIndex >= 0 ? input.value.slice(0, separatorIndex) : input.value;
    const related = [...bossRecommendFilterList.querySelectorAll(`input[data-filter-key="${input.dataset.filterKey}"]`)];
    if (separatorIndex >= 0) {
      const parent = related.find((item) => item.value === parentCode);
      if (parent) parent.checked = false;
    } else if (input.value !== '0') {
      related.forEach((item) => {
        if (item.value.startsWith(`${parentCode}:`)) item.checked = false;
      });
    }
  }
  saveBossRecommendFilter(input.dataset.filterKey, input)
    .catch((error) => showStatus(error?.message || String(error), true));
});

bossSourceModeTabs.addEventListener('click', async (event) => {
  const tab = event.target.closest('[data-source-mode]');
  if (!tab || isConfigEditingLocked() || !savedConfig) return;
  savedConfig = normalizeConfig({ ...savedConfig, bossSourceMode: tab.dataset.sourceMode });
  await chrome.storage.local.set({ [CONFIG_STORAGE_KEY]: savedConfig });
  await loadBossLocationFilterOptions();
  renderConfigView(savedConfig);
});

bossSearchQuery.addEventListener('change', async () => {
  if (isConfigEditingLocked() || !savedConfig) return;
  savedConfig = normalizeConfig({ ...savedConfig, bossSearchQuery: bossSearchQuery.value });
  await chrome.storage.local.set({ [CONFIG_STORAGE_KEY]: savedConfig });
  renderConfigView(savedConfig);
});

liepinRecommendSortChoices.addEventListener('change', async (event) => {
  const input = event.target.closest('input[name="liepin-recommend-sort"]');
  if (!input?.checked || !savedConfig || ['running', 'paused', 'refreshing', 'cancelling'].includes(renderedRunStatus)) return;
  savedConfig = normalizeConfig({ ...savedConfig, liepinRecommendSortType: input.value });
  await chrome.storage.local.set({ [CONFIG_STORAGE_KEY]: savedConfig });
  renderConfigView(savedConfig);
});

document.addEventListener('pointerdown', (event) => {
  if (!bossRecommendFilterSection || bossRecommendFilterSection.hidden) return;
  bossRecommendFilterSection.querySelectorAll('.recommend-filter[open]').forEach((filter) => {
    if (!filter.contains(event.target)) filter.open = false;
  });
});

aiMatchToggleButton.addEventListener('click', () => {
  const expanded = aiMatchToggleButton.getAttribute('aria-expanded') !== 'true';
  aiMatchToggleButton.setAttribute('aria-expanded', String(expanded));
  aiMatchToggleButton.setAttribute('aria-label', expanded ? '收起 AI匹配配置' : '展开 AI匹配配置');
  aiMatchPanel.hidden = !expanded;
});

function handleAiConfigInput(event) {
  if (isConfigEditingLocked()) {
    renderAiConfig(savedConfig);
    showEditLockedNotice();
    return;
  }
  savedConfig = aiConfigFromInputs();
  renderAiDependentState(savedConfig);
  clearTimeout(aiConfigSaveTimer);
  aiConfigSaveTimer = setTimeout(() => persistAiConfig().catch((error) => {
    showStatus(error?.message || String(error), true);
  }), event.type === 'change' ? 0 : 300);
}

[
  aiMatchEnabledInput,
  aiResumeEnabledInput,
  aiResumeInput,
  aiResumePromptInput,
  aiExpectedJobEnabledInput,
  aiExpectedJobInput,
  aiExpectedJobPromptInput,
  aiOtherPromptInput
].forEach((input) => {
  input.addEventListener('input', handleAiConfigInput);
  input.addEventListener('change', handleAiConfigInput);
});

deepSeekApiKeyInput.addEventListener('input', () => {
  if (isConfigEditingLocked()) {
    deepSeekApiKeyInput.value = deepSeekApiKey;
    showEditLockedNotice();
    return;
  }
  deepSeekApiKey = deepSeekApiKeyInput.value;
  clearTimeout(apiKeySaveTimer);
  apiKeySaveTimer = setTimeout(() => persistDeepSeekApiKey().catch((error) => {
    showStatus(error?.message || String(error), true);
  }), 300);
});

deepSeekApiKeyInput.addEventListener('change', () => {
  persistDeepSeekApiKey().catch((error) => showStatus(error?.message || String(error), true));
});

configView.addEventListener('dblclick', (event) => {
  const target = event.target.closest('[data-edit-key]');
  if (!target || !configView.contains(target)) return;
  if (isConfigEditingLocked()) {
    showEditLockedNotice();
    return;
  }
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
    savedConfig = aiConfigFromInputs();
    await Promise.all([persistAiConfig(), persistDeepSeekApiKey()]);
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
    const response = await chrome.runtime.sendMessage({ type: `JOB_CHAT_AUTO_GREETING_${action}`, tabId: renderedRunTabId || activeTab?.id });
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
      tabId: renderedRunTabId || activeTab?.id
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
    const ownerTab = await chrome.tabs.get(activeTab.id);
    await chrome.sidePanel.setOptions({ path, enabled: true });
    await chrome.sidePanel.open({ windowId: ownerTab.windowId });
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
  if (areaName === 'local' && changes[DEEPSEEK_API_KEY_STORAGE_KEY]) {
    deepSeekApiKey = String(changes[DEEPSEEK_API_KEY_STORAGE_KEY].newValue || '');
    if (document.activeElement !== deepSeekApiKeyInput) deepSeekApiKeyInput.value = deepSeekApiKey;
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

// A BOSS risk-control recovery reloads the recruitment tab. Chrome can miss
// storage change delivery to a side panel around that lifecycle transition,
// so periodically reconcile the visible counters with the persisted run.
setInterval(() => {
  if (document.visibilityState !== 'visible'
    || !['running', 'paused', 'refreshing', 'cancelling'].includes(renderedRunStatus)) return;
  refreshRunView().catch(() => {});
}, 2000);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshRunView().catch(() => {});
});

initialize();
