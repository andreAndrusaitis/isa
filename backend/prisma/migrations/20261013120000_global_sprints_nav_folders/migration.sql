-- Sprints globais por Gerente (replicados nos projetos que seguem o calendário)
-- e pastas compartilhadas da sidebar de Projetos. Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS "global_sprints" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "SprintStatus" NOT NULL DEFAULT 'planned',
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "global_sprints_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "global_sprints_owner_id_idx" ON "global_sprints"("owner_id");

CREATE TABLE IF NOT EXISTS "project_nav_folders" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_nav_folders_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "sprints" ADD COLUMN IF NOT EXISTS "global_sprint_id" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "sprint_source_id" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "nav_folder_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "sprints_project_id_global_sprint_id_key" ON "sprints"("project_id", "global_sprint_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'global_sprints_owner_id_fkey') THEN
    ALTER TABLE "global_sprints" ADD CONSTRAINT "global_sprints_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_nav_folders_parent_id_fkey') THEN
    ALTER TABLE "project_nav_folders" ADD CONSTRAINT "project_nav_folders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "project_nav_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sprints_global_sprint_id_fkey') THEN
    ALTER TABLE "sprints" ADD CONSTRAINT "sprints_global_sprint_id_fkey" FOREIGN KEY ("global_sprint_id") REFERENCES "global_sprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_sprint_source_id_fkey') THEN
    ALTER TABLE "projects" ADD CONSTRAINT "projects_sprint_source_id_fkey" FOREIGN KEY ("sprint_source_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_nav_folder_id_fkey') THEN
    ALTER TABLE "projects" ADD CONSTRAINT "projects_nav_folder_id_fkey" FOREIGN KEY ("nav_folder_id") REFERENCES "project_nav_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
