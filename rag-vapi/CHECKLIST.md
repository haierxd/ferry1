# RAG 联调验证清单

在 PowerShell 中进入项目：

```powershell
cd D:\test2\rag-vapi
```

所有检查脚本均支持 `npm run check:xxx` 和 `node scripts/check-xxx.js` 独立运行。成功退出码为 0，失败为 1；出现 FAIL 时先修复再继续。脚本不会打印真实密码、密钥、SDK 错误正文或文档正文，敏感配置最多显示前 4 位加 `***`（长度不超过 4 时全部隐藏）。不要把 `.env`、JWT 或连接密码贴到日志、聊天或 Git 中。

## 1. 填写 .env

确认项目根目录有 `.env`，不是仅有 `.env.example`。仅在文件不存在时复制模板，然后在本地编辑；不要覆盖已有配置：

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
npm run check:env
```

必填：`PG_HOST / PG_PORT / PG_DB / PG_USER / PG_PASSWORD`、`MYSQL_HOST / MYSQL_PORT / MYSQL_DB / MYSQL_USER / MYSQL_PASSWORD`、`VAPI_BASE_URL / VAPI_API_KEY / VAPI_EMBEDDING_MODEL / VAPI_CHAT_MODEL / VAPI_EMBED_DIM`、`KNOWLEDGE_DIR`、`JWT_SECRET`。

- PG_DB 填 `rag_kb`，MYSQL_DB 填 `zhixu_ai`。两个库需要预先存在。检查脚本只检查，不自动建库或改表。
- VAPI_BASE_URL 使用 v-api 控制台地址，以 `/v1` 结尾，不追加 `/embeddings`，不含用户名、密码或查询参数。
- 嵌入模型必须返回 1536 维，聊天模型使用独立的可用调用名。`JWT_SECRET` 至少 32 字符，且与前端所用登录服务一致；`JWT_ISSUER / JWT_AUDIENCE` 也要一致。
- KNOWLEDGE_DIR 指向包含 UTF-8 `.md / .txt` 的目录。可递归搜索子目录，不跟随符号链接。
- 系统环境变量优先于 `.env`；改了文件仍无效时，检查当前终端是否已有同名变量。可选参数及默认值见 `lib/config.js`。

**预期：** 输出“键名 / 是否有值 / 长度 / 敏感值预览”表，最后 `汇总：PASS`。这里只确认有值及基本格式，不代表连接成功。

**失败：** 按“未填写”列表补齐；有值仍 FAIL 时检查 URL、端口、整数参数、1536 维限制、聊天模型、JWT 长度。不要用真实密码截图求助。

## 2. 运行 check:all

```powershell
npm run check:all
```

依次执行环境 → 数据库 → 单次 embedding 检查；任一脚本失败即停止后续脚本。它不导入文件，不测试聊天模型，也不替代启动和前端验证。

**数据库预期：** PG `SELECT 1`、rag_kb、当前库 vector 扩展、`public.kb_documents / public.kb_chunks`、`vector(1536)`；MySQL `SELECT 1`、zhixu_ai、conversations 表均为 ✅，连接池自动关闭，最后 PASS。某一步失败仍会继续收集该脚本内其他检查结果。

**数据库失败处理：**

- 拒绝连接/超时：检查 PostgreSQL、MySQL 服务、HOST、PORT、防火墙。
- 密码或权限错误：核对相应 USER/PASSWORD，联系管理员授权；不要把密码打印到终端命令历史。
- 库不存在：由管理员创建对应库，核对 PG_DB/MYSQL_DB 后重试。连接池会连接配置中的库，因此库不存在也会使该库内其他查询失败。
- 扩展/PG 表不存在：先确认服务端已安装 pgvector，再运行 `npm run init:pg`。
- MySQL 表不存在：核对目标库后运行 `npm run init:mysql`。已有 conversations 表缺少新字段时运行 `npm run migrate:mysql`。启动还要求 users 表和会话字段完整；check:db 的表存在检查不保证所有业务字段完整。

**embedding 预期：** 请求 v-api `/v1/embeddings`，输入只有“测试”；表格显示模型、返回维度 1536、与 VAPI_EMBED_DIM 相等，最后 PASS。不打印完整向量。此步骤会产生少量 API 调用费用，SDK 可能重试网络/限流/上游错误。

**embedding 失败处理：**

| 提示 | 处理 |
| --- | --- |
| 401 | 核对 v-api Key 是否有效、已过期或被撤销 |
| 402 | 检查余额与计费配额 |
| 403 | 检查模型权限、IP 限制 |
| 404 | 核对 BASE_URL 和模型调用名，避免重复 `/v1` 或 `/embeddings` |
| 400 | 检查模型是否支持 embeddings 及参数 |
| 429 | 降低频率，检查限额后重试 |
| 5xx / 超时 | 检查网络、代理、TLS、VAPI_TIMEOUT_MS 或联系服务商 |
| 维度不一致 | 需要改 pgvector.sql 的 vector(N) 并重跑 init:pg；但本项目业务层、校验和 SQL 约束也固定 1536，不能只改 .env/SQL。优先换用返回 1536 维的模型。确需换维度时须另行统一修改、迁移或重建向量表并重新入库。init:pg 的 IF NOT EXISTS 不会迁移已有列，避免直接删除已有资料 |

可分别定位：`npm run check:db`、`npm run check:embed`。

## 3. 单文件 check:ingest

```powershell
npm run check:ingest
```

**预期：** 按现有知识目录遍历顺序选择首个 `.md / .txt`，显示“读取文件 → 分块数量 → PG 连接 → 每块 embedding 成功/失败 → PG 提交 → PASS/FAIL 汇总”。脚本使用原 `node scripts/ingest.js --file <文件>` 入口，复用原分块、模型校验与事务入库。分块成功根据原入口完成进度确认；批次失败会先提示重试，再显示每块最终状态。遇到致命错误，未执行的块明确显示未完成。

**会产生真实副作用：** 该文件正文将发送到已配置的 v-api，产生 API 费用，成功时写入 PG。同一路径文档的旧块会按原事务逻辑替换，并非只读演练。脚本不会批量导入整个目录。空文件会停止，避免原入口清除空文件的旧块。

**失败：** 没有文件时检查目录及文件扩展名；编码错误转为 UTF-8；分块失败查 Key/余额/模型/维度；PG 写入失败先跑 check:db。模型配置冲突表示当前库已绑定不同模型、维度或接口地址，请恢复原配置或另建知识库。原入库事务失败会保留该文件旧数据；连接中断且未确认 COMMIT 时，先核查数据库再重试。

需验证指定文件，可手动执行原入口（它的日志格式不同）：

```powershell
node scripts/ingest.js --file "D:\test2\docs\甲方资料\某个文档.md"
```

## 4. 启动 server.js

```powershell
npm start
```

**预期：** 启动校验通过，显示 `RAG API: http://127.0.0.1:3002`（以实际 HOST/PORT 为准）。另开终端：

