-- Acesso a módulo (chamados / projetos) por usuário, com herança de manager.
-- NULL = "não configurado, herda do manager na cadeia (ou default se não
-- houver manager)". true/false = override explícito. Ver
-- backend/src/services/moduleAccess.ts para a lógica de resolução.
--
-- Backfill: todo usuário com role acima de "user" (agent, supervisor,
-- manager, admin) já existente recebe module_tickets = true explícito,
-- para não perder acesso a chamados quando o guard de /projetos passar a
-- depender de module_projects em vez de role fixo. module_projects fica
-- NULL (= false por default) até ser habilitado manualmente por time.
-- Escrita idempotente: ver convenção em 20260919120000_projects_phase6.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "module_tickets" BOOLEAN;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "module_projects" BOOLEAN;

UPDATE "users"
SET "module_tickets" = true
WHERE "role" <> 'user' AND "module_tickets" IS NULL;
