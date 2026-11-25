-- FEAT-31: base de conhecimento (artigos, categorias, trechos com vetor) e interações com a IA.
-- Só aditiva e idempotente: nenhuma tabela existente é alterada.
-- Exige a extensão pgvector no servidor; no Azure, "vector" precisa estar em azure.extensions.
CREATE EXTENSION IF NOT EXISTS vector;

DO $$ BEGIN
  CREATE TYPE "KnowledgeArticleStatus" AS ENUM ('draft', 'published');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AiInteractionFeedback" AS ENUM ('useful', 'not_useful');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "knowledge_articles" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "KnowledgeArticleStatus" NOT NULL DEFAULT 'draft',
    "source_filename" TEXT,
    "created_by_id" TEXT NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "published_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_articles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "knowledge_article_categories" (
    "id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_article_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "knowledge_chunks" (
    "id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ai_interactions" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT,
    "user_id" TEXT NOT NULL,
    "org_id" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "confidence" DOUBLE PRECISION,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "feedback" "AiInteractionFeedback",
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_interactions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "knowledge_articles_status_deleted_at_idx" ON "knowledge_articles"("status", "deleted_at");
CREATE INDEX IF NOT EXISTS "knowledge_article_categories_category_id_idx" ON "knowledge_article_categories"("category_id");
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_article_categories_article_id_category_id_key" ON "knowledge_article_categories"("article_id", "category_id");
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_chunks_article_id_position_key" ON "knowledge_chunks"("article_id", "position");
CREATE INDEX IF NOT EXISTS "ai_interactions_created_at_idx" ON "ai_interactions"("created_at");
CREATE INDEX IF NOT EXISTS "ai_interactions_user_id_created_at_idx" ON "ai_interactions"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "ai_interactions_org_id_created_at_idx" ON "ai_interactions"("org_id", "created_at");
CREATE INDEX IF NOT EXISTS "ai_interactions_ticket_id_idx" ON "ai_interactions"("ticket_id");

DO $$ BEGIN
  ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "knowledge_article_categories" ADD CONSTRAINT "knowledge_article_categories_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "knowledge_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "knowledge_article_categories" ADD CONSTRAINT "knowledge_article_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "knowledge_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ai_interactions" ADD CONSTRAINT "ai_interactions_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ai_interactions" ADD CONSTRAINT "ai_interactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ai_interactions" ADD CONSTRAINT "ai_interactions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
