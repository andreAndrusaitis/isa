-- Lixeira de chamados (aditiva e idempotente: segura para aplicar manualmente em prod).
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "deleted_by_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_deleted_by_id_fkey') THEN
    ALTER TABLE "tickets"
      ADD CONSTRAINT "tickets_deleted_by_id_fkey"
      FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "trash_config" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "retention_days" INTEGER NOT NULL DEFAULT 30,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "trash_config_pkey" PRIMARY KEY ("id")
);
