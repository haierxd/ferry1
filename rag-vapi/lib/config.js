import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from './errors.js';

export const projectDir = fileURLToPath(new URL('../', import.meta.url));
export function loadEnv() { dotenv.config({ path: path.join(projectDir, '.env'), quiet: true }); }
function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new AppError('CONFIG_ERROR', `请在服务端 .env 配置 ${name}`);
  return value;
}
function integer(value, fallback, min, max, name) {
  const n = Number(value ?? fallback);
  if (!Number.isInteger(n) || n < min || n > max) throw new AppError('CONFIG_ERROR', `${name} 必须为 ${min}–${max} 的整数`);
  return n;
}
export function databaseConfig(kind, env = process.env) {
  const prefix = kind === 'pg' ? 'PG' : 'MYSQL';
  return {
    host: required(env, `${prefix}_HOST`),
    port: integer(env[`${prefix}_PORT`], kind === 'pg' ? 5432 : 3306, 1, 65535, `${prefix}_PORT`),
    database: required(env, `${prefix}_DB`), user: required(env, `${prefix}_USER`),
    password: env[`${prefix}_PASSWORD`] ?? ''
  };
}
export function readConfig(env = process.env, { mode = 'server' } = {}) {
  const base = new URL(required(env, 'VAPI_BASE_URL'));
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new AppError('CONFIG_ERROR', 'VAPI_BASE_URL 只能是无凭据、无查询参数的 HTTP(S) API 地址');
  }
  if (base.hostname === 'openai.com' || base.hostname.endsWith('.openai.com')) {
    throw new AppError('CONFIG_ERROR', '本实现必须走 v-api；禁止直连 OpenAI，请配置 v-api 的 VAPI_BASE_URL');
  }
  const baseURL = base.toString().replace(/\/+$/, '');
  if (!baseURL.endsWith('/v1')) throw new AppError('CONFIG_ERROR', 'VAPI_BASE_URL 请填写 v-api 控制台的兼容 API 地址并以 /v1 结尾；SDK 会追加 /embeddings 或 /chat/completions');
  const embedDim = integer(env.VAPI_EMBED_DIM, 1536, 1, 65535, 'VAPI_EMBED_DIM');
  if (embedDim !== 1536) throw new AppError('DIMENSION_MISMATCH', '本表固定 vector(1536)。检查 v-api 模型/调用名、重建向量列或新表隔离、重跑 ingest；不能仅修改 VAPI_EMBED_DIM。');
  const embeddingModel = env.VAPI_EMBEDDING_MODEL?.trim() || 'text-embedding-3-small';
  const chatModel = mode === 'server' ? required(env, 'VAPI_CHAT_MODEL') : env.VAPI_CHAT_MODEL?.trim();
  if (chatModel && (chatModel === embeddingModel || /embedding/i.test(chatModel))) {
    throw new AppError('CONFIG_ERROR', 'VAPI_CHAT_MODEL 必须是独立的聊天模型，不能使用嵌入模型');
  }
  const jwtSecret = mode === 'server' ? required(env, 'JWT_SECRET') : undefined;
  if (jwtSecret && jwtSecret.length < 32) throw new AppError('CONFIG_ERROR', 'JWT_SECRET 至少需要 32 个字符，并应与现有登录服务一致');
  return {
    baseURL, apiKey: required(env, 'VAPI_API_KEY'), embeddingModel, chatModel, embedDim,
    knowledgeDir: path.resolve(env.KNOWLEDGE_DIR || 'D:/test2/docs/甲方资料'),
    agent: mode === 'ingest' ? 'A' : 'B',
    topK: integer(env.RAG_TOP_K, 3, 1, 20, 'RAG_TOP_K'),
    batchSize: integer(env.EMBED_BATCH_SIZE, 16, 1, 64, 'EMBED_BATCH_SIZE'),
    timeoutMs: integer(env.VAPI_TIMEOUT_MS, 60000, 1000, 300000, 'VAPI_TIMEOUT_MS'),
    jwtSecret, jwtIssuer: env.JWT_ISSUER || 'zhixu-ai-auth', jwtAudience: env.JWT_AUDIENCE || 'zhixu-ai-web',
    host: env.HOST || '127.0.0.1', port: integer(env.PORT, 3002, 1, 65535, 'PORT')
  };
}

// Allowlist only: never spread config/process.env or include database credentials.
export function printConfig(config, log = console.log) {
  const safe = { agent: config.agent, baseURL: config.baseURL,
    embeddingModel: config.embeddingModel, embedDim: config.embedDim,
    knowledgeDir: config.knowledgeDir, topK: config.topK,
    batchSize: config.batchSize, timeoutMs: config.timeoutMs,
    ...(config.agent === 'B' ? { chatModel: config.chatModel, host: config.host, port: config.port } : {}),
    apiKey: '[REDACTED]', jwtSecret: '[REDACTED]' };
  log(safe);
  return safe;
}
