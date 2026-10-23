import path from 'node:path';
import { AppError } from './errors.js';
import { vectorLiteral } from './embeddings.js';
import { assertProfile as checkProfile } from './profile.js';

export function sourcePrefix(root, directory = '') {
  if (typeof directory !== 'string' || directory.length > 1000) throw new AppError('INVALID_FILTER', '目录过滤参数无效', 400);
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, directory);
  const relative = path.relative(resolvedRoot, candidate);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new AppError('INVALID_FILTER', '目录过滤不能超出 KNOWLEDGE_DIR', 400);
  }
  return candidate.replaceAll('\\', '/').replace(/\/$/, '') + '/';
}
export function createRetriever({ pg, embed, config, assertProfile = checkProfile }) {
  return async function retrieve(question, { topK = config.topK, directory = '', source_path, signal } = {}) {
    if (!Number.isInteger(topK) || topK < 1 || topK > 20) throw new AppError('INVALID_TOP_K', 'topK 必须为 1–20 的整数', 400);
    const prefix = sourcePrefix(config.knowledgeDir, directory);
    let source = null;
    if (source_path !== undefined) {
      if (typeof source_path !== 'string' || !source_path.trim() || source_path.length > 2000 || source_path.includes('\0')) {
        throw new AppError('INVALID_FILTER', 'source_path 必须为知识根目录内的文件路径', 400);
      }
      const root = path.resolve(config.knowledgeDir);
      const candidate = path.resolve(root, source_path);
      const relative = path.relative(root, candidate);
      if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
        throw new AppError('INVALID_FILTER', 'source_path 不能超出知识根目录', 400);
      }
      source = path.join(root, relative).replaceAll('\\', '/');
    }
    await assertProfile(pg, config);
    const [vector] = await embed([question], { signal });
    const { rows } = await pg.query(`SELECT c.chunk_text, 1 - (c.embedding <=> $1::vector) AS score,
      c.source_path, c.chunk_index, c.doc_id::text AS doc_id
      FROM public.kb_chunks c JOIN public.kb_documents d ON d.id = c.doc_id
      WHERE d.embedding_model = $3 AND d.embedding_dim = $4
        AND left(c.source_path, char_length($5)) = $5
        AND ($6::text IS NULL OR c.source_path = $6)
      ORDER BY c.embedding <=> $1::vector LIMIT $2`,
    [vectorLiteral(vector), topK, config.embeddingModel, config.embedDim, prefix, source]);
    return rows;
  };
}
