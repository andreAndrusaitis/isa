-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('pending', 'success', 'failed');

-- CreateEnum
CREATE TYPE "InboundWebhookAction" AS ENUM ('create_ticket', 'update_ticket', 'create_user', 'update_user');

-- CreateEnum
CREATE TYPE "InboundRequestStatus" AS ENUM ('received', 'processing', 'success', 'duplicate', 'failed');

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "endpoint_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_retry_at" TIMESTAMP(3),
    "response_status" INTEGER,
    "response_body" TEXT,
    "error_message" TEXT,
    "duration_ms" INTEGER,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_webhooks" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "action" "InboundWebhookAction" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "defaults" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbound_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_webhook_requests" (
    "id" TEXT NOT NULL,
    "inbound_webhook_id" TEXT NOT NULL,
    "external_request_id" TEXT,
    "status" "InboundRequestStatus" NOT NULL,
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

    CONSTRAINT "inbound_webhook_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_next_retry_at_idx" ON "webhook_deliveries"("status", "next_retry_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_endpoint_id_created_at_idx" ON "webhook_deliveries"("endpoint_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_webhooks_slug_key" ON "inbound_webhooks"("slug");

-- CreateIndex
CREATE INDEX "inbound_webhook_requests_inbound_webhook_id_created_at_idx" ON "inbound_webhook_requests"("inbound_webhook_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_webhook_requests_inbound_webhook_id_external_reques_key" ON "inbound_webhook_requests"("inbound_webhook_id", "external_request_id");

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_webhook_requests" ADD CONSTRAINT "inbound_webhook_requests_inbound_webhook_id_fkey" FOREIGN KEY ("inbound_webhook_id") REFERENCES "inbound_webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
