import { AppError } from './errors.js';

export async function assertSchema(pg) {
  const { rows } = await pg.query(`SELECT format_type(a.atttypid, a.atttypmod) AS vector_type
    FROM pg_attribute a WHERE a.attrelid = 'public.kb_chunks'::regclass
    AND a.attname = 'embedding' AND NOT a.attisdropped`);
  if (rows[0]?.vector_type !== 'vector(1536)') {
    throw new AppError('DIMENSION_MISMATCH', '数据库不是 vector(1536)。检查 v-api 模型/调用名、重建向量列或新表隔离、重跑 ingest。');
  }
}
export async function assertProfile(pg, config, { create = false } = {}) {
  if (create) await pg.query(`INSERT INTO public.kb_settings (id, embedding_model, embedding_dim, base_url)
    VALUES (1, $1, $2, $3) ON CONFLICT (id) DO NOTHING`,
  [config.embeddingModel, config.embedDim, config.baseURL]);
  const { rows } = await pg.query('SELECT embedding_model, embedding_dim, base_url FROM public.kb_settings WHERE id = 1');
  const row = rows[0];
  if (!row) throw new AppError('KB_NOT_READY', '知识库尚未入库，请先运行 node scripts/ingest.js', 503);
  if (row.embedding_model !== config.embeddingModel || Number(row.embedding_dim) !== config.embedDim || row.base_url !== config.baseURL) {
    throw new AppError('EMBEDDING_PROFILE_MISMATCH', '检索和入库必须使用同一个 v-api 嵌入模型、同一维度和同一接口地址，否则结果无效。检查 v-api 模型/调用名、重建向量列或新表隔离、重跑 ingest。', 503);
  }
}
