# Como rodar

## Com Docker

```bash
cp backend/.env.example backend/.env
# preencha JWT_SECRET e JWT_REFRESH_SECRET (openssl rand -hex 32)
docker compose up -d
# só na primeira vez; o seed recusa bancos que não sejam locais, por isso a confirmação
docker compose exec -e SEED_ALLOW_NON_LOCAL=true backend npm run db:seed
```

Abra http://localhost:5173.

## Sem Docker

Precisa de Node 22 e PostgreSQL 16 com a extensão [pgvector](https://github.com/pgvector/pgvector).

```bash
cp backend/.env.example backend/.env   # aponte DATABASE_URL e preencha os segredos
cd backend && npm install && npx prisma migrate deploy && npm run db:seed && npm run dev
cd frontend && npm install && npm run dev
```

## Contas de demonstração

Criadas pelo seed, só para uso local.

| Papel | E-mail | Senha |
|---|---|---|
| Administrador | admin@admin.com | admin |
| Gerente | gerente@gerente.com | gerente |
| Ticket Manager | ticketmaster@ticketmaster.com | ticketmaster |
| Analista | agente@agente.com | agente |
| Cliente | user@user.com | user#2user |

IA, login Microsoft, e-mail e Teams são opcionais: sem configurá-los, o resto funciona. Login Microsoft e provedor de IA são configurados em tela pelo administrador.

## Testes

```bash
cd frontend && npm test
cd backend && npm test -- --fileParallelism=false   # usa o banco de DATABASE_URL; aponte para um de teste
cd backend && npm run test:integration              # sobe um ambiente isolado em Docker
```

Com Node 25 ou mais novo, rode os testes da interface com `NODE_OPTIONS=--no-experimental-webstorage`. A suíte de integração está descrita em [backend/e2e](../backend/e2e/README.md).
