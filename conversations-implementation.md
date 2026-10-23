# 会话管理：完整增量代码与接入位置

以下内容从已落地的文件生成，代码无省略。现有项目已经完成接入，无需再次重复添加。

## D:/test2/sql/init_conversations.sql：完整建表语句

```sql
-- Run in zhixu_ai. Compatible with MySQL 5.7 and 8.0; preserves existing data.
USE zhixu_ai;

CREATE TABLE IF NOT EXISTS conversations (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  title VARCHAR(200) DEFAULT NULL,
  question TEXT NOT NULL,
  answer LONGTEXT NOT NULL,
  model VARCHAR(100) DEFAULT NULL,
  tokens INT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user_created (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
```

## D:/test2/server/conversations.js：四个接口的完整代码

```javascript
'use strict';
const express = require('express');

function createConversationsRouter({ pool }) {
  const router = express.Router();
  const detailColumns = 'CAST(id AS CHAR) AS id, title, question, answer, model, tokens, UNIX_TIMESTAMP(created_at) AS created_at';
  const serialize = row => ({ ...row, created_at: new Date(Number(row.created_at) * 1000).toISOString() });
  function badRequest(res, message) {
    return res.status(400).json({ message, code: 'invalid_input' });
  }
  function validId(id) {
    return typeof id === 'string' && /^[1-9]\d{0,18}$/.test(id) && BigInt(id) <= 9223372036854775807n;
  }
  async function checkOwner(req, res) {
    if (!validId(req.params.id)) { badRequest(res, '会话编号无效。'); return false; }
    const [rows] = await pool.execute('SELECT user_id FROM conversations WHERE id = ? LIMIT 1', [req.params.id]);
    if (!rows[0]) { res.status(404).json({ message: '会话不存在。', code: 'not_found' }); return false; }
    if (String(rows[0].user_id) !== req.userId) {
      res.status(403).json({ message: '无权访问此会话。', code: 'forbidden' }); return false;
    }
    return true;
  }

  router.post('/', async (req, res) => {
    const body = req.body || {};
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    const answer = typeof body.answer === 'string' ? body.answer : '';
    const model = body.model == null ? null : typeof body.model === 'string' ? body.model.trim() : undefined;
    if (!question || Buffer.byteLength(question, 'utf8') > 65535) return badRequest(res, '问题不能为空，且不能超过 65535 字节。');
    if (!answer.trim() || Buffer.byteLength(answer, 'utf8') > 900000) return badRequest(res, '回答不能为空，且不能超过 900000 字节。');
    if (model === undefined || (model && Array.from(model).length > 100)) return badRequest(res, '模型名称不能超过 100 字符。');
    const title = Array.from(question).slice(0, 30).join('');
    // Ownership always comes from verified JWT middleware. Ignore any body.user_id.
    const [result] = await pool.execute('INSERT INTO conversations (user_id, title, question, answer, model) VALUES (?, ?, ?, ?, ?)',
      [req.userId, title, question, answer, model || null]);
    res.status(201).json({ message: '会话已保存。', conversation: { id: String(result.insertId), title } });
  });

  router.get('/', async (req, res) => {
    const rawLimit = req.query.limit ?? '20';
    const rawOffset = req.query.offset ?? '0';
    if (typeof rawLimit !== 'string' || typeof rawOffset !== 'string' || !/^\d{1,3}$/.test(rawLimit) || !/^\d{1,10}$/.test(rawOffset)) {
      return badRequest(res, '分页参数无效。');
    }
    const limit = Number(rawLimit); const offset = Number(rawOffset);
    if (limit < 1 || limit > 100 || offset > 2147483647) return badRequest(res, 'limit 需为 1–100，offset 需为有效的非负整数。');
    const [rows] = await pool.execute('SELECT CAST(id AS CHAR) AS id, title, LEFT(question, 100) AS question, UNIX_TIMESTAMP(created_at) AS created_at FROM conversations WHERE user_id = ? ORDER BY conversations.created_at DESC, conversations.id DESC LIMIT ? OFFSET ?',
      [req.userId, limit + 1, offset]);
    res.json({ items: rows.slice(0, limit).map(serialize), limit, offset, has_more: rows.length > limit });
  });

  router.get('/:id', async (req, res) => {
    if (!await checkOwner(req, res)) return;
    const [rows] = await pool.execute(`SELECT ${detailColumns} FROM conversations WHERE id = ? AND user_id = ? LIMIT 1`, [req.params.id, req.userId]);
    if (!rows[0]) return res.status(404).json({ message: '会话不存在。', code: 'not_found' });
    res.json({ conversation: serialize(rows[0]) });
  });

  router.delete('/:id', async (req, res) => {
    if (!await checkOwner(req, res)) return;
    const [result] = await pool.execute('DELETE FROM conversations WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
    if (!result.affectedRows) return res.status(404).json({ message: '会话不存在。', code: 'not_found' });
    res.json({ message: '会话已删除。', id: req.params.id });
  });
  return router;
}
module.exports = { createConversationsRouter };
```

