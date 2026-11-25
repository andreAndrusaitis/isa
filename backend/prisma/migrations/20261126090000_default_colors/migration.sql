-- Cor padrão de novas filas e categorias: o azul da paleta gelo. Cores já gravadas não mudam.
ALTER TABLE "queues" ALTER COLUMN "color" SET DEFAULT '#0f73ac';
ALTER TABLE "categories" ALTER COLUMN "color" SET DEFAULT '#0f73ac';
