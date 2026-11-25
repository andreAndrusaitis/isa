-- AlterEnum
ALTER TYPE "TaskActivityType" ADD VALUE IF NOT EXISTS 'story_points_changed';

-- AlterTable
ALTER TABLE "project_statuses" ADD COLUMN IF NOT EXISTS "wip_limit" INTEGER;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "story_points" INTEGER;
