-- Modo de cada agente de IA escolhido pelo admin em Motor IA (off | shadow | apply).
-- Sem linha = padrão do env (AI_<AGENTE>_MODE). Idempotente para a receita manual de prod.
CREATE TABLE IF NOT EXISTS "ai_agent_settings" (
    "agent" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_agent_settings_pkey" PRIMARY KEY ("agent")
);
