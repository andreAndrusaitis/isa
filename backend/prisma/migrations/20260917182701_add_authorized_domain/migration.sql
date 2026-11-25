-- CreateTable
CREATE TABLE IF NOT EXISTS "authorized_domains" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "authorized_domains_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "authorized_domains_domain_key" ON "authorized_domains"("domain");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'authorized_domains_org_id_fkey'
    ) THEN
        ALTER TABLE "authorized_domains"
            ADD CONSTRAINT "authorized_domains_org_id_fkey"
            FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
