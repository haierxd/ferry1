# 知序 AI · 企业智能问答

前端采用原生 HTML + CSS + JavaScript，无前端依赖和构建步骤。智能体对话已对接 `personal_agent` 中的 Agno AgentOS + DeepSeek；后端复用该目录的 uv 虚拟环境。

请通过 `node serve.cjs` 访问网页，不能直接以 `file://` 打开 HTML 使用智能体对话。前端地址：http://127.0.0.1:4173/#chat 。

Figma：https://www.figma.com/design/ntJeQTHcY2tMN4PjyDHAQg

## 功能

客户问答、即时搜索、分类筛选、折叠答案、知识专题；三种真实 DeepSeek 角色智能体、推荐提问、新建会话、历史恢复、复制和导出、请求失败与重试；桌面与手机适配、输入法发送保护、分类键盘导航。

`index.html` 是页面结构，`styles.css` 是视觉样式与响应式布局，`app.js` 是页面交互，`agent-client.js` 是 AgentOS 请求客户端，`serve.cjs` 只提供静态文件和白名单 API 转发。`design/` 保存 Figma 制作记录和页面预览。

## 启动与联调

在第一个 PowerShell 终端运行后端：

```powershell
cd D:\test2\personal_agent
.\.venv\Scripts\python.exe agentos.py
```

后端固定读取此目录 `.env` 中的 `DEEPSEEK_API_KEY`，只需填写保存一次，以后启动自动复用，不会重写文件。文件中的非空值优先于终端环境变量；未配置文件值时才使用进程环境变量。修改后需要重启后端。现有环境已经安装所需依赖；重新建立环境时在此目录运行 `uv sync`。

`agent.py`、`personal_agent/agent.py` 和后端服务启动时均不会自动发起模型请求。只有发送聊天问题，或手动运行下面的真实模型测试时才会调用 DeepSeek。

在第二个终端运行前端：

```powershell
cd D:\test2
node serve.cjs
```

浏览器访问 http://127.0.0.1:4173/#chat ，API 文档为 http://127.0.0.1:7777/docs 。两个终端分别按 Ctrl+C 停止。若端口已占用，先停止对应的旧测试服务，不要终止不明进程。

可选真实模型测试（会发起两次 DeepSeek 请求）：

```powershell
cd D:\test2
.\personal_agent\.venv\Scripts\python.exe personal_agent\smoke_test.py
```

成功应显示 `PASS`，验证代理、AgentOS、真实模型回复及连续对话。若显示密钥为空，请检查实际保存的 `.env`，或在启动后端的同一终端先执行 `$env:DEEPSEEK_API_KEY='你的密钥'` 再启动。不要将密钥发到聊天或提交 Git。

## 当前范围

智能体使用真实模型。客户问答页仍为静态示例；企业知识检索和正式账号权限尚未接入，不会读取或上传工作区企业文件。智能体不能声称已检索真实企业资料，也不会显示虚构引用。

浏览器会话列表通过 localStorage 保留，最多持久化 30 段；模型上下文保存在 `personal_agent/data/agentos.db` 中，复用 user_id 和 session_id 即可延续。三个角色拥有不同后端 ID 与系统指令。旧版演示聊天记录与真实聊天使用不同存储键，旧记录不会显示为真实回答。

## 请求链路

浏览器 POST `/api/agents/{agent_id}/runs` → Node 转发到 7777 端口的 `/agents/{agent_id}/runs` → AgentOS 调用 DeepSeek。参数使用 multipart/form-data，包含 message、user_id、session_id、stream=false。模型密钥不进入前端。

角色 ID：企业知识助手 `deepseek-agent`、产品顾问 `product-agent`、服务支持助手 `service-agent`。服务仅绑定本地地址，尚未加入部署所需的登录鉴权与用户权限隔离。

## 验证

```powershell
node --test tests/agent-client.test.cjs tests/server.test.cjs
.\personal_agent\.venv\Scripts\python.exe -m unittest discover -s personal_agent/tests -v
```

目前 7 个 Node 测试和 5 个 Python 集成测试通过。Python 测试运行真实 AgentOS 和 SQLite，仅替换收费模型的网络响应；它们不能代替真实密钥的端到端验证。真实联调用上面的 smoke_test.py 和网页进行。

Figma 包含两个桌面页面、可复用组件和语义颜色变量，使用原生文字、矢量图层及 Auto Layout，未将整页截图用作设计图层。
