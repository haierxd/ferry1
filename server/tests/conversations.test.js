'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { createApp } = require('../server');

function memoryPool() {
  const rows = []; const calls = []; let nextId = 1;
  return { rows, calls, async execute(sql, values) {
    calls.push({ sql, values });
    if (sql.startsWith('INSERT INTO conversations')) {
      const [user_id, title, question, answer, model] = values;
      const row = { id: String(nextId++), user_id: String(user_id), title, question, answer, model, tokens: null, created_at: 1700000000 };
      rows.push(row); return [{ insertId: Number(row.id) }];
    }
    if (sql.startsWith('SELECT user_id')) return [rows.filter(r => r.id === values[0]).map(r => ({ user_id: r.user_id }))];
    if (sql.startsWith('DELETE')) {
      const index = rows.findIndex(r => r.id === values[0] && r.user_id === values[1]);
      if (index < 0) return [{ affectedRows: 0 }];
      rows.splice(index, 1); return [{ affectedRows: 1 }];
    }
    if (sql.includes('WHERE id = ? AND user_id = ?')) return [rows.filter(r => r.id === values[0] && r.user_id === values[1]).map(r => ({ ...r }))];
    if (sql.includes('WHERE user_id = ?')) return [rows.filter(r => r.user_id === values[0]).slice().reverse().slice(values[2], values[2] + values[1]).map(r => ({ id: r.id, title: r.title, question: Array.from(r.question).slice(0, 100).join(''), created_at: r.created_at }))];
    throw new Error('Unexpected SQL in conversation test');
  } };
}
async function fixture(t, pool = memoryPool()) {
  const secret = randomBytes(48).toString('hex');
  const server = createApp({ pool, jwtSecret: secret, bcryptRounds: 4 }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const token = id => jwt.sign({}, secret, { subject: String(id), issuer: 'zhixu-ai-auth', audience: 'zhixu-ai-web', expiresIn: '1h' });
  const base = `http://127.0.0.1:${server.address().port}/api/conversations`;
  async function request(method, suffix = '', body, user = '1') {
    const headers = user === null ? {} : { Authorization: `Bearer ${token(user)}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + suffix, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  return { pool, request };
}
const sample = { question: '如何选择适合的产品？', answer: '请提供使用场景和设备清单。', model: 'test-model' };

test('every conversation endpoint requires a valid JWT', async t => {
  const { request } = await fixture(t);
  for (const [method, suffix, body] of [['POST', '', sample], ['GET', ''], ['GET', '/1'], ['DELETE', '/1']]) {
    assert.equal((await request(method, suffix, body, null)).status, 401);
  }
});
test('create derives ownership from JWT, preserves text, and makes a 30-character Unicode title', async t => {
  const { request, pool } = await fixture(t);
  const question = '😀'.repeat(31) + "' OR 1=1 --";
  const result = await request('POST', '', { ...sample, question, user_id: '2' });
  assert.equal(result.status, 201);
  assert.equal(pool.rows[0].user_id, '1');
  assert.equal(pool.rows[0].title, '😀'.repeat(30));
  assert.equal(pool.rows[0].question, question);
  assert.ok(pool.calls.every(call => !call.sql.includes(question) && Array.isArray(call.values)));
});
test('list paginates only the current user and never returns answer bodies', async t => {
  const { request } = await fixture(t);
  for (let n = 0; n < 3; n++) await request('POST', '', { ...sample, question: '中'.repeat(101) + n });
  await request('POST', '', sample, '2');
  const first = await request('GET', '?limit=2&offset=0');
  assert.equal(first.status, 200); assert.equal(first.body.items.length, 2); assert.equal(first.body.has_more, true);
  assert.deepEqual(first.body.items.map(r => r.id), ['3', '2']);
  assert.equal(Array.from(first.body.items[0].question).length, 100);
  assert.ok(!('answer' in first.body.items[0]));
  assert.equal(first.body.items[0].created_at, new Date(1700000000 * 1000).toISOString());
  const next = await request('GET', '?limit=2&offset=2');
  assert.deepEqual(next.body.items.map(r => r.id), ['1']); assert.equal(next.body.has_more, false);
});
test('detail and delete enforce ownership; another user gets 403 and cannot remove data', async t => {
  const { request, pool } = await fixture(t);
  const created = await request('POST', '', sample);
  const id = created.body.conversation.id;
  assert.equal((await request('GET', '/' + id, undefined, '2')).status, 403);
  assert.equal((await request('DELETE', '/' + id, undefined, '2')).status, 403);
  assert.equal(pool.rows.length, 1);
  const detail = await request('GET', '/' + id);
  assert.equal(detail.body.conversation.answer, sample.answer);
  assert.equal((await request('DELETE', '/' + id)).status, 200);
  assert.equal((await request('GET', '/' + id)).status, 404);
  assert.equal(pool.rows.length, 0);
});
test('invalid inputs, overflowed IDs and hostile pagination are rejected before SQL', async t => {
  const { request, pool } = await fixture(t);
  for (const input of [{}, { ...sample, question: '' }, { ...sample, answer: {} }, { ...sample, question: '中'.repeat(22000) }, { ...sample, model: 'm'.repeat(101) }]) {
    assert.equal((await request('POST', '', input)).status, 400);
  }
  for (const suffix of ['?limit=0', '?limit=101', '?offset=-1', '?limit=1%20OR%201=1', '/1%20OR%201=1', '/9223372036854775808']) {
    assert.equal((await request('GET', suffix)).status, 400);
  }
  assert.equal(pool.calls.length, 0);
});
