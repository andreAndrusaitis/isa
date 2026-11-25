-- AlterTable
-- Idempotente: colunas podem já existir se aplicadas manualmente antes desta migration ser registrada.
ALTER TABLE "subcategories" ADD COLUMN IF NOT EXISTS "is_special" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "subcategories" ADD COLUMN IF NOT EXISTS "special_form_schema" JSONB;
ALTER TABLE "subcategories" ADD COLUMN IF NOT EXISTS "special_title_template" TEXT;

ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "special_data" JSONB;
ALTER TABLE "tickets" ALTER COLUMN "description" DROP NOT NULL;
