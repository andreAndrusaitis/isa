-- Fechamento automático configurável + log (aditiva e idempotente: segura para aplicar manualmente em prod).
CREATE TABLE IF NOT EXISTS "auto_close_config" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "inactive_days" INTEGER NOT NULL DEFAULT 7,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "auto_close_config_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "auto_close_logs" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "inactive_days" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auto_close_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "auto_close_logs_created_at_idx" ON "auto_close_logs"("created_at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_close_logs_ticket_id_fkey') THEN
    ALTER TABLE "auto_close_logs"
      ADD CONSTRAINT "auto_close_logs_ticket_id_fkey"
      FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
