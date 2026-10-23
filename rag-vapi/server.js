import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadEnv, readConfig, printConfig } from './lib/config.js';
import { createPgPool } from './lib/pg.js';
import { createMysqlPool } from './lib/mysql.js';
import { createAgentVapi } from './lib/vapi.js';
import { createRetriever } from './lib/retrieve.js';
import { assertSchema, assertProfile } from './lib/profile.js';
import { authenticate } from './lib/auth.js';
import { AppError, safeError } from './lib/errors.js';
import { createAskRouter } from './routes/ask.js';

export function createApp({ config, mysql, sdk, chat, retrieve, log = console.error }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Request-ID': req.requestId });
    next();
  });
  const publicError = (error, req) => {
    const detail = safeError(error);
    log({ request_id: req.requestId, ...detail });
    return { request_id: req.requestId, ...detail };
  };
  app.get('/health', (_req, res) => res.json({ status: 'ok',
    knowledge_access: 'all_authenticated_users', full_document: true }));
  app.use('/api/ask', rateLimit({ windowMs: 60000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false }),
    authenticate({ config, mysql }), express.json({ limit: '32kb' }),
    createAskRouter({ config, mysql, sdk, chat, retrieve, publicError }));
  app.use((error, req, res, _next) => {
    if (res.headersSent) return res.end();
    if (error.type === 'entity.too.large') error = new AppError('INVALID_REQUEST', '请求体过大', 413);
    else if (error.type === 'entity.parse.failed') error = new AppError('INVALID_REQUEST', 'JSON 请求体格式错误', 400);
    res.status(error instanceof AppError ? error.status : 500).json(publicError(error, req));
  });
  return app;
}

async function start() {
  loadEnv();
  const config = readConfig();
  printConfig(config);
  const pg = createPgPool(process.env, { readOnly: true }), mysql = createMysqlPool();
  try {
    await assertSchema(pg);
    await assertProfile(pg, config);
    await mysql.execute('SELECT id, citations, response_id, response_model FROM conversations LIMIT 0');
    await mysql.execute('SELECT id FROM users LIMIT 0');
    const vapi = createAgentVapi(config, { role: 'ask' });
    const retrieve = createRetriever({ pg, config, embed: vapi.embedTexts });
    const server = createApp({ config, mysql, chat: vapi.chat, retrieve }).listen(config.port, config.host,
      () => console.log(`RAG API: http://${config.host}:${config.port}；向量=PG，会话=MySQL`));
    server.on('error', async error => { console.error(safeError(error)); await Promise.all([pg.end(), mysql.end()]); process.exitCode = 1; });
    let closing = false;
    const close = () => {
      if (closing) return;
      closing = true;
      const timer = setTimeout(() => process.exit(1), 15000).unref();
      server.close(async () => { await Promise.all([pg.end(), mysql.end()]); clearTimeout(timer); });
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
  } catch (error) { await Promise.all([pg.end(), mysql.end()]); throw error; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch(error => { console.error('启动失败', safeError(error)); process.exitCode = 1; });
}
