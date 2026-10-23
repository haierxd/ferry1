// Static frontend + same-origin AgentOS/RAG proxy. Run: node serve.cjs
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const publicFiles = new Set(['index.html', 'styles.css', 'agent-client.js', 'history.js', 'app.js']);
const RUN_ROUTE = /^\/api\/agents\/(deepseek-agent|product-agent|service-agent)\/runs$/;
const sendJson = (res, status, code) => {
  if (res.headersSent) return res.destroy();
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ code }));
};

function createServer({ backendUrl = process.env.AGENTOS_URL || 'http://127.0.0.1:7777',
  ragUrl = process.env.RAG_URL || 'http://127.0.0.1:3002' } = {}) {
  const upstreamBase = new URL(backendUrl);
  const ragBase = new URL(ragUrl);
  if (upstreamBase.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(upstreamBase.hostname)) {
    throw new Error('AGENTOS_URL must be a local HTTP address.');
  }
  if (ragBase.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(ragBase.hostname)) {
    throw new Error('RAG_URL must be a local HTTP address.');
  }
  return http.createServer((req, res) => {
  let name;
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; name = decodeURIComponent(pathname).replace(/^\//, '') || 'index.html'; }
  catch { res.writeHead(400); return res.end('Bad request'); }
  if (pathname.startsWith('/api/')) {
    let target;
    let targetBase = upstreamBase;
    if (req.method === 'POST' && /^\/api\/ask\/?$/.test(pathname)) {
      target = pathname;
      targetBase = ragBase;
    }
    else if (req.method === 'GET' && pathname === '/api/config') target = '/web/config';
    else if (req.method === 'GET' && pathname === '/api/health') target = '/web/health';
    else if (req.method === 'POST' && RUN_ROUTE.test(pathname)) target = pathname.slice(4);
    else return sendJson(res, 404, 'not_found');
    const headers = {};
    for (const key of ['content-type', 'content-length', 'accept']) if (req.headers[key]) headers[key] = req.headers[key];
    if (targetBase === ragBase && req.headers.authorization) headers.authorization = req.headers.authorization;
    const upstream = http.request(new URL(target, targetBase), { method: req.method, headers }, response => {
      res.writeHead(response.statusCode, {
        'Content-Type': response.headers['content-type'] || 'application/json',
        'Cache-Control': response.headers['cache-control'] || 'no-store',
        ...(response.headers['x-accel-buffering'] ? { 'X-Accel-Buffering': response.headers['x-accel-buffering'] } : {}),
      });
      response.on('error', () => res.destroy());
      response.pipe(res);
    });
    upstream.setTimeout(125000, () => { sendJson(res, 504, 'backend_timeout'); upstream.destroy(); });
    upstream.on('error', () => { if (!res.writableEnded) sendJson(res, 503, 'backend_unavailable'); });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
    req.pipe(upstream);
    return;
  }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
  if (!publicFiles.has(name)) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(path.join(root, name), (err, content) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(name)], 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : content);
  });
  });
}

module.exports = { createServer };
if (require.main === module) {
  const port = Number(process.env.FRONTEND_PORT || 4173);
  const server = createServer();
  server.on('error', error => { console.error(`Frontend failed to start: ${error.code}`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`知序 AI: http://127.0.0.1:${port}`));
}
