import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { loadEnv, readConfig, projectDir } from '../lib/config.js';
import { knowledgeFiles } from '../lib/ingestion.js';
import { chunkText } from '../lib/chunk.js';
import { isMain, runCheck, errorHint, display } from './check-env.js';

export async function checkIngest() {
  loadEnv();
  const config = readConfig(process.env, { mode: 'ingest' });
  let file;
  for await (const candidate of knowledgeFiles(config.knowledgeDir, () => {})) { file = candidate; break; }
  if (!file) {
    console.error('❌ KNOWLEDGE_DIR 中没有 .md / .txt 文件；请先放入一个 UTF-8 文本文件。');
    console.log('汇总：FAIL（没有处理文件）'); process.exitCode = 1; return;
  }
  const data = await readFile(file);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); }
  catch { throw { code: 'INVALID_ENCODING' }; }
  if (text.includes('\0')) throw { code: 'INVALID_ENCODING' };
  console.log(`✅ 读取文件：${display(file)}（${data.length} 字节；不输出正文）`);
  const chunks = chunkText(text);
  console.log(`✅ 分块完成：${chunks.length} 块（复用 lib/chunk.js）`);
  if (!chunks.length) {
    console.error('❌ 首个文件为空，停止验证以避免清除该文件的旧分块；请补充正文后重试。');
    console.log('汇总：FAIL（0 块）'); process.exitCode = 1; return;
  }
  console.log('将真实调用 v-api 并写入 PG；同一路径的旧文档按原 ingest 事务逻辑替换。');
  console.log('执行原入口：node scripts/ingest.js --file <上述文件>（仅此一个文件）');
  const states = chunks.map(() => '未完成');
  let committed = false, dbConnected = false;
  function setState(index, state) {
    if (index < 0 || index >= states.length || states[index] === state) return;
    states[index] = state;
    console.log(`${state === '成功' ? '✅' : '❌'} 第 ${index + 1}/${chunks.length} 块 embedding ${state}`);
  }
  function consume(line) {
    // Only translate known progress markers; never relay raw child stdout/stderr,
    // SDK bodies, SQL parameters, file contents or credentials.
    if (line.trim() === 'PG connected') { dbConnected = true; console.log('✅ PG 连接成功'); }
    const failure = /FAILED file=.* chunk_index=(\d+) /.exec(line);
    if (failure) setState(Number(failure[1]), '失败');
    if (/\bRETRY file=/.test(line)) console.log('❌ 一批 embedding 请求失败；原 ingest 将逐块重试。');
    const progress = /^\s*embeddings (\d+)\/(\d+)\s*$/.exec(line);
    if (progress) {
      for (let i = 0; i < Math.min(Number(progress[1]), states.length); i++) {
        if (states[i] === '未完成') setState(i, '成功');
      }
    }
    if (/^\s*OK doc_id=\d+ chunks=\d+/.test(line)) { committed = true; console.log('✅ 写入 PG 成功：原 ingest 事务已 COMMIT'); }
    // console.error may format safeError objects over several lines; code and
    // HTTP status must also be recognized on lines after the failure heading.
    const code = /["']?code["']?\s*:\s*["']([A-Z0-9_]+)["']/.exec(line)?.[1];
    const status = /HTTP (\d{3})/.exec(line)?.[1];
    if (code || status) console.error(`   提示：${errorHint({ code, status: status ? Number(status) : undefined })}`);
  }
  const child = spawn(process.execPath, [path.join(projectDir, 'scripts', 'ingest.js'), '--file', file],
    { cwd: projectDir, env: { ...process.env, KNOWLEDGE_DIR: config.knowledgeDir },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8');
    let buffer = '';
    stream.on('data', part => {
      buffer += part;
      const lines = buffer.split(/\r?\n/); buffer = lines.pop();
      for (const line of lines) consume(line);
      // Bound retained output even if an upstream dependency emits a huge line.
      if (buffer.length > 16384) buffer = '';
    });
    stream.on('end', () => { if (buffer) consume(buffer); });
  }
  const code = await new Promise(resolve => {
    child.once('error', error => { console.error(`❌ 无法启动 ingest：${errorHint(error)}`); resolve(1); });
    child.once('close', exitCode => resolve(exitCode ?? 1));
  });
  for (let i = 0; i < states.length; i++) {
    if (states[i] === '未完成') console.log(`❌ 第 ${i + 1}/${chunks.length} 块未完成或未获得成功确认（不能视为成功）。`);
  }
  const ok = code === 0 && committed && states.every(s => s === '成功');
  if (!committed) console.error(`❌ 写入 PG 未成功确认${dbConnected ? '；请检查 schema、模型配置、embedding 和 PG 权限' : '；请先跑 check:db'}。`);
  console.log(`汇总：${ok ? 'PASS' : 'FAIL'}；文件 1 个，分块 ${chunks.length}，embedding 成功 ${states.filter(s => s === '成功').length}，失败 ${states.filter(s => s === '失败').length}，未完成 ${states.filter(s => s === '未完成').length}，PG 提交 ${committed ? '成功' : '未确认'}`);
  process.exitCode = ok ? 0 : 1;
}
if (isMain(import.meta.url)) await runCheck(checkIngest);
