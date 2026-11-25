-- AlterTable
-- Idempotente: a coluna já pode existir se aplicada manualmente antes desta migration ser registrada.
ALTER TABLE "webhook_endpoints" ADD COLUMN IF NOT EXISTS "filters" JSONB;
