-- Fix ID-356: tickets sem fila real ("geral") ficavam invisíveis para analistas.
-- A coluna queue passa a ser nullable e sem default: chamado sem fila válida
-- fica com queue = NULL e é visível a todos os analistas (ver services/tickets.ts).
ALTER TABLE "tickets" ALTER COLUMN "queue" DROP NOT NULL;
ALTER TABLE "tickets" ALTER COLUMN "queue" DROP DEFAULT;
