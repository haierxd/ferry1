# 两个轻量 RAG 智能体

A 是 scripts/ingest.js 独立CLI；B是既有 server.js / POST /api/ask。没有引入新依赖或框架，没有执行业务入库、SQL、真实v-api请求，也没有修改真实.env。前端、代理和路由地址保持不变。

## 逐文件归属与完整源码

完整源码见 COMPLETE_SOURCE.md，每个源码文件标题标注归属。

| 文件 | 归属 | 用途 |
|---|---|---|
| .env.example、package.json、package-lock.json | 共享 | 安全模板、原依赖与版本锁定 |
| pgvector.sql | 共享/管理员初始化 | A写B读；vector(1536)、唯一约束、余弦HNSW索引 |
| mysql.sql | B独有/管理员初始化 | 用户与会话表，已有库优先沿用 |
| lib/config.js | 共享 | 分模式读取配置，白名单printConfig |
| lib/vapi.js、lib/embeddings.js | 共享 | 单进程一个SDK、嵌入/聊天分离、1536维硬校验 |
| lib/pg.js | 共享 | A可写连接，B默认只读连接 |
| lib/mysql.js | B独有 | 用户校验与会话连接池 |
| lib/db.js | 共享/兼容 | 保留旧工具的连接工厂导出 |
| lib/chunker.js、lib/chunk.js | A独有 | 兼容入口及原标题/400–800字分块实现 |
| lib/ingestion.js、scripts/ingest.js | A独有 | 递归扫描UTF-8文件、批量嵌入、事务替换、计数与错误 |
| lib/profile.js、lib/errors.js | 共享 | 模型/维度/地址一致性及错误脱敏 |
| lib/retrieve.js | B独有 | 同模型问题嵌入、Top-3可配置、目录/精确来源过滤 |
| lib/auth.js、lib/prompt.js | B独有 | JWT、上下文、真实引用及聚合 |
| routes/ask.js、server.js | B独有 | 问答路由、流结束写MySQL |
| scripts/init-db.js | 共享/管理员工具 | 手动建表与补齐旧会话字段 |
| scripts/prepare-knowledge.js | A独有/可选 | 本地准备知识目录，不自动执行 |
| scripts/export-source.js | 共享/交付工具 | 固定白名单导出源码，不读真实.env |
| tests/agents.test.js、tests/config.test.js、tests/core.test.js | 共享/测试 | 角色、配置、SDK及检索契约 |
| tests/ingest.test.js | A独有/测试 | 幂等、失败保护、事务 |
| tests/ask.test.js | B独有/测试 | JWT、引用、SSE与会话保存 |
| TWO_AGENTS.md、COMPLETE_SOURCE.md | 共享/文档 | 操作说明、完整源码 |

原有其他诊断/导出工具保留，不属于A/B运行必需清单。没有新增routes/ingest.js：A按已确认方案只提供CLI，避免把导入权限放入B。

## 角色边界与数据流

文档 → A扫描/分块 → v-api embeddings → 1536维检查 → PG文件事务 → B同模型问题嵌入 → PG只读检索 → 引用上下文 → v-api chat → 正常流结束 → MySQL → JSON/SSE done。

A只获得embedText/embedTexts，不获得chat或原始SDK，不导入MySQL和retrieve。B默认连接设置default_transaction_read_only=on；部署时还应给B独立SELECT-only账号、A写账号。相同PG_*键名可由两个进程分别注入，不必增加键名。只读连接设置用于防误写，不替代数据库授权；本次没有自动创建账号或执行GRANT。

每文件全部向量成功才开启事务：锁定、upsert文档、仅删除chunk_index超出新块数量的旧尾块、按(source_path,chunk_index) ON CONFLICT DO UPDATE更新已有块或插入新块、提交。已有块保留行ID；文档缩短不残留尾块。SQL失败回滚；块失败记录文件和块号并尝试后续块，但不提交不完整文件。维度错误立即停止整个导入；其他失败汇总，非零退出。0文件明确报错。

路径用path处理，落库统一正斜杠。文件严格UTF-8解码，编码错误不猜测、不静默。标题按#/##分段，长段400–800字拆分；嵌入前还有7500 UTF-8字节的保守安全检查。

B返回answer、references、retrieved_count，并保留旧citations/model/会话ID。references含真实路径、文件名、块号、doc_id、score及最多200个Unicode字符摘要。exact_match仅表示输入逐字出现在块中；检索候选数不等于确定出处数。同名文档使用带区分目录的citation_label。group_by_source=true可返回按source_path聚合、score降序的reference_groups。

