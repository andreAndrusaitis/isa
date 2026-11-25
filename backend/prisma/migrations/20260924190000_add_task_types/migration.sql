-- AlterEnum
ALTER TYPE "TaskActivityType" ADD VALUE IF NOT EXISTS 'task_type_changed';

-- CreateTable
CREATE TABLE IF NOT EXISTS "task_types" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "task_types_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'task_types_project_id_fkey'
    ) THEN
        ALTER TABLE "task_types" ADD CONSTRAINT "task_types_project_id_fkey"
            FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "task_type_id" TEXT;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'tasks_task_type_id_fkey'
    ) THEN
        ALTER TABLE "tasks" ADD CONSTRAINT "tasks_task_type_id_fkey"
            FOREIGN KEY ("task_type_id") REFERENCES "task_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
