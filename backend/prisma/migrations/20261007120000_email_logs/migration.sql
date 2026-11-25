-- Log de envios de e-mail (tela admin "Logs de E-mail"). Idempotente para a receita manual de prod.
CREATE TABLE IF NOT EXISTS "email_logs" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "ticket_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "email_logs_created_at_idx" ON "email_logs"("created_at");
CREATE INDEX IF NOT EXISTS "email_logs_ticket_id_idx" ON "email_logs"("ticket_id");

DO $$ BEGIN
  ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_ticket_id_fkey"
    FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
