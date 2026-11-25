-- Adiciona suporte a login SSO SAML (Azure AD) coexistindo com login local.
-- password vira opcional (contas SSO não têm senha local); authProvider
-- distingue local/microsoft; mustChangePassword força troca no 1º acesso
-- de contas locais recém-criadas.

DO $$ BEGIN
    CREATE TYPE "AuthProvider" AS ENUM ('local', 'microsoft');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "users" ALTER COLUMN "password" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "auth_provider" "AuthProvider" NOT NULL DEFAULT 'local';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "must_change_password" BOOLEAN NOT NULL DEFAULT false;
