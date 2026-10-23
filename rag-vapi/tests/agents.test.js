import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readConfig } from '../lib/config.js';

const env = { VAPI_BASE_URL: 'https://vapi.invalid/v1', VAPI_API_KEY: 'private-test-api',
  VAPI_CHAT_MODEL: 'test-chat', JWT_SECRET: 'private-test-jwt'.repeat(3) };

test('默认Top-3，printConfig只输出允许的配置，A无需聊天/JWT/MySQL', async () => {
  const { printConfig } = await import('../lib/config.js');
  const config = readConfig({ ...env, VAPI_CHAT_MODEL: '', JWT_SECRET: '' }, { mode: 'ingest' });
  assert.equal(config.topK, 3);
  assert.equal(config.jwtSecret, undefined);
  const logs = [];
  printConfig({ ...config, password: 'private-db-password', nested: { token: 'private-token' } }, x => logs.push(x));
  const output = JSON.stringify(logs);
  for (const secret of ['private-test-api', 'private-db-password', 'private-token']) assert.ok(!output.includes(secret));
  assert.ok(output.includes('1536'));
});

test('A只得到嵌入能力，B聊天模型固定且与嵌入分离，每个智能体仅创建一个SDK', async () => {
  const { createAgentVapi } = await import('../lib/vapi.js');
  const calls = [];
  const sdk = { embeddings: { create: async req => {
    calls.push(req);
    return { data: req.input.map((_, index) => ({ index, embedding: Array(1536).fill(0.1) })) };
  } }, chat: { completions: { create: async req => { calls.push(req); return { id: 'chat-result' }; } } } };
  const config = readConfig(env);
  const a = createAgentVapi(config, { role: 'ingest', sdk });
  assert.equal(a.chat, undefined);
  assert.equal((await a.embedText('原文')).length, 1536);
  const b = createAgentVapi(config, { role: 'ask', sdk });
  await b.chat([{ role: 'user', content: '问题' }], { model: config.embeddingModel });
  assert.deepEqual(calls.map(c => c.model), ['text-embedding-3-small', 'test-chat']);
  await assert.rejects(a.embedText(''), /输入/);
  sdk.embeddings.create = async () => ({ data: [{ index: 0, embedding: [1] }] });
  await assert.rejects(b.embedText('问题'), /重建向量列.*重跑 ingest/);
});

test('B按source_path精确过滤，参数化且不能越过知识根目录', async () => {
  const { createRetriever } = await import('../lib/retrieve.js');
  const root = path.resolve('knowledge-test');
  let queried, embedded = 0;
  const retrieve = createRetriever({ config: { knowledgeDir: root, topK: 3, embeddingModel: 'embed', embedDim: 1536 },
    embed: async () => { embedded++; return [Array(1536).fill(0.1)]; }, assertProfile: async () => {},
    pg: { query: async (sql, values) => { queried = { sql, values }; return { rows: [] }; } } });
  await retrieve('问题', { source_path: "部门/规则'表.md" });
  assert.match(queried.sql, /c\.source_path = \$6/);
  assert.equal(queried.values[1], 3);
  assert.equal(queried.values[5], path.join(root, "部门/规则'表.md").replaceAll('\\', '/'));
  assert.ok(!queried.sql.includes("规则'表"));
  await assert.rejects(retrieve('问题', { source_path: '../outside.md' }), /根目录/);
  assert.equal(embedded, 1);
});

test('B的PG连接默认只读，旧db模块兼容导出不变', async () => {
  const { createPgPool } = await import('../lib/pg.js');
  const legacy = await import('../lib/db.js');
  const { createMysqlPool } = await import('../lib/mysql.js');
  assert.equal(legacy.createPgPool, createPgPool);
  assert.equal(legacy.createMysqlPool, createMysqlPool);
  const pool = createPgPool({ PG_HOST: '127.0.0.1', PG_USER: 'test', PG_DB: 'test' }, { readOnly: true });
  try { assert.match(pool.options.options, /default_transaction_read_only=on/); }
  finally { await pool.end(); }
});
