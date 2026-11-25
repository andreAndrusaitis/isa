-- Configurações do sistema editadas pelo admin (aparência, login Microsoft, IA).
-- "secrets" guarda só texto cifrado (AES-256-GCM, utils/secretBox.ts).
CREATE TABLE "system_settings" (
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL DEFAULT '{}',
  "secrets" JSONB NOT NULL DEFAULT '{}',
  "updated_by_id" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);
