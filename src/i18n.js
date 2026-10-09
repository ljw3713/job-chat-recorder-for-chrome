(function () {
  const STORAGE_KEY = 'jobChatLanguage';
  const SUPPORTED_LANGUAGES = new Set(['cn', 'en']);
  const listeners = new Set();
  let language = 'cn';
  let initialized = null;
  let observer = null;
  const observerOptions = { childList: true, characterData: true, subtree: true };
  const englishSourceText = globalThis.JobChatLocales?.en?.sourceText || {};
  const englishTranslations = new Map(Object.entries(englishSourceText));
  const chineseSources = new Map([...englishTranslations].map(([source, translated]) => [translated, source]));

  function systemLanguage() {
    return String(globalThis.navigator?.language || '').toLowerCase().startsWith('zh') ? 'cn' : 'en';
  }

  function normalizeLanguage(value) {
    return SUPPORTED_LANGUAGES.has(value) ? value : systemLanguage();
  }

  function locale(value = language) {
    return globalThis.JobChatLocales?.[value] || globalThis.JobChatLocales?.cn || { messages: {}, sourceText: {} };
  }

  function valueAtPath(object, path) {
    return path.split('.').reduce((value, key) => value && value[key], object);
  }

  function translate(key, parameters = {}) {
    const template = valueAtPath(locale().messages || {}, key)
      ?? valueAtPath(locale('cn').messages || {}, key)
      ?? key;
    return String(template).replace(/\{(\w+)\}/g, (_, name) => String(parameters[name] ?? `{${name}}`));
  }

  function sourceFor(text) {
    if (language === 'cn') {
      return chineseSources.get(text) || locale('en').sourceForDynamic?.(text) || text;
    }
    return chineseSources.get(text) || locale('en').sourceForDynamic?.(text) || text;
  }

  function translateSource(source) {
    if (language !== 'en') return source;
    return englishTranslations.get(source)
      || locale('en').translateDynamic?.(source)
      || source;
  }

  function translateText(text) {
    const source = text.trim();
    if (!source) return text;
    const start = text.indexOf(source);
    const end = start + source.length;
    return `${text.slice(0, start)}${translateSource(sourceFor(source))}${text.slice(end)}`;
  }

  function isSkippedElement(element) {
    return !element || element.closest?.('[data-i18n-skip], tbody, .conversation-list, .detail, script, style, pre, textarea, [contenteditable]');
  }

  function translateTextNode(node) {
    if (isSkippedElement(node.parentElement)) return;
    const translated = translateText(node.nodeValue || '');
    if (translated !== node.nodeValue) node.nodeValue = translated;
  }

  function translateElement(element) {
    if (!(element instanceof Element) || isSkippedElement(element)) return;
    for (const attribute of ['placeholder', 'title', 'aria-label']) {
      if (!element.hasAttribute(attribute)) continue;
      const translated = translateText(element.getAttribute(attribute) || '');
      if (translated !== element.getAttribute(attribute)) element.setAttribute(attribute, translated);
    }
    if (element.dataset.i18n) element.textContent = translate(element.dataset.i18n);
    if (element.dataset.i18nPlaceholder) element.placeholder = translate(element.dataset.i18nPlaceholder);
    if (element.dataset.i18nTitle) element.title = translate(element.dataset.i18nTitle);
    if (element.dataset.i18nAriaLabel) element.setAttribute('aria-label', translate(element.dataset.i18nAriaLabel));
  }

  function translateDocument(root = document) {
    if (!globalThis.document) return;
    const scope = root instanceof Document ? root.documentElement : root;
    if (!scope) return;
    const shouldResumeObserver = Boolean(observer);
    if (shouldResumeObserver) observer.disconnect();
    try {
      translateElement(scope);
      scope.querySelectorAll?.('[data-i18n], [data-i18n-placeholder], [data-i18n-title], [data-i18n-aria-label], [placeholder], [title], [aria-label]').forEach(translateElement);
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          return isSkippedElement(node.parentElement) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        }
      });
      let node;
      while ((node = walker.nextNode())) translateTextNode(node);
      document.documentElement.lang = language === 'cn' ? 'zh-CN' : 'en';
    } finally {
      if (shouldResumeObserver) observer.observe(document.documentElement, observerOptions);
    }
  }

  function startObserver() {
    if (observer || !globalThis.document?.documentElement) return;
    observer = new MutationObserver((records) => {
      const roots = new Set();
      for (const record of records) {
        if (record.type === 'characterData') translateTextNode(record.target);
        for (const node of record.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
          else if (node.nodeType === Node.ELEMENT_NODE) roots.add(node);
        }
      }
      for (const root of roots) {
        let parent = root.parentElement;
        let isNested = false;
        while (parent) {
          if (roots.has(parent)) {
            isNested = true;
            break;
          }
          parent = parent.parentElement;
        }
        if (!isNested) translateDocument(root);
      }
    });
    observer.observe(document.documentElement, observerOptions);
  }

  async function init() {
    if (initialized) return initialized;
    initialized = (async () => {
      const stored = await globalThis.chrome?.storage?.local?.get(STORAGE_KEY);
      language = normalizeLanguage(stored?.[STORAGE_KEY]);
      translateDocument();
      startObserver();
      return language;
    })();
    return initialized;
  }

  async function setLanguage(nextLanguage) {
    const next = normalizeLanguage(nextLanguage);
    await init();
    if (next === language) return language;
    language = next;
    await globalThis.chrome?.storage?.local?.set({ [STORAGE_KEY]: language });
    translateDocument();
    listeners.forEach((listener) => listener(language));
    return language;
  }

  function onLanguageChanged(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  globalThis.chrome?.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
    const next = normalizeLanguage(changes[STORAGE_KEY].newValue);
    if (next === language) return;
    language = next;
    translateDocument();
    listeners.forEach((listener) => listener(language));
  });

  globalThis.JobChatI18n = { init, setLanguage, getLanguage: () => language, onLanguageChanged, translate, translateDocument };
  init().catch(() => {});
})();
