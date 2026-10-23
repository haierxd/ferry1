\conninfo
SELECT version();
SHOW server_encoding;
SHOW data_directory;
SHOW listen_addresses;
SHOW password_encryption;
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
BEGIN;
CREATE TABLE public.codex_pgvector_install_verification (id int PRIMARY KEY, embedding vector(3));
INSERT INTO public.codex_pgvector_install_verification VALUES (1, '[1,0,0]'), (2, '[0,1,0]'), (3, '[0,0,1]');
CREATE INDEX ON public.codex_pgvector_install_verification USING hnsw (embedding vector_cosine_ops);
SELECT id, embedding <=> '[1,0,0]' AS cosine_distance FROM public.codex_pgvector_install_verification ORDER BY embedding <=> '[1,0,0]' LIMIT 1;
DO $$ BEGIN
    IF (SELECT id FROM public.codex_pgvector_install_verification ORDER BY embedding <=> '[1,0,0]' LIMIT 1) <> 1 THEN
        RAISE EXCEPTION 'Nearest-neighbor result is incorrect';
    END IF;
END $$;
ROLLBACK;
