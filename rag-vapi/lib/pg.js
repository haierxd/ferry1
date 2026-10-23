// Shared connection factory. A uses writable connections; B explicitly requests readOnly.
import pg from 'pg';
import { databaseConfig } from './config.js';

export function createPgPool(env = process.env, { readOnly = false } = {}) {
  return new pg.Pool({ ...databaseConfig('pg', env), max: 5,
    connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000,
    statement_timeout: 30000, application_name: readOnly ? 'vapi-rag-B' : 'vapi-rag-A',
    ...(readOnly ? { options: '-c default_transaction_read_only=on' } : {}) });
}
