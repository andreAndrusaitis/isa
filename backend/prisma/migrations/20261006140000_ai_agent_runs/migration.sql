-- Execuções dos agentes de IA (triagem e futuros). Idempotente para a receita manual de prod.
CREATE TABLE IF NOT EXISTS "ai_agent_runs" (
    "id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "ticket_id" TEXT,
    "mode" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "latency_ms" INTEGER NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_agent_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_agent_runs_agent_created_at_idx" ON "ai_agent_runs"("agent", "created_at");
CREATE INDEX IF NOT EXISTS "ai_agent_runs_ticket_id_idx" ON "ai_agent_runs"("ticket_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_agent_runs_ticket_id_fkey') THEN
    ALTER TABLE "ai_agent_runs" ADD CONSTRAINT "ai_agent_runs_ticket_id_fkey"
      FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
