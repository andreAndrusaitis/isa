-- Configurações dos agentes no Motor IA (agents/registry.ts). null = padrões. Idempotente.
ALTER TABLE "ai_agent_settings" ADD COLUMN IF NOT EXISTS "config" JSONB;
