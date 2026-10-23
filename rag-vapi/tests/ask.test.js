import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const config = { jwtSecret: 'test-only-secret-'.repeat(4), jwtIssuer: 'zhixu-ai-auth',
  jwtAudience: 'zhixu-ai-web', chatModel: 'test-chat', embeddingModel: 'text-embedding-3-small', embedDim: 1536, topK: 3, timeoutMs: 1000 };
const citation = { chunk_text: '采购上限 20000 元。', score: 0.9,
  source_path: 'D:/test2/docs/甲方资料/章程.md', chunk_index: 2, doc_id: '7' };

test('所有已验证且存在的用户自动获得知识库阅读权限，权限不取自前端或JWT自报角色', async () => {
  const { authenticate } = await import('../lib/auth.js');
  const middleware = authenticate({ config, mysql: { execute: async (_sql, values) => [[{ id: values[0] }]] } });
  for (const id of ['42', '99']) {
    const token = jwt.sign({}, config.jwtSecret, { subject: id, algorithm: 'HS256',
      issuer: config.jwtIssuer, audience: config.jwtAudience, expiresIn: '1h' });
    const req = { get: () => `Bearer ${token}` };
    let passed = false;
    await middleware(req, {}, () => { passed = true; });
    assert.equal(passed, true);
    assert.deepEqual(req.auth.permissions, ['knowledge:read']);
  }
});

