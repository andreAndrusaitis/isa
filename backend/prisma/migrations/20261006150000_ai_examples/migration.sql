-- Exemplos rotulados para RAG dos agentes de IA. Idempotente para a receita manual de prod.
-- ponytail: embedding como double precision[] (sem pgvector); upgrade = vector(1536) + HNSW.
CREATE TABLE IF NOT EXISTS "ai_examples" (
    "id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "labels" JSONB NOT NULL,
    "embedding" DOUBLE PRECISION[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_examples_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_examples_agent_source_source_id_key" ON "ai_examples"("agent", "source", "source_id");
CREATE INDEX IF NOT EXISTS "ai_examples_agent_idx" ON "ai_examples"("agent");
