# AgentOS 前后端对接计划

**Goal:** 将已验收的聊天界面对接 personal_agent 中的 DeepSeek，并验证连续对话。

**Architecture:** 浏览器调用前端同源 `/api`；Node 将白名单 API 转发至 127.0.0.1:7777 的原生 AgentOS。AgentOS 注册三种角色，使用同一 DeepSeek 模型与本地 SQLite 持久化历史。浏览器复用稳定 user_id 和每段会话的 session_id。

**Tech Stack:** 现有 HTML/CSS/JS、Node 内置 HTTP、personal_agent/.venv 中的 Agno 3.1.7、DeepSeek、SQLite。

## Constraints

- 保留已验收界面；仅替换演示对话与相关状态提示。
- 密钥仅由后端从 personal_agent/.env 或进程环境读取，不传入网页。
- 企业资料/RAG 尚未接入；不得展示虚假的检索来源。
- 服务只监听本地；已有进程或数据不删除、不覆盖。

## Steps

- [x] 用 unittest/TestClient 和 Node test 写接口协议、会话延续、错误状态与代理隔离测试，确认新功能未实现时失败。
- [x] 实现可安全导入的智能体工厂、AgentOS 服务、配置与 SQLite 历史。
- [x] 实现同源代理和浏览器请求客户端；替换定时演示回复，加入连接状态、错误与重试。
- [x] 提供手动双终端启动说明与真实两轮对话 smoke_test.py，复用现有 uv 环境。
- [ ] 跑自动化检查和真实 DeepSeek 两轮会话，再通过网页验证端到端。

## Review focus

请求失败不得回落为演示答案；切换会话期间的回复不得串入另一会话；新会话必须拥有新 session_id；本地存储禁用时仍可工作；未知代理路径和 .env 不可通过静态服务读取；Agno 的 failed 状态不得当作正常回复。

## Handoff

2026-10-21：7 个 Node 测试及 5 个 Python 集成测试通过，语法检查通过。前端 4173 与后端 7777 的健康接口均返回 200，但实际服务返回 configured=false，真实模型联调尚未通过。此前文本正则检查因允许跨行空白，可能把下一条配置误认为密钥值，因此已改以 dotenv 解析和服务健康状态为准。用户选择自行进行真实测试，启动与排查命令见 WEB-README.md。
