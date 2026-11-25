-- CreateTable
CREATE TABLE "user_org_scopes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,

    CONSTRAINT "user_org_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_org_scopes_user_id_org_id_key" ON "user_org_scopes"("user_id", "org_id");

-- AddForeignKey
ALTER TABLE "user_org_scopes" ADD CONSTRAINT "user_org_scopes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_org_scopes" ADD CONSTRAINT "user_org_scopes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
