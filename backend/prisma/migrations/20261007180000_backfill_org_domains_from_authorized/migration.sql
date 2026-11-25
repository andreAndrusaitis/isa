-- Domínio autorizado (SSO) é sempre domínio da empresa: copia para organizations.domains
-- os que ainda não estão lá. Idempotente, só acrescenta.
UPDATE "organizations" o
SET "domains" = o."domains" || ARRAY(
  SELECT ad."domain" FROM "authorized_domains" ad
  WHERE ad."org_id" = o."id" AND NOT (ad."domain" = ANY(o."domains"))
  ORDER BY ad."created_at"
)
WHERE EXISTS (
  SELECT 1 FROM "authorized_domains" ad
  WHERE ad."org_id" = o."id" AND NOT (ad."domain" = ANY(o."domains"))
);
