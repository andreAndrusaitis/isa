import prisma from '../config/prisma'
import { env } from '../config/env'

// Lista oficial de variáveis de texto ({chave}). Única fonte para o painel de
// macros (picker + lint), a substituição em macros e a pesquisa de satisfação.
export const TEMPLATE_VARIABLES = [
  { key: 'nome_usuario', label: 'Nome do solicitante', example: 'Maria Souza' },
  { key: 'primeiro_nome_usuario', label: 'Primeiro nome do solicitante', example: 'Maria' },
  { key: 'email_usuario', label: 'E-mail do solicitante', example: 'maria.souza@empresa.com' },
  { key: 'empresa', label: 'Empresa do chamado', example: 'Empresa Exemplo' },
  { key: 'numero_chamado', label: 'Número do chamado (o exibido na tela)', example: 'INC-000123' },
  { key: 'titulo_chamado', label: 'Título do chamado', example: 'Impressora não imprime' },
  { key: 'status', label: 'Status atual', example: 'Em atendimento' },
  { key: 'prioridade', label: 'Prioridade', example: 'Alta' },
  { key: 'fila', label: 'Fila', example: 'Service Desk' },
  { key: 'categoria', label: 'Categoria', example: 'Hardware' },
  { key: 'subcategoria', label: 'Subcategoria', example: 'Impressoras' },
  { key: 'nome_analista', label: 'Analista que aplica a macro', example: 'João Lima' },
  { key: 'data_abertura', label: 'Data de abertura', example: '05/10/2026, 09:30' },
  { key: 'prazo_sla', label: 'Prazo de SLA', example: '06/10/2026, 17:00' },
  { key: 'link_chamado', label: 'Link do chamado no portal', example: `${env.PORTAL_URL}/c/INC-000123` },
  { key: 'link_pesquisa', label: 'Link da pesquisa de satisfação', example: `${env.PORTAL_URL}/survey/exemplo` },
] as const

export type TemplateVarKey = typeof TEMPLATE_VARIABLES[number]['key']
export type TemplateVars = Partial<Record<TemplateVarKey, string | null | undefined>>

// Nomes antigos que continuam funcionando (templates de pesquisa já salvos).
const ALIASES: Record<string, TemplateVarKey> = { nome_cliente: 'nome_usuario' }
const KNOWN = new Set<string>(TEMPLATE_VARIABLES.map(v => v.key))
const VAR_RE = /\{([a-z_]+)\}/g
export const EMPTY_VALUE = '—'

export const EXAMPLE_VARS: TemplateVars = Object.fromEntries(TEMPLATE_VARIABLES.map(v => [v.key, v.example]))

/** Troca cada {variável} conhecida pelo valor; sem valor vira "—". Desconhecidas ficam (o lint avisa no cadastro). */
export function renderTemplate(content: string, vars: TemplateVars): string {
  return content.replace(VAR_RE, (match, raw: string) => {
    const key = ALIASES[raw] ?? raw
    if (!KNOWN.has(key)) return match
    return vars[key as TemplateVarKey]?.trim() || EMPTY_VALUE
  })
}

export function findUnknownVariables(content: string): string[] {
  const unknown = new Set<string>()
  for (const [, raw] of content.matchAll(VAR_RE)) if (!KNOWN.has(ALIASES[raw] ?? raw)) unknown.add(raw)
  return [...unknown]
}

export function usesVariable(content: string, key: TemplateVarKey): boolean {
  return content.includes(`{${key}}`)
}

const STATUS: Record<string, string> = { open: 'Aberto', in_progress: 'Em atendimento', pending: 'Pendente', resolved: 'Resolvido', closed: 'Fechado' }
const PRIORITY: Record<string, string> = { low: 'Baixa', medium: 'Média', high: 'Alta' }
const fmtDate = (d?: Date | null) =>
  d ? d.toLocaleString('pt-BR', { timeZone: env.BUSINESS_TIMEZONE, dateStyle: 'short', timeStyle: 'short' }) : null

/** Valores das variáveis para um chamado. link_pesquisa vem do chamador (gerar token tem efeito colateral). */
export async function buildTicketVars(
  ticketId: string,
  opts: { analystId?: string; linkSurvey?: string } = {},
): Promise<TemplateVars> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      user: { select: { name: true, email: true } },
      org: { select: { name: true } },
      category: { select: { name: true } },
      subcategory: { select: { name: true } },
    },
  })
  if (!ticket) return {}
  const [queue, analyst] = await Promise.all([
    ticket.queue ? prisma.queue.findUnique({ where: { id: ticket.queue }, select: { name: true } }) : null,
    opts.analystId ? prisma.user.findUnique({ where: { id: opts.analystId }, select: { name: true } }) : null,
  ])
  return {
    nome_usuario: ticket.user?.name,
    primeiro_nome_usuario: ticket.user?.name?.trim().split(/\s+/)[0],
    email_usuario: ticket.user?.email,
    empresa: ticket.org?.name,
    numero_chamado: ticket.display_number,
    titulo_chamado: ticket.title,
    status: STATUS[ticket.status] ?? ticket.status,
    prioridade: PRIORITY[ticket.priority] ?? ticket.priority,
    fila: queue?.name,
    categoria: ticket.category?.name,
    subcategoria: ticket.subcategory?.name,
    nome_analista: analyst?.name,
    data_abertura: fmtDate(ticket.created_at),
    prazo_sla: fmtDate(ticket.sla_deadline),
    link_chamado: `${env.PORTAL_URL.replace(/\/+$/, '')}/c/${encodeURIComponent(ticket.id)}`,
    link_pesquisa: opts.linkSurvey,
  }
}
