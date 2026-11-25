-- Remove sla_multiplier column from queues (feature removed, unused in SLA logic)
ALTER TABLE "queues" DROP COLUMN IF EXISTS "sla_multiplier";
