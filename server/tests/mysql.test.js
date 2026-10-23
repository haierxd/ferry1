'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID, randomBytes } = require('node:crypto');
const bcrypt = require('bcrypt');
const { getPool } = require('../db');
const { createApp } = require('../server');

test('real MySQL: register persists a bcrypt hash, login/me round-trip and duplicates are rejected', {
  skip: process.env.MYSQL_INTEGRATION !== '1' ? 'Set MYSQL_INTEGRATION=1 after starting MySQL and importing sql/init_users.sql.' : false,
}, async t => {
  const pool = getPool();
  await pool.execute('SELECT 1');
  const app = createApp({ pool, jwtSecret: randomBytes(48).toString('hex'), bcryptRounds: 4 });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  let userId;
  t.after(async () => {
    server.closeAllConnections(); server.close();
    try { if (userId) await pool.execute('DELETE FROM users WHERE id = ?', [userId]); }
    finally { await pool.end(); }
  });
  const suffix = randomUUID().replace(/-/g, '').slice(0, 14);
  const input = { username: `auth_it_${suffix}`, email: `auth_it_${suffix}@example.invalid`, password: 'Integration-test-123!', company: '自动化测试账号' };
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const send = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const response = await send('/register', input);
  assert.equal(response.status, 201);
  const registration = await response.json(); userId = registration.user.id;
  const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [userId]);
  assert.equal(rows.length, 1); assert.equal(rows[0].company, input.company);
  assert.notEqual(rows[0].password_hash, input.password);
  assert.ok(await bcrypt.compare(input.password, rows[0].password_hash));
  assert.equal((await send('/register', input)).status, 409);
  const login = await send('/login', { identifier: input.email, password: input.password });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  const me = await fetch(base + '/me', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(me.status, 200); assert.equal((await me.json()).user.id, userId);
  assert.equal((await send('/login', { identifier: "' OR 1=1 --", password: input.password })).status, 401);
});
