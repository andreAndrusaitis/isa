-- Remetentes bloqueados: e-mail ou domínio que não abre chamado por e-mail/API.
-- Só aditiva e idempotente.
CREATE TABLE IF NOT EXISTS "email_blocks" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "last_hit_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_blocks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "email_blocks_kind_value_key" ON "email_blocks"("kind", "value");