## D:/test2/server/server.js：注册路由

复用已有 authenticate，放在全局 express.json 前；CORS methods 加入 DELETE。完整 server.js 另见 conversations-complete-source.md。

## 路由接入代码

```javascript
const { createConversationsRouter } = require('./conversations');
app.use('/api/conversations', (_req, res, next) => {
  res.set('Cache-Control', 'no-store'); next();
}, authenticate, express.json({ limit: '1mb' }), createConversationsRouter({ pool }));
```

## D:/test2/index.html：完整历史页 HTML 片段

```html
<section id="history-page" class="page history-page" hidden aria-labelledby="history-title">
        <header class="history-heading-row">
          <div><span class="eyebrow">YOUR CONVERSATION ARCHIVE</span><h1 id="history-title">历史会话</h1><p>回顾每一次提问，找到有用的答案。</p></div>
          <button type="button" class="outline-button" id="history-refresh">刷新记录</button>
        </header>
        <p class="history-status" id="history-status" role="status" aria-live="polite"></p>
        <div class="history-list" id="history-list"></div>
        <div class="history-pagination"><button type="button" class="outline-button" id="history-more" hidden>加载更多</button></div>
        <div id="history-sentinel" class="history-sentinel" hidden aria-hidden="true"></div>
      </section>
```

## D:/test2/index.html：导航和脚本（history.js 在 app.js 前）

```html
<a href="#history" class="nav-item" data-page="history"><svg class="icon"><use href="#i-clock"/></svg>历史会话</a>
<script src="agent-client.js" defer></script>
<script src="history.js" defer></script>
<script src="app.js" defer></script>
```

## D:/test2/styles.css：完整新增 CSS

```css
/* Authenticated conversation archive; raw answer text is never treated as HTML. */
.history-page{padding:38px 42px 60px;max-width:1160px;margin:0 auto;width:100%;box-sizing:border-box}
.history-heading-row{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:24px}
.history-heading-row h1{font-size:28px;font-weight:600;margin:10px 0;color:#263f34}
.history-heading-row p{color:#88968d;font-size:12px;line-height:1.8}
.history-status{font-size:12px;color:#7c8c81;line-height:1.8;margin:14px 0;min-height:22px;overflow-wrap:anywhere}
.history-list{display:grid;gap:14px}
.history-card{background:#fff;border:1px solid #e4ebe6;border-radius:13px;padding:20px 22px;box-shadow:0 3px 14px #263f3403;min-width:0}
.history-card-header{display:flex;align-items:center;justify-content:space-between;gap:18px}
.history-open{display:flex;flex-direction:column;align-items:flex-start;text-align:left;gap:7px;flex:1;min-width:0;background:transparent;color:#2f493c;padding:0;cursor:pointer}
.history-open strong{font-size:14px;font-weight:600;line-height:1.7;overflow-wrap:anywhere}
.history-open[aria-expanded=true] strong{color:var(--accent)}
.history-time{font-size:10px;color:#97a399;font-weight:400}
.history-delete{flex-shrink:0;font-size:11px;padding:7px 11px;border:1px solid #eeded8;border-radius:6px;color:#a16652;background:#fffaf8;cursor:pointer}
.history-delete:hover{background:#f9eee8}.history-delete:disabled{opacity:.5;cursor:wait}
.history-preview{color:#87958b;font-size:12px;line-height:1.9;margin:14px 0 0;overflow-wrap:anywhere}
.history-detail{border-top:1px solid #edf1ee;margin-top:18px;padding-top:4px}
.history-detail h3{font-size:12px;color:#567561;margin:17px 0 8px;font-weight:600}
.history-text{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;font:inherit;font-size:13px;line-height:1.95;color:#43584b;margin:0;background:#f6f8f6;padding:13px 15px;border-radius:7px}
.history-answer{background:#eff6f2}.history-model{font-size:10px;color:#91a095;margin-top:12px}
.history-pagination{display:flex;justify-content:center;margin-top:24px}.history-sentinel{height:2px}
@media(max-width:760px){.history-page{padding:25px 18px 45px}.history-heading-row{gap:12px;align-items:flex-start}.history-heading-row h1{font-size:24px}.history-heading-row .outline-button{font-size:10px;white-space:nowrap;margin-top:18px}.history-card{padding:16px}.history-open strong{font-size:13px}.history-card-header{gap:10px}.history-text{padding:11px;font-size:12px}}
```

