-- Agente guidance (orientação na abertura): marca no chamado, veto de cartões e vínculo de duplicidade.
-- Idempotente para a receita manual de prod.
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "guidance_status" TEXT;
ALTER TABLE "ai_examples" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "ticket_links" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "related_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'duplicate',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ticket_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ticket_links_ticket_id_related_id_key" ON "ticket_links"("ticket_id", "related_id");
CREATE INDEX IF NOT EXISTS "ticket_links_related_id_idx" ON "ticket_links"("related_id");

DO $$ BEGIN
  ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_ticket_id_fkey"
    FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ticket_links" ADD CONSTRAINT "ticket_links_related_id_fkey"
    FOREIGN KEY ("related_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
