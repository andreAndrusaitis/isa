-- Webhooks deixam de pertencer a um único projeto (project_id nullable) e
-- passam a ter uma lista de projetos aos quais se aplicam (tabela de junção).
-- Sem nenhuma linha em project_webhook_projects = webhook global, mesma
-- semântica que project_id NULL tinha antes.
-- Escrita idempotente: ver convenção em 20260919120000_projects_phase6.

-- Tabela de junção nova
CREATE TABLE IF NOT EXISTS "project_webhook_projects" (
  "webhook_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  CONSTRAINT "project_webhook_projects_pkey" PRIMARY KEY ("webhook_id", "project_id")
);

CREATE INDEX IF NOT EXISTS "project_webhook_projects_project_id_idx" ON "project_webhook_projects"("project_id");

DO $$ BEGIN
  ALTER TABLE "project_webhook_projects"
    ADD CONSTRAINT "project_webhook_projects_webhook_id_fkey"
    FOREIGN KEY ("webhook_id") REFERENCES "project_webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "project_webhook_projects"
    ADD CONSTRAINT "project_webhook_projects_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Migra dados existentes: cada webhook com project_id preenchido vira uma
-- linha na tabela de junção; os que já eram globais (project_id NULL)
-- continuam globais (nenhuma linha).
INSERT INTO "project_webhook_projects" ("webhook_id", "project_id")
SELECT "id", "project_id" FROM "project_webhooks" WHERE "project_id" IS NOT NULL
ON CONFLICT DO NOTHING;

-- Remove a FK e a coluna antiga de project_webhooks.
DO $$ BEGIN
  ALTER TABLE "project_webhooks" DROP CONSTRAINT "project_webhooks_project_id_fkey";
EXCEPTION WHEN undefined_object THEN NULL; END $$;

DROP INDEX IF EXISTS "project_webhooks_project_id_active_idx";
CREATE INDEX IF NOT EXISTS "project_webhooks_active_idx" ON "project_webhooks"("active");

ALTER TABLE "project_webhooks" DROP COLUMN IF EXISTS "project_id";
