'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { readDbConfig } = require('../db');

test('all database connection settings come from the provided environment', () => {
  const env = { DB_HOST: '127.0.0.1', DB_PORT: '33061', DB_USER: 'isolated_test',
    DB_PASSWORD: randomBytes(24).toString('hex'), DB_NAME: 'isolated_schema' };
  const config = readDbConfig(env);
  assert.equal(config.host, env.DB_HOST);
  assert.equal(config.port, 33061);
  assert.equal(config.user, env.DB_USER);
  assert.equal(config.password, env.DB_PASSWORD);
  assert.equal(config.database, env.DB_NAME);
  for (const key of Object.keys(env)) {
    const missing = { ...env }; delete missing[key];
    assert.throws(() => readDbConfig(missing), new RegExp(key));
  }
  for (const port of ['0', '65536', '33061x', '1.5']) {
    assert.throws(() => readDbConfig({ ...env, DB_PORT: port }), /DB_PORT/);
  }
});

test('initial schema is additive and uses the compatible collation', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../sql/init_users.sql'), 'utf8').replace(/^--.*$/gm, '');
  assert.match(sql, /ENGINE=InnoDB/i);
  assert.match(sql, /COLLATE=utf8mb4_general_ci/i);
  assert.doesNotMatch(sql, /utf8mb4_0900|\bDROP\s|\bDELETE\s|\bTRUNCATE\s/i);
  assert.match(sql, /UNIQUE KEY uq_users_username/);
  assert.match(sql, /UNIQUE KEY uq_users_email/);
});
