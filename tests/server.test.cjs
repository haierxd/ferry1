const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createServer } = require('../serve.cjs');

test('same-origin proxy preserves multipart bodies and upstream failures, denies private files', async t => {
  const calls = [];
  const upstream = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    calls.push({ method: req.method, url: req.url, type: req.headers['content-type'], body });
    res.writeHead(req.url.includes('service-agent') ? 429 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ content: 'proxy reply', configured: true }));
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const server = createServer({ backendUrl: `http://127.0.0.1:${upstream.address().port}` });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); upstream.closeAllConnections(); upstream.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const form = new FormData(); form.set('message', '你好'); form.set('stream', 'false');
  const response = await fetch(`${base}/api/agents/deepseek-agent/runs`, { method: 'POST', body: form });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).content, 'proxy reply');
  assert.equal(calls[0].url, '/agents/deepseek-agent/runs');
  assert.match(calls[0].type, /multipart\/form-data; boundary=/);
  assert.match(calls[0].body, /你好/);
  assert.equal((await fetch(`${base}/api/config`)).status, 200);
  assert.equal(calls.at(-1).url, '/web/config');
  assert.equal((await fetch(`${base}/api/agents/service-agent/runs`, { method: 'POST', body: form })).status, 429);
  for (const p of ['/personal_agent/.env', '/personal_agent/agent.py', '/api/admin', '/api/sessions']) {
    assert.equal((await fetch(base + p)).status, 404, p);
  }
  assert.equal((await fetch(base + '/agent-client.js')).status, 200);
  assert.equal((await fetch(base + '/')).status, 200);
});

test('offline backend yields an explicit 503 rather than HTML or a demo answer', async t => {
  const server = createServer({ backendUrl: 'http://127.0.0.1:1' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'backend_unavailable');
});

test('RAG proxy preserves /api/ask, JWT, JSON body and streaming responses', async t => {
  const calls = [];
  const rag = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    calls.push({ url: req.url, authorization: req.headers.authorization, body });
    if (!req.headers.authorization) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ code: 'UNAUTHORIZED' }));
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
    res.end('event: done\ndata: {"answer":"资料回答"}\n\n');
  });
  rag.listen(0, '127.0.0.1'); await once(rag, 'listening');
  const server = createServer({ ragUrl: `http://127.0.0.1:${rag.address().port}` });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); rag.closeAllConnections(); rag.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + '/api/ask', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-only-token' },
    body: JSON.stringify({ question: '采购权限？', stream: true }) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  assert.match(response.headers.get('cache-control'), /no-transform/);
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  assert.match(await response.text(), /event: done/);
  assert.equal(calls[0].url, '/api/ask');
  assert.equal(calls[0].authorization, 'Bearer test-only-token');
  assert.equal(JSON.parse(calls[0].body).question, '采购权限？');
  assert.equal((await fetch(base + '/api/ask', { method: 'POST', body: '{}' })).status, 401);
});
