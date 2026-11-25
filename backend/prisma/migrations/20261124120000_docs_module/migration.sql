-- Módulo Documentos: espaços, páginas aninhadas (Yjs), versões, favoritos e anexos.
-- O módulo nasce desligado (module_documents nulo = herda do gerente, padrão desligado).

-- CreateEnum
CREATE TYPE "DocSpaceVisibility" AS ENUM ('private', 'internal');

-- CreateEnum
CREATE TYPE "DocSpaceRole" AS ENUM ('owner', 'editor', 'viewer');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "module_documents" BOOLEAN;

-- CreateTable
CREATE TABLE "doc_spaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "color" TEXT,
    "description" TEXT,
    "visibility" "DocSpaceVisibility" NOT NULL DEFAULT 'private',
    "created_by_id" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doc_spaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_space_members" (
    "id" TEXT NOT NULL,
    "space_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "DocSpaceRole" NOT NULL DEFAULT 'viewer',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doc_space_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_pages" (
    "id" TEXT NOT NULL,
    "space_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "title" TEXT NOT NULL DEFAULT 'Sem título',
    "icon" TEXT,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ydoc" BYTEA,
    "content_text" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doc_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_page_versions" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "label" TEXT,
    "ydoc" BYTEA NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doc_page_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_favorites" (
    "user_id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doc_favorites_pkey" PRIMARY KEY ("user_id","page_id")
);

-- CreateTable
CREATE TABLE "doc_attachments" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "space_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doc_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "doc_space_members_user_id_idx" ON "doc_space_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "doc_space_members_space_id_user_id_key" ON "doc_space_members"("space_id", "user_id");

-- CreateIndex
CREATE INDEX "doc_pages_space_id_parent_id_position_idx" ON "doc_pages"("space_id", "parent_id", "position");

-- CreateIndex
CREATE INDEX "doc_pages_parent_id_idx" ON "doc_pages"("parent_id");

-- CreateIndex
CREATE INDEX "doc_pages_deleted_at_idx" ON "doc_pages"("deleted_at");

-- CreateIndex
CREATE INDEX "doc_pages_space_id_updated_at_idx" ON "doc_pages"("space_id", "updated_at");

-- CreateIndex
CREATE INDEX "doc_page_versions_page_id_created_at_idx" ON "doc_page_versions"("page_id", "created_at");

-- CreateIndex
CREATE INDEX "doc_favorites_page_id_idx" ON "doc_favorites"("page_id");

-- CreateIndex
CREATE INDEX "doc_attachments_page_id_idx" ON "doc_attachments"("page_id");

-- CreateIndex
CREATE INDEX "doc_attachments_space_id_idx" ON "doc_attachments"("space_id");

-- AddForeignKey
ALTER TABLE "doc_spaces" ADD CONSTRAINT "doc_spaces_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_space_members" ADD CONSTRAINT "doc_space_members_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "doc_spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_space_members" ADD CONSTRAINT "doc_space_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_pages" ADD CONSTRAINT "doc_pages_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "doc_spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_pages" ADD CONSTRAINT "doc_pages_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "doc_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_pages" ADD CONSTRAINT "doc_pages_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_pages" ADD CONSTRAINT "doc_pages_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_pages" ADD CONSTRAINT "doc_pages_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_page_versions" ADD CONSTRAINT "doc_page_versions_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "doc_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_page_versions" ADD CONSTRAINT "doc_page_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_favorites" ADD CONSTRAINT "doc_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_favorites" ADD CONSTRAINT "doc_favorites_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "doc_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_attachments" ADD CONSTRAINT "doc_attachments_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "doc_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_attachments" ADD CONSTRAINT "doc_attachments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

