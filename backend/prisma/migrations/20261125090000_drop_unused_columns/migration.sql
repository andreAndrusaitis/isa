-- Colunas sem uso desde a nova tela de entrada.
ALTER TABLE "categories" DROP COLUMN IF EXISTS "show_on_login";
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "follow_enabled";
