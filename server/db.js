'use strict';
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const mysql = require('mysql2/promise');

function readDbConfig(env = process.env) {
  for (const key of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
    if (typeof env[key] !== 'string' || !env[key].trim()) {
      throw new Error(`Configure ${key} in server/.env or the process environment.`);
    }
  }
  const port = Number(env.DB_PORT);
  if (!/^\d+$/.test(env.DB_PORT) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('DB_PORT must be an integer from 1 to 65535.');
  }
  return {
    host: env.DB_HOST,
    port,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 50,
    connectTimeout: 10000,
    charset: 'utf8mb4',
    timezone: 'Z',
    multipleStatements: false,
    supportBigNumbers: true,
    bigNumberStrings: true,
  };
}

let pool;
function getPool() {
  if (!pool) pool = mysql.createPool(readDbConfig());
  return pool;
}

// All user-supplied values must go through execute(sql, values), never interpolation.
module.exports = { getPool, readDbConfig };
