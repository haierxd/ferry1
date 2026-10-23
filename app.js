'use strict';

// FAQ content is illustrative. Chat responses now come from the JWT-protected RAG API.
const faqs = [
  { id: 'gateway', category: '产品咨询', title: '如何选择适合我们生产线的工业边缘网关？', keywords: '产品选型 网关 联网 协议 生产线', answer: '建议先整理设备清单、通信协议、采集点数、上报频率和部署环境，再确认是否需要本地计算与断网缓存。将这些信息交给技术人员，可更准确地评估适配方案。', source: '产品选型指南' },
  { id: 'trial', category: '产品咨询', title: '产品是否支持试用？如何申请方案演示？', keywords: '试用 演示 申请 联系', answer: '你可以准备公司名称、应用场景和计划验证的功能，向负责对接的销售或技术团队申请演示。试用范围、设备和周期需由双方确认。本页面不直接提交试用申请。', source: '产品选型指南' },
  { id: 'delivery', category: '项目交付', title: '从需求沟通到项目交付，一般包含哪些阶段？', keywords: '交付 项目 安装 验收 流程', answer: '通常可按需求澄清、方案确认、部署实施、联调测试、验收和使用培训来梳理。正式里程碑、交付物与验收标准应以双方确认的项目文件为准。', source: '项目交付说明' },
  { id: 'support', category: '售后服务', title: '设备出现异常时，如何快速获得售后支持？', keywords: '售后服务 维修 故障 联系 异常 断线', answer: '请先记录设备型号、序列号、故障现象、发生时间与近期变更，保留必要的日志或照片，再联系企业指定的售后渠道。若涉及现场安全，应遵循现场操作规程。', source: '服务支持指引' },
  { id: 'data', category: '使用指南', title: '如何更高效地向知识助手提问？', keywords: '提问 使用指南 知识 助手 数据', answer: '一个清晰的问题可以包含「使用场景 + 产品或主题 + 已知条件 + 想得到的结果」。例如：我需要为一条生产线采集设备数据，现有设备支持 Modbus，应先确认哪些选型信息？', source: '知识助手使用指南' },
  { id: 'protocol', category: '产品咨询', title: '不同通信协议的设备，可以统一接入吗？', keywords: '协议 Modbus 接入 数据 产品选型', answer: '可以先评估网关或平台的协议适配能力。请提供设备品牌、型号、协议版本和点表，由技术团队逐项确认兼容性；本演示不对具体设备兼容性作保证。', source: '产品选型指南' },
  { id: 'acceptance', category: '项目交付', title: '项目验收前，需要准备哪些资料？', keywords: '项目交付 验收 文档 资料', answer: '建议核对项目范围、设备清单、部署记录、测试结果、问题闭环记录和培训交接资料。最终资料清单以项目合同及双方确认的验收方案为准。', source: '项目交付说明' },
  { id: 'warranty', category: '售后服务', title: '如何查询设备的服务与保修范围？', keywords: '售后服务 保修 服务 范围', answer: '请提供设备型号、序列号和采购信息，通过企业指定的服务渠道查询。服务期限、保修范围和费用需以合同、订单或正式服务条款为准。', source: '服务支持指引' }
];
const agents = [
  { id: 'knowledge', name: '企业知识助手', subtitle: '企业知识，一问即知', icon: 'spark', color: 'mint', intro: '你好，我是小知。产品、流程、服务支持，你关心的都可以问我。', questions: ['如何选择工业边缘网关？', '项目交付有哪些主要阶段？', '设备异常时如何获得支持？', '怎样才能更高效地提问？'] },
  { id: 'product', name: '产品顾问', subtitle: '懂产品，更懂你的需求', icon: 'cube', color: 'blue', intro: '你好，我是产品顾问。告诉我你的应用场景，一起梳理产品选型需求。', questions: ['工业网关选型需要哪些信息？', '不同协议的设备可以统一接入吗？', '如何申请产品演示？', '为生产线选型前要做哪些准备？'] },
  { id: 'service', name: '服务支持助手', subtitle: '专业支持，及时响应', icon: 'tool', color: 'sand', intro: '你好，我是服务支持助手。一起整理问题信息，让服务沟通更高效。', questions: ['设备出现异常应该如何处理？', '查询保修范围需要哪些资料？', '项目验收前要准备什么？', '如何描述设备故障现象？'] }
];
const topics = [
  { name: '产品与解决方案', note: '产品选型 · 场景应用', icon: 'cube', color: 'mint', category: '产品咨询' },
  { name: '交付与实施', note: '项目流程 · 验收指引', icon: 'file', color: 'blue', category: '项目交付' },
  { name: '服务与支持', note: '问题排查 · 服务指南', icon: 'tool', color: 'sand', category: '售后服务' }
];
const categories = ['全部问题', '产品咨询', '项目交付', '售后服务', '使用指南'];
const conversationStoragePrefix = 'zhixu-agentos-conversations-v1';
const authTokenKey = 'zhixu-auth-token-v1';
const authApiBase = 'http://127.0.0.1:3000/api';
const $ = (selector) => document.querySelector(selector);
const icon = (name, className = 'icon') => `<svg class="${className}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
let authUser = null;
let authPending = true;
let authVersion = 0;
let authExpiresAt = 0;
let authExpiryTimer;
let sessions = [];
let activeId = null;
let activeAgent = 'knowledge';
let category = '全部问题';
let query = '';
let toastTimer;
let displayedReferences = [];
const pendingSessions = new Set();
let agentIds = { knowledge: 'deepseek-agent', product: 'product-agent', service: 'service-agent' };
let connectionState = 'checking';
let modelName = 'RAG';
const createId = () => globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const agentClient = new AgentClient({ userId: 'unauthenticated' });
const conversationHistory = ConversationHistory.create({ apiBase: authApiBase,
  getToken: savedToken, getUser: () => authUser,
  onUnauthorized: () => logout('登录已失效，请重新登录。'), notify: toast });

function savedToken() {
  try { return localStorage.getItem(authTokenKey); } catch { return null; }
}
function sessionStorageKey() { return `${conversationStoragePrefix}:user-${authUser.id}`; }
function showAuthError(page, message) {
  const node = $(`#${page}-error`);
  node.textContent = message; node.hidden = !message;
}
async function authRequest(path, { body, token } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${authApiBase}${path}`, { method: body ? 'POST' : 'GET',
      headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
    let data;
    try { data = await response.json(); }
    catch { throw new Error('账号服务返回了无法识别的响应，请检查 3000 端口服务。'); }
    if (!response.ok) {
      const error = new Error(typeof data.message === 'string' ? data.message : '账号请求失败，请稍后重试。');
      error.status = response.status; throw error;
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('账号服务响应超时，请稍后重试。');
    if (error instanceof TypeError) throw new Error('无法连接账号服务，请确认 3000 端口后端已启动。');
    throw error;
  } finally { clearTimeout(timer); }
}
function setAuthenticated(user, token) {
  if (!user || !Number.isInteger(Number(user.id)) || Number(user.id) < 1 || typeof user.username !== 'string') throw new Error('账号服务返回的用户信息不完整。');
  localStorage.setItem(authTokenKey, token);
  clearTimeout(authExpiryTimer);
  authVersion++; authUser = user; authPending = false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    authExpiresAt = Number(payload.exp) * 1000;
  } catch { authExpiresAt = 0; }
  if (authExpiresAt) authExpiryTimer = setTimeout(() => logout('登录已过期，请重新登录。'), Math.max(0, Math.min(authExpiresAt - Date.now(), 2147483647)));
  agentClient.userId = `user-${user.id}`;
  activeId = null; sessions = loadSessions();
  document.querySelectorAll('[data-user-name]').forEach(n => { n.textContent = user.username; });
  document.querySelectorAll('[data-user-company]').forEach(n => { n.textContent = user.company || '个人空间'; });
  document.querySelectorAll('[data-user-avatar]').forEach(n => { n.textContent = [...user.username][0] || '知'; });
  renderRecent(); renderMessages();
  route(); void checkBackend();
}
function logout(message = '') {
  authVersion++; authUser = null; authPending = false; authExpiresAt = 0;
  clearTimeout(authExpiryTimer);
  try { localStorage.removeItem(authTokenKey); } catch { /* The UI still logs out. */ }
  sessions = []; activeId = null; pendingSessions.clear(); agentClient.userId = 'unauthenticated';
  if ($('#info-dialog').open) $('#info-dialog').close();
  $('#chat-input').value = ''; $('#char-count').textContent = '0 / 1500';
  $('#login-form').reset(); $('#register-form').reset();
  renderRecent(); renderMessages(); location.replace('#login'); route();
  showAuthError('login', message);
}
async function verifyStoredSession() {
  clearTimeout(authExpiryTimer); authExpiresAt = 0;
  const token = savedToken(); const version = ++authVersion;
  authPending = true; authUser = null; route();
  if (!token) { authPending = false; route(); return; }
  try {
    const result = await authRequest('/me', { token });
    if (version !== authVersion || savedToken() !== token) return;
    setAuthenticated(result.user, token);
  } catch (error) {
    if (version !== authVersion) return;
    authPending = false;
    if (error.status === 401) { try { localStorage.removeItem(authTokenKey); } catch { /* No saved token available. */ } }
    route(); showAuthError('login', error.message);
    $('#auth-recheck').hidden = !savedToken();
  }
}
async function submitAuth(kind) {
  const form = $(`#${kind}-form`);
  if (!form.reportValidity()) return;
  showAuthError(kind, '');
  const values = Object.fromEntries(new FormData(form));
  if (kind === 'register' && values.password !== values.confirmPassword) { showAuthError(kind, '两次输入的密码不一致。'); return; }
  if (new TextEncoder().encode(values.password).length > 72) { showAuthError(kind, '密码过长，请控制在 72 字节以内。'); return; }
  const button = $(`#${kind}-submit`); const label = button.innerHTML;
  if (button.disabled) return;
  const version = ++authVersion;
  button.disabled = true; button.textContent = kind === 'login' ? '正在登录…' : '正在创建账号…';
  const body = kind === 'login' ? { identifier: values.identifier.trim(), password: values.password }
    : { username: values.username.trim(), email: values.email.trim(), password: values.password, company: values.company.trim() };
  try {
    const result = await authRequest(`/${kind}`, { body });
    if (version !== authVersion) return;
    if (typeof result.token !== 'string') throw new Error('账号服务未返回登录凭证。');
    setAuthenticated(result.user, result.token); form.reset();
    toast(kind === 'login' ? '登录成功，欢迎回来' : '账号已创建，欢迎使用知序 AI');
  } catch (error) {
    if (version === authVersion) showAuthError(kind, error.name === 'QuotaExceededError' || error.name === 'SecurityError' ? '浏览器禁止保存登录状态，请允许此站点使用本地存储。' : error.message);
  } finally { button.disabled = false; button.innerHTML = label; }
}

