-- Adiciona timestamp de invalidação de sessão para revogar access tokens no logout (CWE-613)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "session_invalidated_at" TIMESTAMP(3);
