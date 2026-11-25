-- E-mails do sistema pela caixa de atendimento (Microsoft Graph) e resposta do
-- cliente por e-mail entrando no chamado. Só aditiva e idempotente.

-- Liberação por empresa: o cliente pode responder por e-mail.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "email_reply_enabled" BOOLEAN NOT NULL DEFAULT false;

-- Rastreio do envio: liga a resposta do cliente ao e-mail que a originou.
ALTER TABLE "email_logs" ADD COLUMN IF NOT EXISTS "provider" TEXT;
ALTER TABLE "email_logs" ADD COLUMN IF NOT EXISTS "internet_message_id" TEXT;
ALTER TABLE "email_logs" ADD COLUMN IF NOT EXISTS "conversation_id" TEXT;
ALTER TABLE "email_logs" ADD COLUMN IF NOT EXISTS "replyable" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS "email_logs_internet_message_id_key" ON "email_logs"("internet_message_id");
CREATE INDEX IF NOT EXISTS "email_logs_conversation_id_idx" ON "email_logs"("conversation_id");

-- E-mails recebidos na caixa de atendimento e o desfecho de cada um.
CREATE TABLE IF NOT EXISTS "inbound_emails" (
    "id" TEXT NOT NULL,
    "graph_message_id" TEXT NOT NULL,
    "internet_message_id" TEXT,
    "from_email" TEXT NOT NULL,
    "from_name" TEXT,
    "subject" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "detail" TEXT,
    "ticket_id" TEXT,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_emails_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "inbound_emails_graph_message_id_key" ON "inbound_emails"("graph_message_id");
CREATE INDEX IF NOT EXISTS "inbound_emails_received_at_idx" ON "inbound_emails"("received_at");
CREATE INDEX IF NOT EXISTS "inbound_emails_ticket_id_idx" ON "inbound_emails"("ticket_id");
CREATE INDEX IF NOT EXISTS "inbound_emails_status_idx" ON "inbound_emails"("status");

DO $$ BEGIN
  ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_ticket_id_fkey"
    FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
