-- Ponte chamado ↔ task de projeto (fase 7B, spec 2026-10-08-projetos-fase7).
-- Aditiva e idempotente. Chamado vinculado fica "pending/pending_project":
-- SLA pausado pelo mecanismo de pendência existente; vale o prazo da task.
-- ADD VALUE em enum é aditivo (não reescreve dados); o novo valor só pode ser
-- usado depois do commit desta transação, o que não ocorre aqui.

ALTER TYPE "TicketPendingReason" ADD VALUE IF NOT EXISTS 'pending_project';

ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "project_task_id" TEXT;

CREATE INDEX IF NOT EXISTS "tickets_project_task_id_idx" ON "tickets"("project_task_id");

DO $$ BEGIN
  ALTER TABLE "tickets" ADD CONSTRAINT "tickets_project_task_id_fkey"
    FOREIGN KEY ("project_task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
