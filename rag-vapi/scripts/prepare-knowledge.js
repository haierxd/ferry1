import { readdir, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnv, projectDir } from '../lib/config.js';

// Optional local-only staging. Does not contact v-api or a database, and never overwrites files.
loadEnv();
const source = path.resolve(projectDir, '../markdown_output');
const target = path.resolve(process.env.KNOWLEDGE_DIR || path.join(projectDir, '../docs/甲方资料'));
let copied = 0, existing = 0;
async function walk(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) await walk(file);
    else if (item.isFile() && /\.(md|txt)$/i.test(item.name)) {
      const destination = path.join(target, path.relative(source, file));
      await mkdir(path.dirname(destination), { recursive: true });
      try { await copyFile(file, destination, 1); copied++; }
      catch (error) { if (error.code === 'EEXIST') existing++; else throw error; }
    }
  }
}
try {
  if (target === source || target.startsWith(source + path.sep)) throw new Error('目标目录不能位于 markdown_output 内');
  await walk(source);
  console.log(JSON.stringify({ copied, existing, target, note: '仅复制本地 md/txt；没有向外部发送资料。已有文件不覆盖，更新时请自行同步。' }));
} catch (error) { console.error(`资料准备失败：${error.code || 'INVALID_PATH'}`); process.exitCode = 1; }