function renderConnection() {
  const labels = { checking: 'RAG · 等待首次问答验证', ready: `${modelName} · 服务就绪`,
    unconfigured: '请检查 RAG 后端配置', offline: 'RAG 服务未连接', error: '请求失败，可重试' };
  const label = labels[connectionState];
  $('#backend-status').textContent = `● ${label}`;
  $('#chat-connection-status').innerHTML = `<i class="live-dot"></i> ${label}`;
}
async function checkBackend() {
  if (!authUser) return;
  // RAG readiness is confirmed by the first authenticated /api/ask response.
  // Do not probe AgentOS and incorrectly report the RAG service as offline.
  connectionState = 'checking'; modelName = 'RAG'; renderConnection();
  /* Legacy AgentOS status check, retained for rollback:
  const version = authVersion;
  connectionState = 'checking'; renderConnection();
  try {
    const config = await agentClient.config();
    if (version !== authVersion) return;
    if (config.app !== 'zhixu-agent-os' || !['knowledge', 'product', 'service'].every(role => typeof config.agents?.[role] === 'string')) throw new Error('Unexpected backend configuration');
    agentIds = config.agents;
    modelName = config.model;
    connectionState = config.configured ? 'ready' : 'unconfigured';
  } catch { if (version === authVersion) connectionState = 'offline'; }
  if (version === authVersion) renderConnection();
  */
}