async function setup(t, { streamFailure = false, databaseFailure = false, streamTimeout = false,
  retrieved = [citation], generated = '权限为20000元 [1]。', capabilitiesOnly = false, knowledgeDir } = {}) {
  const { createApp } = await import('../server.js');
  const saved = [];
  let completed = false, chats = 0, retrievalOptions;
  const mysql = { execute: async (sql, values) => {
    if (sql.startsWith('SELECT id FROM users')) return [[{ id: values[0] }]];
    assert.equal(completed || retrieved.length === 0, true, 'Only save the complete answer');
    if (databaseFailure) throw new Error('db failed with secret');
    saved.push({ sql, values });
    return [{ insertId: '11' }];
  } };
  const sdk = { chat: { completions: { create: async (req, { signal } = {}) => {
    chats++;
    assert.equal(req.model, 'test-chat');
    if (!req.stream) {
      completed = true;
      assert.match(req.messages[0].content, /上下文\[编号\]/);
      return { id: 'response-id', model: 'actual-chat', choices: [{ message: { content: generated }, finish_reason: 'stop' }] };
    }
    return (async function* () {
      yield { id: 'response-id', model: 'actual-chat', choices: [{ index: 0, delta: { content: '权限为' }, finish_reason: null }] };
      if (streamTimeout) await new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
      if (streamFailure) throw new Error('upstream failed with secret');
      yield { id: 'response-id', choices: [{ index: 0, delta: { content: generated.replace(/^权限为/, '') }, finish_reason: null }] };
      completed = true;
      yield { id: 'response-id', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
    })();
  } } } };
  const { createAgentVapi } = await import('../lib/vapi.js');
  const app = createApp({ config: { ...config, knowledgeDir, timeoutMs: streamTimeout ? 20 : config.timeoutMs },
    mysql, ...(capabilitiesOnly ? { chat: createAgentVapi(config, { role: 'ask', sdk }).chat } : { sdk }),
    retrieve: async (_question, options) => { retrievalOptions = options; return retrieved; }, log: () => {} });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/api/ask`;
  const tokenFor = userId => jwt.sign({}, config.jwtSecret, { subject: userId, algorithm: 'HS256',
    issuer: config.jwtIssuer, audience: config.jwtAudience, expiresIn: '1h' });
  const token = tokenFor('42');
  async function ask(body, bearer = token) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body) });
  }
  return { ask, saved, tokenFor, chats: () => chats, retrievalOptions: () => retrievalOptions };
}

test('全文请求直接原样返回文件，JSON/SSE均不调用chat或向量检索，完成后保存', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rag-full-api-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = path.join(root, '02_新员工入职培训手册.docx');
  await mkdir(dir);
  const original = '# 新员工入职培训手册\n[2026] 原文编号。\n\n全文最后一段。\n';
  await writeFile(path.join(dir, 'document.md'), original);
  const s = await setup(t, { retrieved: [], knowledgeDir: root });
  const response = await s.ask({ question: '请输出《新员工入职培训手册》的全文' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.answer, original);
  assert.equal(body.references[0].kind, 'full_document');
  assert.equal(s.chats(), 0);
  assert.equal(s.retrievalOptions(), undefined);
  assert.equal(s.saved[0].values[2], original);
  assert.equal(s.saved[0].values[3], 'document-read');
  const streaming = await s.ask({ question: '请输出《新员工入职培训手册》的全文', stream: true });
  const events = (await streaming.text()).split('\n\n');
  const done = events.find(event => event.startsWith('event: done\n'));
  assert.equal(JSON.parse(done.split('\ndata: ')[1]).answer, original);
  assert.equal(s.saved.length, 2);
  const otherUser = await s.ask({ question: '《新员工入职培训手册》的全文' }, s.tokenFor('99'));
  assert.equal(otherUser.status, 200);
  assert.equal((await otherUser.json()).answer, original);
  assert.equal(s.saved.at(-1).values[0], '99');
  assert.equal(s.chats(), 0);
  const cameraDir = path.join(root, '09_外观检测相机与追溯接入.pdf');
  await mkdir(cameraDir);
  const cameraSentence = '双相机从两侧拍摄，固定光源与工装位置，算法输出由人工复核后形成最终质量判定。';
  const cameraFullText = '# 外观检测相机与追溯接入\n' + cameraSentence + '\n[2026] 完整文档末尾。\n';
  await writeFile(path.join(cameraDir, 'document.md'), cameraFullText);
  const bySentence = await s.ask({ question: '提问' + cameraSentence + ' 输出全篇文档' });
  assert.equal(bySentence.status, 200);
  const cameraBody = await bySentence.json();
  assert.equal(cameraBody.answer, cameraFullText);
  assert.equal(cameraBody.references[0].filename, '09_外观检测相机与追溯接入.pdf');
  assert.equal(s.chats(), 0);
});

test('B仅注入chat能力即可运行，默认Top-3且只返回固定三个字段', async t => {
  const s = await setup(t, { capabilitiesOnly: true });
  const response = await s.ask({ question: '采购上限 20000 元。' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.retrieved_count, 1);
  assert.equal(body.references[0].source_path, citation.source_path);
  assert.deepEqual(Object.keys(body).sort(), ['answer', 'references', 'retrieved_count']);
  assert.equal(s.retrievalOptions().source_path, undefined);
  assert.equal(s.retrievalOptions().topK, 3);
  assert.equal(s.saved.length, 1);
});

test('JWT 唯一决定 user_id；缺失/伪造 token 和前端 user_id 被拒绝', async t => {
  const s = await setup(t);
  assert.equal((await s.ask({ question: '权限？' }, '')).status, 401);
  assert.equal((await s.ask({ question: '权限？' }, 'forged')).status, 401);
  assert.equal((await s.ask({ question: '权限？', user_id: '99' })).status, 400);
  assert.equal((await s.ask({ question: '权限？', source_path: citation.source_path })).status, 400);
  assert.equal((await s.ask({ question: '权限？', references: [citation] })).status, 400);
  const response = await s.ask({ question: '权限？' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.references[0].chunk_index, 2);
  assert.equal(body.references[0].filename, '章程.md');
  assert.equal(body.references[0].snippet, citation.chunk_text);
  assert.equal(body.retrieved_count, 1);
  assert.equal(body.reference_groups, undefined);
  assert.equal(s.saved[0].values[0], '42');
  assert.equal(s.saved[0].values[3], 'test-chat');
  assert.ok(!s.saved[0].sql.includes('42'));
});

test('SSE 流结束后保存完整答案，done 包含落库 ID', async t => {
  const s = await setup(t);
  const response = await s.ask({ question: '权限？', stream: true });
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const text = await response.text();
  assert.match(text, /event: delta/);
  assert.match(text, /event: done/);
  assert.match(text, /"citation_id":1/);
  assert.equal(s.saved.length, 1);
  assert.equal(s.saved[0].values[2], '权限为20000元 [1]。');
  assert.match(text, /"retrieved_count":1/);
  const stored = JSON.parse(s.saved[0].values[4]);
  assert.equal(stored[0].filename, '章程.md');
  assert.equal(stored[0].snippet, citation.chunk_text);
  assert.equal(stored[0].chunk_text, undefined);
});

test('流中断不能保存部分答案，也不能发出 done 或泄露上游消息', async t => {
  const s = await setup(t, { streamFailure: true });
  const response = await s.ask({ question: '权限？', stream: true });
  const text = await response.text();
  assert.match(text, /event: error/);
  assert.ok(!text.includes('secret'));
  assert.ok(!text.includes('event: done'));
  assert.equal(s.saved.length, 0);
});

test('数据库保存失败明确报错，不将未落库答案标记成功', async t => {
  const s = await setup(t, { databaseFailure: true });
  assert.equal((await s.ask({ question: '权限？' })).status, 500);
  const response = await s.ask({ question: '权限？', stream: true });
  const text = await response.text();
  assert.match(text, /event: error/);
  assert.ok(!text.includes('event: done'));
});

test('SSE 服务端超时必须发明确错误，不得仅以正常 EOF 结束', async t => {
  const s = await setup(t, { streamTimeout: true });
  const response = await s.ask({ question: '权限？', stream: true });
  const text = await response.text();
  assert.match(text, /event: error/);
  assert.match(text, /REQUEST_TIMEOUT/);
  assert.ok(!text.includes('event: done'));
  assert.equal(s.saved.length, 0);
});

test('空检索明确返回空references及计数0，不调用聊天模型', async t => {
  const s = await setup(t, { retrieved: [] });
  const response = await s.ask({ question: '未知问题' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.references, []);
  assert.equal(body.retrieved_count, 0);
  assert.equal(body.answer, '知识库暂无相关内容');
  assert.equal(s.chats(), 0);
});

test('JSON和SSE拒绝模型编造的出处，不保存会话', async t => {
  const s = await setup(t, { generated: '权限为20000元 [不存在的文件.md#99]。' });
  const response = await s.ask({ question: '权限？' });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, 'INVALID_CITATION');
  const stream = await s.ask({ question: '权限？', stream: true });
  const text = await stream.text();
  assert.match(text, /event: error/);
  assert.ok(!text.includes('event: done'));
  assert.equal(s.saved.length, 0);
});

test('引用按hits原顺序由代码给出，MySQL只保存限长引用摘要', async t => {
  const long = '相关原文'.repeat(180);
  const s = await setup(t, { retrieved: [{ ...citation, chunk_text: long }, { ...citation, chunk_index: 4, score: 0.95 }] });
  const response = await s.ask({ question: '相关原文' });
  const body = await response.json();
  assert.equal(body.retrieved_count, 2);
  assert.deepEqual(body.references.map(r => r.chunk_index), [2, 4]);
  assert.deepEqual(body.references.map(r => r.citation_id), [1, 2]);
  assert.ok(body.references.every(r => Array.from(r.snippet).length <= 200));
  assert.ok(!s.saved[0].values[4].includes(long));
});

test('全部低于0.6时明确提示低匹配度并保留真实引用', async t => {
  const s = await setup(t, { retrieved: [{ ...citation, score: 0.59 }] });
  const body = await (await s.ask({ question: '问题' })).json();
  assert.match(body.answer, /^匹配度较低，仅供参考/);
  assert.equal(body.references[0].score, 0.59);
});

test('编号越界明确报错，prettyName从转换路径提取真实文档名', async t => {
  const { prettyName } = await import('../routes/ask.js');
  assert.equal(prettyName('01_Word制度与培训/03_产品体系与选型培训手册.docx/document.md'),
    '03_产品体系与选型培训手册.docx');
  const s = await setup(t, { generated: '权限为20000元 [9]。' });
  assert.equal((await s.ask({ question: '问题' })).status, 502);
  assert.equal(s.saved.length, 0);
});
