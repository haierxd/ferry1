# v-api 嵌入 pgvector 检索与 MySQL 会话

本项目位于 `D:\test2\rag-vapi`，要求 Node.js 20.19+、已安装 pgvector 的 PostgreSQL，以及 MySQL 5.7+/8.0。
使用 `pg`、`mysql2`、`openai` SDK、Express、JWT 和 dotenv，不使用 LangChain、LlamaIndex 等 RAG 框架。

## 方案与文件清单

入库：递归读取 `KNOWLEDGE_DIR` 内 UTF-8 的 `.md/.txt` → 按 `#` / `##` 分章节 → 400–800 字分块 → **v-api embeddings** → PG `vector(1536)`。

问答：验证登录 JWT 及 MySQL 用户 → 用**同一个 v-api 嵌入模型**向量化问题 → pgvector 余弦 top-5 → 独立的 **v-api 聊天模型**回答 → 完整结果写入 MySQL `conversations`。

```text
rag-vapi/
├─ package.json / package-lock.json
├─ .env.example
├─ pgvector.sql                  # 向量扩展、知识表、模型配置、HNSW
├─ mysql.sql                     # 用户及会话表；兼容现有项目字段
├─ server.js                     # HTTP 服务、限流、错误处理、启动校验
├─ lib/
│  ├─ config.js / db.js           # 配置、PG/MySQL 连接池
│  ├─ vapi.js / embeddings.js     # OpenAI SDK 自定义 baseURL；嵌入校验
│  ├─ chunk.js                   # 标题和字数分块
│  ├─ ingestion.js               # 每文件原子替换入库
│  ├─ profile.js                 # 模型、维度、接口地址一致性校验
│  ├─ retrieve.js                # 参数化余弦检索、来源目录过滤
│  ├─ auth.js / prompt.js / errors.js
├─ routes/ask.js                 # JSON / SSE 问答及会话保存
├─ scripts/
│  ├─ ingest.js                  # 批量入库入口
│  ├─ init-db.js                 # 建表及现有 MySQL 增量迁移
│  ├─ prepare-knowledge.js       # 可选：本地复制已有 Markdown，不联网
│  └─ export-source.js           # 汇总完整源码，排除密钥及依赖目录
├─ tests/                        # node:test 测试
├─ COMPLETE_SOURCE.md            # 方案、运行步骤与全部源码
└─ IMPLEMENTATION_PLAN.md
```

API 密钥只存在于服务端环境变量，不入 PG/MySQL，不返回给前端，不输出 SDK 完整错误。
代码没有把文件导入 Codex 作为向量，也没有本地生成替代向量；实际向量由显式配置的 v-api 接口生成。

## 本地运行顺序

### 1 安装或启用 pgvector

