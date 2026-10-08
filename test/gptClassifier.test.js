'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const sourceFile = path.join(__dirname, '../src/gptClassifier.js');
const source = fs.readFileSync(sourceFile, 'utf8');
const url = 'https://fixture.test/products/coffee';
const content = 'Fixture product page: Ethiopia washed coffee, 250g, EUR 12.';
const coffee = { is_coffee_page: true, product: { name: 'Fixture Coffee', attributes: { process: 'Washed' } } };
const complete = JSON.stringify(coffee);

function response(text, finishReason = 'stop', usage, message = {}) {
  return { choices: [{ finish_reason: finishReason, message: { content: text, ...message } }], usage };
}

function apiError(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

// Load the real classifier with a fake SDK and immediate timers. No keys,
// network requests, module-global environment mutations or real backoff waits.
function classifier(steps, environment = {}, { constructorError } = {}) {
  const requests = [], constructors = [], delays = [], logs = [];
  class FakeOpenAI {
    constructor(options) {
      constructors.push(options);
      if (constructorError) throw constructorError;
      this.chat = { completions: { create: async request => {
        requests.push(structuredClone(request));
        const step = steps[requests.length - 1];
        if (step instanceof Error) throw step;
        if (!step) throw new Error('Unexpected fake SDK call');
        return structuredClone(step);
      } } };
    }
  }
  const nativeRequire = createRequire(sourceFile);
  const logger = Object.fromEntries(['debug', 'warn', 'error'].map(level => [level, (...args) => logs.push({ level, args })]));
  const requireMock = name => name === 'openai' ? FakeOpenAI : name === './logger' ? logger : nativeRequire(name);
  const fakeProcess = { env: { OPENAI_API_KEY: 'offline-fixture-key', ...environment } };
  const fakeTimeout = (callback, milliseconds) => { delays.push(milliseconds); callback(); };
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports,process,setTimeout){${source}\n})`, { filename: sourceFile })(requireMock, module, module.exports, fakeProcess, fakeTimeout);
  return { ...module.exports, requests, constructors, delays, logs };
}

const firstUsage = {
  prompt_tokens: 300, completion_tokens: 2000, total_tokens: 2300,
  prompt_tokens_details: { cached_tokens: 128, audio_tokens: 2 },
  completion_tokens_details: { reasoning_tokens: 1990, audio_tokens: 3, accepted_prediction_tokens: 1, rejected_prediction_tokens: 4 },
};
const secondUsage = {
  prompt_tokens: 300, completion_tokens: 2400, total_tokens: 2700,
  prompt_tokens_details: { cached_tokens: 256, audio_tokens: 5 },
  completion_tokens_details: { reasoning_tokens: 2200, audio_tokens: 7, accepted_prediction_tokens: 2, rejected_prediction_tokens: 6 },
};

test('empty output-limit response retries the same model once and accounts for both reported requests', async () => {
  const instance = classifier([response('', 'length', firstUsage), response(complete, 'stop', secondUsage)]);
  const result = await instance.classifyPage(content, url);
  assert.equal(result.success, true);
  assert.deepEqual(result.data, coffee);
  assert.equal(result.aiCalls, 2);
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.outputLimitRetries, 1);
  assert.deepEqual(result.usage, {
    prompt_tokens: 600, completion_tokens: 4400, total_tokens: 5000,
    prompt_tokens_details: { cached_tokens: 384, audio_tokens: 7 },
    completion_tokens_details: { reasoning_tokens: 4190, audio_tokens: 10, accepted_prediction_tokens: 3, rejected_prediction_tokens: 10 },
    reported_calls: 2, unreported_calls: 0,
  });
  assert.deepEqual(instance.requests.map(request => request.max_completion_tokens), [2000, 8000]);
  assert.equal(instance.requests[0].model, 'gpt-5-mini');
  assert.equal(instance.requests[1].model, instance.requests[0].model);
  assert.deepEqual(instance.requests[1].messages, instance.requests[0].messages);
  assert.equal(instance.requests[0].temperature, undefined);
  assert.equal(instance.requests[0].response_format, undefined);
  assert.deepEqual(instance.constructors, [{ apiKey: 'offline-fixture-key', timeout: 180000, maxRetries: 0 }]);
  assert.equal(instance.delays.length, 0);
  assert.equal(instance.logs.filter(entry => entry.level === 'warn').length, 1);
});

for (const truncated of ['{"is_coffee_page":true,"product":', '{"is_coffee_page":false}', 'prefix {"is_coffee_page":false} unfinished']) {
  test(`output-limit content is never accepted before recovery: ${truncated}`, async () => {
    const instance = classifier([response(truncated, 'length', firstUsage), response(complete, 'stop', secondUsage)]);
    const result = await instance.classifyPage(content, url);
    assert.equal(result.success, true);
    assert.deepEqual(result.data, coffee);
    assert.equal(instance.requests.length, 2);
  });
}

test('repeated output-limit responses fail after one recovery even when JSON parses', async () => {
  const instance = classifier([response('', 'length', firstUsage), response('{"is_coffee_page":false}', 'length', secondUsage), response(complete)]);
  const result = await instance.classifyPage(content, url);
  assert.match(result.error, /output token limit/);
  assert.equal(result.data, undefined);
  assert.equal(result.aiCalls, 2);
  assert.equal(result.outputLimitRetries, 1);
  assert.equal(result.finishReason, 'length');
  assert.equal(result.usage.completion_tokens, 4400);
  assert.equal(result.usage.reported_calls, 2);
  assert.equal(result.usage.unreported_calls, 0);
  assert.deepEqual(instance.requests.map(request => request.max_completion_tokens), [2000, 8000]);
});

for (const value of ['', null, '   ']) {
  test(`completed empty response makes one request: ${JSON.stringify(value)}`, async () => {
    const instance = classifier([response(value, 'stop', firstUsage), response(complete)]);
    const result = await instance.classifyPage(content, url);
    assert.equal(result.error, 'Empty response from GPT');
    assert.equal(result.aiCalls, 1);
    assert.equal(result.outputLimitRetries, 0);
    assert.equal(instance.requests.length, 1);
    assert.equal(result.usage.completion_tokens, 2000);
  });
}

test('missing choice is an empty failure without a recovery request', async () => {
  const instance = classifier([{ choices: [], usage: firstUsage }, response(complete)]);
  const result = await instance.classifyPage(content, url);
  assert.equal(result.error, 'Empty response from GPT');
  assert.equal(result.finishReason, null);
  assert.equal(instance.requests.length, 1);
});

for (const [text, expected] of [['ordinary text', 'No JSON found in response'], ['{"is_coffee_page":true,}', 'Failed to parse JSON response']]) {
  test(`completed malformed response is terminal: ${expected}`, async () => {
    const instance = classifier([response(text, 'stop', firstUsage), response(complete)]);
    const result = await instance.classifyPage(content, url);
    assert.equal(result.error, expected);
    assert.equal(result.aiCalls, 1);
    assert.equal(result.outputLimitRetries, 0);
    assert.equal(instance.requests.length, 1);
  });
}

for (const [message, expected] of [
  [{ refusal: 'Cannot classify this page' }, 'Refusal response from GPT'],
  [{ tool_calls: [{ type: 'function', function: { name: 'unused' } }] }, 'Unexpected tool call from GPT'],
  [{ function_call: { name: 'unused' } }, 'Unexpected tool call from GPT'],
]) {
  test(`${expected} never triggers recovery, including when finish reason is length`, async () => {
    for (const finishReason of ['stop', 'length']) {
      const instance = classifier([response(complete, finishReason, firstUsage, message), response(complete)]);
      const result = await instance.classifyPage(content, url);
      assert.equal(result.error, expected);
      assert.equal(result.data, undefined);
      assert.equal(result.outputLimitRetries, 0);
      assert.equal(instance.requests.length, 1);
    }
  });
}

test('content-filter empty response is terminal without recovery', async () => {
  const instance = classifier([response(null, 'content_filter', firstUsage), response(complete)]);
  const result = await instance.classifyPage(content, url);
  assert.equal(result.error, 'Filtered response from GPT');
  assert.equal(result.finishReason, 'content_filter');
  assert.equal(result.outputLimitRetries, 0);
  assert.equal(instance.requests.length, 1);
});

for (const [status, message] of [[400, 'Invalid request'], [401, 'Authentication failed, rate unavailable'], [403, 'Permission denied, timeout policy']]) {
  test(`nontransient HTTP ${status} errors are terminal and counted`, async () => {
    const instance = classifier([apiError(status, message), response(complete)]);
    const result = await instance.classifyPage(content, url);
    assert.equal(result.error, message);
    assert.equal(result.aiCalls, 1);
    assert.equal(result.usage, null);
    assert.equal(result.outputLimitRetries, 0);
    assert.equal(instance.requests.length, 1);
    assert.equal(instance.delays.length, 0);
  });
}

test('quota exhaustion is terminal and prevents subsequent page requests', async () => {
  const instance = classifier([apiError(429, 'You exceeded your current quota', 'insufficient_quota'), response(complete)]);
  const first = await instance.classifyPage(content, url);
  const second = await instance.classifyPage(content, url);
  assert.equal(first.quotaExceeded, true);
  assert.equal(first.aiCalls, 1);
  assert.equal(first.outputLimitRetries, 0);
  assert.equal(second.quotaExceeded, true);
  assert.equal(second.skipped, true);
  assert.equal(instance.requests.length, 1);
  assert.equal(instance.delays.length, 0);
});

test('SDK initialization failure does not count an API request that was never made', async () => {
  const instance = classifier([], {}, { constructorError: new Error('Missing API credentials') });
  const result = await instance.classifyPage(content, url);
  assert.equal(result.error, 'Missing API credentials');
  assert.equal(result.aiCalls, 0);
  assert.equal(result.usage, null);
  assert.equal(instance.requests.length, 0);
  assert.equal(instance.delays.length, 0);
});

test('each new page starts at the configured allowance after an earlier page recovers', async () => {
  const instance = classifier([response('', 'length'), response(complete), response('', 'length'), response(complete)]);
  const first = await instance.classifyPage(content, url);
  const second = await instance.classifyPage(content, url + '-other');
  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(first.aiCalls, 2);
  assert.equal(second.aiCalls, 2);
  assert.deepEqual(instance.requests.map(request => request.max_completion_tokens), [2000, 8000, 2000, 8000]);
});

for (const [budget, expectedBudgets] of [['500', [500, 2000]], ['3000', [3000, 8000]], ['8000', [8000]], ['12000', [12000]]]) {
  test(`configured output allowance ${budget} is preserved and recovery capped`, async () => {
    const instance = classifier([response('', 'length', firstUsage), response(complete)], { OPENAI_MAX_OUTPUT_TOKENS: budget });
    const result = await instance.classifyPage(content, url);
    assert.equal(instance.getOpenAIConfigSummary().maxOutputTokens, Number(budget));
    assert.deepEqual(instance.requests.map(request => request.max_completion_tokens), expectedBudgets);
    assert.equal(result.success, expectedBudgets.length === 2 ? true : undefined);
    assert.equal(result.outputLimitRetries, expectedBudgets.length - 1);
    if (expectedBudgets.length === 1) assert.match(result.error, /output token limit/);
  });
}

test('configured non-GPT-5 model retains its request parameters on recovery', async () => {
  const instance = classifier([response('', 'length'), response(complete)], { OPENAI_MODEL: 'fixture-configured-model', OPENAI_MAX_OUTPUT_TOKENS: '700', OPENAI_REQUEST_TIMEOUT_MS: '12345' });
  const result = await instance.classifyPage(content, url);
  assert.equal(result.success, true);
  assert.deepEqual(instance.requests.map(request => request.max_tokens), [700, 2800]);
  for (const request of instance.requests) {
    assert.equal(request.model, 'fixture-configured-model');
    assert.equal(request.temperature, 0.1);
    assert.equal(request.max_completion_tokens, undefined);
  }
  assert.equal(instance.constructors[0].timeout, 12345);
});

for (const failure of [apiError(429, 'Rate limited'), apiError(503, 'Service unavailable'), apiError(0, 'Request timed out', 'ETIMEDOUT')]) {
  test(`transient error and output-limit recovery retain separate bounds: ${failure.message}`, async () => {
    const instance = classifier([failure, response('', 'length', firstUsage), response(complete, 'stop', secondUsage)]);
    const result = await instance.classifyPage(content, url);
    assert.equal(result.success, true);
    assert.equal(result.aiCalls, 3);
    assert.equal(result.outputLimitRetries, 1);
    assert.equal(result.usage.prompt_tokens, 600);
    assert.equal(result.usage.completion_tokens, 4400);
    assert.equal(result.usage.reported_calls, 2);
    assert.equal(result.usage.unreported_calls, 1);
    assert.deepEqual(instance.requests.map(request => request.max_completion_tokens), [2000, 2000, 8000]);
    assert.equal(instance.delays.length, 1);
    assert(instance.delays[0] >= 700 && instance.delays[0] <= 1300);
  });
}

test('recovery allowance is never escalated again during five bounded transient retries', async () => {
  const instance = classifier([response('', 'length', firstUsage), ...Array.from({ length: 6 }, () => apiError(503, 'Service unavailable')), response(complete)]);
  const result = await instance.classifyPage(content, url);
  assert.equal(result.error, 'Service unavailable');
  assert.equal(result.aiCalls, 7);
  assert.equal(result.outputLimitRetries, 1);
  assert.equal(result.usage.reported_calls, 1);
  assert.equal(result.usage.unreported_calls, 6);
  assert.deepEqual(instance.requests.map(request => request.max_completion_tokens), [2000, 8000, 8000, 8000, 8000, 8000, 8000]);
  assert.equal(instance.delays.length, 5);
});

test('ordinary transient retries still stop at six total requests', async () => {
  const instance = classifier([...Array.from({ length: 6 }, () => apiError(429, 'Rate limited')), response(complete)]);
  const result = await instance.classifyPage(content, url);
  assert.equal(result.error, 'Rate limited');
  assert.equal(result.aiCalls, 6);
  assert.equal(result.outputLimitRetries, 0);
  assert.equal(result.usage, null);
  assert.equal(instance.requests.length, 6);
  assert.equal(instance.delays.length, 5);
});

test('missing response usage remains unreported alongside aggregate reported tokens', async () => {
  for (const missingUsage of [undefined, {}, { prompt_tokens: -1, completion_tokens: '100' }]) {
    const instance = classifier([response('', 'length', missingUsage), response(complete, 'stop', secondUsage)]);
    const result = await instance.classifyPage(content, url);
    assert.equal(result.aiCalls, 2);
    assert.equal(result.usage.prompt_tokens, 300);
    assert.equal(result.usage.completion_tokens, 2400);
    assert.equal(result.usage.reported_calls, 1);
    assert.equal(result.usage.unreported_calls, 1);
  }
});

test('safe response diagnostics do not expose arbitrary finish-reason or usage payloads', async () => {
  const unsafe = 'untrusted-secret-marker';
  const instance = classifier([response('', unsafe, { ...firstUsage, secret: unsafe, prompt_tokens_details: { cached_tokens: 128, secret: unsafe } })]);
  const result = await instance.classifyPage(content, url);
  assert.equal(result.error, 'Empty response from GPT');
  assert.equal(result.finishReason, null);
  assert.equal(result.usage.secret, undefined);
  assert.equal(result.usage.prompt_tokens_details.secret, undefined);
  assert.equal(JSON.stringify(instance.logs).includes(unsafe), false);
  assert.equal(instance.requests.length, 1);
});

test('a filtered parseable JSON response cannot become a completed classification',async()=>{
 const fixture=classifier([response(complete,'content_filter')]);
 const result=await fixture.classifyPage(content,url);
 assert.equal(result.error,'Filtered response from GPT');assert.equal(fixture.requests.length,1);assert.equal(result.outputLimitRetries,0);
});
