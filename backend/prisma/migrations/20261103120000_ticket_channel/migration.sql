-- FEAT-1: canal de origem do chamado e tempo de preenchimento no portal.
-- Aditiva: chamados antigos ficam com channel NULL ("Não identificado").
CREATE TYPE "TicketChannel" AS ENUM ('portal', 'email', 'api', 'teams', 'copilot');

ALTER TABLE "tickets" ADD COLUMN "channel" "TicketChannel";
ALTER TABLE "tickets" ADD COLUMN "opening_seconds" INTEGER;

CREATE INDEX "tickets_channel_created_at_idx" ON "tickets"("channel", "created_at");
