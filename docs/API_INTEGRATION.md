# API de integração

API para sistemas externos criarem e consultarem chamados, usuários e projetos. Para receber avisos do ISA, veja [Webhooks de saída](#webhooks-de-saída).

| API | Base | Chave |
|---|---|---|
| Chamados | `https://api.example.com/api/integrations/v1` | `isakey_…` |
| Projetos | `https://api.example.com/api/integrations/v1/projects` | `isaproj_…` |

## Autenticação

```
Authorization: Bearer isakey_...
```

Também vale `X-Api-Key`. A chave é exibida uma vez, na criação, e fica guardada só como hash.

- Chave de chamados: Configurações → Integrações → API externa.
- Chave de projetos: Projetos → Webhooks e API.

Cada chave tem escopos. Chave de chamados pode ser:

- **travada numa empresa**: tudo o que ela cria ou lê é dessa empresa;
- **multi-empresa**: usa `organization_id` ou, sem ele, o domínio do e-mail do solicitante.

Limite: 60 requisições por minuto por chave e IP (`API_KEY_RATE_LIMIT_PER_MINUTE`). Acima disso, `429 RATE_LIMIT_EXCEEDED`.

## Idempotência

Escritas aceitam `external_request_id` (até 255 caracteres), único por requisição:

- já concluída: `200` com `duplicate: true`, sem executar de novo;
- em andamento: `409 API_REQUEST_IN_FLIGHT`;
- falhou antes: executa de novo.

Sem ele, cada chamada é uma requisição nova.

## API de chamados

| Escopo | Endpoint |
|---|---|
| `create_ticket` | `POST /tickets`, `POST /tickets/:id/attachments` |
| `update_ticket` | `PATCH /tickets/:id` |
| `close_ticket` | `POST /tickets/:id/closure` |
| `read_tickets` | `GET /tickets`, `GET /tickets/:idOuNumero` |
| `read_messages` | `GET /tickets/:id/messages` |
| `create_message` | `POST /tickets/:id/messages` |
| `create_user` | `POST /users` |
| `update_user` | `PATCH /users/:idOuEmail` |
| `read_categories` | `GET /categories` |
| `read_subcategories` | `GET /subcategories` |
| `read_queues` | `GET /queues` |
| `read_organizations` | `GET /organizations` |

Um chamado tem `id` (`ISA-1042`, fixo) e `display_number` (`INC-1042`, muda de prefixo com o tipo).

### `POST /tickets`

```json
{
  "external_request_id": "pedido-001",
  "organization_id": "uuid, só para chave multi-empresa",
  "requester": { "email": "ana@example.com", "name": "Ana (opcional)" },
  "ticket": {
    "title": "Não consigo acessar a VPN",
    "description": "Erro ao conectar desde hoje cedo.",
    "priority": "low | medium | high (padrão medium)",
    "queue": "id da fila (padrão: fila do plano da empresa)",
    "category_id": "uuid (opcional)",
    "subcategory_id": "uuid (opcional)",
    "attachments": [{ "name": "erro.png", "content_type": "image/png", "content_bytes": "<base64>" }]
  }
}
```

Resposta `201`:

```json
{
  "duplicate": false,
  "resource_type": "ticket",
  "resource_id": "ISA-1042",
  "portal_url": "https://isa.example.com/c/ISA-1042",
  "ticket": { },
  "attachments": [{ "name": "erro.png", "size": 18231, "type": "image" }]
}
```

- Solicitante novo é criado como usuário final. Solicitante inativo: `403 REQUESTER_INACTIVE`. Remetente bloqueado: `422 SENDER_BLOCKED`.
- Até 20 anexos de 10 MB. Para arquivos grandes, use `POST /tickets/:id/attachments` (um por chamada, mesmos campos).
- Anexos aceitam também `contentType` e `contentBytes`.

**Subcategoria com formulário.** Se `GET /subcategories` devolver `is_special: true`, `title` e `description` são ignorados. Envie `ticket.special_data` com as chaves de `special_form_schema`:

```json
{ "id": "uuid", "name": "Admissão de colaborador", "is_special": true,
  "special_title_template": "Admissão — {nome_completo}",
  "special_form_schema": [
    { "key": "nome_completo", "label": "Nome completo", "type": "text", "required": true },
    { "key": "ambientes", "label": "Ambientes", "type": "select", "multiple": true,
      "options": [{ "value": "production", "label": "Produção" }] }
  ] }
```

O título sai do modelo. Em `select`, envie o `value` da opção (lista quando `multiple`). Chaves fora do formulário são descartadas.

### `PATCH /tickets/:id`

Ao menos um campo:

```json
{ "status": "open | in_progress | resolved | closed", "priority": "low | medium | high",
  "queue": "id da fila", "assigned_to_email": "bruno@example.com", "note": "Nota da alteração" }
```

`pending` exige motivo da pendência, que a API não recebe: use a tela para pausar um chamado.

### `POST /tickets/:id/closure`

```json
{ "status": "resolved | closed", "note": "opcional, até 5.000 caracteres", "external_request_id": "fim-001" }
```

Resposta `200` com o chamado. Segue as mesmas regras, auditoria e webhooks da tela.

### `GET /tickets` e `GET /tickets/:idOuNumero`

Filtros (todos opcionais): `page`, `per_page` (até 100), `status` (lista por vírgula), `organization_id`, `updated_since`, `created_since` (ISO 8601), `requester_email`, `order` (`asc` ou `desc`, por `updated_at`).

Para sincronizar, guarde o maior `updated_at` e envie como `updated_since` na próxima chamada.

```json
{ "data": [ { "id": "ISA-1042", "display_number": "INC-1042", "status": "open", "portal_url": "…" } ],
  "pagination": { "page": 1, "per_page": 50, "total": 1234, "total_pages": 25 } }
```

O detalhe traz também `survey_url`: link da pesquisa ainda não respondida, ou `null`.

### Mensagens

`GET /tickets/:id/messages` devolve a conversa pública (sem notas internas). Com `?requester_email=`, só responde se o e-mail for o do solicitante.

`POST /tickets/:id/messages` entra como mensagem do solicitante:

```json
{ "requester_email": "ana@example.com", "text": "Segue o log",
  "attachments": [{ "name": "app.log", "content_type": "text/plain", "content_bytes": "<base64>" }] }
```

Chamado fechado recusa (`400 TICKET_CLOSED`); resolvido reabre, dentro do prazo. Até 5 anexos.

### Usuários

`POST /users`: `{ "name", "email", "organization_id"? }`. Cria sempre usuário final.

`PATCH /users/:idOuEmail`: `{ "changes": { "name"?, "email"?, "active"?, "organization_id"? } }`. Só altera usuários finais.

### Catálogo

- `GET /categories`, `GET /subcategories?category_id=`, `GET /queues`, `GET /organizations`.
- Categorias e subcategorias saem filtradas pelo plano quando a empresa é conhecida: chave travada, `?organization_id=` ou `?requester_email=`. Sem isso, vem o catálogo inteiro. Plano vencido: `403 SLA_PLAN_EXPIRED`.

## API de projetos

Entrada e saída em `snake_case`, listas com `data` e `pagination`. A chave age como um usuário de serviço próprio e tem, em cada projeto, o papel de quem a criou (gerente ou membro). Projeto fora do alcance responde 404. `:taskId` aceita o uuid, o código (`BUG-12`) ou o número (`142`).

| Escopo | Recursos em `/:projectId` |
|---|---|
| `read_projects`, `write_projects` | `GET /` (lista), `POST /` (só chave de todos os projetos), `GET` e `PATCH /:projectId` |
| `read_members`, `write_members` | `/members` |
| `read_structure`, `write_structure` | `/statuses`, `/folders`, `/lists`, `/task-types`, `/sprints`, `/tags`, `/custom-fields` |
| `read_tasks`, `write_tasks` | `/tasks`, e por task: `/complete`, `/assignees`, `/checklist`, `/tags`, `/custom-fields`, `/dependencies` |
| `read_comments`, `write_comments` | `/tasks/:taskId/comments` |
| `read_documents`, `write_documents` | `/documents`, `/tasks/:taskId/documents/:documentId` |
| `read_attachments`, `write_attachments` | `/attachments` |
| `read_time` | `/time`, `/tasks/:taskId/time`, `/dashboard`, `/workload` |
| `read_tickets`, `write_tickets` | `/tasks/:taskId/tickets` (vínculo com chamados) |

`GET /:projectId/tasks` filtra por `status_id`, `assignee_id`, `sprint_id`, `list_id`, `parent_id`, `updated_since`, `include_archived` e `order`.

Configurar o projeto (estrutura, membros) exige papel de gerente: `403 API_KEY_ROLE_DENIED`.

## Webhooks de saída

Cadastre o endereço e os eventos em Configurações → Integrações → Saída. Eventos: `ticket.created`, `ticket.updated`, `ticket.status_changed`, `ticket.assigned`, `ticket.resolved`, `ticket.closed`, `ticket.escalated`, `ticket.inactive`, `sla.warning`, `ticket.message_created` (e as variantes `_by_user` e `_by_agent`), `user.created`, `user.updated`, `user.deleted`, `organization.created`, `email.ticket_opened`, `email.not_opened`, `ping`.

Cada entrega leva os cabeçalhos:

```
X-Webhook-Event: ticket.created
X-Webhook-Delivery-Id: <uuid>
X-Webhook-Timestamp: 2026-01-01T12:00:00.000Z
X-Webhook-Signature: sha256=<hmac>
```

Para conferir: HMAC-SHA256 de `"{timestamp}.{corpo}"` com o segredo do endpoint. Falhas são repetidas com espera crescente, e o histórico fica 30 dias.

## Erros

`{ "error": "mensagem", "code": "CODIGO", "details"?: {} }`

| Código | HTTP | Quando |
|---|---|---|
| `API_KEY_MISSING`, `API_KEY_INVALID` | 401 | Chave ausente ou não reconhecida |
| `API_KEY_SCOPE_DENIED` | 403 | Falta o escopo do endpoint |
| `API_KEY_OUT_OF_SCOPE` | 404 | Recurso de outra empresa |
| `TICKET_NOT_FOUND` | 404 | Chamado inexistente, excluído ou fora do alcance |
| `CATEGORY_NOT_FOUND`, `SUBCATEGORY_NOT_FOUND` | 404 | Id inválido ou inativo |
| `USER_NOT_FOUND`, `ASSIGNEE_NOT_FOUND` | 404 | Pessoa não encontrada |
| `API_ORG_NOT_FOUND`, `API_ORG_INVALID` | 400 | Empresa não encontrada ou inválida |
| `SLA_PLAN_EXPIRED` | 403 | Plano da empresa vencido |
| `VALIDATION_ERROR` | 400 | Dados inválidos (veja `details`) |
| `SPECIAL_FORM_MISSING_FIELDS`, `SPECIAL_FORM_INVALID_OPTION`, `SPECIAL_FORM_INVALID_VALUE` | 400 | Formulário da subcategoria |
| `EMPTY_ATTACHMENT`, `INVALID_ATTACHMENT_TYPE` | 400 | Anexo vazio ou de tipo não permitido |
| `ATTACHMENT_TOO_LARGE` | 413 | Anexo acima de 10 MB |
| `API_REQUEST_IN_FLIGHT` | 409 | Mesmo `external_request_id` em andamento |
| `RATE_LIMIT_EXCEEDED` | 429 | Limite de requisições |
