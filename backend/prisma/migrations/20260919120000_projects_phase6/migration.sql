-- Projetos Fase 6: milestones, recorrencia, watchers, relacoes, favoritos,
-- filtros salvos, views personalizadas e webhooks proprios do modulo.
-- Escrita idempotente: prod ja teve drift reconciliado manualmente antes.

-- Enums novos
DO $$ BEGIN
  CREATE TYPE "TaskRelationType" AS ENUM ('relates_to', 'duplicates', 'causes');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "FavoriteEntityType" AS ENUM ('project', 'document');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CustomViewType" AS ENUM ('board', 'list', 'calendar', 'gantt', 'timeline');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Novos valores no enum de atividade
ALTER TYPE "TaskActivityType" ADD VALUE IF NOT EXISTS 'milestone_changed';
ALTER TYPE "TaskActivityType" ADD VALUE IF NOT EXISTS 'watcher_added';
ALTER TYPE "TaskActivityType" ADD VALUE IF NOT EXISTS 'watcher_removed';
ALTER TYPE "TaskActivityType" ADD VALUE IF NOT EXISTS 'relation_added';
ALTER TYPE "TaskActivityType" ADD VALUE IF NOT EXISTS 'relation_removed';
ALTER TYPE "TaskActivityType" ADD VALUE IF NOT EXISTS 'approval_requested';
ALTER TYPE "TaskActivityType" ADD VALUE IF NOT EXISTS 'approval_decided';

-- Task: milestone + recorrencia
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "is_milestone" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "recurrence" JSONB;

CREATE INDEX IF NOT EXISTS "tasks_project_id_archived_at_idx" ON "tasks"("project_id", "archived_at");
CREATE INDEX IF NOT EXISTS "tasks_assignee_id_due_date_idx" ON "tasks"("assignee_id", "due_date");

-- Watchers
CREATE TABLE IF NOT EXISTS "task_watchers" (
  "task_id"    TEXT NOT NULL,
  "user_id"    TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_watchers_pkey" PRIMARY KEY ("task_id", "user_id")
);

-- Relacoes entre tasks
CREATE TABLE IF NOT EXISTS "task_relations" (
  "id"           TEXT NOT NULL,
  "from_task_id" TEXT NOT NULL,
  "to_task_id"   TEXT NOT NULL,
  "type"         "TaskRelationType" NOT NULL DEFAULT 'relates_to',
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_relations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "task_relations_from_task_id_to_task_id_key" ON "task_relations"("from_task_id", "to_task_id");

-- Favoritos
CREATE TABLE IF NOT EXISTS "project_favorites" (
  "id"          TEXT NOT NULL,
  "user_id"     TEXT NOT NULL,
  "entity_type" "FavoriteEntityType" NOT NULL,
  "entity_id"   TEXT NOT NULL,
  "project_id"  TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_favorites_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "project_favorites_user_id_entity_type_entity_id_key" ON "project_favorites"("user_id", "entity_type", "entity_id");

-- Filtros salvos
CREATE TABLE IF NOT EXISTS "project_saved_filters" (
  "id"         TEXT NOT NULL,
  "user_id"    TEXT NOT NULL,
  "project_id" TEXT,
  "name"       TEXT NOT NULL,
  "filters"    JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_saved_filters_pkey" PRIMARY KEY ("id")
);

-- Views personalizadas
CREATE TABLE IF NOT EXISTS "project_custom_views" (
  "id"         TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "type"       "CustomViewType" NOT NULL,
  "filters"    JSONB,
  "group_by"   TEXT,
  "sort_by"    TEXT,
  "position"   INTEGER NOT NULL DEFAULT 0,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_custom_views_pkey" PRIMARY KEY ("id")
);

-- Webhooks do modulo
CREATE TABLE IF NOT EXISTS "project_webhooks" (
  "id"          TEXT NOT NULL,
  "project_id"  TEXT,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "url"         TEXT NOT NULL,
  "secret"      TEXT NOT NULL,
  "events"      TEXT[],
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "created_by"  TEXT NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "project_webhooks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "project_webhooks_project_id_active_idx" ON "project_webhooks"("project_id", "active");

CREATE TABLE IF NOT EXISTS "project_webhook_deliveries" (
  "id"              TEXT NOT NULL,
  "webhook_id"      TEXT NOT NULL,
  "event_id"        TEXT NOT NULL,
  "event"           TEXT NOT NULL,
  "payload"         JSONB NOT NULL,
  "status"          "WebhookDeliveryStatus" NOT NULL DEFAULT 'pending',
  "attempts"        INTEGER NOT NULL DEFAULT 0,
  "next_retry_at"   TIMESTAMP(3),
  "response_status" INTEGER,
  "response_body"   TEXT,
  "error_message"   TEXT,
  "duration_ms"     INTEGER,
  "delivered_at"    TIMESTAMP(3),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "project_webhook_deliveries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "project_webhook_deliveries_status_next_retry_at_idx" ON "project_webhook_deliveries"("status", "next_retry_at");
CREATE INDEX IF NOT EXISTS "project_webhook_deliveries_webhook_id_created_at_idx" ON "project_webhook_deliveries"("webhook_id", "created_at");

-- Foreign keys (idempotentes)
DO $$ BEGIN
  ALTER TABLE "task_watchers" ADD CONSTRAINT "task_watchers_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "task_watchers" ADD CONSTRAINT "task_watchers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "task_relations" ADD CONSTRAINT "task_relations_from_task_id_fkey" FOREIGN KEY ("from_task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "task_relations" ADD CONSTRAINT "task_relations_to_task_id_fkey" FOREIGN KEY ("to_task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "project_favorites" ADD CONSTRAINT "project_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "project_favorites" ADD CONSTRAINT "project_favorites_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "project_saved_filters" ADD CONSTRAINT "project_saved_filters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "project_saved_filters" ADD CONSTRAINT "project_saved_filters_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "project_custom_views" ADD CONSTRAINT "project_custom_views_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "project_custom_views" ADD CONSTRAINT "project_custom_views_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "project_webhooks" ADD CONSTRAINT "project_webhooks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "project_webhooks" ADD CONSTRAINT "project_webhooks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "project_webhook_deliveries" ADD CONSTRAINT "project_webhook_deliveries_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "project_webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
