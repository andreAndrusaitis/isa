-- AlterTable
ALTER TABLE "inactivity_redirect_config" ADD COLUMN IF NOT EXISTS "max_redirects_per_day" INTEGER NOT NULL DEFAULT 1;
