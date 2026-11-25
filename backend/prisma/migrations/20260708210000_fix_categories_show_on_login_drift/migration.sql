-- Pre-existing drift fix (unrelated to ticket type classification): schema.prisma
-- already declares Category.show_on_login, but no prior migration ever added the
-- column. This blocked `prisma db seed` locally. Adding it now so migrations match schema.
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "show_on_login" BOOLEAN NOT NULL DEFAULT true;