## D:/test2/history.js：完整原生 JavaScript

```javascript
'use strict';

// Independent native-JS view. It receives auth accessors, never database credentials.
window.ConversationHistory = {
  create({ apiBase, getToken, getUser, onUnauthorized, notify }) {
    const list = document.getElementById('history-list');
    const status = document.getElementById('history-status');
    const more = document.getElementById('history-more');
    const sentinel = document.getElementById('history-sentinel');
    let generation = 0;
    let active = false;
    let owner = null;
    let offset = 0;
    let hasMore = true;
    let loading = false;
    let records = [];

    function identity() {
      const user = getUser(); const token = getToken();
      return user && token ? { userId: String(user.id), token } : null;
    }
    function stillCurrent(auth) {
      const current = identity();
      return !!current && current.userId === auth.userId && current.token === auth.token;
    }
    async function request(path, { method = 'GET', body, auth = identity() } = {}) {
      if (!auth) throw new Error('请先登录。');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const headers = { Authorization: `Bearer ${auth.token}` };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const response = await fetch(`${apiBase}/conversations${path}`, {
          method, headers, signal: controller.signal,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        let data;
        try { data = await response.json(); } catch { throw new Error('历史会话服务返回了无法识别的响应。'); }
        if (response.status === 401 && stillCurrent(auth)) onUnauthorized();
        if (!response.ok) throw new Error(data.message || '历史会话请求失败。');
        return data;
      } catch (error) {
        if (error.name === 'AbortError') throw new Error('历史会话服务响应超时，请重试。');
        if (error instanceof TypeError) throw new Error('无法连接历史会话服务，请检查后端。');
        throw error;
      } finally { clearTimeout(timer); }
    }
    function node(tag, className, text) {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = text;
      return element;
    }
    function dateLabel(value) {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { hour12: false });
    }
    function render() {
      list.replaceChildren();
      for (const record of records) {
        const article = node('article', 'history-card');
        const header = node('div', 'history-card-header');
        const open = node('button', 'history-open');
        open.type = 'button'; open.dataset.historyOpen = record.id;
        open.setAttribute('aria-expanded', String(!!record.open));
        open.setAttribute('aria-controls', `history-detail-${record.id}`);
        open.append(node('strong', '', record.title || record.question || '未命名会话'),
          node('span', 'history-time', dateLabel(record.created_at)));
        const remove = node('button', 'history-delete', '删除');
        remove.type = 'button'; remove.dataset.historyDelete = record.id;
        remove.disabled = !!record.deleting;
        remove.setAttribute('aria-label', `删除会话：${record.title || '未命名会话'}`);
        header.append(open, remove);
        article.append(header, node('p', 'history-preview', record.question));
        const detail = node('div', 'history-detail');
        detail.id = `history-detail-${record.id}`; detail.hidden = !record.open;
        if (record.open) {
          if (record.detail) {
            detail.append(node('h3', '', '我的提问'), node('pre', 'history-text', record.detail.question),
              node('h3', '', 'AI 回答'), node('pre', 'history-text history-answer', record.detail.answer));
            if (record.detail.model) detail.append(node('p', 'history-model', `模型：${record.detail.model}`));
          } else detail.append(node('p', '', record.error || '正在加载完整问答…'));
        }
        article.append(detail); list.append(article);
      }
      more.hidden = !hasMore || !records.length;
      more.disabled = loading;
      more.textContent = loading ? '正在加载…' : '加载更多';
      sentinel.hidden = !hasMore || !records.length;
    }
    async function loadMore() {
      if (!active || loading || !hasMore) return;
      const version = generation; const auth = identity();
      if (!auth) return;
      loading = true; status.textContent = records.length ? '' : '正在加载历史会话…'; render();
      try {
        const data = await request(`?limit=20&offset=${offset}`, { auth });
        if (version !== generation || !active || !stillCurrent(auth)) return;
        const existing = new Set(records.map(record => record.id));
        records.push(...data.items.filter(record => !existing.has(record.id)));
        offset += data.items.length; hasMore = data.has_more === true;
        status.textContent = records.length ? (hasMore ? '下拉或点击按钮加载更多。' : '已显示全部历史会话。') : '还没有历史会话，向智能体提出第一个问题吧。';
      } catch (error) {
        if (version === generation && active) {
          status.textContent = error.message;
          // Avoid repeated automatic requests when the backend is unavailable.
          observer?.disconnect();
        }
      } finally {
        if (version === generation) { loading = false; render(); }
      }
    }
    async function reload() {
      generation++; records = []; offset = 0; hasMore = true; loading = false;
      if (active) { observer?.observe(sentinel); await loadMore(); }
    }
    async function toggle(id) {
      const record = records.find(item => item.id === id);
      if (!record) return;
      record.open = !record.open; render();
      if (!record.open || record.detail || record.fetching) return;
      const version = generation; const auth = identity();
      record.fetching = true;
      try {
        const result = await request(`/${encodeURIComponent(id)}`, { auth });
        if (version !== generation || !stillCurrent(auth)) return;
        record.detail = result.conversation; record.error = '';
      } catch (error) {
        if (version === generation) record.error = error.message;
      } finally {
        record.fetching = false;
        if (version === generation && active) render();
      }
    }
    async function remove(id) {
      const record = records.find(item => item.id === id);
      if (!record || record.deleting || !window.confirm('确定删除这条历史问答吗？删除后无法恢复。')) return;
      const version = generation; const auth = identity();
      record.deleting = true; render();
      try {
        await request(`/${encodeURIComponent(id)}`, { method: 'DELETE', auth });
        if (version !== generation || !stillCurrent(auth)) return;
        notify('历史问答已删除。'); await reload();
      } catch (error) {
        if (version === generation && active) { status.textContent = error.message; record.deleting = false; render(); }
      }
    }
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadMore();
    }, { rootMargin: '120px' }) : null;
    list.addEventListener('click', event => {
      const open = event.target.closest('[data-history-open]');
      const removeButton = event.target.closest('[data-history-delete]');
      if (open) void toggle(open.dataset.historyOpen);
      if (removeButton) void remove(removeButton.dataset.historyDelete);
    });
    more.addEventListener('click', () => { void loadMore(); });
    document.getElementById('history-refresh').addEventListener('click', () => { void reload(); });

    return {
      enter() {
        const auth = identity();
        if (!auth) return;
        if (active && owner === auth.userId) return;
        active = true; owner = auth.userId; void reload();
      },
      leave() {
        generation++; active = false; owner = null; loading = false;
        records = []; list.replaceChildren(); status.textContent = ''; observer?.disconnect();
      },
      async save({ question, answer, model }) {
        const auth = identity();
        if (!auth) return;
        try {
          await request('', { method: 'POST', body: { question, answer, model }, auth });
          if (active && stillCurrent(auth)) await reload();
        } catch (error) {
          if (stillCurrent(auth)) notify(`回答已显示，但历史保存失败：${error.message}`);
        }
      },
    };
  },
};
```

