-- AlterEnum
ALTER TYPE "TaskActivityType" ADD VALUE IF NOT EXISTS 'sprint_changed';

-- CreateEnum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SprintStatus') THEN
        CREATE TYPE "SprintStatus" AS ENUM ('planned', 'active', 'completed');
    END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "sprints" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "SprintStatus" NOT NULL DEFAULT 'planned',
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sprints_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sprints_project_id_fkey'
    ) THEN
        ALTER TABLE "sprints" ADD CONSTRAINT "sprints_project_id_fkey"
            FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "sprint_id" TEXT;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tasks_sprint_id_fkey'
    ) THEN
        ALTER TABLE "tasks" ADD CONSTRAINT "tasks_sprint_id_fkey"
            FOREIGN KEY ("sprint_id") REFERENCES "sprints"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
