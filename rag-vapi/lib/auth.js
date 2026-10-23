import jwt from 'jsonwebtoken';

export function authenticate({ config, mysql }) {
  return async (req, res, next) => {
    const match = /^Bearer ([^\s]+)$/.exec(req.get('Authorization') || '');
    if (!match) return res.status(401).json({ code: 'UNAUTHORIZED', message: '请携带登录服务签发的 Bearer JWT' });
    let payload;
    try {
      payload = jwt.verify(match[1], config.jwtSecret, { algorithms: ['HS256'],
        issuer: config.jwtIssuer, audience: config.jwtAudience });
      if (typeof payload !== 'object' || typeof payload.exp !== 'number'
        || typeof payload.sub !== 'string' || !/^[1-9]\d{0,18}$/.test(payload.sub)
        || BigInt(payload.sub) > 9223372036854775807n) throw new Error('Invalid subject');
    } catch { return res.status(401).json({ code: 'UNAUTHORIZED', message: 'JWT 无效或已过期' }); }
    const [rows] = await mysql.execute('SELECT id FROM users WHERE id = ? LIMIT 1', [payload.sub]);
    if (!rows.length) return res.status(401).json({ code: 'UNAUTHORIZED', message: '用户不存在或已删除' });
    // Shared enterprise knowledge is readable by every verified, existing user.
    // This permission is assigned by the server, never trusted from JWT role claims or request JSON.
    req.auth = { userId: payload.sub, permissions: ['knowledge:read'] };
    next();
  };
}
