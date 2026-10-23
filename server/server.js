'use strict';
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { randomBytes } = require('node:crypto');
const { getPool } = require('./db');
const { createConversationsRouter } = require('./conversations');

const ISSUER = 'zhixu-ai-auth';
const AUDIENCE = 'zhixu-ai-web';
const PUBLIC_COLUMNS = 'id, username, email, company, created_at';
const dummyHash = bcrypt.hashSync(randomBytes(24).toString('hex'), 12);

function publicUser(row) {
  return { id: row.id, username: row.username, email: row.email,
    company: row.company, created_at: row.created_at };
}
function validPassword(value) {
  return typeof value === 'string' && value.length >= 8 && Buffer.byteLength(value, 'utf8') <= 72;
}
function createApp({ pool = getPool(), jwtSecret = process.env.JWT_SECRET,
  jwtExpiresIn = process.env.JWT_EXPIRES_IN || '1d',
  bcryptRounds = Number(process.env.BCRYPT_ROUNDS || 12), authLimit = 30 } = {}) {
  if (typeof jwtSecret !== 'string' || jwtSecret.length < 32) throw new Error('Set a random JWT_SECRET of at least 32 characters in server/.env.');
  if (!Number.isInteger(bcryptRounds) || bcryptRounds < 4 || bcryptRounds > 15) throw new Error('BCRYPT_ROUNDS must be an integer from 4 to 15.');
  // Validate expiration at startup instead of failing after an account is inserted.
  jwt.sign({}, jwtSecret, { expiresIn: jwtExpiresIn });
  const origins = (process.env.CORS_ORIGINS || 'http://127.0.0.1:4173,http://localhost:4173').split(',').map(s => s.trim()).filter(Boolean);
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: origins, methods: ['GET', 'POST', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
  app.use('/api/conversations', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); },
    authenticate, express.json({ limit: '1mb' }), createConversationsRouter({ pool }));
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: authLimit,
    standardHeaders: 'draft-8', legacyHeaders: false,
    message: { message: '尝试次数过多，请稍后再试。', code: 'rate_limited' } });
  function tokenFor(user) {
    return jwt.sign({}, jwtSecret, { subject: String(user.id), algorithm: 'HS256',
      issuer: ISSUER, audience: AUDIENCE, expiresIn: jwtExpiresIn });
  }
  function authenticate(req, res, next) {
    const match = /^Bearer ([^\s]+)$/.exec(req.get('Authorization') || '');
    if (!match) return res.status(401).json({ message: '请先登录。', code: 'unauthorized' });
    try {
      const payload = jwt.verify(match[1], jwtSecret, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE });
      if (typeof payload !== 'object' || !/^[1-9]\d*$/.test(payload.sub)) throw new Error('Invalid subject');
      req.userId = payload.sub;
      next();
    } catch { res.status(401).json({ message: '登录已失效，请重新登录。', code: 'unauthorized' }); }
  }

  app.post('/api/register', loginLimiter, async (req, res) => {
    const body = req.body || {};
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const company = body.company === undefined ? '' : typeof body.company === 'string' ? body.company.trim() : null;
    if (!/^[\p{L}\p{N}_]{3,32}$/u.test(username)) return res.status(400).json({ message: '用户名需为 3–32 个文字、数字或下划线。' });
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: '请输入有效的邮箱地址。' });
    if (!validPassword(body.password)) return res.status(400).json({ message: '密码至少 8 个字符，UTF-8 编码后不能超过 72 字节。' });
    if (company === null || company.length > 120) return res.status(400).json({ message: '公司名称不能超过 120 个字符。' });
    try {
      const passwordHash = await bcrypt.hash(body.password, bcryptRounds);
      const [result] = await pool.execute('INSERT INTO users (username, email, password_hash, company) VALUES (?, ?, ?, ?)', [username, email, passwordHash, company]);
      const [rows] = await pool.execute(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ? LIMIT 1`, [result.insertId]);
      const user = publicUser(rows[0]);
      return res.status(201).json({ message: '注册成功。', token: tokenFor(user), user });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: '用户名或邮箱已被注册。', code: 'account_exists' });
      throw error;
    }
  });

  app.post('/api/login', loginLimiter, async (req, res) => {
    const body = req.body || {};
    const raw = body.identifier ?? body.email ?? body.username;
    const identifier = typeof raw === 'string' ? raw.trim() : '';
    if (!identifier || identifier.length > 254 || !validPassword(body.password)) return res.status(400).json({ message: '请输入用户名或邮箱，以及有效密码。' });
    const isEmail = identifier.includes('@');
    const sql = isEmail
      ? `SELECT ${PUBLIC_COLUMNS}, password_hash FROM users WHERE email = ? LIMIT 1`
      : `SELECT ${PUBLIC_COLUMNS}, password_hash FROM users WHERE username = ? LIMIT 1`;
    const [rows] = await pool.execute(sql, [isEmail ? identifier.toLowerCase() : identifier]);
    const row = rows[0];
    const matches = await bcrypt.compare(body.password, row?.password_hash || dummyHash);
    if (!row || !matches) return res.status(401).json({ message: '用户名、邮箱或密码不正确。', code: 'invalid_credentials' });
    const user = publicUser(row);
    res.json({ message: '登录成功。', token: tokenFor(user), user });
  });

  app.get('/api/me', authenticate, async (req, res) => {
    const [rows] = await pool.execute(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ? LIMIT 1`, [req.userId]);
    if (!rows[0]) return res.status(401).json({ message: '账号不存在，请重新登录。', code: 'unauthorized' });
    res.json({ user: publicUser(rows[0]) });
  });
  app.use((_req, res) => res.status(404).json({ message: '接口不存在。', code: 'not_found' }));
  app.use((error, _req, res, _next) => {
    if (error.type === 'entity.parse.failed') return res.status(400).json({ message: '请求 JSON 格式不正确。' });
    if (error.type === 'entity.too.large') return res.status(413).json({ message: '请求内容过长。' });
    // Return no SQL, connection details, credentials or raw provider errors.
    console.error('[auth]', error.code || error.name || 'internal_error');
    res.status(503).json({ message: '账号服务暂时不可用，请检查数据库连接后重试。', code: 'service_unavailable' });
  });
  return app;
}

async function start() {
  const pool = getPool();
  const app = createApp({ pool });
  await pool.execute('SELECT 1');
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const server = app.listen(port, '127.0.0.1', () => console.log(`Auth API: http://127.0.0.1:${port}`));
  server.on('error', error => { console.error('Auth startup failed:', error.code); void pool.end(); process.exitCode = 1; });
  const stop = () => server.close(() => { void pool.end().finally(() => process.exit(0)); });
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
module.exports = { createApp };
if (require.main === module) start().catch(error => {
  console.error('Auth startup failed:', error.code || error.message);
  try { void getPool().end(); } catch { /* No pool exists when configuration is missing. */ }
  process.exitCode = 1;
});
