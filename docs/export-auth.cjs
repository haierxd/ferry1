// Export only an explicit public-source allowlist. Never include real .env files.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const files = [
  'sql/init_conversations.sql', 'server/conversations.js', 'history.js', 'CONVERSATIONS_README.md', 'conversations-implementation.md',
  'server/tests/conversations.test.js', 'server/tests/conversations.mysql.test.js',
  'server/package.json', 'server/.env.example', 'server/db.js', 'server/server.js',
  'sql/init_users.sql', 'index.html', 'app.js', 'styles.css', 'README.md',
  'serve.cjs', 'agent-client.js', '.gitignore', 'server/package-lock.json',
  'server/README.md', 'server/tests/auth.test.js', 'server/tests/mysql.test.js', 'server/tests/config.test.js',
];
const fence = String.fromCharCode(96).repeat(3);
const stage = path.join(root, '.runtime/auth-delivery-20261022');
const manifest = [];
let output = '# 知序 AI 登录注册与会话管理：逐文件完整源码\n\n';
output += '以下文件均为本次交付的完整文件，不是局部补丁。按绝对路径标注，未省略既有页面与样式。真实密钥、.env、数据库数据和 node_modules 均不包含在交付中。\n\n';
for (const rel of files) {
  const full = path.join(root, rel);
  const bytes = fs.readFileSync(full);
  const language = rel.endsWith('.json') ? 'json' : rel.endsWith('.html') ? 'html' : rel.endsWith('.css') ? 'css' : rel.endsWith('.sql') ? 'sql' : rel.endsWith('.md') ? 'markdown' : /\.(c?js)$/.test(rel) ? 'javascript' : 'text';
  // Use a longer fence for Markdown which itself contains triple fences.
  const delimiter = language === 'markdown' ? fence + String.fromCharCode(96) : fence;
  output += `## ${root.replaceAll('\\', '/')}/${rel}\n\n${delimiter}${language}\n${bytes.toString('utf8')}\n${delimiter}\n\n`;
  const target = path.join(stage, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(full, target);
  manifest.push({ path: rel, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
}
fs.writeFileSync(path.join(root, 'auth-complete-source.md'), output);
fs.writeFileSync(path.join(root, 'conversations-complete-source.md'), output);
fs.writeFileSync(path.join(stage, 'auth-complete-source.md'), output);
fs.writeFileSync(path.join(stage, 'SOURCE-MANIFEST.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ files: files.length, completeSourceBytes: Buffer.byteLength(output), stage }));
