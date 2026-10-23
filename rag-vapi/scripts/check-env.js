import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnv, readConfig, databaseConfig } from '../lib/config.js';

export const requiredKeys = [
  'PG_HOST', 'PG_PORT', 'PG_DB', 'PG_USER', 'PG_PASSWORD',
  'MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_DB', 'MYSQL_USER', 'MYSQL_PASSWORD',
  'VAPI_BASE_URL', 'VAPI_API_KEY', 'VAPI_EMBEDDING_MODEL', 'VAPI_CHAT_MODEL',
  'VAPI_EMBED_DIM', 'KNOWLEDGE_DIR', 'JWT_SECRET'
];
export const dimensionHint = '需要改 pgvector.sql 的 vector(N) 并重跑 init:pg。注意：当前 lib/config.js、lib/embeddings.js 和 lib/profile.js 及 SQL 约束也固定了 1536 维；仅改 SQL 或 .env 不够。请优先选择返回 1536 维的模型；确需换维度时需另行统一修改并迁移/重建向量表、重新入库。init:pg 不会修改已有列类型。';

// Reused by the other check scripts. Imports have no CLI side effects.
export function isMain(url) {
  return Boolean(process.argv[1]) && url === pathToFileURL(path.resolve(process.argv[1])).href;
}
export function masked(value) {
  return typeof value === 'string' && value.length > 4 ? `${value.slice(0, 4)}***` : '***';
}
export function display(value) {
  let text = String(value);
  for (const [key, secret] of Object.entries(process.env)) {
    if (/PASSWORD|API_KEY|SECRET|TOKEN/i.test(key) && secret) text = text.split(secret).join(masked(secret));
  }
  return text.replace(/[\r\n\x00-\x1f\x7f]/g, ' ').slice(0, 500);
}
export function errorHint(error) {
  const status = Number(error?.status);
  const http = {
    400: 'HTTP 400：请求参数或模型不支持 embeddings；核对模型调用名。',
    401: 'HTTP 401：API Key 无效、已过期或未授权；核对 v-api 密钥。',
    402: 'HTTP 402：账户余额或配额不足；检查 v-api 计费状态。',
    403: 'HTTP 403：没有该模型权限，或来源 IP 被限制。',
    404: 'HTTP 404：接口路径或模型不存在；BASE_URL 应以 /v1 结尾，模型名以控制台为准。',
    429: 'HTTP 429：触发限流或额度限制；降低并发，稍后再试。'
  };
  const codes = {
    DIMENSION_MISMATCH: dimensionHint,
    INVALID_EMBEDDING: '返回的 embedding 数量、索引或向量数据无效；请检查 v-api 模型和响应格式。',
    CONFIG_ERROR: '配置格式错误；检查 URL（以 /v1 结尾）、端口、整数参数、独立聊天模型和至少 32 字符的 JWT_SECRET。',
    ECONNREFUSED: '连接被拒绝：检查数据库服务、主机与端口。',
    ENOTFOUND: '主机名无法解析：检查 HOST / VAPI_BASE_URL 和 DNS。',
    EAI_AGAIN: 'DNS 暂时无法解析；检查网络后重试。',
    ETIMEDOUT: '连接超时：检查网络、防火墙、服务端状态和超时配置。',
    ECONNRESET: '连接被重置：检查网络、代理和服务状态。',
    '28P01': 'PG 密码认证失败：检查 PG_USER / PG_PASSWORD。',
    '28000': '数据库认证失败：检查账户权限和认证配置。',
    '3D000': 'PG 数据库不存在：先由管理员创建 PG_DB（默认 rag_kb），再跑 init:pg。',
    '42501': 'PG 权限不足：请管理员授权目标库、表和扩展。',
    '42P01': 'PG 表不存在：请先运行 npm run init:pg。',
    ER_ACCESS_DENIED_ERROR: 'MySQL 认证失败：检查 MYSQL_USER / MYSQL_PASSWORD 和账户授权。',
    ER_BAD_DB_ERROR: 'MySQL 数据库不存在：请管理员创建 MYSQL_DB（默认 zhixu_ai）。',
    ER_NO_SUCH_TABLE: 'MySQL 表不存在：请先确认目标库，再运行 npm run init:mysql。',
    ER_DBACCESS_DENIED_ERROR: 'MySQL 目标库访问被拒绝：请管理员授权。',
    ENOENT: '文件或目录不存在：检查 KNOWLEDGE_DIR，确保有 UTF-8 的 .md / .txt 文件。',
    EACCES: '文件访问被拒绝：请检查目录和文件读取权限。',
    INVALID_ENCODING: '文件不是有效 UTF-8，或含 NUL 字符；请转换文件编码。',
    EMBEDDING_PROFILE_MISMATCH: '知识库模型、维度或 v-api 地址与当前配置不一致；请使用原配置或另建知识库。',
    KB_NOT_READY: '知识库尚未入库；请先成功运行 check:ingest。',
    CHUNK_EMBEDDING_FAILED: '有分块嵌入失败；本文件没有提交写入，原数据保留。',
    PG_CONNECTION_FAILED: 'PG 连接失败；先运行 npm run check:db 定位连接问题。'
  };
  if (codes[error?.code]) return codes[error.code];
  if (http[status]) return http[status];
  if (status >= 500 && status <= 599) return `HTTP ${status}：v-api 上游服务异常；稍后重试或联系服务商。`;
  if (error?.name === 'APIConnectionTimeoutError') return 'v-api 请求超时；检查网络或 VAPI_TIMEOUT_MS。';
  if (error?.name === 'APIConnectionError') return '无法连接 v-api；检查地址、网络、TLS 证书及代理。';
  return '操作失败：请检查配置、网络、权限和服务状态；为避免泄露凭据，不输出原始错误正文。';
}
export async function runCheck(main) {
  try { await main(); }
  catch (error) { console.error(`❌ ${errorHint(error)}`); console.log('汇总：FAIL'); process.exitCode = 1; }
}

export function checkEnv() {
  loadEnv();
  const missing = [];
  console.table(requiredKeys.map(key => {
    const raw = process.env[key];
    const present = typeof raw === 'string' && raw.trim().length > 0;
    if (!present) missing.push(key);
    return { '键名': key, '是否有值': present ? '✅ 是' : '❌ 否', '长度': typeof raw === 'string' ? raw.length : 0,
      '敏感值预览': present && /PASSWORD|API_KEY|SECRET/.test(key) ? masked(raw) : '—' };
  }));
  if (missing.length) {
    console.error(`❌ 未填写：${missing.join('、')}`);
    console.error('请在项目根目录的 .env 填写；系统环境变量优先于 .env。');
    console.log('汇总：FAIL');
    process.exitCode = 1;
    return;
  }
  readConfig();
  databaseConfig('pg');
  databaseConfig('mysql');
  console.log('✅ 必填项均有值，配置格式校验通过（尚未测试数据库和 API 连通性）。');
  console.log('汇总：PASS');
}
if (isMain(import.meta.url)) await runCheck(checkEnv);
