#!/usr/bin/env bash
# Sobe o ambiente isolado e roda a suíte integrada do ISA de uma vez:
# Postgres descartável (Docker) → schema → dados fictícios → backend em modo
# produção → testes → encerra o backend e apaga o banco.
#
#   npm run test:integration                     # suíte inteira
#   npm run test:integration -- e2e/15-*.e2e.ts  # só alguns arquivos
#   IT_KEEP=1 npm run test:integration           # mantém banco e backend no ar
#
# Nunca aponta para produção: as credenciais vêm de e2e/.env.integration (só
# valores fictícios, no lugar do backend/.env) e o script para se a URL do banco
# não for local.
set -euo pipefail

cd "$(dirname "$0")/.."

PG_CONTAINER="${IT_PG_CONTAINER:-isa_integration}"
PG_PORT="${IT_PG_PORT:-5436}"
PG_DB="${IT_PG_DB:-isa_integration}"
API_PORT="${IT_API_PORT:-3022}"
AI_PORT="${IT_AI_PORT:-3023}"
LOG_FILE="${IT_LOG_FILE:-logs/integration-backend.log}"
DB_URL="postgresql://isa:isa_local@127.0.0.1:${PG_PORT}/${PG_DB}"

case "$DB_URL" in
  postgresql://*@127.0.0.1:*|postgresql://*@localhost:*) ;;
  *) echo "Recusado: o banco da suíte precisa ser local ($DB_URL)" >&2; exit 2 ;;
esac

# Porta ocupada quer dizer outra sessão rodando: escrever nela sujaria o outro ambiente.
for porta in "$API_PORT" "$AI_PORT" "$((AI_PORT + 1))"; do
  if (exec 3<>"/dev/tcp/127.0.0.1/${porta}") 2>/dev/null; then
    echo "A porta ${porta} já está em uso. Defina IT_API_PORT e IT_AI_PORT com outras." >&2
    exit 2
  fi
done

export DOTENV_CONFIG_PATH="e2e/.env.integration"
export DATABASE_URL="$DB_URL" DIRECT_URL="$DB_URL"
export PORT="$API_PORT" CORS_ORIGIN="http://localhost:5194" PORTAL_URL="http://localhost:5194"
export E2E_BASE_URL="http://127.0.0.1:${API_PORT}"
# A chave real do shell, se houver, não passa daqui: vale a fictícia do .env.integration.
unset AZURE_AI_KEY
export IT_AI_PORT="$AI_PORT" AZURE_AI_ENDPOINT="http://127.0.0.1:${AI_PORT}"
export E2E_FOUNDRY_STUB="http://127.0.0.1:$((AI_PORT + 1))"
export E2E_PG_CONTAINER="$PG_CONTAINER" E2E_PG_DB="$PG_DB"

API_PID=""
cleanup() {
  local code=$?
  if [ "${IT_KEEP:-}" = "1" ]; then
    echo "Ambiente mantido: API ${E2E_BASE_URL} (pid ${API_PID:-?}), banco ${DB_URL}, stub ${AZURE_AI_ENDPOINT}"
    exit "$code"
  fi
  stop_backend || true
  curl -fs -X POST "${E2E_FOUNDRY_STUB}/shutdown" >/dev/null 2>&1 || true
  docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
  exit "$code"
}
trap cleanup EXIT

echo "› Postgres descartável em 127.0.0.1:${PG_PORT}"
docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$PG_CONTAINER" \
  -e POSTGRES_DB="$PG_DB" -e POSTGRES_USER=isa -e POSTGRES_PASSWORD=isa_local \
  -p "127.0.0.1:${PG_PORT}:5432" pgvector/pgvector:pg16 >/dev/null
until docker exec "$PG_CONTAINER" pg_isready -U isa -d "$PG_DB" -h 127.0.0.1 >/dev/null 2>&1; do sleep 1; done

