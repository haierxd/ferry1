import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

test('同名文档使用可区分的引用标签，拒绝歧义出处', async () => {
  const { buildReferences, assertAnswerReferences } = await import('../lib/prompt.js');
  const refs = buildReferences(['a/document.md', 'b/document.md'].map((source_path, i) =>
    ({ source_path, chunk_index: 0, doc_id: String(i), score: 0.9, chunk_text: '正文' })));
  assert.deepEqual(refs.map(r => r.citation_label), ['a/document.md#0', 'b/document.md#0']);
  assert.equal(refs[0].filename, 'document.md');
  assert.throws(() => assertAnswerReferences('正文 [document.md#0]', refs), /出处/);
  assert.doesNotThrow(() => assertAnswerReferences('正文 [a/document.md#0]', refs));
});

test('分块保留全部正文、识别标题并限制 Unicode 字符数', async () => {
  const { chunkText } = await import('../lib/chunk.js');
  const long = '甲方资料😀参数'.repeat(240);
  const source = '# 公司\n正文\n## 采购\n' + long + '\n## 附录\n结束';
  const chunks = chunkText(source);
  assert.ok(chunks.length > 3);
  assert.ok(chunks.every(c => Array.from(c.chunk_text).length <= 800));
  assert.deepEqual(chunks.map(c => c.chunk_index), chunks.map((_, i) => i));
  const normalize = s => s.replace(/\s/g, '');
  assert.equal(normalize(chunks.map(c => c.chunk_text).join('')), normalize(source));
});

test('代码块内的 # 不作为章节边界；大段按 400–800 字拆分', async () => {
  const { chunkText } = await import('../lib/chunk.js');
  assert.equal(chunkText('```md\n# 不是标题\n## 也不是\n```').length, 1);
  const chunks = chunkText('中'.repeat(1601));
  assert.ok(chunks.every(c => c.chunk_text.length >= 400 && c.chunk_text.length <= 800));
});

test('嵌入只调用 embeddings 并对维度、输入及响应索引做硬检查', async () => {
  const { createEmbedder } = await import('../lib/embeddings.js');
  const cfg = { embeddingModel: 'vendor/text-embedding-3-small', embedDim: 1536 };
  let request;
  const sdk = { embeddings: { create: async req => {
    request = req;
    return { data: [{ index: 1, embedding: Array(1536).fill(0.1) }, { index: 0, embedding: Array(1536).fill(0.2) }] };
  } } };
  const embed = createEmbedder(sdk, cfg);
  const vectors = await embed(['问题一', '问题二']);
  assert.equal(request.model, cfg.embeddingModel);
  assert.equal(request.encoding_format, 'float');
  assert.equal(vectors[0][0], 0.2);
  sdk.embeddings.create = async () => ({ data: [{ index: 0, embedding: [1, 2] }] });
  await assert.rejects(embed(['问题']), /检查 v-api 模型\/调用名.*重建向量列或新表隔离.*重跑 ingest/);
  await assert.rejects(embed(['😀'.repeat(2100)]), /输入.*上限/);
});

test('检索参数化、绑定目录和模型，直接以余弦距离排序', async () => {
  const { createRetriever } = await import('../lib/retrieve.js');
  const cfg = { knowledgeDir: 'D:/test2/docs/甲方资料', embeddingModel: 'embed', embedDim: 1536, topK: 5, baseURL: 'https://vapi.invalid/v1' };
  let query;
  const pg = { query: async (sql, values) => { query = { sql, values }; return { rows: [{ chunk_text: '资料', score: 0.9 }] }; } };
  const retrieve = createRetriever({ pg, config: cfg, embed: async () => [Array(1536).fill(0.1)], assertProfile: async () => {} });
  await retrieve('采购权限', { directory: "部门' OR 1=1 --" });
  assert.match(query.sql, /ORDER BY c\.embedding <=> \$1::vector/);
  assert.ok(!query.sql.includes("OR 1=1 --"));
  assert.equal(query.values[1], 5);
  assert.ok(query.values.includes('embed'));
  await assert.rejects(retrieve('问题', { directory: '../外部目录' }), /目录/);
});

