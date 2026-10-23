const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('答案展示移除citation_id和文件名块号尾注，保留自然出处与正文数字', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const start = source.indexOf('function displayAnswer(');
  assert.ok(start >= 0);
  const body = source.slice(start, source.indexOf('\nfunction renderMessages(', start));
  const context = vm.createContext({});
  vm.runInContext(body, context);
  assert.equal(context.displayAnswer('销售学员完成一份含两个可替代型号的选型说明出自《新员工入职培训手册》[citation_id=1]。文件名：document.md，块号：2。'),
    '销售学员完成一份含两个可替代型号的选型说明出自《新员工入职培训手册》。');
  assert.equal(context.displayAnswer('采购上限为20000元 [1]。'), '采购上限为20000元。');
  assert.equal(context.displayAnswer('温度为20℃，数量为2。'), '温度为20℃，数量为2。');
  const fullText = '[1] 第一条。\n文件名：document.md，块号：2。\n';
  assert.equal(context.displayAnswer(fullText, [{ kind: 'full_document' }]), fullText);
});
const vm = require('node:vm');
const { AgentClient, AgentRequestError } = require('../agent-client.js');

function ragFrontend(fetchImpl) {
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const body = source.slice(source.indexOf('async function runMessage('), source.indexOf('\nfunction sendMessage('));
  const tokenFunction = source.slice(source.indexOf('function savedToken('), source.indexOf('\nfunction sessionStorageKey('));
  const target = { id: 's', agent: 'knowledge', messages: [] };
  const context = vm.createContext({ authUser: { id: 1 }, authVersion: 1, activeId: 's',
    modelName: 'RAG', connectionState: 'checking', pendingSessions: new Set(),
    authTokenKey: 'zhixu-auth-token-v1', localStorage: { getItem: key => {
      assert.equal(key, 'zhixu-auth-token-v1'); return 'test-jwt';
    } }, fetch: fetchImpl, AbortController, setTimeout, clearTimeout,
    persist() {}, renderRecent() {}, renderMessages() {}, renderConnection() {},
    AgentRequestError, logout() {}, toast() {},
    agentClient: { run() { throw new Error('legacy AgentOS must not be called'); } },
    conversationHistory: { save() { throw new Error('RAG already saves the conversation'); } }
  });
  vm.runInContext(tokenFunction + '\n' + body, context);
  return { context, target };
}

test('app.js uses RAG JSON/JWT, appends answer and sources without duplicate history save', async () => {
  const { context, target } = ragFrontend(async (url, options) => {
    assert.equal(url, '/api/ask');
    assert.equal(options.headers.Authorization, 'Bearer test-jwt');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(options.body), { question: '采购权限？', stream: false });
    return new Response(JSON.stringify({ answer: '20000元 [1]', model: 'vapi-chat',
      citations: [{ file: '章程.md', chunk_index: 2 }] }));
  });
  const message = { role: 'user', text: '采购权限？' };
  await context.runMessage(target, message);
  assert.equal(message.status, 'sent');
  assert.equal(target.messages[0].text, '20000元 [1]');
  assert.equal(target.messages[0].model, 'vapi-chat');
  assert.ok(target.messages[0].sources[0].includes('章程.md'));
  assert.equal(context.pendingSessions.size, 0);
});

test('app.js shows RAG error and clears loading state', async () => {
  const { context, target } = ragFrontend(async () => new Response(JSON.stringify({ message: '知识库尚未入库' }), { status: 503 }));
  const message = { role: 'user', text: '问题' };
  await context.runMessage(target, message);
  assert.equal(message.status, 'failed');
  assert.match(message.error, /知识库尚未入库/);
  assert.equal(target.messages.length, 0);
  assert.equal(context.pendingSessions.size, 0);
});

test('app.js consumes references with snippets and keeps structured metadata', async () => {
  const reference = { source_path: 'kb/章程.md', filename: '章程.md', display_filename: 'kb/章程.md', citation_label: 'kb/章程.md#2', chunk_index: 2,
    doc_id: '7', score: 0.9, snippet: '采购上限为20000元。' };
  const { context, target } = ragFrontend(async () => new Response(JSON.stringify({
    answer: '采购上限为20000元 [章程.md#2]', references: [reference], retrieved_count: 1
  })));
  await context.runMessage(target, { role: 'user', text: '采购权限？' });
  assert.equal(target.messages[0].references[0].snippet, reference.snippet);
  assert.equal(target.messages[0].references[0].source_path, reference.source_path);
  assert.equal(target.messages[0].references[0].citation_label, reference.citation_label);
  assert.equal(target.messages[0].retrievedCount, 1);
});