echo "› Schema e dados fictícios"
# Client gerado de outra branch vira 500 opaco. Falha aqui costuma ser EPERM com
# um tsx watch segurando o query engine; segue com o client que já existe.
node_modules/.bin/prisma generate >/dev/null 2>&1 || echo "  aviso: prisma generate falhou, usando o client atual" >&2
node_modules/.bin/prisma migrate deploy >/dev/null
node_modules/.bin/prisma db push --skip-generate --accept-data-loss >/dev/null
# O db push apaga o índice HNSW, que o schema não representa: sem ele, a busca da base
# não passaria pelo caminho de produção.
docker exec -i "$PG_CONTAINER" psql -q -U isa -d "$PG_DB" <prisma/migrations/20261105140000_knowledge_chunks_hnsw/migration.sql >/dev/null
npx tsx prisma/seed.ts >/dev/null
node prisma/seed-test-rbac.mjs >/dev/null

start_backend() {
  stop_backend || exit 1
  mkdir -p "$(dirname "$LOG_FILE")"
  API_RATE_LIMIT_MAX="$1" npx tsx src/server.ts >>"$LOG_FILE" 2>&1 &
  API_PID=$!
  for _ in $(seq 1 90); do
    curl -fs "${E2E_BASE_URL}/health" >/dev/null 2>&1 && return 0
    kill -0 "$API_PID" 2>/dev/null || break
    sleep 1
  done
  echo "O backend não subiu. Veja ${LOG_FILE}" >&2
  tail -20 "$LOG_FILE" >&2
  exit 1
}

# No Windows o kill só alcança o npx: o node filho sobrevive e segura a porta, e a
# passada seguinte rodaria contra o backend antigo. Mata quem escuta na porta.
stop_backend() {
  [ -n "$API_PID" ] || return 0
  kill "$API_PID" 2>/dev/null || true
  if command -v taskkill >/dev/null 2>&1; then
    local pid
    pid=$(netstat -ano | awk -v porta=":${API_PORT}" '/LISTENING/ && index($2, porta) && substr($2, length($2) - length(porta) + 1) == porta { print $NF; exit }')
    [ -n "$pid" ] && taskkill //F //T //PID "$pid" >/dev/null 2>&1 || true
  fi
  wait "$API_PID" 2>/dev/null || true
  API_PID=""
  for _ in $(seq 1 15); do
    (exec 3<>"/dev/tcp/127.0.0.1/${API_PORT}") 2>/dev/null || return 0
    sleep 1
  done
  echo "A porta ${API_PORT} continua ocupada depois de parar o backend." >&2
  return 1
}

: >"$LOG_FILE" 2>/dev/null || true
FAILED=0

echo "› Stub do Foundry em 127.0.0.1:${AI_PORT}"
node e2e/foundry-stub.mjs >/dev/null 2>&1 &
for _ in $(seq 1 15); do
  curl -fs "${E2E_FOUNDRY_STUB}/requests" >/dev/null 2>&1 && break
  sleep 1
done
curl -fs "${E2E_FOUNDRY_STUB}/requests" >/dev/null 2>&1 || { echo "O stub do Foundry não subiu." >&2; exit 1; }

if [ "$#" -gt 0 ]; then
  echo "› Backend em modo produção na porta ${API_PORT}"
  start_backend 1000000
  npx vitest run -c vitest.e2e.config.ts "$@" || FAILED=1
else
  # A suíte faz milhares de requisições com poucos usuários e estouraria o limite
  # de 500 por usuário. Só 02-auth, que testa esse limite, roda com o valor real,
  # num backend recém-reiniciado (o contador fica em memória).
  echo "› Passada 1: suíte com limite de requisições alto"
  start_backend 1000000
  npx vitest run -c vitest.e2e.config.ts --exclude '**/02-auth.e2e.ts' || FAILED=1

  echo "› Passada 2: autenticação com o limite real"
  start_backend 500
  npx vitest run -c vitest.e2e.config.ts e2e/02-auth.e2e.ts || FAILED=1
fi

exit "$FAILED"
