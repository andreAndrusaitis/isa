-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "collab_queue" TEXT;

-- CreateTable
CREATE TABLE "ticket_participants" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'collaborator',
    "added_by_id" TEXT,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ticket_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_participants_agent_id_active_idx" ON "ticket_participants"("agent_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_participants_ticket_id_agent_id_key" ON "ticket_participants"("ticket_id", "agent_id");

-- AddForeignKey
ALTER TABLE "ticket_participants" ADD CONSTRAINT "ticket_participants_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_participants" ADD CONSTRAINT "ticket_participants_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_participants" ADD CONSTRAINT "ticket_participants_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
