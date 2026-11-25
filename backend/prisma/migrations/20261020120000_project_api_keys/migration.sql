-- API pública de Projetos: chaves isaproj_ com usuário de serviço e log de requisições
-- compartilhado com a API de chamados. Só aditiva e idempotente.

-- Usuário técnico de uma chave: não faz login nem aparece na gestão de usuários.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_service_account" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "project_api_keys" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "key_hash" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "scopes" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "service_user_id" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_api_keys_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "project_api_key_projects" (
    "api_key_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,

    CONSTRAINT "project_api_key_projects_pkey" PRIMARY KEY ("api_key_id","project_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "project_api_keys_key_hash_key" ON "project_api_keys"("key_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "project_api_keys_service_user_id_key" ON "project_api_keys"("service_user_id");
CREATE INDEX IF NOT EXISTS "project_api_key_projects_project_id_idx" ON "project_api_key_projects"("project_id");

-- O log passa a ser de uma das duas chaves: api_key_id deixa de ser obrigatório (nenhum dado muda).
ALTER TABLE "api_request_logs" ADD COLUMN IF NOT EXISTS "project_api_key_id" TEXT;
ALTER TABLE "api_request_logs" ALTER COLUMN "api_key_id" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS "api_request_logs_project_api_key_id_created_at_idx" ON "api_request_logs"("project_api_key_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "api_request_logs_project_api_key_id_external_request_id_key" ON "api_request_logs"("project_api_key_id", "external_request_id");

DO $$ BEGIN
  ALTER TABLE "api_request_logs" ADD CONSTRAINT "api_request_logs_project_api_key_id_fkey" FOREIGN KEY ("project_api_key_id") REFERENCES "project_api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "project_api_keys" ADD CONSTRAINT "project_api_keys_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "project_api_keys" ADD CONSTRAINT "project_api_keys_service_user_id_fkey" FOREIGN KEY ("service_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "project_api_key_projects" ADD CONSTRAINT "project_api_key_projects_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "project_api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "project_api_key_projects" ADD CONSTRAINT "project_api_key_projects_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