PostgreSQL 服务端必须先安装 pgvector 扩展文件，只有执行 `CREATE EXTENSION` 不会自动下载扩展。
已有 PostgreSQL 可按 [pgvector 官方安装说明](https://github.com/pgvector/pgvector#installation) 安装；HNSW 需要 pgvector 0.5+。
也可使用预装 pgvector 的独立 Docker 容器（本项目没有启动或改动任何现有容器）：

```powershell
# 仅示例：先设置一个仅供本地测试的临时数据库密码变量，不要把真实密码写进源码。
$env:PG_DEMO_PASSWORD = 'replace-with-a-local-test-password'
docker run --name rag-pg -e "POSTGRES_PASSWORD=$env:PG_DEMO_PASSWORD" -e POSTGRES_DB=rag_kb -p 127.0.0.1:5433:5432 -d pgvector/pgvector:pg17
```

该示例对应 `.env` 中 `PG_HOST=127.0.0.1`、`PG_PORT=5433`、`PG_DB=rag_kb`、`PG_USER=postgres`，密码自行填写。
正式部署应使用自己的持久化存储、备份和权限配置。使用已有实例时，先由管理员创建专用数据库 `rag_kb`。
MySQL 数据库需要预先存在；连接账号需要对目标表拥有相应权限。建议沿用已有 `zhixu_ai` 用户库。

### 2 安装依赖并配置环境

```powershell
cd D:\test2\rag-vapi
npm ci

# 仅当 .env 不存在时复制，避免覆盖已配置密钥。
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

在本机编辑 `.env`，填写 v-api 和两类数据库配置。不要把真实 `.env` 发到聊天或提交 Git。
环境变量优先于 `.env`。`.env` 路径固定为本项目目录，不会加载其他项目的 `.env`。

`VAPI_BASE_URL` 必须是 **v-api 控制台给出的 OpenAI 兼容 API 地址，包含 `/v1`，不能重复写 `/embeddings`**。
SDK 会在它后面追加 `/embeddings` 或 `/chat/completions`。不提供地址就报错，不会回退到 OpenAI 地址；代码显式拒绝直连 OpenAI 域名。
`VAPI_EMBEDDING_MODEL` 默认为 `text-embedding-3-small`，如果 v-api 要求供应商前缀，填写控制台的完整调用名。
`VAPI_CHAT_MODEL` 单独填写控制台可用的聊天模型，例如 `deepseek-chat`；不能用嵌入模型做聊天。

JWT 验证固定为 HS256，并验证有效期、issuer、audience；用户 ID 取自 JWT 的数字字符串 `sub`。
默认 issuer/audience 与已有 `D:\test2\server` 登录服务一致：`zhixu-ai-auth` / `zhixu-ai-web`。
在本机手动配置相同的 `JWT_SECRET`、issuer、audience；不要把 JWT_SECRET 当作 v-api API Key。
本服务还会查询 MySQL `users` 表，拒绝已删除用户。不提供公开的 token 签发接口；请使用已有登录接口取得 token。

### 3 建表

数据库管理员可先在目标 PG 库执行：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

然后执行本项目建表脚本（内部同样包含幂等的扩展启用语句）：

```powershell
npm run init:pg

# 新库/新表：建 users、conversations，并补齐 RAG 会话列。
npm run init:mysql

# 若已有项目的 users/conversations，改为仅执行增量迁移：
npm run migrate:mysql
```

`pgvector.sql` 中包括 `kb_settings`、`kb_documents`、`kb_chunks`，`embedding vector(1536)`、余弦 HNSW 索引和 `(source_path, chunk_index)` 唯一约束。
`CREATE TABLE IF NOT EXISTS` 不会迁移已有的向量列或模型。
MySQL 增量迁移只补充 `citations`、`response_id`、`response_model`，必要时将原 `model VARCHAR` 扩到 255；保留已有行和其他字段。
MySQL DDL 会自动提交，迁移失败请按错误修正权限后重跑。

### 4 准备 Markdown 并入库

默认目录是 `D:\test2\docs\甲方资料`，不会直接读取原始 Word/PDF 或 Excel。
可手动把可发布的 `.md/.txt` 放进去，也可以从前面转换出的 `markdown_output` 本地复制：

```powershell
# 可选，仅复制本地文件，不调用 API，不覆盖已存在文件。
node scripts/prepare-knowledge.js

# 真正的向量化入库；这一步会向 v-api 发送资料文本。
node scripts/ingest.js
```

分块优先按一级/二级标题划分；代码围栏中的 `#` 不作为标题。
长章节按 400–800 个 Unicode 字符拆分，并优先在句末/换行处分界。短章节和短尾块允许少于 400 字，不跨章节强行凑长度。
每块最多 800 字；UTF-8 最多约 3200 字节，并在嵌入前额外限制每个输入最多 7500 字节，保守留在所要求的 8K 上下文以内。
文件必须是 UTF-8；无效编码/NUL 会明确报错。目录内符号链接不跟随，并打印跳过信息。

每个文件先完成全部嵌入，再开启短事务：锁定配置 → upsert 文档 → 删除该文件旧块 → 插入全部新块 → 提交。
重跑会重新调用嵌入并完整替换，不会重复增加同文件的块；文件缩短后旧尾块也会删除。
嵌入失败不删除旧块，事务失败回滚保留旧版本。空文件会更新文档记录并清除旧块。
每个文件及嵌入批次打印进度、失败类型；有文件失败时最终退出码为 1，其他文件继续处理。
脚本不自动删除已从磁盘移除的文件对应的历史向量，删除知识需另外按受控流程处理。

### 5 启动

```powershell
node server.js
```

默认监听 `http://127.0.0.1:3002`。启动会检查向量列类型、入库模型配置和 MySQL 必要列。
`GET /health` 仅表示 HTTP 进程存活，不代表每个下游服务随时可用。
本实现不自动开放跨域；浏览器部署时通过同源反向代理转发 `/api/ask`。

### 6 调用 /api/ask

在另一个 PowerShell 窗口，通过已有登录流程获取自己的 JWT，仅保存在本地变量中：

```powershell
$token = '<登录服务返回的JWT，仅本地使用>'
$headers = @{ Authorization = "Bearer $token" }
$body = @{ question = '采购金额20000元由谁审批？'; topK = 5 } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3002/api/ask' -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
```

请求体仅包含业务参数，不能传 `user_id`，不能指定/覆盖模型：

```json
{
  "question": "采购金额20000元由谁审批？",
  "topK": 5,
  "directory": "01_Word制度与培训",
  "stream": false
}
```

`directory` 可省略；它是 `KNOWLEDGE_DIR` 内的相对目录，不能用 `..` 越界。
默认 top-5，`topK` 范围 1–20。问题最多 1500 字，嵌入前同样校验输入。
所有已认证用户共享这个知识目录；目录过滤是来源过滤，不是租户/部门授权。

响应字段示例：

```json
{
  "conversation_id": "123",
  "answer": "……[1]，章程.md，块号2",
  "model": "实际配置的VAPI_CHAT_MODEL",
  "response_model": "上游响应的模型标识或null",
  "response_id": "上游响应ID或null",
  "citations": [
    { "citation_id": 1, "file": "章程.md", "source_path": "D:/test2/docs/甲方资料/章程.md", "chunk_index": 2, "doc_id": "7", "score": 0.91 }
  ]
}
```

`score` 是余弦相似度，不是概率或业务可信度；检索结果未必与问题相关。
未命中任何块时不调用聊天模型，返回明确的无依据说明并记录会话。
有候选块时，提示模型只基于上下文回答、不足时说明不确定，并附编号、文件名及块号；仍需评估实际回答质量。

### SSE 调用

同一接口设置 `stream: true` 即返回 SSE，依次发送 `context`、`delta`、`done` 或 `error`。
只有收到 **done** 才表示正常完成且已写入 MySQL；`delta` 只是展示中的临时文本。
不能用浏览器 `EventSource` 直接代替，因为该请求需要 POST JSON 和 Authorization；应使用 `fetch` 读取流。

```javascript
const response = await fetch('/api/ask', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ question: '设备联网案例的采样周期是多少？', stream: true })
});
if (!response.ok) throw new Error(await response.text());
const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
let buffer = '';
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += value;
  let end;
  while ((end = buffer.indexOf('\n\n')) !== -1) {
    const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
    const lines = frame.split('\n');
    const event = lines.find(s => s.startsWith('event: '))?.slice(7);
    const data = JSON.parse(lines.filter(s => s.startsWith('data: ')).map(s => s.slice(6)).join('\n'));
    if (event === 'delta') console.log(data.text); // 页面上使用 textContent，勿直接 innerHTML
    if (event === 'done') console.log('完整答案已保存', data.conversation_id);
    if (event === 'error') console.error(data.code, data.message);
  }
}
```

服务端完整累积流，收到 `finish_reason=stop` 后才保存 MySQL。
上游断流、缺少结束标识、输出截断、空答案或客户端在生成时断开，都不会保存部分答案。
MySQL 失败会明确报错；SSE 不发送 `done`。数据库提交与浏览器收到 `done` 无法组成跨网络原子事务，提交后的极晚断线可能已保存但客户端未收到确认；本实现没有自动重试/跨请求去重。

## 检索 SQL 与一致性要求

核心查询使用参数，不把问题、目录、topK 拼进 SQL：

```sql
SELECT c.chunk_text, 1 - (c.embedding <=> $1::vector) AS score,
       c.source_path, c.chunk_index, c.doc_id::text AS doc_id
FROM public.kb_chunks c JOIN public.kb_documents d ON d.id = c.doc_id
WHERE d.embedding_model = $3 AND d.embedding_dim = $4
  AND left(c.source_path, char_length($5)) = $5
ORDER BY c.embedding <=> $1::vector
LIMIT $2;
```

入库和检索必须使用**同一 v-api 嵌入模型调用名、同一维度**，否则结果无效。
`kb_settings` 额外校验 v-api baseURL；换代理地址也要明确迁移，不能在原库里悄悄混用。
每批嵌入检查条数和索引，每条检查维度、有限值和非零向量。
默认不发送可选 `dimensions` 请求参数，避免代理兼容问题；始终检查真实返回维度。
一旦返回非 1536 维，明确报错：**检查 v-api 模型/调用名、重建向量列或新表隔离、重跑 ingest**。
禁止仅修改 `.env` 维度后继续查询。本版 schema、配置校验及向量校验固定 1536；采用其他维度需要同步修改这些代码并重建新表/新库及重跑全部入库。

HNSW 为近似检索；严格目录过滤下可能返回少于 topK 条。小知识库可使用精确扫描，大库按 pgvector 官方说明调整 `ef_search`、迭代扫描或索引布局。
移动知识根目录后需重新入库，因为 `source_path` 保存规范化的绝对路径。

## 模型属性参考与资料保密

参考链接 [https://gpt.ge/models/text-embedding-3-small](https://gpt.ge/models/text-embedding-3-small) **仅作模型属性参考**，用于说明 text-embedding-3-small 的约 8K 输入上下文及默认 1536 维；不是本代码的调用地址，也不能证明你的 v-api 账号已开通该调用名。
本次无法取得该参考页正文，代码按本次需求实现并以 v-api 实际响应做硬校验。

**代码走 v-api；若 v-api 返回维度非1536/调用名不同，按 v-api 文档调整并重建向量列/重跑入库；甲方资料会经 v-api 向量化并作为问答上下文，注意保密/出网/内网策略。**

入库会发送资料块到 v-api；问答会发送用户问题用于嵌入，并把命中的资料块和问题发送给 v-api 聊天模型。
API Key 只保存在服务端环境变量；JWT 只用于本服务认证，不转发给 v-api。
日志只输出自有错误说明及允许的错误码，不打印完整第三方响应、数据库 SQL 参数、问题正文或令牌。

## 验证与运行边界

```powershell
npm test
```

自动测试覆盖分块、维度错误、SDK baseURL 路由、模型隔离、参数化检索、配置不一致、文件替换事务、JWT、SSE 正常完成与错误不落库。
测试中的 v-api 是本机 HTTP 模拟接口，PG/MySQL 是可控替身；**不等于已完成真实 v-api 与数据库联调**。
本次未读取现有真实 `.env`，未执行真实入库、建表或账号迁移，也未改动原 `server` 登录服务。
本地还需由你填好 `.env`，安装/启用 pgvector、建表、确认资料的出网授权后，按上述顺序运行。

完整源码可见 `COMPLETE_SOURCE.md`；运行 `node scripts/export-source.js` 可重新生成。
技术参考：[pgvector](https://github.com/pgvector/pgvector)、[OpenAI Node SDK](https://github.com/openai/openai-node)、[mysql2 prepared statements](https://sidorares.github.io/node-mysql2/docs/documentation/prepared-statements)、[jsonwebtoken](https://github.com/auth0/node-jsonwebtoken)。
