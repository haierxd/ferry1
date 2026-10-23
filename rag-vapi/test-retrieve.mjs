import { loadEnv, readConfig } from './lib/config.js';
import { createPgPool } from './lib/pg.js';
import { createAgentVapi } from './lib/vapi.js';
import { createRetriever } from './lib/retrieve.js';
import { assertSchema } from './lib/profile.js';
import { referencesFromHits } from './routes/ask.js';
import { AppError, safeError } from './lib/errors.js';

async function main() {
let pg;
try {
  loadEnv();
  const question = process.argv.slice(2).join(' ').trim();
  if (!question) throw new AppError('INVALID_QUESTION', '用法：node test-retrieve.mjs "问题"', 400);
  const config = readConfig(process.env, { mode: 'ingest' });
  pg = createPgPool(process.env, { readOnly: true });
  await assertSchema(pg);
  const vapi = createAgentVapi(config, { role: 'ingest' });
  const retrieve = createRetriever({ pg, config, embed: vapi.embedTexts });
  const hits = await retrieve(question, { topK: 3 });
  console.log(JSON.stringify({ references: referencesFromHits(hits), retrieved_count: hits.length }, null, 2));
} catch (error) {
  console.error(safeError(error));
  process.exitCode = 1;
} finally {
  if (pg) await pg.end();
}
}

if (process.env.NODE_TEST_CONTEXT) {
  const { test } = await import('node:test');
  test('手动Top-3检索工具，不在单测中访问v-api', { skip: true }, () => {});
} else await main();
