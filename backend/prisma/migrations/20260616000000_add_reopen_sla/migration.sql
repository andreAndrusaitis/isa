-- AlterTable: add reopen SLA columns to tickets
ALTER TABLE "tickets" ADD COLUMN "reopen_sla_enabled" BOOLEAN;
ALTER TABLE "tickets" ADD COLUMN "reopen_sla_limit_hours" INTEGER;

-- CreateTable: reopen SLA global config
CREATE TABLE "reopen_sla_config" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "reopen_limit_hours" INTEGER NOT NULL DEFAULT 24,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reopen_sla_config_pkey" PRIMARY KEY ("id")
);
