-- CreateEnum
CREATE TYPE "SurveyQuestionType" AS ENUM ('escala_1_5', 'unica_escolha', 'texto_livre');

-- CreateEnum
CREATE TYPE "SurveyInstanceStatus" AS ENUM ('enviada', 'respondida', 'expirada');

-- CreateEnum
CREATE TYPE "SurveyDispatchChannel" AS ENUM ('email', 'chat_auto', 'chat_macro');

-- CreateEnum
CREATE TYPE "SurveyDispatchSendStatus" AS ENUM ('enfileirado', 'enviado', 'falha');

-- CreateEnum
CREATE TYPE "SurveyResolution" AS ENUM ('total', 'parcial', 'nao');

-- CreateEnum
CREATE TYPE "SurveyTimeRating" AS ENUM ('muito_rapido', 'adequado', 'lento', 'muito_lento');

-- AlterEnum removed to keep 'manager' role in the enum


-- AlterTable
ALTER TABLE "org_queue_access" ADD COLUMN     "warning_active" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "survey_templates" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "assunto_email" TEXT NOT NULL,
    "corpo_convite_auto" TEXT NOT NULL,
    "corpo_convite_macro" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "atualizado_por_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "survey_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_questions" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "enunciado" TEXT NOT NULL,
    "tipo" "SurveyQuestionType" NOT NULL,
    "obrigatoria" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "survey_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_instances" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "link_token" TEXT NOT NULL,
    "status" "SurveyInstanceStatus" NOT NULL DEFAULT 'enviada',
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondida_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "survey_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_dispatches" (
    "id" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "canal" "SurveyDispatchChannel" NOT NULL,
    "disparado_por" TEXT,
    "disparado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status_envio" "SurveyDispatchSendStatus" NOT NULL DEFAULT 'enfileirado',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "survey_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_responses" (
    "id" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "p1_csat" INTEGER NOT NULL,
    "p2_resolucao" "SurveyResolution",
    "p3_tempo" "SurveyTimeRating",
    "p4_cordialidade" INTEGER,
    "p5_comentario" TEXT,
    "respondido_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "survey_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "survey_instances_ticket_id_key" ON "survey_instances"("ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX "survey_instances_link_token_key" ON "survey_instances"("link_token");

-- CreateIndex
CREATE UNIQUE INDEX "survey_responses_instance_id_key" ON "survey_responses"("instance_id");

-- AddForeignKey
ALTER TABLE "survey_templates" ADD CONSTRAINT "survey_templates_atualizado_por_id_fkey" FOREIGN KEY ("atualizado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_questions" ADD CONSTRAINT "survey_questions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "survey_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_instances" ADD CONSTRAINT "survey_instances_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_instances" ADD CONSTRAINT "survey_instances_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "survey_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_dispatches" ADD CONSTRAINT "survey_dispatches_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "survey_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "survey_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
