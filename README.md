# test2

# 登录注册 + JWT + MySQL

前端为原生 HTML/CSS/JS：`http://127.0.0.1:4173`。账号 API 为 Express：`http://127.0.0.1:3000/api`。MySQL 已有宿主机映射地址为 `127.0.0.1:33061`，数据库为 `zhixu_ai`。需要 Node.js 20 或更高版本。

## 1. 安装并配置环境变量

在 PowerShell 执行：

```powershell
cd D:\test2\server
npm.cmd install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

最后一条命令在本机生成 JWT_SECRET。打开 `D:\test2\server\.env`，用自己的本地配置替换以下占位符，不需要发送任何密码：

```dotenv
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=33061
DB_USER=your_mysql_user
DB_PASSWORD=your_password_here
DB_NAME=zhixu_ai
JWT_SECRET=your_generated_jwt_secret_here
JWT_EXPIRES_IN=1d
BCRYPT_ROUNDS=12
CORS_ORIGINS=http://127.0.0.1:4173,http://localhost:4173
```

将生成的随机字符串保存为 JWT_SECRET，之后每次启动都复用该文件。不要每次启动重新生成；更换 JWT_SECRET 会使旧 token 失效。数据库五个连接参数全部从环境变量读取，代码没有账号、密码或连接串默认值；操作系统已有的同名环境变量优先于 `.env`。密码包含 `#` 时用双引号包住整个值。真实 `.env` 已加入 Git 忽略规则。此文件独立于 `personal_agent/.env`，不会修改 DeepSeek 密钥。

## 2. 启动 MySQL 并通过 Navicat 导入 SQL

启动你现有的 MySQL 容器，保留现有 `33061:3306` 映射和数据卷。Navicat 新建或打开 MySQL 连接，主机填 `127.0.0.1`，端口填 `33061`，账号密码填你自己的本地配置。

连接后使用“运行 SQL 文件”，选择 `D:\test2\sql\init_users.sql`，编码选择 UTF-8。脚本会创建 `zhixu_ai` 和 `users`（需要相应建库/建表权限），使用 InnoDB、utf8mb4、utf8mb4_general_ci。包含用户名、邮箱唯一索引；密码只存 bcrypt 哈希。额外保留选填的 company，兼容现有注册表单。

脚本使用 `IF NOT EXISTS`，可重复执行，不清空任何数据。如果 users 已存在，脚本不会自动改变原表；请确认字段和唯一索引与脚本一致。旧表的排序规则也不会被静默转换。

## 3. 启动前后端

终端一：

```powershell
cd D:\test2\server
node server.js
```

看到 `Auth API: http://127.0.0.1:3000` 说明配置校验和数据库连接成功。

终端二：

```powershell
cd D:\test2
node serve.cjs
```

打开 [登录页面](http://127.0.0.1:4173/#login)。未登录访问 `#qa` 会跳到 `#login`；注册成功自动登录；登录成功进入 `#qa`；刷新时通过 `/api/me` 验证 token；退出会清理 token。页面沿用原有问答及智能体逻辑。

使用智能体服务时，在第三个终端启动：

```powershell
cd D:\test2\personal_agent
.\.venv\Scripts\python.exe agentos.py
```

## 4. 接口与 Authorization 示例

- `POST /api/register`：JSON `{ username, email, password }`，company 可选。成功返回 201 和 `{ message, token, user }`；重复用户名或邮箱返回 409。
- `POST /api/login`：JSON `{ email, password }` 或 `{ username, password }`，也兼容现有表单的 `{ identifier, password }`。成功返回 `{ message, token, user }`，账号或密码错误返回 401。
- `GET /api/me`：需要 `Authorization: Bearer <token>`，返回 `{ user }`，不包含密码和哈希。无效、过期 token 返回 401。

前端已经实现以下请求方式：

```javascript
// email 和 password 来自表单输入。
const response = await fetch('http://127.0.0.1:3000/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const result = await response.json();
if (!response.ok) throw new Error(result.message);
localStorage.setItem('zhixu-auth-token-v1', result.token);

const meResponse = await fetch('http://127.0.0.1:3000/api/me', {
  headers: {
    Authorization: `Bearer ${localStorage.getItem('zhixu-auth-token-v1')}`,
  },
});
const me = await meResponse.json();
if (!meResponse.ok) throw new Error(me.message);

// 退出登录：
localStorage.removeItem('zhixu-auth-token-v1');
location.hash = '#login';
```

用户名为 3–32 个文字、数字或下划线；密码至少 8 字符且 UTF-8 编码后最多 72 字节；公司名称最多 120 字符。用户输入通过 `mysql2.execute(sql, values)` 预处理传入，数据库原始错误不会返回浏览器。

JWT 鉴权覆盖新增账号接口，前端路由守卫覆盖工作台。原有独立 AgentOS 接口保留其现有访问方式。

## 5. 测试和排错

```powershell
cd D:\test2\server
npm.cmd test
# MySQL 启动且 SQL 导入之后，按需执行真实数据库集成测试：
$env:MYSQL_INTEGRATION = '1'
npm.cmd run test:mysql
Remove-Item Env:MYSQL_INTEGRATION
```

集成测试创建随机命名的专用测试账号，只按主键清理自己创建的那条记录。默认测试不连接数据库。

连接失败检查容器运行情况、33061 映射、`.env` 账号权限；表不存在则检查 SQL 导入的库名；配置变量或 JWT_SECRET 缺失时按启动提示填写后重启。已有 `.env` 请直接编辑，勿用示例文件覆盖原来的配置。


会话管理：完整接入说明与验证步骤见 [CONVERSATIONS_README.md](CONVERSATIONS_README.md)。
