-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "my_tasks_columns" JSONB;
