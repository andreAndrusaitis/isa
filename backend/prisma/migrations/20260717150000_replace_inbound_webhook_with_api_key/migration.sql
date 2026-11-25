-- DropForeignKey
ALTER TABLE "inbound_webhook_requests" DROP CONSTRAINT "inbound_webhook_requests_inbound_webhook_id_fkey";

-- DropTable
DROP TABLE "inbound_webhook_requests";

-- DropTable
DROP TABLE "inbound_webhooks";

-- DropEnum
DROP TYPE "InboundWebhookAction";

-- RenameEnum (mesmos valores, novo uso genérico para qualquer log de requisição de API)
ALTER TYPE "InboundRequestStatus" RENAME TO "ApiRequestStatus";

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "scopes" TEXT[],
    "org_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_request_logs" (
    "id" TEXT NOT NULL,
    "api_key_id" TEXT NOT NULL,
    "external_request_id" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" "ApiRequestStatus" NOT NULL,
    "request_payload" JSONB,
    "response_status" INTEGER,
    "response_payload" JSONB,
    "error_code" TEXT,
    "error_message" TEXT,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "api_request_logs_api_key_id_created_at_idx" ON "api_request_logs"("api_key_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "api_request_logs_api_key_id_external_request_id_key" ON "api_request_logs"("api_key_id", "external_request_id");

-- AddForeignKey
ALTER TABLE "api_request_logs" ADD CONSTRAINT "api_request_logs_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
