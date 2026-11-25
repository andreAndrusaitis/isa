-- CreateEnum (idempotent)
DO $$ BEGIN
  CREATE TYPE "SurveyQuestionStyle" AS ENUM ('emoji','estrela','numerico','pill');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "SurveyOptionAction" AS ENUM ('reabrir_chamado');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AlterEnum (idempotent; ADD VALUE cannot run inside a transaction in older PG)
ALTER TYPE "SurveyQuestionType" ADD VALUE IF NOT EXISTS 'escala';
ALTER TYPE "SurveyQuestionType" ADD VALUE IF NOT EXISTS 'escolha_unica';
ALTER TYPE "SurveyQuestionType" ADD VALUE IF NOT EXISTS 'escolha_multipla';
ALTER TYPE "SurveyQuestionType" ADD VALUE IF NOT EXISTS 'nps';

-- AlterTable survey_questions
ALTER TABLE "survey_questions" ADD COLUMN IF NOT EXISTS "ativa" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "survey_questions" ADD COLUMN IF NOT EXISTS "descricao" TEXT;
ALTER TABLE "survey_questions" ADD COLUMN IF NOT EXISTS "estilo" "SurveyQuestionStyle";
ALTER TABLE "survey_questions" ALTER COLUMN "codigo" DROP NOT NULL;

-- AlterTable survey_responses
ALTER TABLE "survey_responses" ALTER COLUMN "p1_csat" DROP NOT NULL;

-- CreateTable survey_question_options
CREATE TABLE IF NOT EXISTS "survey_question_options" (
    "id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "rotulo" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "emoji" TEXT,
    "cor" TEXT,
    "pontuacao" INTEGER,
    "acao" "SurveyOptionAction",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "survey_question_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable survey_answers
CREATE TABLE IF NOT EXISTS "survey_answers" (
    "id" TEXT NOT NULL,
    "response_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "valor_texto" TEXT,
    "valor_numero" INTEGER,
    "valores_opcao" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "survey_answers_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "survey_question_options" ADD CONSTRAINT "survey_question_options_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "survey_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "survey_answers" ADD CONSTRAINT "survey_answers_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "survey_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "survey_answers" ADD CONSTRAINT "survey_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "survey_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
