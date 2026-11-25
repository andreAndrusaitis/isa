-- CreateIndex
CREATE INDEX "ticket_messages_ticket_id_created_at_idx" ON "ticket_messages"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "tickets_deleted_at_status_idx" ON "tickets"("deleted_at", "status");

-- CreateIndex
CREATE INDEX "tickets_org_id_idx" ON "tickets"("org_id");

-- CreateIndex
CREATE INDEX "tickets_queue_idx" ON "tickets"("queue");

-- CreateIndex
CREATE INDEX "tickets_assigned_to_id_idx" ON "tickets"("assigned_to_id");

-- CreateIndex
CREATE INDEX "tickets_created_at_idx" ON "tickets"("created_at");

-- CreateIndex
CREATE INDEX "tickets_sla_deadline_idx" ON "tickets"("sla_deadline");

-- CreateIndex
CREATE INDEX "users_manager_id_idx" ON "users"("manager_id");

-- CreateIndex
CREATE INDEX "users_org_id_idx" ON "users"("org_id");