```powershell
Invoke-RestMethod http://127.0.0.1:3002/health
```

预期 `status` 为 `ok`。health 只表示 HTTP 进程在响应，不代表聊天/检索/会话保存已经联调通过。

**失败：** KB_NOT_READY 先成功运行 check:ingest；表结构缺失按第 2 步初始化/迁移；模型配置冲突使用与入库一致的模型、地址、维度；端口占用调整 PORT 并同步前端代理。JWT 配置错误按第 1 步修复。

## 5. 前端验证

1. 按前端项目现有方式启动页面与代理，确认 `/api/ask` 转发到上面的 RAG 服务；登录现有账号。
2. 选择已入库文件中明确存在的问题，发送请求。预期 `/api/ask` 返回 200，答案与资料有关，引用能对应入库文件；流式请求有 context/delta 等事件并正常结束。
3. 查看历史会话，确认新回答保存在 MySQL conversations 中。数据库脚本不验证聊天模型、登录 JWT 或前端代理，这一步必须实际操作。

**失败：** 401 检查登录态、Bearer JWT、SECRET/ISSUER/AUDIENCE；404/502 检查前端代理、后端端口；浏览器跨域由前端现有同源代理配置解决；无检索依据确认该文件成功入库、问题和目录过滤范围正确；模型错误核对 VAPI_CHAT_MODEL 的调用名和权限；会话保存错误检查 conversations 字段、用户与数据库权限。不要在浏览器端配置 v-api Key 或数据库密码。
