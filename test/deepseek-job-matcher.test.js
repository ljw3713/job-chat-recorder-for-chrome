const test = require('node:test');
const assert = require('node:assert/strict');

require('../src/deepseek-job-matcher.js');

const matcher = globalThis.JobChatDeepSeekMatcher;

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

test('composeCriteria only includes enabled matching inputs', () => {
  const prompt = matcher.composeCriteria({
    aiResumeEnabled: true,
    aiResume: '五年前端开发经验',
    aiResumePromptTemplate: '简历：${resume}',
    aiExpectedJobEnabled: false,
    aiExpectedJob: '产品经理',
    aiExpectedJobPromptTemplate: '期待：${expectedJob}',
    aiOtherPrompt: '不接受外包'
  });
  assert.equal(prompt, '简历：五年前端开发经验\n\n不接受外包');
});

test('matchJob returns a validated structured match result', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  const events = [];
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return jsonResponse(200, {
      choices: [{ message: { content: '{"matched":true,"reason":"技术方向一致"}' } }]
    });
  };
  try {
    const result = await matcher.matchJob({
      apiKey: 'test-key',
      config: { aiOtherPrompt: '需要 Java 经验' },
      job: { title: 'Java 工程师', description: '负责后端服务' },
      onLog: (event) => events.push(event)
    });
    assert.deepEqual(result, { matched: true, reason: '技术方向一致' });
    assert.equal(requestBody.response_format.type, 'json_object');
    assert.equal(requestBody.stream, false);
    assert.equal(events[0].phase, 'request');
    assert.equal(events[1].phase, 'response');
    assert.match(events[1].body, /技术方向一致/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('matchJob retries one invalid JSON response', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse(200, {
      choices: [{ message: { content: calls === 1 ? 'invalid' : '{"matched":false,"reason":"经验不足"}' } }]
    });
  };
  try {
    const result = await matcher.matchJob({ apiKey: 'test-key', config: { aiOtherPrompt: '要求匹配' }, job: {} });
    assert.equal(calls, 2);
    assert.deepEqual(result, { matched: false, reason: '经验不足' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('matchJob classifies authentication errors as fatal', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse(401, { error: { message: 'invalid key' } });
  try {
    await assert.rejects(
      matcher.matchJob({ apiKey: 'bad-key', config: { aiOtherPrompt: '要求匹配' }, job: {} }),
      (error) => error.code === 'AUTHENTICATION_FAILED' && error.fatal === true
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
