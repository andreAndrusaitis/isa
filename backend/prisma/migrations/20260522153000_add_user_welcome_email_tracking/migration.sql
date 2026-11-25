-- AlterTable
ALTER TABLE "users"
ADD COLUMN "welcome_email_sent_at" TIMESTAMP(3),
ADD COLUMN "welcome_email_status" TEXT,
ADD COLUMN "welcome_email_error" TEXT;