function loadSessions() {
  if (!authUser) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(sessionStorageKey()) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(s => s && typeof s.id === 'string' && typeof s.title === 'string' &&
      ['knowledge', 'product', 'service'].includes(s.agent) && Array.isArray(s.messages) &&
      s.messages.every(m => m && ['user', 'assistant'].includes(m.role) && typeof m.text === 'string' &&
        (m.sources === undefined || Array.isArray(m.sources) && m.sources.every(v => typeof v === 'string'))))
      .slice(0, 30).map(s => ({ ...s, title: s.title.slice(0, 70), messages: s.messages.slice(-100).map(m =>
        m.status === 'pending' ? { ...m, status: 'failed', error: '上次等待被中断，服务可能仍在处理，请稍后检查后重试。' } : m) }));
  } catch { return []; }
}
function persist() {
  if (!authUser) return;
  try { localStorage.setItem(sessionStorageKey(), JSON.stringify(sessions.slice(0, 30))); }
  catch { toast('当前浏览器无法保存记录，会话仍可继续使用'); }
}
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 2800);
}
function renderFaqs() {
  $('#category-tabs').innerHTML = categories.map((item, i) => `<button class="tab" role="tab" aria-selected="${item === category}" tabindex="${item === category ? 0 : -1}" id="tab-${i}" aria-controls="faq-list" data-category="${item}">${item}</button>`).join('');
  $('#faq-list').setAttribute('aria-labelledby', `tab-${categories.indexOf(category)}`);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = faqs.filter(f => (category === '全部问题' || f.category === category) &&
    words.every(word => `${f.title} ${f.keywords} ${f.answer} ${f.category}`.toLowerCase().includes(word)));
  const shown = category === '全部问题' && !query ? matches.slice(0, 5) : matches;
  $('#faq-count').textContent = query ? `${matches.length} 个结果` : '精选问题';
  $('#search-summary').hidden = !query;
  $('#search-summary').innerHTML = query ? `“${escapeHtml(query)}” 的搜索结果<button data-action="clear-search">清除搜索</button>` : '';
  $('#faq-list').innerHTML = shown.length ? shown.map(f => `<details class="faq-item"><summary><span class="question-dot">Q</span><span class="question-label">${f.title}</span><span class="faq-tag">${f.category}</span>${icon('chev')}</summary><div class="faq-answer">${f.answer}<button data-question="${escapeHtml(f.title)}">继续向智能体提问 ${icon('arrow')}</button></div></details>`).join('') : `<div class="empty-state">${icon('search')}<p>暂时没有找到匹配的问题</p><button data-action="ask">把这个问题交给智能体 ${icon('arrow')}</button></div>`;
}
function renderAgents() {
  $('#agent-cards').innerHTML = agents.map(a => `<button class="agent-card" data-agent="${a.id}"><span class="agent-icon ${a.color}">${icon(a.icon)}</span><h3>${a.name}</h3><p>${a.subtitle}</p>${icon('arrow')}</button>`).join('');
  $('#agent-select').innerHTML = agents.map(a => `<button class="agent-option ${a.id === activeAgent ? 'active' : ''}" data-agent="${a.id}" aria-pressed="${a.id === activeAgent}"><span class="agent-icon ${a.color}">${icon(a.icon)}</span><span><strong>${a.name}</strong><small>${a.subtitle}</small></span>${a.id === activeAgent ? icon('check') : ''}</button>`).join('');
  const agent = agents.find(a => a.id === activeAgent);
  $('#active-agent-name').textContent = agent.name;
  $('#agent-intro').textContent = agent.intro;
  $('#chat-input').placeholder = `向${agent.name}提问，让知识为你所用…`;
  $('#chat-suggestions').innerHTML = agent.questions.map(q => `<button class="suggestion" data-question="${escapeHtml(q)}">${q}${icon('arrow')}</button>`).join('');
}
function renderTopics() {
  $('#knowledge-list').innerHTML = topics.map(t => `<button class="knowledge-row" data-topic="${t.category}"><span class="agent-icon ${t.color}">${icon(t.icon)}</span><span><strong>${t.name}</strong><small>${t.note}</small></span>${icon('chev')}</button>`).join('');
}
function renderRecent() {
  $('#recent-list').innerHTML = sessions.length ? sessions.slice(0, 4).map(s => `<button class="recent-item" data-session="${escapeHtml(s.id)}">${escapeHtml(s.title)}</button>`).join('') : '<p class="recent-empty">新的灵感，从一次提问开始</p>';
}
function displayAnswer(text, references = []) {
  if (references.some(ref => ref?.kind === 'full_document')) return String(text ?? '');
  return String(text ?? '')
    .replace(/\[(?:citation_id\s*=\s*)?\d+\]/giu, '')
    .replace(/(?:文件名|来源文件)\s*[：:]\s*[^\r\n，,；;。]+[，,；;]\s*块号\s*[：:]\s*\d+\s*[。.]?/gu, '')
    .replace(/[ \t]+([，。；！？])/gu, '$1')
    .trim();
}
function renderMessages() {
  const session = sessions.find(s => s.id === activeId);
  const messages = session?.messages || [];
  const agent = agents.find(a => a.id === activeAgent);
  $('#chat-welcome').hidden = messages.length > 0;
  $('#messages').innerHTML = messages.map((m, i) => `<article class="message ${m.role}"><span class="message-avatar">${m.role === 'user' ? escapeHtml([...(authUser?.username || '知')][0]) : icon(agent.icon)}</span><div class="message-body"><div class="message-meta">${m.role === 'user' ? '你' : agent.name}<span>${m.role === 'assistant' ? escapeHtml(m.model || modelName) : ''}</span></div><div class="message-text">${escapeHtml(m.role === 'assistant' ? displayAnswer(m.text, m.references) : m.text)}</div>${m.role === 'assistant' ? `<div class="message-actions"><button class="copy-message" data-copy="${i}">${icon('copy')} 复制</button><span>AI 生成 · 请以企业正式资料为准</span></div>` : ''}${m.status === 'failed' ? `<div class="message-error" role="alert"><span>${escapeHtml(m.error || '请求失败，请重试。')}</span><button data-retry="${i}" ${pendingSessions.has(activeId) ? 'disabled' : ''}>重试</button></div>` : ''}</div></article>`).join('');
  const pending = pendingSessions.has(activeId);
  if (pending) $('#messages').insertAdjacentHTML('beforeend', '<div class="typing" role="status">智能体正在思考，请稍候…</div>');
  $('#send-button').disabled = pending;
  $('#chat-input').disabled = pending;
  const latestAnswer = messages.filter(m => m.role === 'assistant').at(-1);
  renderSources(latestAnswer?.references ?? latestAnswer?.sources ?? []);
  requestAnimationFrame(() => { $('#message-scroll').scrollTop = $('#message-scroll').scrollHeight; });
}
function renderSources(references) {
  displayedReferences = references.map(ref => typeof ref === 'string' ? { filename: ref, snippet: '' } : ref)
    .filter(ref => ref && typeof ref.filename === 'string');
  $('#chat-sources').innerHTML = displayedReferences.length ? displayedReferences.map((ref, index) =>
    `<button class="source-card" data-reference-index="${index}">${icon('file')}<span><strong>${escapeHtml(ref.display_filename || ref.filename)}</strong>`
    + `${Number.isInteger(ref.chunk_index) ? `<small>块号${ref.chunk_index}</small>` : ''}`
    + `<small>${escapeHtml(ref.snippet || '旧会话未保存摘要，请重新提问获取。')}</small></span></button>`).join('')
    : '<p class="source-empty">本轮没有可展示的检索引用。</p>';
}
function showRetrievedReference(index) {
  if (!Number.isInteger(index)) return;
  const ref = displayedReferences[index];
  if (!ref) return;
  const label = `${ref.display_filename || ref.filename}${Number.isInteger(ref.chunk_index) ? ` · 块号${ref.chunk_index}` : ''}`;
  showDialog(label, `<p>${escapeHtml(ref.source_path || ref.filename)}</p>`
    + `<p>${escapeHtml(ref.snippet || '旧会话未保存摘要，请重新提问获取。')}</p>`
    + '<div class="dialog-note">摘要取自本轮实际检索块，最多200字；语义相关不等于逐字出处。</div>');
}
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
function openChat(agent = activeAgent, forceNew = false) {
  if (!authUser) { location.replace('#login'); route(); return; }
  if (forceNew || agent !== activeAgent) activeId = null;
  activeAgent = agent;
  renderAgents();
  renderMessages();
  location.hash = 'chat';
  route();
  $('#chat-input').focus();
}
async function runMessage(target, message) {
  if (!authUser || pendingSessions.has(target.id)) return;
  const version = authVersion;
  // let completedAnswer; // Legacy AgentOS history save; /api/ask saves on the server.
  pendingSessions.add(target.id);
  message.status = 'pending'; delete message.error;
  persist(); renderRecent();
  if (activeId === target.id) renderMessages();
  try {
    /* Legacy AgentOS request, retained for rollback:
    const answer = await agentClient.run({ agentId: agentIds[target.agent],
      sessionId: target.id, message: message.text });
    if (version !== authVersion) return;
    message.status = 'sent';
    target.messages.push({ role: 'assistant', text: answer.text, model: modelName, runId: answer.runId });
    connectionState = 'ready';
    completedAnswer = { question: message.text, answer: answer.text, model: modelName };
    */
    const token = savedToken(); // localStorage key: zhixu-auth-token-v1, same as login.
    if (!token) throw new AgentRequestError('登录已失效，请重新登录。', 'UNAUTHORIZED');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 125000);
    let answer;
    try {
      const response = await fetch('/api/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question: message.text, stream: false }), signal: controller.signal
      });
      try { answer = await response.json(); }
      catch { throw new AgentRequestError('RAG 服务返回了无法解析的响应，请检查 3002 服务和代理。', 'INVALID_RESPONSE'); }
      if (!response.ok) {
        throw new AgentRequestError(typeof answer?.message === 'string' ? answer.message : `RAG 请求失败（HTTP ${response.status}）`,
          response.status === 401 ? 'UNAUTHORIZED' : answer?.code || `http_${response.status}`);
      }
      if (typeof answer?.answer !== 'string' || !answer.answer.trim()) {
        throw new AgentRequestError('RAG 服务没有返回有效 answer。', 'EMPTY_ANSWER');
      }
    } finally { clearTimeout(timer); }
    if (version !== authVersion) return;
    const refs = Array.isArray(answer.references) ? answer.references
      : Array.isArray(answer.refs) ? answer.refs : Array.isArray(answer.citations) ? answer.citations : [];
    const references = refs.map(ref => {
      if (typeof ref === 'string') return { filename: ref, snippet: '' };
      if (!ref || typeof ref !== 'object') return null;
      const filename = ref.filename || ref.file || ref.source_path;
      if (typeof filename !== 'string') return null;
      return { filename, source_path: typeof ref.source_path === 'string' ? ref.source_path : '',
        kind: ref.kind === 'full_document' ? 'full_document' : undefined,
        display_filename: typeof ref.display_filename === 'string' ? ref.display_filename : filename,
        citation_label: typeof ref.citation_label === 'string' ? ref.citation_label : '',
        chunk_index: ref.chunk_index, doc_id: ref.doc_id, score: ref.score,
        snippet: typeof ref.snippet === 'string' ? Array.from(ref.snippet).slice(0, 200).join('') : '',
        exact_match: ref.exact_match === true };
    }).filter(Boolean);
    const sources = references.map(ref => `${ref.display_filename || ref.filename}${Number.isInteger(ref.chunk_index) ? ` · 块号${ref.chunk_index}` : ''}`);
    modelName = typeof answer.model === 'string' ? answer.model : 'RAG';
    message.status = 'sent';
    target.messages.push({ role: 'assistant', text: answer.answer, model: modelName, sources, references,
      retrievedCount: Number.isInteger(answer.retrieved_count) ? answer.retrieved_count : references.length,
      conversationId: answer.conversation_id });
    connectionState = 'ready';
  } catch (error) {
    if (version !== authVersion) return;
    message.status = 'failed';
    message.error = error instanceof AgentRequestError ? error.message
      : error.name === 'AbortError' ? 'RAG 请求超时，请稍后重试。' : '无法连接 RAG 服务，请检查 3002 后端和代理。';
    connectionState = 'error';
    if (error.code === 'UNAUTHORIZED') { logout(message.error); return; }
  } finally {
    if (version !== authVersion) return;
    pendingSessions.delete(target.id);
    target.updated = Date.now();
    persist(); renderRecent(); renderConnection();
    if (activeId === target.id) renderMessages();
    // if (completedAnswer) void conversationHistory.save(completedAnswer);
    // RAG already saved this complete answer in MySQL; do not insert it a second time.
  }
}
function sendMessage(value) {
  if (!authUser) { location.replace('#login'); route(); return; }
  const text = value.trim();
  if (Array.from(text).length > 1500) { toast('问题请控制在1500字以内。'); return; }
  if (!text || pendingSessions.has(activeId)) return;
  let session = sessions.find(s => s.id === activeId);
  if (!session) {
    const id = createId();
    session = { id, title: text.slice(0, 40), agent: activeAgent, messages: [], updated: Date.now() };
    sessions.unshift(session);
    sessions = sessions.slice(0, 30);
    activeId = session.id;
  }
  const message = { role: 'user', text };
  session.messages.push(message);
  session.updated = Date.now();
  sessions = [session, ...sessions.filter(s => s.id !== session.id)];
  $('#chat-input').value = '';
  $('#char-count').textContent = '0 / 1500';
  // Capture this session so an in-flight reply never enters a different chat.
  void runMessage(session, message);
}
function ask(question) {
  if (pendingSessions.has(activeId)) openChat(activeAgent, true); else openChat();
  sendMessage(question);
}
function showDialog(title, html) {
  $('#dialog-title').textContent = title;
  $('#dialog-content').innerHTML = html;
  $('#info-dialog').showModal();
}
function closeMenu() {
  $('#sidebar').classList.remove('open');
  $('#backdrop').classList.remove('open');
  $('#menu-toggle').setAttribute('aria-expanded', 'false');
}
function filterTopic(topic) {
  category = topic;
  query = '';
  $('#search-input').value = '';
  location.hash = 'qa'; route(); renderFaqs();
  requestAnimationFrame(() => $('.faq-panel').scrollIntoView({ behavior: 'smooth', block: 'start' }));
}
const actions = {
  logout: () => logout(),
  reconnect: () => { void checkBackend(); },
  new: () => { $('#chat-input').value = ''; $('#char-count').textContent = '0 / 2000'; openChat(activeAgent, true); },
  ask: () => { if (query) ask(query); else openChat(); },
  'clear-search': () => { query = ''; $('#search-input').value = ''; renderFaqs(); $('#search-input').focus(); },
  help: () => showDialog('欢迎使用知序 AI', '<span class="dialog-label">01 / 客户问答</span><p>此页仍为示例常见问题，可以搜索分类，或进入智能体继续提问。</p><span class="dialog-label">02 / 智能体对话</span><p>三种助手均使用真实 DeepSeek 服务。Enter 发送，Shift + Enter 换行；失败时可以重试。顶部星形按钮可重新检查服务连接。</p><span class="dialog-label">03 / 会话记录</span><p>左侧记录保存在当前浏览器，连续对话上下文由本地后端 SQLite 保存。Ctrl / ⌘ + K 新建会话。</p><div class="dialog-note">企业知识库和正式账号权限尚未接入。AI 回答没有企业文档检索依据，请以公司正式资料为准。</div>'),
  knowledge: () => showDialog('探索知识专题', `${topics.map(t => `<button class="dialog-row" data-topic="${t.category}"><span class="agent-icon ${t.color}">${icon(t.icon)}</span><span>${t.name}<small style="display:block;color:#99a49c">${t.note}</small></span>${icon('arrow')}</button>`).join('')}<div class="dialog-note">专题使用示例问答，未自动解析工作区内的企业文件。</div>`),
  history: () => { location.hash = 'history'; route(); }
};

