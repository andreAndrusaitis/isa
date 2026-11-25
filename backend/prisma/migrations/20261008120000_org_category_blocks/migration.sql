-- Categoria do plano desligada por empresa (aditiva).
CREATE TABLE IF NOT EXISTS "org_category_blocks" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    CONSTRAINT "org_category_blocks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "org_category_blocks_org_id_category_id_key"
    ON "org_category_blocks"("org_id", "category_id");

DO $$ BEGIN
    ALTER TABLE "org_category_blocks" ADD CONSTRAINT "org_category_blocks_org_id_fkey"
        FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "org_category_blocks" ADD CONSTRAINT "org_category_blocks_category_id_fkey"
        FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
