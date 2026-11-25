-- Automações de roteamento: gatilhos, ordem configurável e histórico no chamado.
-- Aditiva e idempotente: regras existentes viram "ticket_created" + "para aqui" (comportamento atual).
ALTER TABLE "routing_rules" ADD COLUMN IF NOT EXISTS "trigger" TEXT NOT NULL DEFAULT 'ticket_created';
ALTER TABLE "routing_rules" ADD COLUMN IF NOT EXISTS "trigger_hours" INTEGER;
ALTER TABLE "routing_rules" ADD COLUMN IF NOT EXISTS "stop_processing" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "ticket_events" ADD COLUMN IF NOT EXISTS "routing_rule_id" TEXT;
CREATE INDEX IF NOT EXISTS "ticket_events_routing_rule_id_idx" ON "ticket_events"("routing_rule_id");

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'routing_alert';