## D:/test2/app.js：初始化历史组件

```javascript
const conversationHistory = ConversationHistory.create({ apiBase: authApiBase,
  getToken: savedToken, getUser: () => authUser,
  onUnauthorized: () => logout('登录已失效，请重新登录。'), notify: toast });
```

## D:/test2/app.js：包含 #history 的完整路由函数

```javascript
function route() {
  closeMenu();
  if (authUser && authExpiresAt && Date.now() >= authExpiresAt) { logout('登录已过期，请重新登录。'); return; }
  const needsAuth = !authUser || authPending;
  document.body.classList.toggle('auth-screen', needsAuth);
  $('#auth-pages').hidden = !needsAuth;
  $('#auth-loading').hidden = !authPending;
  $('#login-page').hidden = true; $('#register-page').hidden = true;
  if (needsAuth) {
    $('#qa-page').hidden = true; $('#chat-page').hidden = true;
    $('#history-page').hidden = true; conversationHistory.leave();
    if (!authPending) {
      const page = location.hash === '#register' ? 'register' : 'login';
      if (location.hash !== `#${page}`) location.replace(`#${page}`);
      $(`#${page}-page`).hidden = false;
      $('#auth-recheck').hidden = !savedToken();
    }
    return;
  }
  if (!['#qa', '#chat', '#history'].includes(location.hash)) location.replace('#qa');
  const page = location.hash === '#history' ? 'history' : location.hash === '#chat' ? 'chat' : 'qa';
  $('#qa-page').hidden = page !== 'qa';
  $('#chat-page').hidden = page !== 'chat';
  $('#history-page').hidden = page !== 'history';
  if (page === 'history') conversationHistory.enter(); else conversationHistory.leave();
  $('#breadcrumb-current').textContent = page === 'history' ? '历史会话' : page === 'qa' ? '客户问答' : '智能体对话';
  document.querySelectorAll('[data-page]').forEach(el => {
    const selected = el.dataset.page === page;
    el.classList.toggle('active', selected);
    if (selected) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  });
  closeMenu();
}
```

## D:/test2/app.js：问答函数完整代码与成功后保存位置

```javascript
async function runMessage(target, message) {
  if (!authUser || pendingSessions.has(target.id)) return;
  const version = authVersion;
  let completedAnswer;
  pendingSessions.add(target.id);
  message.status = 'pending'; delete message.error;
  persist(); renderRecent();
  if (activeId === target.id) renderMessages();
  try {
    const answer = await agentClient.run({ agentId: agentIds[target.agent],
      sessionId: target.id, message: message.text });
    if (version !== authVersion) return;
    message.status = 'sent';
    target.messages.push({ role: 'assistant', text: answer.text, model: modelName, runId: answer.runId });
    connectionState = 'ready';
    completedAnswer = { question: message.text, answer: answer.text, model: modelName };
  } catch (error) {
    if (version !== authVersion) return;
    message.status = 'failed';
    message.error = error instanceof AgentRequestError ? error.message : '请求失败，请稍后重试。';
    connectionState = error.code === 'missing_api_key' ? 'unconfigured' : 'error';
  } finally {
    if (version !== authVersion) return;
    pendingSessions.delete(target.id);
    target.updated = Date.now();
    persist(); renderRecent(); renderConnection();
    if (activeId === target.id) renderMessages();
    if (completedAnswer) void conversationHistory.save(completedAnswer);
  }
}
```

## D:/test2/serve.cjs

将 history.js 加入 publicFiles 静态白名单。server/db.js 已增加 supportBigNumbers / bigNumberStrings，以字符串处理 BIGINT ID。

# 会话管理：接入与验证

本功能记录每次成功的“问题 + AI 回答”，一轮问答对应 conversations 中的一行。原有浏览器最近对话和 AgentOS 连续对话上下文保持原样；启用前仅存于浏览器的旧对话不会自动导入 MySQL。

## 文件与接入位置

| 路径 | 内容 |
| --- | --- |
| `D:\test2\sql\init_conversations.sql` | MySQL 5.7/8.0 建表 SQL，不修改旧表 |
| `D:\test2\server\conversations.js` | 新增接口的完整路由模块 |
| `D:\test2\server\server.js` | 引入模块、复用 authenticate、允许 DELETE 的 CORS |
| `D:\test2\server\db.js` | 增加 BIGINT 字符串读取，避免 JavaScript ID 精度丢失 |
| `D:\test2\index.html` | 历史页 HTML、导航和 history.js 脚本引用 |
| `D:\test2\history.js` | 分页、全文展开、确认删除、异步保存的完整原生 JS |
| `D:\test2\styles.css` | 末尾追加历史页 CSS，含移动端适配 |
| `D:\test2\app.js` | 注册 #history、挂载视图、回答成功后的保存调用 |
| `D:\test2\serve.cjs` | 将 history.js 加入公开静态文件白名单 |

后端注册位置在原有 express.json 前面：

```javascript
const { createConversationsRouter } = require('./conversations');

