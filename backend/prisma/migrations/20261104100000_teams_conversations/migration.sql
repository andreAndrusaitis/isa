-- Bot do Teams: estado da conversa (referência para proativas, histórico curto,
-- escrita pendente de confirmação e tokens gastos). Só aditiva e idempotente.
CREATE TABLE IF NOT EXISTS "teams_conversations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "tenant_id" TEXT NOT NULL,
    "aad_object_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "service_url" TEXT NOT NULL,
    "conversation_reference" JSONB NOT NULL,
    "history" JSONB NOT NULL DEFAULT '[]',
    "pending_action" JSONB,
    "tokens_used" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_message_at" TIMESTAMP(3),

    CONSTRAINT "teams_conversations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "teams_conversations_conversation_id_key" ON "teams_conversations"("conversation_id");
CREATE INDEX IF NOT EXISTS "teams_conversations_user_id_idx" ON "teams_conversations"("user_id");
CREATE INDEX IF NOT EXISTS "teams_conversations_tenant_id_idx" ON "teams_conversations"("tenant_id");

DO $$ BEGIN
  ALTER TABLE "teams_conversations" ADD CONSTRAINT "teams_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
