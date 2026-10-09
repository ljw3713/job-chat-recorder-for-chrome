const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');

function loadLocale(relativePath) {
  const context = { globalThis: {} };
  vm.runInNewContext(fs.readFileSync(path.join(rootDir, relativePath), 'utf8'), context, { filename: relativePath });
  return context.globalThis.JobChatLocales;
}

function flatten(object, prefix = '') {
  return Object.entries(object).flatMap(([key, value]) => {
    const pathKey = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object'
      ? flatten(value, pathKey)
      : [[pathKey, String(value)]];
  });
}

function parameters(value) {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(',');
}

function main() {
  const cn = loadLocale('src/locales/cn.js').cn;
  const en = loadLocale('src/locales/en.js').en;
  const cnMessages = new Map(flatten(cn.messages));
  const enMessages = new Map(flatten(en.messages));
  const keys = new Set([...cnMessages.keys(), ...enMessages.keys()]);

  for (const key of keys) {
    if (!cnMessages.has(key) || !enMessages.has(key)) {
      throw new Error(`Locale message key mismatch: ${key}`);
    }
    if (!cnMessages.get(key) || !enMessages.get(key)) {
      throw new Error(`Locale message cannot be empty: ${key}`);
    }
    if (parameters(cnMessages.get(key)) !== parameters(enMessages.get(key))) {
      throw new Error(`Locale parameter mismatch: ${key}`);
    }
  }

  console.log(`I18n checks passed: ${keys.size} shared messages.`);
}

main();
