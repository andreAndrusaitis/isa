-- ID da task por tipo (BUG-12, FEAT-3…), tipos padrão ampliados e tipo obrigatório.
-- Aditiva: nenhuma coluna/linha removida. Tasks sem tipo passam a "Tarefa" (TASK).

ALTER TABLE "task_types" ADD COLUMN IF NOT EXISTS "prefix" TEXT NOT NULL DEFAULT '';
ALTER TABLE "task_types" ADD COLUMN IF NOT EXISTS "next_number" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "type_number" INTEGER;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "key" TEXT;

-- Nomes padrão antigos em inglês → nomes novos (só os que continuam com o nome de fábrica).
UPDATE "task_types" SET "name" = 'User Story' WHERE "name" = 'Story';
UPDATE "task_types" SET "name" = 'Tarefa' WHERE "name" = 'Task';

-- Prefixo dos tipos padrão.
UPDATE "task_types" SET "prefix" = CASE "name"
  WHEN 'Epic' THEN 'EPIC' WHEN 'Feature' THEN 'FEAT' WHEN 'User Story' THEN 'US'
  WHEN 'Tarefa' THEN 'TASK' WHEN 'Bug' THEN 'BUG' WHEN 'Melhoria' THEN 'MEL'
  WHEN 'QA' THEN 'QA' WHEN 'Documentação' THEN 'DOC' ELSE '' END
WHERE "prefix" = '';

-- Tipos criados pelos usuários: prefixo derivado do nome (sem acento, só A-Z0-9, até 4).
UPDATE "task_types" SET "prefix" = COALESCE(NULLIF(LEFT(REGEXP_REPLACE(
  TRANSLATE(UPPER("name"), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC'), '[^A-Z0-9]', '', 'g'), 4), ''), 'TIPO')
WHERE "prefix" = '';

-- Prefixo único por projeto: repetidos ganham sufixo numérico (TIPO, TIPO2…).
WITH ranked AS (
  -- O tipo padrão fica com o prefixo "limpo"; o criado pelo usuário é que ganha sufixo.
  SELECT "id", "prefix", ROW_NUMBER() OVER (
    PARTITION BY "project_id", "prefix"
    ORDER BY CASE WHEN "name" IN ('Epic','Feature','User Story','Tarefa','Bug','Melhoria','QA','Documentação') THEN 0 ELSE 1 END, "position", "id"
  ) AS rn
  FROM "task_types"
)
UPDATE "task_types" t SET "prefix" = LEFT(r."prefix", 6) || r.rn
FROM ranked r WHERE t."id" = r."id" AND r.rn > 1;

-- Tipos padrão que faltam em cada projeto.
INSERT INTO "task_types" ("id", "project_id", "name", "icon", "color", "position", "is_active", "prefix", "next_number")
SELECT gen_random_uuid()::text, p."id", d.name, d.icon, d.color,
       COALESCE((SELECT MAX("position") FROM "task_types" x WHERE x."project_id" = p."id"), -1) + d.ord,
       true, d.prefix, 1
FROM "projects" p
CROSS JOIN (VALUES
  ('Epic', 'Zap', '#7c3aed', 'EPIC', 1), ('Feature', 'Package', '#0891b2', 'FEAT', 2),
  ('User Story', 'BookmarkCheck', '#16a34a', 'US', 3), ('Tarefa', 'CheckSquare', '#2563eb', 'TASK', 4),
  ('Bug', 'Bug', '#dc2626', 'BUG', 5), ('Melhoria', 'Sparkles', '#ea580c', 'MEL', 6),
  ('QA', 'FlaskConical', '#f59e0b', 'QA', 7), ('Documentação', 'FileText', '#64748b', 'DOC', 8)
) AS d(name, icon, color, prefix, ord)
WHERE NOT EXISTS (SELECT 1 FROM "task_types" x WHERE x."project_id" = p."id" AND x."prefix" = d.prefix);

-- Tipo agora é obrigatório: tasks sem tipo (ou com tipo excluído) viram "Tarefa".
UPDATE "tasks" t SET "task_type_id" = tt."id"
FROM "task_types" tt
WHERE tt."project_id" = t."project_id" AND tt."prefix" = 'TASK' AND tt."is_active" = true
  AND (t."task_type_id" IS NULL OR t."task_type_id" IN (SELECT "id" FROM "task_types" WHERE "is_active" = false));

-- Numeração por tipo na ordem de criação (#seq), incluindo arquivadas, e a chave pronta.
WITH numbered AS (
  SELECT t."id", ROW_NUMBER() OVER (PARTITION BY t."task_type_id" ORDER BY t."seq") AS n
  FROM "tasks" t WHERE t."task_type_id" IS NOT NULL AND t."type_number" IS NULL
)
UPDATE "tasks" t SET "type_number" = n.n FROM numbered n WHERE t."id" = n."id";

UPDATE "tasks" t SET "key" = tt."prefix" || '-' || t."type_number"
FROM "task_types" tt WHERE tt."id" = t."task_type_id" AND t."type_number" IS NOT NULL;

UPDATE "task_types" tt SET "next_number" = COALESCE((SELECT MAX("type_number") FROM "tasks" t WHERE t."task_type_id" = tt."id"), 0) + 1;

CREATE UNIQUE INDEX IF NOT EXISTS "tasks_task_type_id_type_number_key" ON "tasks"("task_type_id", "type_number");
