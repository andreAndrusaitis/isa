-- Ponte chamado ↔ task (roadmap ID 1.4): marca quando o chamado em projeto teve a
-- previsão vencida avisada. Zera quando a previsão muda ou o vínculo acaba.
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "project_forecast_alerted_at" TIMESTAMP(3);

-- Aviso de previsão (mudou / venceu) para analista, responsáveis da task e gestão.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'project_forecast';
