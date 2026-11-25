-- Fix ID-356: o limiar de escalonamento automático (30min antes do vencimento
-- de SLA) estava fixo no código (slaChecker.ts), sem campo correspondente no
-- SLAPanel. Agora é configurável por tier via SlaConfig.escalation_minutes.
ALTER TABLE "sla_configs" ADD COLUMN "escalation_minutes" INTEGER NOT NULL DEFAULT 30;