app.use('/api/conversations', (_req, res, next) => {
  res.set('Cache-Control', 'no-store'); next();
}, authenticate, express.json({ limit: '1mb' }), createConversationsRouter({ pool }));
```

这里 authenticate 就是现有 JWT 鉴权函数，没有修改注册、登录、me 的业务逻辑。新接口单独使用 1 MB JSON 上限，以容纳 AI 长回答；原登录注册接口的 16 KB 上限保持原样。

前端脚本顺序为 agent-client.js → history.js → app.js，均使用 defer。现有 ask 调用在 `app.js` 的 `runMessage(target, message)`：

```javascript
// 现有 AgentOS 请求成功后，记录本次要保存的内容：
completedAnswer = { question: message.text, answer: answer.text, model: modelName };

// finally 中先完成原有 renderMessages()，随后追加：
if (completedAnswer) void conversationHistory.save(completedAnswer);
```

只有成功回答会保存；失败、超时不会写入。保存失败提示“回答已显示，但历史保存失败”，不阻塞答案显示。用户切换或退出后，旧请求不会把内容显示到新用户的历史页。

## 数据表

SQL 使用 InnoDB、utf8mb4_general_ci；id/user_id 为 BIGINT，title 为首条问题的前 30 个 Unicode 字符，tokens 本次留 NULL。复合索引为 `(user_id, created_at)`。

现有 users.id 是 INT，新表按需求使用 BIGINT user_id，所以没有建立要求两端类型完全相同的物理外键，也没有修改 users。接口只使用已验证 JWT 的 sub 作为 user_id；请求正文中的 user_id 被忽略。

## API

所有请求都需要 `Authorization: Bearer <token>`。账号 API 基址沿用 `http://127.0.0.1:3000/api`。

