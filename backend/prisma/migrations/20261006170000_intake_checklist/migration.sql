-- Agente intake: checklist de informações mínimas por tipo de chamado e marca no chamado.
-- Idempotente para a receita manual de prod.
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "intake_status" TEXT;

CREATE TABLE IF NOT EXISTS "intake_checklist_items" (
    "id" TEXT NOT NULL,
    "type" "TicketType" NOT NULL,
    "subcategory_id" TEXT,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "criterion" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'text',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "intake_checklist_items_pkey" PRIMARY KEY ("id")
);

-- Prisma @updatedAt não tem default no banco; remove o default de DBs que já aplicaram a versão anterior.
ALTER TABLE "intake_checklist_items" ALTER COLUMN "updated_at" DROP DEFAULT;

CREATE INDEX IF NOT EXISTS "intake_checklist_items_type_idx" ON "intake_checklist_items"("type");

DO $$ BEGIN
  ALTER TABLE "intake_checklist_items" ADD CONSTRAINT "intake_checklist_items_subcategory_id_fkey"
    FOREIGN KEY ("subcategory_id") REFERENCES "subcategories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Checklist inicial (spec §3); editável no Admin depois.
INSERT INTO "intake_checklist_items" ("id", "type", "key", "label", "criterion", "question", "kind", "required", "sort", "updated_at") VALUES
('intake-inc-o-que-acontece', 'incident', 'o_que_acontece', 'O que acontece',
 'O chamado descreve concretamente o problema: o que acontece, o que deixou de funcionar ou qual mensagem de erro aparece. Frases genéricas como "está com problema", "não funciona" ou "ver abaixo" sem o conteúdo não bastam.',
 'O que exatamente acontece? Se aparece uma mensagem de erro, qual é o texto?', 'text', true, 10, CURRENT_TIMESTAMP),
('intake-inc-quem-afetado', 'incident', 'quem_afetado', 'Quem ou o que é afetado',
 'O chamado identifica quem ou o que é afetado: um usuário, e-mail, caixa, equipamento, servidor ou sistema específico. Se o texto fala do próprio solicitante ("meu computador", "não consigo acessar"), conta como identificado. Um relato curto sem pessoa ou recurso citado ("VPN not working") se refere ao próprio solicitante e também conta como identificado.',
 'Qual usuário, equipamento ou sistema é afetado?', 'text', true, 20, CURRENT_TIMESTAMP),
('intake-inc-evidencia', 'incident', 'evidencia', 'Evidência (print ou erro)',
 'Evidência só é necessária quando o chamado menciona uma mensagem, erro ou código: nesse caso o texto dele deve estar transcrito (ou haver print anexado). Dizer apenas que "aparece um erro" ou "recebo erro" sem o texto da mensagem e sem print NÃO basta. Para problemas de comportamento sem mensagem de erro (sem rede, lentidão, travamento, tela incompleta), uma descrição precisa do comportamento observado já conta como evidência.',
 'Pode enviar um print da tela ou copiar o texto do erro?', 'evidence', true, 30, CURRENT_TIMESTAMP),
('intake-inc-desde-quando', 'incident', 'desde_quando', 'Desde quando',
 'O chamado informa quando o problema começou ou com que frequência acontece.',
 'Desde quando isso acontece?', 'text', false, 40, CURRENT_TIMESTAMP),
('intake-req-o-que-pedido', 'request', 'o_que_pedido', 'O que é pedido',
 'O chamado diz concretamente o que precisa ser feito: qual acesso, licença, configuração, instalação, relatório ou ação. O título conta: "Acesso ao CRM" ou "Habilitar MFA nos 3 usuários" já dizem o que é pedido. Pedir apoio ou avaliação de um tema ou configuração específica (ex.: "avaliar a configuração do Exchange Online para EWS") também conta.',
 'O que precisa ser feito, exatamente?', 'text', true, 10, CURRENT_TIMESTAMP),
('intake-req-para-quem', 'request', 'para_quem', 'Para quem ou qual recurso',
 'Só falta quando o pedido é para outra pessoa ou recurso que não está identificado (ex.: "novo colaborador" sem e-mail, campo "E-mail:" vazio, "os usuários" sem dizer quais quando o pedido não é justamente identificá-los). Se nenhum destinatário é citado, o pedido é para o próprio solicitante e conta como identificado. Empresa, tenant, caixa ou ambiente da empresa também contam como recurso identificado.',
 'Para qual usuário (e-mail) ou recurso é o pedido?', 'text', true, 20, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
