-- Run in a dedicated PostgreSQL database, with pgvector >=0.5 installed on the server.
BEGIN;
CREATE EXTENSION IF NOT EXISTS vector;

-- One immutable embedding profile per knowledge database. No keys are stored.
CREATE TABLE IF NOT EXISTS public.kb_settings (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  embedding_model TEXT NOT NULL,
  embedding_dim INTEGER NOT NULL CHECK (embedding_dim = 1536),
  base_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.kb_documents (
  id BIGSERIAL PRIMARY KEY,
  source_path TEXT NOT NULL UNIQUE,
  content_hash CHAR(64) NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding_dim INTEGER NOT NULL CHECK (embedding_dim = 1536),
  chunker_version TEXT NOT NULL,
  chunk_count INTEGER NOT NULL CHECK (chunk_count >= 0),
  file_mtime TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, source_path)
);
ALTER TABLE public.kb_documents ADD COLUMN IF NOT EXISTS file_mtime TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.kb_chunks (
  id BIGSERIAL PRIMARY KEY,
  doc_id BIGINT NOT NULL,
  source_path TEXT NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  chunk_text TEXT NOT NULL CHECK (length(chunk_text) > 0 AND length(chunk_text) <= 800),
  content_hash CHAR(64) NOT NULL,
  embedding vector(1536) NOT NULL,
  FOREIGN KEY (doc_id, source_path) REFERENCES public.kb_documents(id, source_path) ON DELETE CASCADE,
  UNIQUE (source_path, chunk_index)
);
CREATE INDEX IF NOT EXISTS kb_chunks_doc_id_idx ON public.kb_chunks(doc_id);
CREATE INDEX IF NOT EXISTS kb_chunks_embedding_hnsw_idx ON public.kb_chunks
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
COMMIT;

-- Each ingest transaction locks, upserts a document, deletes obsolete tail chunks and
-- upserts the replacement set. Failure rolls back all changes, preserving the old file.
-- IF NOT EXISTS does NOT migrate an existing vector column/model. Use a fresh database
-- or explicitly rebuild/isolate the tables, then rerun ingest when changing models/dimensions.
