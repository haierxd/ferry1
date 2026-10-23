import { readFile } from 'node:fs/promises';
import { loadEnv } from '../lib/config.js';
import { createPgPool, createMysqlPool } from '../lib/db.js';
import { AppError, safeError } from '../lib/errors.js';

const migrations = [
  ['citations', 'ALTER TABLE conversations ADD COLUMN citations JSON DEFAULT NULL'],
  ['response_id', 'ALTER TABLE conversations ADD COLUMN response_id TEXT DEFAULT NULL'],
  ['response_model', 'ALTER TABLE conversations ADD COLUMN response_model TEXT DEFAULT NULL']
];
let connection;
try {
  loadEnv();
  const kind = process.argv[2];
  if (kind === 'pg') {
    connection = createPgPool();
    const sql = await readFile(new URL('../pgvector.sql', import.meta.url), 'utf8');
    await connection.query(sql); // Trusted local DDL only; never accepts request SQL.
    console.log('PostgreSQL extension/tables/indexes ready.');
  } else if (kind === 'mysql' || kind === 'mysql-existing') {
    connection = createMysqlPool();
    if (kind === 'mysql') {
      const sql = await readFile(new URL('../mysql.sql', import.meta.url), 'utf8');
      const statements = sql.replace(/^\s*--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean);
      for (const statement of statements) await connection.query(statement);
    }
    const [columns] = await connection.execute(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conversations'`);
    const names = new Set(columns.map(c => c.COLUMN_NAME));
    if (!names.size) throw new AppError('MYSQL_SCHEMA_MISSING', 'conversations 表不存在，请先运行 npm run init:mysql');
    for (const [column, sql] of migrations) {
      if (!names.has(column)) { await connection.query(sql); console.log(`Added conversations.${column}`); }
    }
    // Only widen an old column. Do not shrink wider columns or TEXT supplied by the host app.
    const [models] = await connection.execute(`SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conversations' AND COLUMN_NAME = 'model'`);
    if (models[0]?.DATA_TYPE === 'varchar' && Number(models[0].CHARACTER_MAXIMUM_LENGTH) < 255) {
      await connection.query('ALTER TABLE conversations MODIFY COLUMN model VARCHAR(255) DEFAULT NULL');
    }
    console.log('MySQL conversations ready; existing rows preserved.');
  } else throw new AppError('INVALID_COMMAND', '用法：node scripts/init-db.js pg | mysql | mysql-existing');
} catch (error) {
  console.error('建表失败', safeError(error));
  process.exitCode = 1;
} finally { if (connection) await connection.end(); }
