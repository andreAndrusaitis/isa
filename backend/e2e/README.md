# Suíte de integração

Testes contra o backend rodando de verdade: HTTP, Socket.IO e PostgreSQL reais. Não importa o app nem usa mocks.

```bash
cd backend
npm run test:integration                     # sobe tudo, roda e apaga o banco
npm run test:integration -- e2e/15-*.e2e.ts  # só alguns arquivos
IT_KEEP=1 npm run test:integration           # mantém banco e backend no ar
```

Precisa só do Docker. O `run-integration.sh`:

1. cria um PostgreSQL descartável em `127.0.0.1:5436`;
2. aplica as migrations e carrega os dados fictícios do seed;
3. sobe o stub de IA na 3023 e o backend em modo produção na 3022;
4. roda a suíte em duas passadas: tudo com limite de requisições alto, depois `02-auth` com o limite real;
5. apaga o container.

As variáveis vêm de `.env.integration`, que substitui o `backend/.env` e só tem valores fictícios: nenhum e-mail sai e a IA fala só com o stub. O script para se a URL do banco não for local. Portas e nomes mudam com `IT_PG_PORT`, `IT_API_PORT`, `IT_AI_PORT`, `IT_PG_CONTAINER` e `IT_PG_DB`.

## Stub de IA

`foundry-stub.mjs` responde `/openai/deployments/*/embeddings` e `/chat/completions`, sempre igual para a mesma entrada.

- O embedding vem das palavras-chave do texto: perguntas com as mesmas palavras ficam próximas.
- O chat responde a múltipla escolha com logprobs, no formato de `core/choice.ts`, e o JSON de resposta com o trecho mais parecido.
- Obedece a injeção de prompt de propósito: quem barra é o backend.
- As palavras `duvidoso` (80%) e `quase` (87%) fixam a certeza, para testar o rigor.

A porta seguinte (`IT_AI_PORT + 1`) é o controle: `GET /requests` lista o que chegou, e `POST` em `/reset`, `/down` e `/up` limpa a lista e derruba ou sobe a API. O `integration-helpers.ts` expõe isso em `foundry`, além de `sql` e `bancoContem`.

Os agentes ficam desligados; só o `23-base-conhecimento` liga o `knowledge` e o desliga no fim. O assistente do portal não tem modo e recebe do stub uma resposta fixa.

## Arquivos

| Arquivos | O que cobrem |
|---|---|
| `01` a `14` | Rotas, sessão, isolamento entre empresas, ciclo do chamado, API externa, tempo real |
| `15-projetos-ciclo` | Projeto, task, sprint, dependência, histórico, exportação, numeração sob concorrência |
| `16-projetos-acesso` | Módulo, privacidade, papéis do projeto, IDOR entre projetos, busca |
| `17-projetos-api-publica` | Chave `isaproj_`: revogação, escopo, alcance, idempotência, contrato snake_case |
| `18-ponte-chamado-task` | Vínculo chamado ↔ task sem furar a carteira |
| `19-mcp` | Token pessoal, revogação e o que o agente de IA enxerga |
| `20-configuracao` | Quem configura e o efeito de roteamento, SLA e regras automáticas |
| `21-integracoes-externas` | Bloqueio de e-mail, Teams e IA desligados, cabeçalhos de produção |
| `22-idempotencia-chamados` | Retentativa em rajada na API de chamados |
| `23-base-conhecimento` | Artigos, isolamento por plano e categoria, sugestão, aceite, feedback, piloto, lacunas e métricas |
| `24-escalonamento-regras` | Regras de escalonamento e acesso pelo destino |
| `25-documentos` | Espaços, páginas, papéis, versões e edição colaborativa |

Teste que falha aponta um defeito: corrija o código, não o teste.
