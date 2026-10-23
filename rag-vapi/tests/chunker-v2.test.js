import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { chunkText } from '../lib/chunker.js';

test('三级标题分块，短相邻节合并，元数据与末尾正文保留', () => {
  const source = '# 培训\n## 产品\n### 接口\n' + '接口要求。'.repeat(60)
    + '\n### 供电\n' + '供电要求。'.repeat(60) + '\n### 尾节\n最后一项。';
  const chunks = chunkText(source, { source_path: 'kb/产品.docx/document.md' });
  assert.ok(chunks.length >= 2);
  assert.deepEqual(chunks.map(c => c.chunk_index), chunks.map((_, i) => i));
  assert.ok(chunks.every(c => c.source_path === 'kb/产品.docx/document.md' && c.title));
  assert.ok(chunks.at(-1).chunk_text.includes('最后一项。'));
});

test('长节按完整句子切，<=800字符，有约50字的完整句重叠且不丢内容', () => {
  const sentences = Array.from({ length: 60 }, (_, i) => `第${i}句` + '测试内容'.repeat(8) + '。');
  const chunks = chunkText('### 长节\n' + sentences.join(''));
  assert.ok(chunks.length >= 4);
  assert.ok(chunks.every(c => Array.from(c.chunk_text).length <= 800));
  for (const sentence of sentences) assert.ok(chunks.some(c => c.chunk_text.includes(sentence)));
  assert.ok(sentences.some(sentence => chunks[0].chunk_text.includes(sentence) && chunks[1].chunk_text.includes(sentence)));
});

test('不为凑块数截断超过800字的无标点长句，明确报错', () => {
  assert.throws(() => chunkText('中'.repeat(801)), /长句.*800/);
});

test('约4500字有标点正文切成7到10块，不依赖文档名称', () => {
  const chunks = chunkText('### 参数\n' + ('参数说明'.repeat(10) + '。').repeat(110));
  assert.ok(chunks.length >= 7 && chunks.length <= 10);
  assert.ok(chunks.every(c => Array.from(c.chunk_text).length <= 800));
});

test('DRYRUN即使没有API/PG凭据也只预览，不连接数据库和v-api', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rag-dry-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, '资料.md'), '### 标题\n预览正文。');
  const { stdout } = await promisify(execFile)(process.execPath, ['scripts/ingest.js'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), timeout: 5000,
    env: { ...process.env, CHUNKER_DRYRUN: '1', KNOWLEDGE_DIR: dir,
      PG_HOST: '127.0.0.1', PG_PORT: '1', VAPI_API_KEY: '', VAPI_BASE_URL: '', JWT_SECRET: '' }
  });
  assert.match(stdout, /DRYRUN/);
  assert.match(stdout, /chunk_index/);
  assert.ok(!stdout.includes('PG connected'));
});
