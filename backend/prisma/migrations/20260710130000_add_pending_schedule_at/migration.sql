-- ID-382: data/hora do agendamento combinado para "Pendente Agendamento" + reabertura automática
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ticket_schedule_reopened';

ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "pending_schedule_at" TIMESTAMP(3);
ALTER TABLE "ticket_events" ADD COLUMN IF NOT EXISTS "pending_schedule_at" TIMESTAMP(3);