test('嵌入配置不一致时必须拒绝检索', async () => {
  const { assertProfile } = await import('../lib/profile.js');
  const pg = { query: async () => ({ rows: [{ embedding_model: 'old', embedding_dim: 1536, base_url: 'https://vapi.invalid/v1' }] }) };
  await assert.rejects(assertProfile(pg, { embeddingModel: 'new', embedDim: 1536, baseURL: 'https://vapi.invalid/v1' }), /同一.*模型.*维度/);
});

test('真实检索行映射为出处摘要，Unicode 摘要最多200字，不混入原文全量', async () => {
  const { buildReferences, buildPrompt } = await import('../lib/prompt.js');
  const text = '参数😀'.repeat(180);
  const chunks = [{ source_path: 'folder\\规则.md', chunk_index: 3, doc_id: '12', score: '0.91', chunk_text: text }];
  const refs = buildReferences(chunks, '参数😀');
  assert.equal(refs[0].filename, '规则.md');
  assert.equal(refs[0].source_path, chunks[0].source_path);
  assert.equal(refs[0].score, 0.91);
  assert.equal(refs[0].exact_match, true);
  assert.equal(Array.from(refs[0].snippet).length, 200);
  assert.equal(refs[0].chunk_text, undefined);
  assert.ok(!JSON.stringify(refs).includes(text));
  const prompt = buildPrompt('参数😀', chunks);
  assert.match(prompt.messages[0].content, /文件名#块号/);
  assert.ok(prompt.messages[1].content.includes(text));
  assert.equal(prompt.citations[0].file, '规则.md');
});

test('按出处分组：不合并同名不同路径文档，块和分组均按score降序，不改原数组', async () => {
  const { groupReferencesBySource } = await import('../lib/prompt.js');
  const refs = [
    { source_path: 'a/规则.md', filename: '规则.md', chunk_index: 0, score: 0.4 },
    { source_path: 'b/规则.md', filename: '规则.md', chunk_index: 0, score: 0.8 },
    { source_path: 'a/规则.md', filename: '规则.md', chunk_index: 1, score: 0.9 }
  ];
  const groups = groupReferencesBySource(refs);
  assert.deepEqual(groups.map(g => g.source_path), ['a/规则.md', 'b/规则.md']);
  assert.deepEqual(groups[0].references.map(r => r.chunk_index), [1, 0]);
  assert.equal(refs[0].score, 0.4);
});

test('复用retrieve真实返回契约，问题向量化后可生成references及retrieved_count', async () => {
  const { createRetriever } = await import('../lib/retrieve.js');
  const { buildPrompt } = await import('../lib/prompt.js');
  const root = path.resolve('knowledge-test');
  const row = { source_path: root.replaceAll('\\', '/') + '/制度.md',
    chunk_index: 0, doc_id: '9', score: 0.98, chunk_text: '该句来自制度。', api_key: 'must-not-leak' };
  let embedded;
  const retrieve = createRetriever({ config: { knowledgeDir: root, topK: 5, embeddingModel: 'same-ingest-model', embedDim: 1536 },
    pg: { query: async () => ({ rows: [row] }) }, assertProfile: async () => {},
    embed: async texts => { embedded = texts; return [Array(1536).fill(0.1)]; } });
  const result = buildPrompt('该句来自制度。', await retrieve('该句来自制度。'));
  assert.deepEqual(embedded, ['该句来自制度。']);
  assert.equal(result.retrieved_count, 1);
  assert.equal(result.references[0].filename, '制度.md');
  assert.equal(result.references[0].exact_match, true);
  assert.equal(result.references[0].snippet, row.chunk_text);
  assert.ok(!JSON.stringify(result.references).includes('must-not-leak'));
});
