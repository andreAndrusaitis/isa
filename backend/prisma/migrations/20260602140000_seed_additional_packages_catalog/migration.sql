-- Catálogo base de pacotes adicionais (feature 196).
-- Migration de DADOS (não altera schema): garante o catálogo base em todos os
-- ambientes (dev/staging/prod) via `prisma migrate deploy` no startup do
-- container. Idempotente — ON CONFLICT no nome (único) torna seguro reexecutar
-- e aplicar em ambientes já populados, sem duplicar.
-- gen_random_uuid() é nativo do PostgreSQL 13+ (não requer extensão).
INSERT INTO "additional_packages" ("id", "name", "description", "active", "updated_at")
VALUES
  (gen_random_uuid(), 'Suporte 24x7',                'Atendimento estendido fora do horário comercial (24 horas, 7 dias)', true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Atendimento Premium',         'Fila prioritária com gerente de contas dedicado',                    true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Horas Extras de Consultoria', 'Pacote adicional de horas técnicas de consultoria por mês',          true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Monitoramento Proativo',      'Monitoramento ativo de incidentes e alertas preventivos',            true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Onboarding Assistido',        'Acompanhamento dedicado na implantação e treinamento inicial',       true, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
