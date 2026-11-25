-- Acesso a Projetos deixa de ser a permissão de tela 'projetos' e passa a ser
-- o módulo users.module_projects, herdado pela carteira do gerente
-- (backend/src/services/moduleAccess.ts). Quem tinha a permissão explícita
-- recebe o módulo, para ninguém perder acesso na troca. Só preenche quem ainda
-- não tem valor definido (idempotente; não sobrescreve exceções).
-- A entrada 'projetos' no array permissions fica (inofensiva, ignorada).

UPDATE "users"
SET "module_projects" = true
WHERE 'projetos' = ANY("permissions") AND "module_projects" IS NULL;
