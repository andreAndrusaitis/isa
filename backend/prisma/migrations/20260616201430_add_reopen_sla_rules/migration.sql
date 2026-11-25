-- AlterTable
ALTER TABLE "reopen_sla_config" ADD COLUMN     "reopen_deadline_hours" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "reopen_deadline_rule" TEXT NOT NULL DEFAULT 'org_sla';
