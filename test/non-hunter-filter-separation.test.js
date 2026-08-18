const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('popup non-hunter filter uses page-filter messages instead of auto-message storage', () => {
  const popup = read('src/popup.js');
  const handler = popup.match(/nonHunterCheckbox\.addEventListener\('change',[\s\S]*?\n\}\);/);
  assert.ok(handler, 'non-hunter checkbox handler should exist');
  assert.match(handler[0], /JOB_CHAT_NON_HUNTER_SET/);
  assert.doesNotMatch(handler[0], /jobChatAutoMessageConfig|nonHunterOnly/);
});

test('page hooks identify hunters from each site response contract', () => {
  const bossHook = read('src/boss-hook.js');
  const liepinHook = read('src/liepin-online-job-hook.js');
  const pageFilter = read('src/online-job-filter.js');
  assert.match(bossHook, /Number\(job\?\.goldHunter\) === 1/);
  assert.match(liepinHook, /job\?\.jobKind \|\| ''\) === '1'/);
  assert.match(pageFilter, /nonHunterEnabled/);
  assert.match(pageFilter, /hunterEncryptJobIds/);
  assert.match(pageFilter, /hunterIdentifiers/);
});
