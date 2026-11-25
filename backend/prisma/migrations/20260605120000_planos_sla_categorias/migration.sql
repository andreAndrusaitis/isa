-- AlterTable: organizations - add expiry/warning fields
ALTER TABLE "organizations" ADD COLUMN "expires_at" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN "expiry_message" TEXT;
ALTER TABLE "organizations" ADD COLUMN "warning_active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable: sla_configs - add category, queue routing fields
ALTER TABLE "sla_configs" ADD COLUMN "category_id" TEXT;
ALTER TABLE "sla_configs" ADD COLUMN "default_queue" TEXT NOT NULL DEFAULT 'geral';
ALTER TABLE "sla_configs" ADD COLUMN "escalation_queue" TEXT NOT NULL DEFAULT 'geral';

-- CreateTable: plan_categories
CREATE TABLE "plan_categories" (
    "id" TEXT NOT NULL,
    "sla_config_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable: business_hours_config
CREATE TABLE "business_hours_config" (
    "id" TEXT NOT NULL,
    "business_hours_start" TEXT NOT NULL DEFAULT '08:00',
    "business_hours_end" TEXT NOT NULL DEFAULT '18:00',
    "working_days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_hours_config_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "plan_categories" ADD CONSTRAINT "plan_categories_sla_config_id_fkey" FOREIGN KEY ("sla_config_id") REFERENCES "sla_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_categories" ADD CONSTRAINT "plan_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
