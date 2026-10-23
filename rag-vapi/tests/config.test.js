import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readConfig } from '../lib/config.js';
import { createVapi, createAgentVapi } from '../lib/vapi.js';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { databaseConfig } from '../lib/config.js';

const environment = { VAPI_BASE_URL: 'https://vapi.invalid/v1', VAPI_API_KEY: 'test-only-not-a-real-key',
  VAPI_CHAT_MODEL: 'deepseek-chat', JWT_SECRET: 'a-test-secret-only-'.repeat(3) };

test('.env.example 的所有键名都与集中配置读取完全一致', () => {
  const example = dotenv.parse(readFileSync(new URL('../.env.example', import.meta.url)));
  const accessed = new Set();
  const env = new Proxy({ ...example, ...environment, PG_USER: 'test', MYSQL_USER: 'test' }, {
    get(target, key) { accessed.add(key); return target[key]; }
  });
  readConfig(env);
  databaseConfig('pg', env);
  databaseConfig('mysql', env);
  assert.deepEqual([...accessed].sort(), Object.keys(example).sort());
});

test('配置拒绝直连 OpenAI、混用嵌入聊天模型、非1536维', () => {
  assert.throws(() => readConfig({ ...environment, VAPI_BASE_URL: 'https://api.openai.com/v1' }), /禁止直连/);
  assert.throws(() => readConfig({ ...environment, VAPI_CHAT_MODEL: 'vendor/text-embedding-3-small' }), /独立.*聊天模型/);
  assert.throws(() => readConfig({ ...environment, VAPI_EMBED_DIM: '1024' }), /重建向量列/);
  assert.throws(() => readConfig({ ...environment, VAPI_BASE_URL: 'https://vapi.invalid' }), /v1/);
  assert.equal(readConfig(environment).embedDim, 1536);
  assert.equal(readConfig(environment).embeddingModel, 'text-embedding-3-small');
});

test('真实 OpenAI SDK 只访问配置的 v-api 兼容路径，嵌入和聊天分开', async t => {
  const calls = [];
  const stub = createServer(async (req, res) => {
    const body = [];
    for await (const part of req) body.push(part);
    calls.push({ url: req.url, body: JSON.parse(Buffer.concat(body).toString()) });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/embeddings') {
      res.end(JSON.stringify({ object: 'list', data: [{ index: 0, embedding: Array(1536).fill(0.1) }] }));
    } else if (req.url === '/v1/chat/completions') {
      res.end(JSON.stringify({ id: 'test', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '测试答案' } }] }));
    } else { res.statusCode = 404; res.end('{}'); }
  });
  await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { stub.close(resolve); stub.closeAllConnections(); }));
  const config = readConfig({ ...environment, VAPI_BASE_URL: `http://127.0.0.1:${stub.address().port}/v1` });
  const sdk = createVapi(config);
  const vapi = createAgentVapi(config, { role: 'ask', sdk });
  await vapi.embedText('测试问题');
  await vapi.chat([{ role: 'user', content: '问题' }]);
  assert.deepEqual(calls.map(c => c.url), ['/v1/embeddings', '/v1/chat/completions']);
  assert.equal(calls[0].body.model, 'text-embedding-3-small');
  assert.equal(calls[1].body.model, 'deepseek-chat');
});
