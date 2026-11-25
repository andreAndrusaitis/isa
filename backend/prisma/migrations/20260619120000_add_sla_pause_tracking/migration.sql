-- AlterTable: add SLA pause tracking fields to tickets
-- sla_paused_at: timestamp when the SLA clock was paused (ticket entered "pending")
-- total_paused_minutes: cumulative business-minutes the SLA was paused across all pending cycles
ALTER TABLE "tickets" ADD COLUMN "sla_paused_at" TIMESTAMP(3);
ALTER TABLE "tickets" ADD COLUMN "total_paused_minutes" INTEGER NOT NULL DEFAULT 0;
