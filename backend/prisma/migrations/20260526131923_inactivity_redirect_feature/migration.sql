-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ticket_redirected';

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "auto_redirected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "redirected_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "inactivity_redirect_config" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "inactivity_hours" INTEGER NOT NULL DEFAULT 24,
    "business_hours_start" TEXT NOT NULL DEFAULT '08:00',
    "business_hours_end" TEXT NOT NULL DEFAULT '18:00',
    "working_days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "target_priority" "TicketPriority" NOT NULL DEFAULT 'high',
    "vip_queue_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inactivity_redirect_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inactivity_redirect_logs" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "original_queue" TEXT NOT NULL,
    "previous_assigned_to_id" TEXT,
    "new_assigned_to_id" TEXT,
    "previous_priority" "TicketPriority" NOT NULL,
    "new_priority" "TicketPriority" NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '24h_inactivity',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inactivity_redirect_logs_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "inactivity_redirect_logs" ADD CONSTRAINT "inactivity_redirect_logs_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inactivity_redirect_logs" ADD CONSTRAINT "inactivity_redirect_logs_previous_assigned_to_id_fkey" FOREIGN KEY ("previous_assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inactivity_redirect_logs" ADD CONSTRAINT "inactivity_redirect_logs_new_assigned_to_id_fkey" FOREIGN KEY ("new_assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
