import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

test('同文件重跑按事务替换；数据库失败回滚，旧块不会被永久删除', async t => {
  const { ingestFile } = await import('../lib/ingestion.js');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rag-ingest-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, '规则.md');
  await writeFile(file, '# 规则\n' + ('权限'.repeat(24) + '。').repeat(27));
  const calls = [];
  let failInsert = false;
  const client = { release() {}, query: async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes('INSERT INTO public.kb_documents')) return { rows: [{ id: '7' }] };
    if (failInsert && sql.includes('INSERT INTO public.kb_chunks')) throw new Error('simulated database error');
    return { rows: [] };
  } };
  const pg = { connect: async () => client };
  const embed = async texts => texts.map(() => Array(1536).fill(0.1));
  const config = { embeddingModel: 'embed', embedDim: 1536, baseURL: 'https://vapi.invalid/v1', batchSize: 16 };
  const args = { pg, embed, config, profile: async () => {} };
  const first = await ingestFile(file, args);
  await ingestFile(file, args);
  assert.equal(calls.filter(c => c.sql === 'COMMIT').length, 2);
  assert.equal(calls.filter(c => c.sql.includes('DELETE FROM public.kb_chunks')).length, 2);
  assert.ok(calls.some(c => c.sql.includes('ON CONFLICT (source_path)')));
  assert.ok(calls.some(c => c.sql.includes('ON CONFLICT (source_path, chunk_index) DO UPDATE')));
  const cleanup = calls.find(c => c.sql.includes('DELETE FROM public.kb_chunks'));
  assert.match(cleanup.sql, /chunk_index >= \$2/);
  assert.equal(cleanup.values[1], first.chunks);
  const upsert = calls.find(c => c.sql.includes('INSERT INTO public.kb_documents'));
  assert.ok(upsert.sql.includes('file_mtime = EXCLUDED.file_mtime'));
  assert.ok(upsert.values[6] instanceof Date);
  failInsert = true;
  await assert.rejects(ingestFile(file, args), /simulated/);
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
});

test('嵌入失败时不会删除旧块或开始替换事务', async t => {
  const { ingestFile } = await import('../lib/ingestion.js');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rag-ingest-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, '规则.txt');
  await writeFile(file, '资料');
  let connects = 0;
  await assert.rejects(ingestFile(file, { pg: { connect: async () => { connects++; } },
    embed: async () => { throw new Error('v-api unavailable'); },
    config: { batchSize: 16, embedDim: 1536 } }), /块.*失败/);
  assert.equal(connects, 0);
});

test('失败批次逐块重试，记录文件和块号并继续后续块，不覆盖旧数据', async t => {
  const { ingestFile } = await import('../lib/ingestion.js');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rag-ingest-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, '块失败.md');
  await writeFile(file, '甲'.repeat(799) + '。' + '乙'.repeat(799) + '。' + '丙'.repeat(799) + '。');
  const attempted = [], logs = [];
  let connects = 0;
  await assert.rejects(ingestFile(file, {
    config: { batchSize: 16, embedDim: 1536 },
    pg: { connect: async () => { connects++; } }, log: s => logs.push(s),
    embed: async texts => {
      if (texts.length > 1) throw new Error('batch failed');
      attempted.push(texts[0][0]);
      if (texts[0][0] === '乙') throw Object.assign(new Error('private payload must not be logged'), { status: 429 });
      return [Array(1536).fill(0.1)];
    }
  }), /块.*失败/);
  assert.deepEqual(attempted, ['甲', '乙', '丙']);
  assert.equal(connects, 0);
  assert.ok(logs.some(s => s.includes(file) && s.includes('chunk_index=1') && s.includes('429')));
  assert.ok(logs.every(s => !s.includes('private payload')));
});

test('真实返回维度不符立即抛出，不重试后续块、不开启事务', async t => {
  const { ingestFile } = await import('../lib/ingestion.js');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rag-ingest-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, '维度.txt');
  await writeFile(file, '甲'.repeat(799) + '。' + '乙'.repeat(799) + '。');
  let calls = 0;
  await assert.rejects(ingestFile(file, { pg: {}, config: { batchSize: 1, embedDim: 1536 },
    embed: async () => { calls++; return [[1, 2]]; } }), /重建向量列/);
  assert.equal(calls, 1);
});

test('ingest CLI 连接 PG 失败时明确报错并以非零退出，不进入嵌入', async () => {
  await assert.rejects(promisify(execFile)(process.execPath, ['scripts/ingest.js'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), timeout: 5000,
    env: { ...process.env, VAPI_BASE_URL: 'http://127.0.0.1:1/v1', VAPI_API_KEY: 'test-only',
      VAPI_EMBEDDING_MODEL: 'text-embedding-3-small', VAPI_CHAT_MODEL: '', VAPI_EMBED_DIM: '1536',
      PG_HOST: '127.0.0.1', PG_PORT: '1', PG_DB: 'test', PG_USER: 'test', PG_PASSWORD: '' }
  }), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /PG_CONNECTION_FAILED/);
    assert.match(error.stderr, /连接 PG 失败/);
    assert.ok(!error.stdout.includes('embeddings'));
    return true;
  });
});

test('--file 与批量入库使用相同根目录形式，不因 Windows 大小写形成重复来源', async () => {
  const source = await readFile(new URL('../scripts/ingest.js', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('const selected = path.resolve(args[1]);'), source.indexOf('\n  } else {'));
  const root = 'D:\\test2\\docs\\甲方资料';
  const canonical = path.win32.join(root, 'document.md');
  const files = [];
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction('config', 'args', 'files', 'path', 'realpath', 'AppError', code)(
    { knowledgeDir: root }, ['--file', 'd:\\TEST2\\DOCS\\甲方资料\\document.md'], files, path.win32,
    async p => p.toLowerCase() === root.toLowerCase() ? root : canonical, Error);
  assert.deepEqual(files, [canonical]);
});