提示要求只据上下文、依据不足明确不确定、每个事实标[文件名#块号]。引用标签必须来自本轮检索；标签检查本身不能证明所有事实的语义正确。空检索返回空数组和0，不调用聊天模型。

SSE顺序：context→delta→流正常结束且finish_reason=stop→校验→MySQL参数化INSERT→done。中断、截断或非法引用不保存部分会话；SQL失败不发成功done。临时delta可能已发出，失败以SSE error明确通知。

conversations记录JWT用户、问题、完整答案、请求模型、响应模型/ID、引用摘要JSON和默认时间。引用JSON不额外保存chunk_text全量；原有question/answer字段仍保存问答文本。API Key、JWT_SECRET、Token、数据库密码不进入日志/响应/会话。

## 改前/改后关键点

- RAG_TOP_K缺省从5变3；新增printConfig白名单输出，绝不展开process.env/config。
- A：createEmbedder(createVapi(config),config) → createAgentVapi(config,{role:'ingest'}).embedTexts。
- B：普通PG连接 → createPgPool(process.env,{readOnly:true})；直接SDK聊天 → 注入chat(messages,options)，固定使用config.chatModel。
- 原先全文件旧块删除后INSERT → 只清理失效尾块，已有索引ON CONFLICT (source_path,chunk_index) DO UPDATE，新增索引INSERT；均在原事务内完成。
- 保留目录过滤，新增参数化精确来源过滤：$6::text IS NULL OR c.source_path=$6；禁止越过知识根目录。
- 保留createVapi、createEmbedder、db.js、chunk.js及原SDK测试注入接口；实际入口使用受限能力对象。

vapi.js导出embedText(text,{sdk,config,signal})、chat(messages,{sdk,config,stream,signal})，通过createAgentVapi绑定同一个SDK，不重复创建。A批量导入使用同一能力对象的embedTexts。

## PowerShell运行顺序（手动）

1. 安装现有依赖并测试：

```powershell
Set-Location D:\test2\rag-vapi
npm ci --ignore-scripts
npm test
```

预期全部通过；测试使用模拟依赖和本地HTTP服务，不连接业务数据库或真实v-api。没有新增依赖。

2. 配置.env，不覆盖已有配置、不打印内容：

```powershell
if (-not (Test-Path -LiteralPath .env)) { Copy-Item .env.example .env }
notepad .env
```

设置v-api兼容地址（以/v1结尾）、密钥、控制台真实聊天模型、PG/MySQL连接。KNOWLEDGE_DIR设为D:/test2/docs/甲方资料，VAPI_EMBED_DIM=1536，RAG_TOP_K=3，PORT=3002。目录里需已有UTF-8 md/txt。已有.env中的显式值优先，例如RAG_TOP_K=5仍覆盖新默认值；本次没有修改真实.env或迁移知识目录。

JWT_SECRET/JWT_ISSUER/JWT_AUDIENCE与现有登录服务保持一致，JWT_SECRET至少32字符。A不要求MySQL/JWT配置，B要求。进程环境变量优先于dotenv，可分别注入A/B的PG账号；不要把密码写到命令历史。

3. DBeaver选择正确PG_DB，打开并执行pgvector.sql。服务端需已安装pgvector；脚本不DROP/TRUNCATE。首次无MySQL表时在正确MYSQL_DB执行mysql.sql；已有库只在缺字段时手动运行npm run migrate:mysql。CREATE TABLE IF NOT EXISTS不会迁移旧列或旧约束，结构不兼容需明确处理，不能靠重跑脚本静默改维度。

4. 运行A，可先用既有--file参数试一个知识根目录内文件：

```powershell
node scripts/ingest.js
if ($LASTEXITCODE -ne 0) { throw 'A入库失败，请查看文件名、块号和错误原因。' }
```

预期脱敏配置、PG connected、文件/嵌入计数、每文件OK/FAILED和最终success/failed。重跑替换同source_path文件的块，不删整库；不会自动清理目录中已经移除的其他文件。

5. 启动B：

```powershell
npm start
```

预期脱敏配置及3002服务地址；启动只读检查PG结构/模型配置并检查MySQL表字段，冲突明确失败。端口可被现有.env的PORT覆盖。

6. 新PowerShell窗口调用B。先从现有登录服务取得有效JWT，不生成虚构身份：

```powershell
$secureJwt = Read-Host '粘贴登录JWT（隐藏输入）' -AsSecureString
$jwt = [System.Net.NetworkCredential]::new('', $secureJwt).Password
try {
  $body = @{
    question = Read-Host '输入已知在文档中的原句'
    stream = $false
    group_by_source = $true
    # 可选 topK = 3
    # 可选 source_path = '部门/制度.md'，也支持接口返回的完整source_path
  } | ConvertTo-Json
  $result = Invoke-RestMethod -Uri 'http://127.0.0.1:3002/api/ask' `
    -Method Post -ContentType 'application/json; charset=utf-8' `
    -Headers @{ Authorization = "Bearer $jwt" } `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
  $result | Select-Object answer, model, retrieved_count, conversation_id
  $result.references | Format-List
} finally {
  $jwt = $null
  $secureJwt = $null
}
```

预期answer+references+retrieved_count；无依据时空引用和0。stream=true返回SSE，须用支持SSE的客户端，不能按普通JSON消费。现有4173代理和前端引用卡片继续可用。

## 模型与保密

参考链接 https://gpt.ge/models/text-embedding-3-small 仅作模型属性参考（用户约定8K上下文、默认维度）；代码只走v-api。嵌入与chat模型严格分离。调用名以v-api文档/控制台为准；维度不是1536时明确报错：“检查 v-api 模型/调用名、重建向量列或新表隔离、重跑 ingest”。本实现固定1536，不能仅改.env混入其他维度或其他模型。

甲方资料经v-api向量化，并作为问答上下文发送给v-api聊天模型，请确认保密、出网和内网策略。真实.env不包含在完整源码中，模板密钥/密码均为空。
