-- Numeração atômica dos chamados (ISA-<n>). Antes era MAX(id)+1: aberturas
-- simultâneas colidiam (P2002 → 500) e expurgar o último chamado fazia o
-- número ser reemitido. Aditiva e idempotente; começa após o maior número atual.
CREATE SEQUENCE IF NOT EXISTS ticket_number_seq;

SELECT setval('ticket_number_seq', GREATEST(
  COALESCE((SELECT MAX(CAST(SUBSTRING(id FROM '^ISA-([0-9]+)$') AS INTEGER)) FROM tickets), 1000),
  (SELECT last_value FROM ticket_number_seq)
));
