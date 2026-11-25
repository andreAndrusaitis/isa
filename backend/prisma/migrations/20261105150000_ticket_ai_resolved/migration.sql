-- Chamado que a IA resolveu sem passar pela fila (FEAT-40). A marca sai quando o chamado é
-- reaberto. Default constante: o Postgres só grava no catálogo, sem reescrever a tabela.
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "ai_resolved" BOOLEAN NOT NULL DEFAULT false;