document.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.closest('#auth-pages')) return;
  if (!authUser) { route(); return; }
  const d = button.dataset;
  if (d.action && actions[d.action]) actions[d.action]();
  if (d.category) { category = d.category; renderFaqs(); $(`[data-category="${category}"]`).focus(); }
  if (d.search) { query = d.search; category = '全部问题'; $('#search-input').value = query; renderFaqs(); }
  if (d.question) ask(d.question);
  if (d.retry !== undefined) {
    const session = sessions.find(s => s.id === activeId);
    const message = session?.messages[Number(d.retry)];
    if (session && message?.role === 'user' && message.status === 'failed') void runMessage(session, message);
  }
  if (d.agent) { openChat(d.agent, d.agent !== activeAgent); }
  if (d.topic) { if ($('#info-dialog').open) $('#info-dialog').close(); filterTopic(d.topic); }
  if (d.session) {
    const session = sessions.find(s => s.id === d.session);
    if (session) { activeId = session.id; activeAgent = session.agent; if ($('#info-dialog').open) $('#info-dialog').close(); openChat(); }
  }
  if (d.referenceIndex !== undefined) showRetrievedReference(Number(d.referenceIndex));
  if (d.source) showDialog(d.source, '<p>旧会话只保存了来源名称，请重新提问获取真实检索摘要。</p>');
  if (d.copy !== undefined) {
    const message = sessions.find(s => s.id === activeId)?.messages[Number(d.copy)];
    if (message) {
      const text = message.role === 'assistant' ? displayAnswer(message.text, message.references) : message.text;
      try { await navigator.clipboard.writeText(text); toast('回答已复制'); }
      catch { showDialog('复制回答', `<p>浏览器未允许自动复制，请手动选择下方文字。</p><p style="white-space:pre-wrap;user-select:text">${escapeHtml(text)}</p>`); }
    }
  }
});
$('#category-tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  let index = categories.indexOf(category);
  index = event.key === 'Home' ? 0 : event.key === 'End' ? categories.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + categories.length) % categories.length;
  category = categories[index]; renderFaqs(); $(`#tab-${index}`).focus();
});
$('#search-form').addEventListener('submit', event => { event.preventDefault(); query = $('#search-input').value.trim(); category = '全部问题'; renderFaqs(); });
$('#search-input').addEventListener('input', () => { query = $('#search-input').value.trim(); renderFaqs(); });
$('#chat-form').addEventListener('submit', event => { event.preventDefault(); sendMessage($('#chat-input').value); });
$('#chat-input').maxLength = 1500;
$('#char-count').textContent = '0 / 1500';
$('#chat-input').addEventListener('input', () => { $('#char-count').textContent = `${$('#chat-input').value.length} / 1500`; });
$('#chat-input').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); sendMessage($('#chat-input').value); } });
$('#menu-toggle').addEventListener('click', () => { const open = $('#sidebar').classList.toggle('open'); $('#backdrop').classList.toggle('open', open); $('#menu-toggle').setAttribute('aria-expanded', String(open)); });
$('#backdrop').addEventListener('click', closeMenu);
$('#close-dialog').addEventListener('click', () => $('#info-dialog').close());
$('#info-dialog').addEventListener('click', event => { if (event.target === $('#info-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
$('#export-chat').addEventListener('click', () => {
  if (!authUser) return;
  const session = sessions.find(s => s.id === activeId);
  if (!session?.messages.length) { toast('先开始一段对话，再导出记录'); return; }
  const text = `知序 AI · 智能体会话\n智能体：${agents.find(a => a.id === session.agent).name}\n\n${session.messages.map(m => `${m.role === 'user' ? '你' : '助手'}：\n${m.text}${m.status === 'failed' ? '\n[发送失败：' + m.error + ']' : ''}`).join('\n\n')}\n\nAI 回答仅供参考，请以企业正式资料为准。`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = '知序AI-智能体会话.txt'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); toast('会话记录已导出');
});
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if ($('#info-dialog').open) $('#info-dialog').close(); actions.new(); } if (event.key === 'Escape') closeMenu(); });
window.addEventListener('hashchange', route);
window.addEventListener('storage', event => {
  if (event.key === authTokenKey || event.key === null) {
    sessions = []; activeId = null; pendingSessions.clear();
    renderRecent(); renderMessages(); void verifyStoredSession();
  }
});
$('#login-form').addEventListener('submit', event => { event.preventDefault(); void submitAuth('login'); });
$('#register-form').addEventListener('submit', event => { event.preventDefault(); void submitAuth('register'); });
$('#auth-recheck').addEventListener('click', () => { void verifyStoredSession(); });
renderFaqs(); renderAgents(); renderTopics(); renderRecent(); renderMessages(); route();
void verifyStoredSession();
