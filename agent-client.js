/* Browser/Node shared client for the native AgentOS run API. No credentials here. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(globalThis, function () {
  'use strict';
  class AgentRequestError extends Error {
    constructor(message, code = 'request_failed') { super(message); this.name = 'AgentRequestError'; this.code = code; }
  }
  class AgentClient {
    constructor({ userId, baseUrl = '/api', fetchImpl = globalThis.fetch.bind(globalThis), timeoutMs = 120000 } = {}) {
      this.userId = userId;
      this.baseUrl = baseUrl.replace(/\/$/, '');
      this.fetch = fetchImpl;
      this.timeoutMs = timeoutMs;
    }
    async request(path, options = {}) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetch(`${this.baseUrl}${path}`, { ...options, signal: controller.signal });
        if (!response.ok) {
          let code;
          try { code = (await response.json()).code; } catch { /* Do not display raw provider/HTML errors. */ }
          if (code === 'missing_api_key') throw new AgentRequestError('后端尚未配置 DeepSeek 密钥，请配置后重启服务。', code);
          const messages = {
            401: '模型认证失败，请检查后端 DeepSeek 密钥配置。',
            402: '模型账户余额不足，请检查 DeepSeek 账户。',
            403: '当前请求没有访问权限，请检查服务配置。',
            404: '智能体接口不存在，请确认已启动最新版后端。',
            422: '请求参数不符合接口要求，请刷新网页后重试。',
            429: '模型服务繁忙或触发限流，请稍后重试。',
            502: '模型服务暂时不可用，请稍后重试。',
            503: '无法连接智能体后端，请确认 AgentOS 服务已启动。',
            504: '模型响应超时，请稍后重试。',
          };
          throw new AgentRequestError(messages[response.status] || '智能体请求失败，请检查后端日志后重试。', code || `http_${response.status}`);
        }
        try { return await response.json(); }
        catch { throw new AgentRequestError('后端返回了无法识别的响应，请检查服务地址。', 'invalid_response'); }
      } catch (error) {
        if (error instanceof AgentRequestError) throw error;
        if (controller.signal.aborted) throw new AgentRequestError('等待模型回复超时。服务可能仍在处理，请稍后检查会话再重试。', 'timeout');
        throw new AgentRequestError('连接中断，请检查网络与本地服务后重试。', 'network_error');
      } finally { clearTimeout(timer); }
    }
    config() { return this.request('/config'); }
    async run({ agentId, sessionId, message }) {
      if (!agentId || !sessionId || !this.userId || !message?.trim()) throw new AgentRequestError('缺少提问内容或会话信息，请刷新后重试。', 'invalid_input');
      const body = new FormData();
      body.set('message', message); body.set('session_id', sessionId);
      body.set('user_id', this.userId); body.set('stream', 'false');
      const result = await this.request(`/agents/${encodeURIComponent(agentId)}/runs`, { method: 'POST', body });
      if (result.session_id && result.session_id !== sessionId) throw new AgentRequestError('后端返回的会话不匹配，已停止显示此回答。', 'session_mismatch');
      if (result.status && !['COMPLETED', 'completed'].includes(result.status)) throw new AgentRequestError('智能体本次运行未成功完成，请稍后重试。', 'run_failed');
      if (typeof result.content !== 'string' || !result.content.trim()) throw new AgentRequestError('模型未返回有效回答，请稍后重试。', 'empty_response');
      return { text: result.content, runId: result.run_id, sessionId: result.session_id || sessionId };
    }
  }
  return { AgentClient, AgentRequestError };
});
