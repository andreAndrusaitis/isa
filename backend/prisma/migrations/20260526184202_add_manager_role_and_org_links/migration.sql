-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'manager';

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "manager_global" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "manager_global" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "org_manager_links" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "manager_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_manager_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "org_manager_links_org_id_manager_id_key" ON "org_manager_links"("org_id", "manager_id");

-- AddForeignKey
ALTER TABLE "org_manager_links" ADD CONSTRAINT "org_manager_links_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_manager_links" ADD CONSTRAINT "org_manager_links_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
