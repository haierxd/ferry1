import { loadEnv, readConfig } from '../lib/config.js';
import { createVapi } from '../lib/vapi.js';
import { createEmbedder } from '../lib/embeddings.js';
import { isMain, runCheck, display } from './check-env.js';

export async function checkEmbed() {
  loadEnv();
  const config = readConfig(process.env, { mode: 'ingest' });
  const embedClient = createVapi(config);
  console.log('开始通过已配置的 v-api /v1/embeddings 请求“测试”（可能产生少量 API 费用）。');
  // Observe the response before the existing embedder validates the dimension,
  // so a mismatched response still produces the requested diagnostic table.
  const observedClient = { embeddings: { async create(...args) {
    const response = await embedClient.embeddings.create(...args);
    const dim = Array.isArray(response.data?.[0]?.embedding) ? response.data[0].embedding.length : null;
    console.table([{ '模型名': display(config.embeddingModel), '返回维度': dim ?? '无有效向量',
      'VAPI_EMBED_DIM': config.embedDim, '是否相等': dim === config.embedDim ? '✅ 是' : '❌ 否' }]);
    return response;
  } } };
  try {
    await createEmbedder(observedClient, config)(['测试']);
  } catch (error) {
    if (Number(error?.status) !== 404) throw error;
    console.error('❌ 模型名不被 v-api 识别，请去控制台确认调用名');
    console.log('汇总：FAIL');
    process.exitCode = 1;
    return;
  }
  console.log('✅ embedding 请求、返回结构、非零有限向量及维度校验通过。');
  console.log('汇总：PASS');
}
if (isMain(import.meta.url)) await runCheck(checkEmbed);
