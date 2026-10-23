'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { randomBytes } = require('node:crypto');
const { createApp } = require('../server');

const secret = randomBytes(48).toString('hex');
const valid = { username: 'xiaozhi', email: 'xz@example.com', password: 'Password123!', company: '知序科技' };

function memoryPool() {
  const rows = []; const calls = [];
  return { rows, calls, async execute(sql, values) {
    calls.push({ sql, values });
    if (sql.startsWith('INSERT INTO users')) {
      const [username, email, password_hash, company] = values;
      if (rows.some(r => r.username === username || r.email === email)) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
      const row = { id: rows.length + 1, username, email, password_hash, company, created_at: '2026-10-22T00:00:00.000Z' };
      rows.push(row); return [{ insertId: row.id }];
    }
    const field = sql.includes('WHERE id = ?') ? 'id' : sql.includes('WHERE email = ?') ? 'email' : 'username';
    return [rows.filter(r => String(r[field]) === String(values[0])).map(r => ({ ...r }))];
  } };
}
async function fixture(t, pool = memoryPool()) {
  const app = createApp({ pool, jwtSecret: secret, bcryptRounds: 4, authLimit: 100 });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, body, token) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(base + '/api' + path, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  }
  return { request, pool, base };
}

test('register stores bcrypt hash, returns token/public user, and /me reads the database', async t => {
  const { request, pool } = await fixture(t);
  const result = await request('/register', valid);
  assert.equal(result.status, 201);
  assert.equal(result.body.user.username, valid.username);
  assert.equal(result.body.user.company, valid.company);
  assert.ok(!JSON.stringify(result.body).includes('password'));
  assert.notEqual(pool.rows[0].password_hash, valid.password);
  assert.ok(await bcrypt.compare(valid.password, pool.rows[0].password_hash));
  const me = await request('/me', undefined, result.body.token);
  assert.equal(me.status, 200); assert.equal(me.body.user.email, valid.email);
  assert.ok(!JSON.stringify(me.body).includes('password_hash'));
  assert.ok(pool.calls.every(c => c.sql.includes('?') && Array.isArray(c.values)));
});
test('minimal registration accepts username/email/password without company', async t => {
  const { request } = await fixture(t);
  const { username, email, password } = valid;
  const result = await request('/register', { username, email, password });
  assert.equal(result.status, 201);
  assert.equal(result.body.user.company, '');
});

test('login accepts username or normalized email and rejects a wrong password', async t => {
  const { request } = await fixture(t); await request('/register', valid);
  for (const identifier of [valid.username, 'XZ@EXAMPLE.COM']) {
    const result = await request('/login', { identifier, password: valid.password });
    assert.equal(result.status, 200); assert.ok(result.body.token);
  }
  for (const credentials of [{ email: valid.email }, { username: valid.username }]) {
    assert.equal((await request('/login', { ...credentials, password: valid.password })).status, 200);
  }
  assert.equal((await request('/login', { email: valid.email, password: 'wrongpassword' })).status, 401);
  assert.equal((await request('/login', { identifier: 'unknown', password: 'wrongpassword' })).status, 401);
});
test('duplicate username/email is a controlled 409, including insert races', async t => {
  const { request } = await fixture(t); await request('/register', valid);
  assert.equal((await request('/register', { ...valid, email: 'other@example.com' })).status, 409);
  assert.equal((await request('/register', { ...valid, username: 'other' })).status, 409);
});
test('validation rejects bad input and bcrypt-truncated passwords', async t => {
  const { request, pool } = await fixture(t);
  for (const body of [null, { ...valid, email: 'invalid' }, { ...valid, username: 'x' },
    { ...valid, password: 'short' }, { ...valid, password: '中'.repeat(25) },
    { ...valid, company: {} }, { ...valid, username: "x' OR 1=1 --" }, { ...valid, password: {} }]) {
    const result = await request('/register', body || {}); assert.equal(result.status, 400);
  }
  assert.equal(pool.rows.length, 0);
});
test('injection-shaped login stays a parameter and cannot sign in', async t => {
  const { request, pool } = await fixture(t); await request('/register', valid);
  const attack = "' OR 1=1 --";
  assert.equal((await request('/login', { identifier: attack, password: valid.password })).status, 401);
  assert.equal(pool.calls.at(-1).values[0], attack);
  assert.ok(!pool.calls.at(-1).sql.includes(attack));
});
test('me rejects missing, tampered, expired, wrong-audience tokens and removed users', async t => {
  const { request, pool } = await fixture(t);
  const result = await request('/register', valid);
  const expired = jwt.sign({}, secret, { subject: '1', issuer: 'zhixu-ai-auth', audience: 'zhixu-ai-web', expiresIn: -1 });
  const wrongAudience = jwt.sign({}, secret, { subject: '1', issuer: 'zhixu-ai-auth', audience: 'other', expiresIn: 60 });
  for (const token of [undefined, 'invalid.token', result.body.token + 'x', expired, wrongAudience]) {
    assert.equal((await request('/me', undefined, token)).status, 401);
  }
  pool.rows.length = 0;
  assert.equal((await request('/me', undefined, result.body.token)).status, 401);
});
test('database errors return a generic 503 and never leak connection data', async t => {
  const { request } = await fixture(t, { execute: async () => { throw Object.assign(new Error('private-db-password'), { code: 'ECONNREFUSED' }); } });
  const response = await request('/register', valid);
  assert.equal(response.status, 503);
  assert.ok(!JSON.stringify(response.body).includes('private-db-password'));
});
test('CORS permits the frontend and malformed JSON stays a JSON 400', async t => {
  const { base } = await fixture(t);
  const preflight = await fetch(base + '/api/login', { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:4173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' } });
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://127.0.0.1:4173');
  const response = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
  assert.equal(response.status, 400); assert.ok((await response.json()).message);
});
