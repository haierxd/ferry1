import { readFile, writeFile } from 'node:fs/promises';

// Fixed allowlist: never glob .env, logs, node_modules or unrelated user files.
const files = [
  '.env.example', 'package.json', 'pgvector.sql', 'mysql.sql',
  'lib/config.js', 'lib/pg.js', 'lib/mysql.js', 'lib/db.js', 'lib/errors.js',
  'lib/vapi.js', 'lib/embeddings.js', 'lib/chunker.js', 'lib/chunk.js',
  'lib/profile.js', 'lib/ingestion.js', 'lib/retrieve.js', 'lib/auth.js', 'lib/prompt.js',
  'routes/ask.js', 'server.js', 'scripts/init-db.js', 'scripts/prepare-knowledge.js',
  'scripts/ingest.js', 'scripts/export-source.js', 'tests/agents.test.js',
  'tests/core.test.js', 'tests/config.test.js', 'tests/ingest.test.js', 'tests/ask.test.js'
];
const aFiles = new Set(['lib/chunker.js', 'lib/chunk.js', 'lib/ingestion.js',
  'scripts/ingest.js', 'scripts/prepare-knowledge.js', 'tests/ingest.test.js']);
const bFiles = new Set(['lib/mysql.js', 'lib/retrieve.js', 'lib/auth.js', 'lib/prompt.js',
  'routes/ask.js', 'server.js', 'mysql.sql', 'tests/ask.test.js']);
const root = new URL('../', import.meta.url);
const intro = await readFile(new URL('TWO_AGENTS.md', root), 'utf8');
const parts = [intro, '\n---\n\n# 完整可运行源码\n'];
for (const file of files) {
  const source = await readFile(new URL(file, root), 'utf8');
  const language = file.endsWith('.js') ? 'javascript' : file.endsWith('.sql') ? 'sql' : file.endsWith('.json') ? 'json' : 'dotenv';
  const role = aFiles.has(file) ? 'A 独有' : bFiles.has(file) ? 'B 独有' : '共享';
  const fence = '`'.repeat(4);
  parts.push(`\n## ${file}（${role}）\n\n${fence}${language}\n${source}\n${fence}\n`);
}
await writeFile(new URL('COMPLETE_SOURCE.md', root), parts.join('\n'), 'utf8');
console.log(`Exported ${files.length} source files; no real .env included.`);
