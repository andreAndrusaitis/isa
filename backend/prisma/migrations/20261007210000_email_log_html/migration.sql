-- Corpo HTML do e-mail para a tela admin "Logs de E-mail". Idempotente.
ALTER TABLE "email_logs" ADD COLUMN IF NOT EXISTS "html" TEXT;
