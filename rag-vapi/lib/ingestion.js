import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chunkText, CHUNKER_VERSION } from './chunker.js';
import { assertProfile } from './profile.js';
import { vectorLiteral, validateVector } from './embeddings.js';
import { AppError, safeError } from './errors.js';

const hash = text => createHash('sha256').update(text).digest('hex');
export async function* knowledgeFiles(directory, log = console.warn) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) { log(`[SKIP] 不跟随符号链接：${file}`); continue; }
    if (entry.isDirectory()) yield* knowledgeFiles(file, log);
    else if (entry.isFile() && /\.(md|txt)$/i.test(entry.name)) yield file;
  }
}

export async function ingestFile(file, { pg, embed, config, profile = assertProfile, log = () => {} }) {
  const data = await readFile(file);
  const fileStat = await stat(file);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); }
  catch { throw new AppError('INVALID_ENCODING', '文件不是有效 UTF-8，请先转换编码后重新 ingest'); }
  if (text.includes('\0')) throw new AppError('INVALID_ENCODING', '文件含 NUL 字符，请先检查编码和文件格式');
  const chunks = chunkText(text);
  const vectors = new Array(chunks.length);
  const failures = [];
  const expectedDim = config.embedDim ?? Number(process.env.VAPI_EMBED_DIM || 1536);
  const reportFailure = (index, error) => {
    log(`  FAILED file=${file} chunk_index=${index} ${JSON.stringify(safeError(error))}`);
    if (error.code === 'DIMENSION_MISMATCH') { error.chunkIndex = index; throw error; }
    failures.push(index);
  };
  const batchSize = config.batchSize || 16;
  for (let offset = 0; offset < chunks.length; offset += batchSize) {
    const batch = chunks.slice(offset, offset + batchSize);
    try {
      const result = await embed(batch.map(c => c.chunk_text));
      if (result.length !== batch.length) throw new AppError('INVALID_EMBEDDING', '嵌入数量与块数量不一致');
      for (let i = 0; i < batch.length; i++) {
        try { vectors[offset + i] = validateVector(result[i], expectedDim); }
        catch (error) { reportFailure(offset + i, error); }
      }
    } catch (error) {
      if (error.code === 'DIMENSION_MISMATCH') {
        const index = error.chunkIndex ?? offset + (error.embeddingIndex ?? 0);
        log(`  FAILED file=${file} chunk_index=${index} ${JSON.stringify(safeError(error))}`);
        throw error;
      }
      log(`  RETRY file=${file} chunk_index=${offset}..${offset + batch.length - 1} ${JSON.stringify(safeError(error))}`);
      for (const chunk of batch) {
        try {
          const [vector] = await embed([chunk.chunk_text]);
          vectors[chunk.chunk_index] = validateVector(vector, expectedDim);
        } catch (chunkError) { reportFailure(chunk.chunk_index, chunkError); }
      }
    }
    log(`  embeddings ${Math.min(offset + batch.length, chunks.length)}/${chunks.length}`);
  }
  if (failures.length) throw new AppError('CHUNK_EMBEDDING_FAILED', `${failures.length} 个块嵌入失败（chunk_index=${failures.join(',')}），已继续尝试后续块；本文件旧数据保留，请修复后重跑 ingest。`);
  if (vectors.length !== chunks.length) throw new AppError('INVALID_EMBEDDING', '嵌入数量与块数量不一致，未替换旧资料');
  // Validate all vectors before starting a replacement transaction.
  const literals = vectors.map(vectorLiteral);
  const source = path.resolve(file).replaceAll('\\', '/');
  const client = await pg.connect();
  try {
    await client.query('BEGIN');
    // Short global lock serializes profile initialization + file replacement, not remote API calls.
    await client.query('SELECT pg_advisory_xact_lock(7301536)');
    await profile(client, config, { create: true });
    const { rows } = await client.query(`INSERT INTO public.kb_documents
      (source_path, content_hash, embedding_model, embedding_dim, chunker_version, chunk_count, file_mtime)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (source_path) DO UPDATE SET content_hash = EXCLUDED.content_hash,
        embedding_model = EXCLUDED.embedding_model, embedding_dim = EXCLUDED.embedding_dim,
        chunker_version = EXCLUDED.chunker_version, chunk_count = EXCLUDED.chunk_count,
        file_mtime = EXCLUDED.file_mtime, updated_at = now()
      RETURNING id::text AS id`,
    [source, hash(data), config.embeddingModel, config.embedDim, CHUNKER_VERSION, chunks.length, fileStat.mtime]);
    const docId = rows[0].id;
    // Remove only obsolete tail chunks; existing indices are updated by the upsert below.
    await client.query('DELETE FROM public.kb_chunks WHERE doc_id = $1 AND chunk_index >= $2', [docId, chunks.length]);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      await client.query(`INSERT INTO public.kb_chunks
        (doc_id, source_path, chunk_index, chunk_text, content_hash, embedding)
        VALUES ($1, $2, $3, $4, $5, $6::vector)
        ON CONFLICT (source_path, chunk_index) DO UPDATE SET
          doc_id = EXCLUDED.doc_id, chunk_text = EXCLUDED.chunk_text,
          content_hash = EXCLUDED.content_hash, embedding = EXCLUDED.embedding`,
      [docId, source, chunk.chunk_index, chunk.chunk_text, hash(chunk.chunk_text), literals[i]]);
    }
    await client.query('COMMIT');
    return { source_path: source, doc_id: docId, chunks: chunks.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
