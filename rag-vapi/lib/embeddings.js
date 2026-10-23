import { AppError } from './errors.js';

export function validateVector(vector, expected = 1536) {
  if (!Array.isArray(vector) || vector.length !== expected) {
    throw new AppError('DIMENSION_MISMATCH', `v-api 返回维度 ${vector?.length ?? '未知'}，要求 ${expected}。检查 v-api 模型/调用名、重建向量列或新表隔离、重跑 ingest。`);
  }
  if (!vector.every(Number.isFinite) || !vector.some(n => n !== 0)) {
    throw new AppError('INVALID_EMBEDDING', 'v-api 返回非有限数值或零向量，不能进行余弦检索');
  }
  return vector;
}
export function vectorLiteral(vector) { return JSON.stringify(validateVector(vector)); }
export function createEmbedder(sdk, config) {
  if (config.embedDim !== 1536) {
    throw new AppError('DIMENSION_MISMATCH', '嵌入维度必须为1536。检查 v-api 模型/调用名、重建向量列或新表隔离、重跑 ingest。');
  }
  return async function embed(inputs, { signal } = {}) {
    if (!Array.isArray(inputs) || inputs.length === 0) throw new AppError('INVALID_INPUT', '嵌入输入不能为空', 400);
    for (const input of inputs) {
      // Conservative byte bound below 8K tokens for byte-level BPE; chunks <=800 code points <=3200 bytes.
      if (typeof input !== 'string' || !input.trim() || Buffer.byteLength(input, 'utf8') > 7500) {
        throw new AppError('INVALID_INPUT', '嵌入输入为空或超过安全输入字节上限 7500；请缩短问题或重新分块', 400);
      }
    }
    const response = await sdk.embeddings.create({ model: config.embeddingModel,
      input: inputs, encoding_format: 'float' }, { signal });
    if (!Array.isArray(response.data) || response.data.length !== inputs.length) {
      throw new AppError('INVALID_EMBEDDING', 'v-api 嵌入返回数量不完整，未写入数据库');
    }
    const result = new Array(inputs.length);
    for (const item of response.data) {
      if (!Number.isInteger(item.index) || item.index < 0 || item.index >= inputs.length || result[item.index]) {
        throw new AppError('INVALID_EMBEDDING', 'v-api 嵌入响应索引缺失、重复或越界');
      }
      try { result[item.index] = validateVector(item.embedding, config.embedDim); }
      catch (error) { error.embeddingIndex = item.index; throw error; }
    }
    return result;
  };
}
