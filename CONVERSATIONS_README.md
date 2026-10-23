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
