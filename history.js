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