test('reference cards and dialog show actual snippets safely instead of demo FAQ', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const body = source.slice(source.indexOf('function renderSources('), source.indexOf('\nfunction route('));
  const node = {};
  let dialog;
  const context = vm.createContext({ displayedReferences: [], $: () => node, icon: () => '',
    escapeHtml: value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]),
    showDialog: (title, html) => { dialog = { title, html }; }
  });
  vm.runInContext(body, context);
  context.renderSources([{ filename: '章程.md', display_filename: 'kb/章程.md', source_path: 'kb/章程.md', chunk_index: 2,
    snippet: '原文<script>alert(1)</script>', score: 0.9 }]);
  assert.ok(node.innerHTML.includes('章程.md'));
  assert.ok(node.innerHTML.includes('kb/章程.md'));
  assert.ok(node.innerHTML.includes('块号2'));
  assert.ok(node.innerHTML.includes('&lt;script&gt;'));
  assert.ok(!node.innerHTML.includes('<script>'));
  context.showRetrievedReference(0);
  assert.ok(dialog.title.includes('kb/章程.md'));
  assert.ok(dialog.html.includes('kb/章程.md'));
  assert.ok(dialog.html.includes('&lt;script&gt;'));
  context.renderSources([]);
  assert.ok(!node.innerHTML.includes('章程.md'));
});

test('app.js disables the input while waiting for RAG', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const body = source.slice(source.indexOf('function renderMessages('), source.indexOf('\nfunction renderSources('));
  const nodes = new Map();
  const context = vm.createContext({ sessions: [], activeId: 's', activeAgent: 'knowledge',
    agents: [{ id: 'knowledge', icon: 'spark' }], pendingSessions: new Set(['s']),
    $: name => { if (!nodes.has(name)) nodes.set(name, { insertAdjacentHTML() {} }); return nodes.get(name); },
    renderSources() {}, requestAnimationFrame() {}, icon: () => '', escapeHtml: String });
  vm.runInContext(body + '\nrenderMessages()', context);
  assert.equal(nodes.get('#chat-input')?.disabled, true);
  assert.equal(nodes.get('#send-button').disabled, true);
});

test('posts native multipart AgentOS fields and preserves the conversation identity', async () => {
  const calls = [];
  const client = new AgentClient({ userId: 'browser-a', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ content: '真实回答', session_id: 'session-a', run_id: 'run-1', status: 'COMPLETED' }));
  }});
  const answer = await client.run({ agentId: 'deepseek-agent', sessionId: 'session-a', message: '你好' });
  assert.equal(answer.text, '真实回答');
  assert.equal(answer.runId, 'run-1');
  assert.equal(calls[0].url, '/api/agents/deepseek-agent/runs');
  assert.equal(calls[0].options.body.get('user_id'), 'browser-a');
  assert.equal(calls[0].options.body.get('session_id'), 'session-a');
  assert.equal(calls[0].options.body.get('stream'), 'false');
  assert.equal(calls[0].options.body.get('message'), '你好');
  assert.equal(calls[0].options.headers, undefined, 'browser must generate the multipart boundary');
});

test('failed runs, empty content and mismatched sessions never become successful answers', async () => {
  for (const result of [
    { status: 'ERROR', content: 'provider failed' },
    { status: 'FAILED', content: 'provider failed' },
    { status: 'CANCELLED', content: 'cancelled' },
    { status: 'COMPLETED', content: '' },
    { status: 'COMPLETED', content: 'answer', session_id: 'another-session' },
  ]) {
    const client = new AgentClient({ userId: 'u', fetchImpl: async () => new Response(JSON.stringify(result)) });
    await assert.rejects(client.run({ agentId: 'deepseek-agent', sessionId: 's', message: 'q' }), AgentRequestError);
  }
});

test('network, malformed JSON and provider errors are actionable without leaking raw payloads', async () => {
  for (const fetchImpl of [
    async () => { throw new TypeError('fetch failed'); },
    async () => new Response('not json'),
    async () => new Response('sensitive provider payload', { status: 401 }),
    async () => new Response(JSON.stringify({ code: 'missing_api_key' }), { status: 503 }),
  ]) {
    const client = new AgentClient({ userId: 'u', fetchImpl });
    await assert.rejects(client.run({ agentId: 'deepseek-agent', sessionId: 's', message: 'q' }), error => {
      assert.ok(error instanceof AgentRequestError);
      assert.ok(error.message.length > 8);
      assert.ok(!error.message.includes('sensitive provider payload'));
      return true;
    });
  }
});

test('request timeout releases the pending request and reports timeout', async () => {
  const client = new AgentClient({ userId: 'u', timeoutMs: 10, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }) });
  await assert.rejects(client.run({ agentId: 'deepseek-agent', sessionId: 's', message: 'q' }), error => error.code === 'timeout');
});

test('non-string structured content is not rendered as an object or HTML', async () => {
  const client = new AgentClient({ userId: 'u', fetchImpl: async () => new Response(JSON.stringify({ content: { answer: '<script>unsafe</script>' } })) });
  await assert.rejects(client.run({ agentId: 'deepseek-agent', sessionId: 's', message: 'q' }), AgentRequestError);
});
