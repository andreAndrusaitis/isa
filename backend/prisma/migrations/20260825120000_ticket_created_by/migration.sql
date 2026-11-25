-- Abertura de chamado em nome de cliente: registra quem realizou a abertura.
-- NULL = chamado aberto pelo próprio solicitante (comportamento anterior).
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "created_by_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "tickets" ADD CONSTRAINT "tickets_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "tickets_created_by_id_idx" ON "tickets"("created_by_id");
