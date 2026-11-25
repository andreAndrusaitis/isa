-- CreateTable
CREATE TABLE "additional_packages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "additional_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_additional_packages" (
    "id" TEXT NOT NULL,
    "sla_config_id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_additional_packages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "additional_packages_name_key" ON "additional_packages"("name");

-- CreateIndex
CREATE UNIQUE INDEX "plan_additional_packages_sla_config_id_package_id_key" ON "plan_additional_packages"("sla_config_id", "package_id");

-- AddForeignKey
ALTER TABLE "plan_additional_packages" ADD CONSTRAINT "plan_additional_packages_sla_config_id_fkey" FOREIGN KEY ("sla_config_id") REFERENCES "sla_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_additional_packages" ADD CONSTRAINT "plan_additional_packages_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "additional_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
