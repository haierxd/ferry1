'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const { getPool } = require('../db');
const { createApp } = require('../server');

test('real MySQL: conversations persist, paginate and isolate two authenticated users', {
  skip: process.env.MYSQL_INTEGRATION !== '1' ? 'Set MYSQL_INTEGRATION=1 after importing both SQL files.' : false,
}, async t => {
  const pool = getPool(); const users = [];
  const server = createApp({ pool, jwtSecret: randomBytes(48).toString('hex'), bcryptRounds: 4, authLimit: 100 }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections(); server.close();
    try {
      for (const user of users) {
        try { await pool.execute('DELETE FROM conversations WHERE user_id = ?', [user.id]); }
        catch (error) { if (error.code !== 'ER_NO_SUCH_TABLE') throw error; }
        await pool.execute('DELETE FROM users WHERE id = ?', [user.id]);
      }
    } finally { await pool.end(); }
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(path, { method = 'GET', body, token } = {}) {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    if (body) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json() };
  }
  for (let n = 0; n < 2; n++) {
    const suffix = randomBytes(8).toString('hex');
    const result = await request('/register', { method: 'POST', body: {
      username: 'hist_it_' + suffix, email: suffix + '@example.invalid', password: randomBytes(18).toString('hex'),
    } });
    assert.equal(result.status, 201);
    users.push({ id: result.data.user.id, token: result.data.token });
  }
  const [a, b] = users;
  assert.equal((await request('/conversations')).status, 401);
  const ids = [];
  const question = '😀'.repeat(31) + "' OR 1=1 --";
  for (let n = 0; n < 3; n++) {
    const saved = await request('/conversations', { method: 'POST', token: a.token,
      body: { question, answer: `完整回答 ${n}\n<script>plain text only</script>`, model: 'test-model', user_id: b.id } });
    assert.equal(saved.status, 201); ids.push(saved.data.conversation.id);
  }
  const list = await request('/conversations?limit=2&offset=0', { token: a.token });
  assert.equal(list.data.items.length, 2); assert.equal(list.data.has_more, true);
  assert.deepEqual(list.data.items.map(row => row.id), ids.slice().reverse().slice(0, 2));
  assert.equal(list.data.items[0].title, '😀'.repeat(30));
  assert.ok(Math.abs(Date.now() - Date.parse(list.data.items[0].created_at)) < 60000, 'timestamps must use the actual instant, regardless of MySQL session timezone');
  assert.equal((await request('/conversations?limit=2&offset=2', { token: a.token })).data.items.length, 1);
  assert.equal((await request('/conversations', { token: b.token })).data.items.length, 0);
  assert.equal((await request('/conversations/' + ids[0], { token: b.token })).status, 403);
  assert.equal((await request('/conversations/' + ids[0], { method: 'DELETE', token: b.token })).status, 403);
  const detail = await request('/conversations/' + ids[0], { token: a.token });
  assert.equal(detail.data.conversation.question, question);
  assert.equal(detail.data.conversation.answer, '完整回答 0\n<script>plain text only</script>');
  assert.equal((await request('/conversations/' + ids[0], { method: 'DELETE', token: a.token })).status, 200);
  assert.equal((await request('/conversations/' + ids[0], { token: a.token })).status, 404);
});
