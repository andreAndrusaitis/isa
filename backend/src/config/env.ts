import 'dotenv/config'
import { z } from 'zod'

const schema = z.object({
  NODE_ENV:               z.enum(['development', 'test', 'production']).default('development'),
  PORT:                   z.union([z.string(), z.coerce.number()]).default(3001),
  DATABASE_URL:           z.string().min(1),
  DIRECT_URL:             z.string().optional(),
  DATABASE_URL_DIRECT:    z.string().optional(),
  JWT_SECRET:             z.string().min(32),
  JWT_REFRESH_SECRET:     z.string().min(32),
  // Cifra os segredos salvos pelo admin (SSO, IA). Sem ela, deriva de JWT_SECRET:
  // nesse caso, trocar o JWT_SECRET obriga a digitar os segredos de novo.
  SETTINGS_ENCRYPTION_KEY: z.string().min(32).optional(),
  JWT_EXPIRES_IN:         z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGIN:            z.string().default('http://localhost:5173'),
  AZURE_COMMUNICATION_CONNECTION_STRING: z.string().optional(),
  AZURE_EMAIL_SENDER:     z.string().default('DoNotReply@example.com'),
  // Caixa de atendimento no M365 (Microsoft Graph, app-only com certificado). Com as
  // cinco preenchidas, todo e-mail do sistema sai por ela; sem elas, segue pelo ACS.
  // O app só enxerga essa caixa (RBAC for Applications no Exchange Online).
  MAIL_GRAPH_TENANT_ID:   z.string().optional(),
  MAIL_GRAPH_CLIENT_ID:   z.string().optional(),
  MAIL_GRAPH_CERT:        z.string().optional(), // PEM do certificado
  MAIL_GRAPH_PRIVATE_KEY: z.string().optional(), // PEM da chave privada (PKCS#8)
  MAIL_GRAPH_MAILBOX:     z.string().optional(), // ex.: atendimento@example.com
  // Ler a caixa e transformar e-mails em chamados/respostas. Só um
  // ambiente pode ler cada caixa: a leitura move os e-mails e dois leitores abririam o
  // mesmo chamado. Em dev fica desligado.
  MAIL_INBOUND_ENABLED:   z.string().optional().transform(v => v === 'true' || v === '1'),
  // Data/hora (ISO) de corte: só e-mails recebidos depois dela são lidos. A Caixa de
  // Entrada pode ter histórico; sem o corte, tudo viraria chamado.
  // Obrigatória para a leitura ligar.
  MAIL_INBOUND_SINCE:     z.string().optional().refine(v => !v || !Number.isNaN(Date.parse(v)), 'data ISO inválida'),
  // Categoria/subcategoria dos chamados abertos por e-mail.
  MAIL_INBOUND_CATEGORY_ID:    z.string().optional(),
  MAIL_INBOUND_SUBCATEGORY_ID: z.string().optional(),
  PORTAL_URL:             z.string().default('http://localhost:5173'),
  // Hosts aceitos no X-Forwarded-Host da prévia de link (/api/link-preview), separados
  // por vírgula; ".dominio" vale como sufixo. Fora da lista usa o host de PORTAL_URL.
  LINK_PREVIEW_ALLOWED_HOSTS: z.string().default(''),
  // Requisições/minuto por API key + IP na API externa. Integrações que atendem muitos
  // usuários por trás de um único servidor precisam de um teto maior.
  API_KEY_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  WEBHOOK_BOOTSTRAP_ENDPOINTS: z.string().optional(),
  // Permite URLs privadas/localhost como destino de webhooks de saída (true em dev)
  // Só 'true'/'1' liga: z.coerce.boolean() tratava a string 'false' como true.
  WEBHOOKS_ALLOW_PRIVATE_URLS: z.string().optional().transform(v => v === 'true' || v === '1'),
  BUSINESS_HOURS_START:   z.coerce.number().default(8),
  BUSINESS_HOURS_END:     z.coerce.number().default(18),
  BUSINESS_TIMEZONE:      z.string().default('America/Sao_Paulo'),

  // Azure Blob Storage para anexos. Se ausentes, o sistema mantém o comportamento
  // antigo (anexo em base64 no banco). Presentes → anexos vão para o blob.
  AZURE_STORAGE_ACCOUNT:   z.string().optional(),
  AZURE_STORAGE_KEY:       z.string().optional(),
  AZURE_STORAGE_CONTAINER: z.string().default('ticket-attachments'),

  // SSO OIDC multi-tenant (Azure AD / Entra ID) — opcionais: ambientes sem
  // SSO configurado (dev/test) seguem funcionando só com login local.
  // Autenticação via /common/ aceita qualquer conta Microsoft organizacional
  // (qualquer tenant), sem exigir convite B2B prévio — a autorização real
  // (quem pode entrar no sistema) é feita no backend via busca no banco por
  // email + auth_provider='microsoft' + active=true (authSso.ts).
  AZURE_AD_CLIENT_ID:     z.string().optional(),
  OIDC_CALLBACK_URL:      z.string().optional(),
  // Credencial do client: reaproveita o certificado X.509 já emitido para o
  // SP (client assertion / private_key_jwt), sem gerar client secret novo.
  AZURE_AD_CERT:           z.string().optional(),
  AZURE_AD_PRIVATE_KEY:    z.string().optional(),

  // IA — agentes em backend/src/ai (LLM no Azure Foundry). Sem endpoint/chave
  // todos os agentes ficam desligados, qualquer que seja o modo.
  AZURE_AI_ENDPOINT:      z.string().optional(),
  AZURE_AI_KEY:           z.string().optional(),
  AZURE_AI_DEPLOYMENT:    z.string().default('gpt-4.1-mini'),
  AZURE_AI_API_VERSION:   z.string().default('2024-10-21'),
  AZURE_AI_TIMEOUT_MS:    z.coerce.number().default(15000),
  // Máximo de chamadas simultâneas ao LLM neste processo (excedente entra na fila).
  AZURE_AI_MAX_CONCURRENCY: z.coerce.number().int().min(1).default(6),
  AZURE_AI_EMBEDDING_DEPLOYMENT: z.string().default('text-embedding-3-small'),
  // Agente de triagem: off | shadow (só sugere em nota interna) | apply (grava no chamado o que passou no limiar).
  AI_TRIAGE_MODE:         z.enum(['off', 'shadow', 'apply']).default('off'),
  // Campos que o modo apply pode gravar (type, priority, category, subcategory); o resto
  // fica só como sugestão na nota. Padrão: todos (categoria/subcategoria só com 95% de confiança).
  AI_TRIAGE_APPLY_FIELDS: z.string().default('type,priority,category,subcategory'),
  // Agente de completude na abertura: off | shadow (só nota interna) | apply (pergunta ao solicitante e marca o chamado).
  AI_INTAKE_MODE:         z.enum(['off', 'shadow', 'apply']).default('off'),
  // Agente de orientação: off | shadow (só nota interna) | apply (orienta o solicitante e oferece vincular duplicados).
  AI_GUIDANCE_MODE:       z.enum(['off', 'shadow', 'apply']).default('off'),
  // Assistente de chamados (Teams/portal/MCP): mensagens por usuário na janela,
  // teto de tokens por conversa e alerta (só log) do consumo diário (0 = sem alerta).
  AI_ASSISTANT_RATE_LIMIT:        z.coerce.number().int().positive().default(20),
  AI_ASSISTANT_RATE_WINDOW_MIN:   z.coerce.number().positive().default(5),
  AI_ASSISTANT_MAX_CONVERSATION_TOKENS: z.coerce.number().int().positive().default(50000),
  AI_ASSISTANT_DAILY_TOKEN_ALERT: z.coerce.number().int().min(0).default(0),
  // Bot do Teams (Azure Bot single-tenant). Sem app id, senha e tenant o bot fica
  // desligado e POST /api/teams/messages responde 503. TEAMS_BOT_TENANT_ID aceita
  // lista separada por vírgula: o primeiro é o tenant do app; todos são os tenants
  // de onde o bot aceita conversas. TEAMS_BOT_ENABLED=false desliga sem apagar as chaves.
  TEAMS_BOT_ENABLED:      z.string().optional().transform(v => v !== 'false' && v !== '0'),
  TEAMS_BOT_APP_ID:       z.string().optional(),
  TEAMS_BOT_APP_PASSWORD: z.string().optional(),
  TEAMS_BOT_TENANT_ID:    z.string().optional(),
})

const parsed = schema
  // Com o mesmo segredo, um refresh token valeria como token de acesso.
  .refine(v => v.JWT_SECRET !== v.JWT_REFRESH_SECRET, { path: ['JWT_REFRESH_SECRET'], message: 'precisa ser diferente de JWT_SECRET' })
  .safeParse(process.env)

if (!parsed.success) {
  const errors = parsed.error.flatten().fieldErrors
  process.stderr.write('[ISA] Variáveis de ambiente inválidas:\n')
  process.stderr.write(JSON.stringify(errors, null, 2) + '\n')
  throw new Error('ENV_INVALID:' + JSON.stringify(errors))
}

export const env = parsed.data