- `POST /conversations`：`{ question, answer, model? }`。返回 201：`{ message, conversation: { id, title } }`。
- `GET /conversations?limit=20&offset=0`：返回 `{ items, limit, offset, has_more }`。items 仅含当前用户的 id/title/question 前 100 字/created_at，按时间和 id 倒序排列；limit 为 1–100。
- `GET /conversations/:id`：返回 `{ conversation: { id, title, question, answer, model, tokens, created_at } }`，正文完整。
- `DELETE /conversations/:id`：只删除当前用户的一行，返回 `{ message, id }`。

无 JWT 或失效 JWT 返回 401；其他用户的详情和删除返回 403；不存在返回 404；参数错误返回 400。所有业务 SQL 均使用 mysql2.execute 占位符，列表始终限定当前用户。未实现可选的标题 PATCH。

history.js 用 textContent 展示历史正文，不把 AI 文本作为 HTML 执行。删除前使用 confirm 弹窗；下拉接近列表底部会加载更多，也提供“加载更多”和“刷新记录”按钮。

## 验证步骤

1. MySQL 启动后，在 Navicat 的“运行 SQL 文件”中选择 `D:\test2\sql\init_conversations.sql`，连接端口为 33061，库为 zhixu_ai。脚本可重复执行，不清空旧数据。
2. 保留现有 `D:\test2\server\.env`，无需新增秘密配置。分别启动或重启：

```powershell
cd D:\test2\server
node server.js
```

```powershell
cd D:\test2
node serve.cjs
```

```powershell
cd D:\test2\personal_agent
.\.venv\Scripts\python.exe agentos.py
```

3. 打开 `http://127.0.0.1:4173/#login`，登录或注册自己的账号。
4. 进入智能体对话，发送一个问题并等待 AI 成功回答。
5. 点击侧栏“历史会话”或打开 `http://127.0.0.1:4173/#history`，应看到刚才的问题和时间。
6. 点击标题展开，核对完整问题和回答；刷新网页后记录仍存在。
7. 累积超过 20 条后，下拉或点击“加载更多”验证分页。
8. 删除一条记录时先取消确认，记录应保留；再次点击并确认后，该条记录消失。
9. 退出后直接访问 #history，应跳到 #login。换另一个账号登录后，历史列表不包含上个账号的数据。

可在 Navicat 手动核对自己测试账号的记录，使用带特定 user_id 的查询，不需要导出所有用户数据。

## 自动测试

```powershell
cd D:\test2\server
npm.cmd test
$env:MYSQL_INTEGRATION = '1'
try { npm.cmd run test:mysql } finally { Remove-Item Env:MYSQL_INTEGRATION }
```

测试覆盖注册登录回归、JWT、伪造 user_id、双用户隔离、403/404、分页、Unicode 标题、参数校验和 SQL 参数化。真实数据库测试仅清理它自己生成的测试账号和记录。
