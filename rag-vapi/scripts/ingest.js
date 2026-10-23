import { loadEnv, readConfig, printConfig, projectDir } from '../lib/config.js';
import { createPgPool } from '../lib/pg.js';
import { createAgentVapi } from '../lib/vapi.js';
import { assertProfile, assertSchema } from '../lib/profile.js';
import { ingestFile, knowledgeFiles } from '../lib/ingestion.js';
import { chunkText } from '../lib/chunker.js';
import { AppError, safeError } from '../lib/errors.js';
import path from 'node:path';
import { realpath, readFile } from 'node:fs/promises';

let pg;
try {
  loadEnv();
  const dryRun = process.env.CHUNKER_DRYRUN === '1';
  const config = dryRun ? { knowledgeDir: path.resolve(process.env.KNOWLEDGE_DIR
    || path.join(projectDir, '../markdown_output')) } : readConfig(process.env, { mode: 'ingest' });
  let embed;
  if (!dryRun) {
    printConfig(config);
    pg = createPgPool();
    try { await pg.query('SELECT 1'); }
    catch (error) {
      throw new AppError('PG_CONNECTION_FAILED', `连接 PG 失败（${safeError(error).code}）；请检查 PG_HOST/PG_PORT/PG_DB/PG_USER/PG_PASSWORD 和服务状态。`);
    }
    console.log('PG connected');
    await assertSchema(pg);
    try { await assertProfile(pg, config); }
    catch (error) { if (error.code !== 'KB_NOT_READY') throw error; }
    ({ embedTexts: embed } = createAgentVapi(config, { role: 'ingest' }));
  }
  const files = [];
  const args = process.argv.slice(2);
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--file') throw new AppError('INVALID_COMMAND', '用法：node scripts/ingest.js [--file 文件路径]');
    const selected = path.resolve(args[1]);
    const relative = path.relative(await realpath(config.knowledgeDir), await realpath(selected));
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || !/\.(md|txt)$/i.test(selected)) {
      throw new AppError('INVALID_FILE', '--file 必须是 KNOWLEDGE_DIR 内的 .md/.txt 文件');
    }
    files.push(path.join(config.knowledgeDir, relative));
  } else {
    for await (const file of knowledgeFiles(config.knowledgeDir)) files.push(file);
  }
  if (!files.length) throw new AppError('NO_DOCUMENTS', 'KNOWLEDGE_DIR 中没有 .md/.txt 文件，请检查目录并先完成 Markdown 转换');
  console.log(`${dryRun ? 'DRYRUN：不调用API、不连接PG' : 'INGEST：将调用v-api并覆盖同文件块'}；文件数=${files.length}`);
  let success = 0, failed = 0;
  for (const [index, file] of files.entries()) {
    console.log(`[${index + 1}/${files.length}] ${file}`);
    try {
      const source = path.resolve(file).replaceAll('\\', '/');
      if (dryRun) {
        const data = await readFile(file);
        let text;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); }
        catch { throw new AppError('INVALID_ENCODING', '文件不是有效UTF-8，请转换编码后重试'); }
        if (text.includes('\0')) throw new AppError('INVALID_ENCODING', '文件含NUL字符，请检查编码');
        const chunks = chunkText(text, { source_path: source });
        console.log(`  blocks=${chunks.length} old=未读取（DRYRUN） new=${chunks.length}`);
        for (const chunk of chunks) console.log(JSON.stringify({ source_path: source,
          chunk_index: chunk.chunk_index, title: chunk.title,
          characters: Array.from(chunk.chunk_text).length,
          preview: Array.from(chunk.chunk_text).slice(0, 80).join('') }));
        success++;
        continue;
      }
      const { rows } = await pg.query('SELECT count(*)::integer AS count FROM public.kb_chunks WHERE source_path = $1', [source]);
      const result = await ingestFile(file, { pg, embed, config, log: console.log });
      console.log(`  OK doc_id=${result.doc_id} old=${rows[0].count} new=${result.chunks}${result.chunks === 0 ? '（空文件，已清除该文件旧块）' : ''}`);
      success++;
    } catch (error) {
      console.error(`  FAILED file=${file}`, safeError(error));
      failed++;
      if (error.code === 'DIMENSION_MISMATCH') throw error;
    }
  }
  console.log(JSON.stringify({ total: files.length, success, failed }));
  process.exitCode = failed ? 1 : 0;
} catch (error) {
  console.error('ingest 失败', safeError(error));
  process.exitCode = 1;
} finally { if (pg) await pg.end(); }
