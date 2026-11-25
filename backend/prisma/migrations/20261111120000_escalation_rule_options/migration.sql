-- Regras de escalonamento: opções de destino e de comportamento (aditiva, idempotente).
-- target_mode: 'queue' (fila) | 'agent_pick' (analista escolhido na hora) | 'agent_fixed' (analista fixo).
ALTER TABLE "escalation_rules" ADD COLUMN IF NOT EXISTS "target_mode" TEXT NOT NULL DEFAULT 'queue';
ALTER TABLE "escalation_rules" ADD COLUMN IF NOT EXISTS "target_agent_id" TEXT;
-- Quem escalonou continua no chamado (transferência) ou acompanha o filho, como colaborador.
ALTER TABLE "escalation_rules" ADD COLUMN IF NOT EXISTS "keep_origin" BOOLEAN NOT NULL DEFAULT false;
-- Exige justificativa de quem escalona (vai para a nota interna e para o chamado filho).
ALTER TABLE "escalation_rules" ADD COLUMN IF NOT EXISTS "require_note" BOOLEAN NOT NULL DEFAULT false;
-- Prioridade aplicada ao escalonar (null = mantém).
ALTER TABLE "escalation_rules" ADD COLUMN IF NOT EXISTS "target_priority" TEXT;
-- Filas em que a regra aparece (vazio = todas).
ALTER TABLE "escalation_rules" ADD COLUMN IF NOT EXISTS "source_queue_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Atuação unificada sem fila sempre foi "analista escolhido na hora".
UPDATE "escalation_rules" SET "target_mode" = 'agent_pick'
 WHERE "type" IN ('same_ticket', 'child_ticket') AND "target_queue_id" IS NULL AND "target_mode" = 'queue';
