-- Feedback humano sobre decisões da IA + data da primeira atribuição do chamado. Idempotente.
CREATE TABLE IF NOT EXISTS "ai_feedback" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "ai_value" TEXT,
    "ai_label" TEXT,
    "from_value" TEXT,
    "to_value" TEXT,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_feedback_run_id_idx" ON "ai_feedback"("run_id");
CREATE INDEX IF NOT EXISTS "ai_feedback_ticket_id_idx" ON "ai_feedback"("ticket_id");
CREATE INDEX IF NOT EXISTS "ai_feedback_agent_created_at_idx" ON "ai_feedback"("agent", "created_at");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_feedback_run_id_fkey') THEN
    ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_run_id_fkey"
      FOREIGN KEY ("run_id") REFERENCES "ai_agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_feedback_ticket_id_fkey') THEN
    ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_ticket_id_fkey"
      FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_feedback_user_id_fkey') THEN
    ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "first_assigned_at" TIMESTAMP(3);

-- Qualquer caminho de atribuição (manual, regra, API externa, redirecionamento) passa por aqui.
CREATE OR REPLACE FUNCTION set_ticket_first_assigned_at() RETURNS trigger AS $$
BEGIN
  IF NEW.assigned_to_id IS NOT NULL AND NEW.first_assigned_at IS NULL THEN
    NEW.first_assigned_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tickets_first_assigned_at ON "tickets";
CREATE TRIGGER tickets_first_assigned_at
  BEFORE INSERT OR UPDATE OF assigned_to_id ON "tickets"
  FOR EACH ROW EXECUTE FUNCTION set_ticket_first_assigned_at();

-- ponytail: UPDATE único no backfill; lotear se tickets passar de centenas de milhares de linhas
-- Retroativo (aproximação): 1º evento de troca de responsável, senão a abertura do chamado.
UPDATE "tickets" t SET "first_assigned_at" = COALESCE(
  (SELECT MIN(e."created_at") FROM "ticket_events" e
    WHERE e."ticket_id" = t."id" AND e."note" LIKE 'Alteração de responsável%'),
  t."created_at")
WHERE t."assigned_to_id" IS NOT NULL AND t."first_assigned_at" IS NULL;
