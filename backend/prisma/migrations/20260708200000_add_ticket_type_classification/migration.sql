-- CreateEnum
CREATE TYPE "TicketType" AS ENUM ('incident', 'request', 'problem', 'change');

-- AlterTable: sla_configs - rename existing hour columns to incident_* (preserve data), add per-type columns
ALTER TABLE "sla_configs" RENAME COLUMN "first_response_hours" TO "incident_first_response_hours";
ALTER TABLE "sla_configs" RENAME COLUMN "resolution_hours" TO "incident_resolution_hours";
ALTER TABLE "sla_configs" ADD COLUMN     "request_first_response_hours" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "request_resolution_hours" INTEGER NOT NULL DEFAULT 48,
ADD COLUMN     "problem_first_response_hours" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "problem_resolution_hours" INTEGER NOT NULL DEFAULT 72,
ADD COLUMN     "change_first_response_hours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "change_resolution_hours" INTEGER NOT NULL DEFAULT 120;

-- AlterTable: tickets - add type + display_number (nullable first, backfilled below)
ALTER TABLE "tickets" ADD COLUMN     "type" "TicketType" NOT NULL DEFAULT 'incident',
ADD COLUMN     "display_number" TEXT;

-- CreateTable
CREATE TABLE "ticket_type_configs" (
    "type" "TicketType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ticket_type_configs_pkey" PRIMARY KEY ("type")
);

-- Backfill: chamados existentes recebem display_number = INC-<parte numérica do id>
UPDATE "tickets"
SET "display_number" = 'INC-' || regexp_replace("id", '\D', '', 'g')
WHERE "display_number" IS NULL OR "display_number" = '';

-- Enforce NOT NULL + unique now that every row has a value
ALTER TABLE "tickets" ALTER COLUMN "display_number" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "tickets_display_number_key" ON "tickets"("display_number");

-- Seed dos 4 tipos no toggle global (todos habilitados por padrão)
INSERT INTO "ticket_type_configs" ("type", "enabled") VALUES
  ('incident', true), ('request', true), ('problem', true), ('change', true)
ON CONFLICT ("type") DO NOTHING;
