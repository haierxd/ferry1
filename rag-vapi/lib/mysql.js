// B only: user validation and conversations. A never imports this module.
import mysql from 'mysql2/promise';
import { databaseConfig } from './config.js';

export function createMysqlPool(env = process.env) {
  return mysql.createPool({ ...databaseConfig('mysql', env), connectionLimit: 5,
    waitForConnections: true, queueLimit: 50, connectTimeout: 10000,
    supportBigNumbers: true, bigNumberStrings: true, charset: 'utf8mb4',
    timezone: 'Z', multipleStatements: false });
}
