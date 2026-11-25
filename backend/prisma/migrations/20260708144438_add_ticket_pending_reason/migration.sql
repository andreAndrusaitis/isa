-- ID-382: tipos de pendência + justificativa/evidência
DO $$ BEGIN
  CREATE TYPE "TicketPendingReason" AS ENUM ('pending_user', 'pending_vendor', 'pending_approval', 'pending_parts', 'pending_schedule');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "pending_reason" "TicketPendingReason";
ALTER TABLE "ticket_events" ADD COLUMN IF NOT EXISTS "pending_reason" "TicketPendingReason";
ALTER TABLE "ticket_events" ADD COLUMN IF NOT EXISTS "attachment_url" TEXT;
