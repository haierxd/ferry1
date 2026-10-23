'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const fence = String.fromCharCode(96).repeat(3);
let output = '# 会话管理：完整增量代码与接入位置\n\n以下内容从已落地的文件生成，代码无省略。现有项目已经完成接入，无需再次重复添加。\n\n';
function block(title, language, code) {
  output += `## ${title}\n\n${fence}${language}\n${code.trim()}\n${fence}\n\n`;
}
function between(source, start, end) {
  const from = source.indexOf(start); const to = source.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error('Expected source markers are missing');
  return source.slice(from, to);
}
block('D:/test2/sql/init_conversations.sql：完整建表语句', 'sql', read('sql/init_conversations.sql'));
block('D:/test2/server/conversations.js：四个接口的完整代码', 'javascript', read('server/conversations.js'));
output += '## D:/test2/server/server.js：注册路由\n\n复用已有 authenticate，放在全局 express.json 前；CORS methods 加入 DELETE。完整 server.js 另见 conversations-complete-source.md。\n\n';
block('路由接入代码', 'javascript', "const { createConversationsRouter } = require('./conversations');\napp.use('/api/conversations', (_req, res, next) => {\n  res.set('Cache-Control', 'no-store'); next();\n}, authenticate, express.json({ limit: '1mb' }), createConversationsRouter({ pool }));");
const html = read('index.html');
block('D:/test2/index.html：完整历史页 HTML 片段', 'html', between(html, '      <section id="history-page"', '      <section id="chat-page"'));
block('D:/test2/index.html：导航和脚本（history.js 在 app.js 前）', 'html', '<a href="#history" class="nav-item" data-page="history"><svg class="icon"><use href="#i-clock"/></svg>历史会话</a>\n<script src="agent-client.js" defer></script>\n<script src="history.js" defer></script>\n<script src="app.js" defer></script>');
const css = read('styles.css');
block('D:/test2/styles.css：完整新增 CSS', 'css', css.slice(css.indexOf('/* Authenticated conversation archive;')));
block('D:/test2/history.js：完整原生 JavaScript', 'javascript', read('history.js'));
const app = read('app.js');
block('D:/test2/app.js：初始化历史组件', 'javascript', between(app, 'const conversationHistory =', 'function savedToken()'));
block('D:/test2/app.js：包含 #history 的完整路由函数', 'javascript', between(app, 'function route() {', 'function openChat('));
block('D:/test2/app.js：问答函数完整代码与成功后保存位置', 'javascript', between(app, 'async function runMessage(', 'function sendMessage('));
output += '## D:/test2/serve.cjs\n\n将 history.js 加入 publicFiles 静态白名单。server/db.js 已增加 supportBigNumbers / bigNumberStrings，以字符串处理 BIGINT ID。\n\n';
output += read('CONVERSATIONS_README.md');
fs.writeFileSync(path.join(root, 'conversations-implementation.md'), output);
console.log('Generated complete SQL/API/HTML/CSS/JS implementation guide.');
