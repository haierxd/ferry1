import { loadEnv, databaseConfig } from '../lib/config.js';
import { createPgPool, createMysqlPool } from '../lib/db.js';
import { assertSchema } from '../lib/profile.js';
import { isMain, runCheck, errorHint, display } from './check-env.js';

export async function checkDb() {
  loadEnv();
  let passed = 0, failed = 0;
  async function step(label, action) {
    try {
      const detail = await action();
      passed++;
      console.log(`✅ ${label}${detail ? `：${display(detail)}` : ''}`);
    } catch (error) {
      failed++;
      console.error(`❌ ${label}：${errorHint(error)}`);
    }
  }
  function requireFound(found, message) {
    if (!found) { console.log(`   提示：${message}`); throw { code: 'CHECK_NOT_FOUND' }; }
  }
  for (const kind of ['pg', 'mysql']) {
    const name = kind === 'pg' ? 'PG' : 'MySQL';
    let pool, config;
    try {
      config = databaseConfig(kind);
      pool = kind === 'pg' ? createPgPool() : createMysqlPool();
    } catch (error) {
      failed++;
      console.error(`❌ ${name} 连接配置：${errorHint(error)}`);
      console.log(`❌ ${name} 后续检查跳过；先运行 check:env 修复该数据库配置。`);
      continue;
    }
    // Handle background idle-client errors without dumping a driver Error object.
    pool.on('error', () => { failed++; console.error(`❌ ${name} 连接池后台连接异常；请检查服务状态。`); });
    try {
      await step(`${name} SELECT 1`, async () => {
        const result = kind === 'pg' ? (await pool.query('SELECT 1 AS ok')).rows : (await pool.query('SELECT 1 AS ok'))[0];
        requireFound(Number(result[0]?.ok) === 1, '数据库没有返回预期的 1。');
        return '连接和基础查询成功';
      });
      if (kind === 'pg') {
        await step('PG rag_kb 库存在且为当前目标', async () => {
          const { rows } = await pool.query("SELECT datname FROM pg_database WHERE datname = $1", ['rag_kb']);
          requireFound(rows.length && config.database === 'rag_kb', '本清单目标为 rag_kb；检查 PG_DB，并请管理员创建该库。');
          return 'rag_kb';
        });
        await step('PG 当前库 vector 扩展', async () => {
          const { rows } = await pool.query("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
          requireFound(rows.length, '服务端安装扩展后，在目标库运行 npm run init:pg。');
          return `版本 ${rows[0].extversion}`;
        });
        for (const table of ['kb_documents', 'kb_chunks']) {
          await step(`PG public.${table} 表`, async () => {
            const { rows } = await pool.query('SELECT to_regclass($1)::text AS name', [`public.${table}`]);
            requireFound(rows[0]?.name, '请在目标库运行 npm run init:pg。');
            return '存在';
          });
        }
        await step('PG 向量列与现有业务维度一致', async () => { await assertSchema(pool); return 'vector(1536)'; });
      } else {
        await step('MySQL zhixu_ai 库存在且为当前目标', async () => {
          const [rows] = await pool.query('SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?', ['zhixu_ai']);
          requireFound(rows.length && config.database === 'zhixu_ai', '本清单目标为 zhixu_ai；检查 MYSQL_DB 和数据库可见权限。');
          return 'zhixu_ai';
        });
        await step('MySQL conversations 表', async () => {
          const [rows] = await pool.query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND TABLE_TYPE = 'BASE TABLE'", ['conversations']);
          requireFound(rows.length, '请运行 npm run init:mysql；已有会话表缺字段时运行 npm run migrate:mysql。');
          return '存在';
        });
      }
    } finally {
      await step(`${name} 关闭连接池`, async () => { await pool.end(); });
    }
  }
  console.log(`汇总：${failed ? 'FAIL' : 'PASS'}（通过 ${passed} 项，失败 ${failed} 项）`);
  process.exitCode = failed ? 1 : 0;
}
if (isMain(import.meta.url)) await runCheck(checkDb);
