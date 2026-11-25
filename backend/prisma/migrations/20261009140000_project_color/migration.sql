-- Cor de identidade do projeto (pasta na sidebar + destaques dentro do projeto).
-- Aditiva: coluna opcional, null = cor padrão do tema.

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "color" TEXT;
