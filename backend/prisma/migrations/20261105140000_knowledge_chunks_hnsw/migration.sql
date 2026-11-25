-- FEAT-34: índice vetorial da busca por similaridade (distância de cosseno).
-- Só aditiva e idempotente. O schema não sabe representar este índice: migrate diff
-- e db push o propõem como DROP. Nunca aceitar esse DROP (filtrar o diff à mão).
CREATE INDEX IF NOT EXISTS "knowledge_chunks_embedding_hnsw_idx" ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);

-- Republicar artigo deixa linhas mortas, e o HNSW com filtro pode perder trecho vivo por causa delas.
ALTER TABLE "knowledge_chunks" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 50);
