/**
 * Adaptive Cards (schema 1.5) do bot do Teams, montados a partir das mesmas
 * categorias/subcategorias e do formulário dinâmico (special_form_schema) do
 * portal. Funções puras: quem envia é o handler do bot.
 *
 * Todo Action.Submit leva `acao` no data; o Teams junta os valores dos inputs
 * no mesmo objeto, por isso os campos do formulário especial usam o prefixo
 * `sf_` (nunca colidem com acao/subcategoryId).
 */
import type { PendingAction } from '../../ai/assistant/types'

export const CARD_SCHEMA = 'http://adaptivecards.io/schemas/adaptive-card.json'
export const CARD_VERSION = '1.5'
export const SPECIAL_FIELD_PREFIX = 'sf_'
export const TITLE_INPUT = 'titulo'
export const DESCRIPTION_INPUT = 'descricao'
export const REPLY_INPUT = 'resposta'

type CardElement = Record<string, unknown>

export interface AdaptiveCard {
  type: 'AdaptiveCard'
  $schema: string
  version: string
  body: CardElement[]
  actions?: CardElement[]
}

export interface CardCategory {
  id: string
  name: string
  description?: string | null
  icon?: string | null
  image_url?: string | null
}

export type SpecialFormFieldType = 'text' | 'textarea' | 'date' | 'email' | 'select'

/** Mesmo formato validado em services/categories.ts (specialFormFieldSchema). */
export interface SpecialFormField {
  key: string
  label: string
  /** Formulários antigos não têm tipo: o backend trata como texto. */
  type?: SpecialFormFieldType
  required?: boolean
  multiple?: boolean
  options?: Array<{ value: string; label: string }>
}

export interface CardSubcategory extends CardCategory {
  is_special?: boolean | null
  special_form_schema?: SpecialFormField[] | null
}

export type SpecialData = Record<string, string | string[]>

function card(body: CardElement[], actions?: CardElement[]): AdaptiveCard {
  return { type: 'AdaptiveCard', $schema: CARD_SCHEMA, version: CARD_VERSION, body, ...(actions?.length ? { actions } : {}) }
}

const heading = (text: string): CardElement => ({ type: 'TextBlock', text, weight: 'Bolder', size: 'Medium', wrap: true })
const subtle = (text: string, extra: CardElement = {}): CardElement => ({ type: 'TextBlock', text, isSubtle: true, wrap: true, spacing: 'Small', ...extra })
const submit = (title: string, data: Record<string, unknown>, extra: CardElement = {}): CardElement => ({ type: 'Action.Submit', title, data, ...extra })

/** Emoji vira prefixo; data:image (o Teams limita o tamanho do card) e nomes de ícone são ignorados. */
function iconPrefix(icon?: string | null): string {
  const value = icon?.trim()
  if (!value || value.length > 16 || /[A-Za-z0-9:]/.test(value)) return ''
  return `${value} `
}

function tile(item: CardCategory, data: Record<string, unknown>): CardElement {
  const items: CardElement[] = []
  if (item.image_url && /^https:\/\//i.test(item.image_url)) {
    items.push({ type: 'Image', url: item.image_url, size: 'Small', altText: item.name })
  }
  items.push({ type: 'TextBlock', text: `${iconPrefix(item.icon)}${item.name}`, weight: 'Bolder', wrap: true })
  if (item.description?.trim()) items.push(subtle(item.description.trim(), { maxLines: 2 }))
  return {
    type: 'Container',
    style: 'emphasis',
    items,
    selectAction: submit(item.name, data),
  }
}

/** Cards em grade (2 por linha): toque no bloco envia a escolha. */
function grid(tiles: CardElement[], perRow = 2): CardElement[] {
  const rows: CardElement[] = []
  for (let i = 0; i < tiles.length; i += perRow) {
    const columns = tiles.slice(i, i + perRow).map(t => ({ type: 'Column', width: 'stretch', items: [t] }))
    while (columns.length < perRow) columns.push({ type: 'Column', width: 'stretch', items: [] })
    rows.push({ type: 'ColumnSet', columns, spacing: 'Small' })
  }
  return rows
}

export function categoryCard(categories: CardCategory[]): AdaptiveCard {
  if (!categories.length) {
    return card([heading('Abrir chamado'), subtle('Nenhuma categoria disponível para você no momento.')])
  }
  return card([
    heading('Abrir chamado'),
    subtle('Escolha a categoria do seu pedido:'),
    ...grid(categories.map(c => tile(c, { acao: 'categoria', id: c.id }))),
  ])
}

export function subcategoryCard(category: Pick<CardCategory, 'id' | 'name' | 'icon'>, subcategories: CardCategory[]): AdaptiveCard {
  const back = [submit('Voltar às categorias', { acao: 'categorias' })]
  if (!subcategories.length) {
    return card([heading(`${iconPrefix(category.icon)}${category.name}`), subtle('Esta categoria não tem subcategorias disponíveis.')], back)
  }
  return card([
    heading(`${iconPrefix(category.icon)}${category.name}`),
    subtle('Agora escolha o assunto:'),
    ...grid(subcategories.map(s => tile(s, { acao: 'subcategoria', id: s.id, categoryId: category.id }))),
  ], back)
}

export function specialInputId(key: string): string {
  return `${SPECIAL_FIELD_PREFIX}${key}`
}

/** Mapeia um campo do formulário dinâmico para o input equivalente do Adaptive Card. */
export function fieldInput(field: SpecialFormField): CardElement {
  const required = !!field.required
  const base: CardElement = {
    id: specialInputId(field.key),
    label: field.label,
    isRequired: required,
    ...(required ? { errorMessage: `Preencha o campo obrigatório: ${field.label}` } : {}),
  }
  switch (field.type) {
    case 'textarea':
      return { type: 'Input.Text', ...base, isMultiline: true }
    case 'email':
      return { type: 'Input.Text', ...base, style: 'Email', placeholder: 'nome@empresa.com.br' }
    case 'date':
      return { type: 'Input.Date', ...base }
    case 'select':
      return {
        type: 'Input.ChoiceSet',
        ...base,
        choices: (field.options ?? []).map(o => ({ title: o.label, value: o.value })),
        isMultiSelect: !!field.multiple,
        style: field.multiple ? 'expanded' : 'compact',
        placeholder: 'Selecione',
      }
    default:
      return { type: 'Input.Text', ...base }
  }
}

/**
 * Formulário de abertura: subcategoria especial usa os campos do
 * special_form_schema (o título sai do template no backend); as demais pedem
 * título e descrição.
 */
export function ticketFormCard(subcategory: CardSubcategory, categoryName?: string): AdaptiveCard {
  const fields = subcategory.is_special ? subcategory.special_form_schema ?? [] : []
  const inputs: CardElement[] = fields.length
    ? fields.map(fieldInput)
    : [
        { type: 'Input.Text', id: TITLE_INPUT, label: 'Título', isRequired: true, errorMessage: 'Informe um título para o chamado', placeholder: 'Resuma o problema ou pedido' },
        { type: 'Input.Text', id: DESCRIPTION_INPUT, label: 'Descrição', isRequired: true, errorMessage: 'Descreva o problema ou pedido', isMultiline: true, placeholder: 'Conte o que aconteceu, desde quando e quem é afetado' },
      ]
  return card([
    heading(`${iconPrefix(subcategory.icon)}${subcategory.name}`),
    ...(categoryName ? [subtle(categoryName, { spacing: 'None' })] : []),
    ...(subcategory.description?.trim() ? [subtle(subcategory.description.trim())] : []),
    ...inputs,
  ], [
    submit('Abrir chamado', { acao: 'abrir', subcategoryId: subcategory.id }, { style: 'positive' }),
    submit('Voltar às categorias', { acao: 'categorias' }, { associatedInputs: 'none' }),
  ])
}

/** Escrita pendente: o bot só executa depois do "Confirmar". */
export function confirmationCard(pending: PendingAction, facts: Array<{ title: string; value: string }> = []): AdaptiveCard {
  return card([
    heading('Confirma esta ação?'),
    { type: 'TextBlock', text: pending.summary, wrap: true },
    ...(facts.length ? [{ type: 'FactSet', facts: facts.map(f => ({ title: f.title, value: f.value })) }] : []),
  ], [
    submit('Confirmar', { acao: 'confirmar', tool: pending.tool }, { style: 'positive' }),
    submit('Cancelar', { acao: 'cancelar', tool: pending.tool }, { style: 'destructive' }),
  ])
}

const EXCERPT_MAX = 300

/** Texto puro e curto da mensagem do analista (pode vir em HTML do editor). */
export function excerpt(text: string, max = EXCERPT_MAX): string {
  const plain = text
    .replace(/<br\s*\/?>|<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain
}

export interface AgentReplyCardInput {
  ticketId: string
  displayNumber: string
  title?: string | null
  agentName?: string | null
  message: string
  /** Link do chamado no portal. */
  url?: string | null
}

/** Proativa "o analista respondeu": mostra o trecho e deixa responder ali mesmo. */
export function agentReplyCard(input: AgentReplyCardInput): AdaptiveCard {
  const who = input.agentName?.trim() || 'O analista'
  const actions: CardElement[] = [submit('Responder', { acao: 'responder', ticketId: input.ticketId }, { style: 'positive' })]
  if (input.url) actions.push({ type: 'Action.OpenUrl', title: 'Abrir no portal', url: input.url })
  return card([
    heading(`${who} respondeu o chamado ${input.displayNumber}`),
    ...(input.title?.trim() ? [subtle(input.title.trim(), { spacing: 'None' })] : []),
    { type: 'Container', style: 'emphasis', items: [{ type: 'TextBlock', text: excerpt(input.message), wrap: true }] },
    { type: 'Input.Text', id: REPLY_INPUT, label: 'Sua resposta', isMultiline: true, isRequired: true, errorMessage: 'Escreva a resposta antes de enviar', placeholder: 'Escreva aqui para responder ao analista' },
  ], actions)
}

// ---------- Leitura do que o card enviou ----------

export type CardAction =
  | { acao: 'categorias' }
  | { acao: 'categoria'; id: string }
  | { acao: 'subcategoria'; id: string; categoryId?: string }
  | { acao: 'abrir'; subcategoryId: string; values: Record<string, unknown> }
  | { acao: 'confirmar'; tool?: string }
  | { acao: 'cancelar'; tool?: string }
  | { acao: 'responder'; ticketId: string; text: string }

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** Lê activity.value de um Action.Submit; null para o que não veio dos nossos cards. */
export function parseCardAction(value: unknown): CardAction | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  switch (v.acao) {
    case 'categorias':
      return { acao: 'categorias' }
    case 'categoria':
      return str(v.id) ? { acao: 'categoria', id: str(v.id) } : null
    case 'subcategoria':
      return str(v.id) ? { acao: 'subcategoria', id: str(v.id), ...(str(v.categoryId) ? { categoryId: str(v.categoryId) } : {}) } : null
    case 'abrir': {
      if (!str(v.subcategoryId)) return null
      const values = { ...v }
      delete values.acao
      delete values.subcategoryId
      return { acao: 'abrir', subcategoryId: str(v.subcategoryId), values }
    }
    case 'confirmar':
    case 'cancelar':
      return { acao: v.acao as 'confirmar' | 'cancelar', ...(str(v.tool) ? { tool: str(v.tool) } : {}) }
    case 'responder':
      return str(v.ticketId) ? { acao: 'responder', ticketId: str(v.ticketId), text: str(v[REPLY_INPUT]) } : null
    default:
      return null
  }
}

/**
 * O Input.ChoiceSet múltiplo devolve os valores juntos por vírgula. Como o
 * valor de uma opção pode ter vírgula, remonta casando com as opções conhecidas.
 */
function splitChoices(raw: string, options: Array<{ value: string }> | undefined): string[] {
  const known = new Set((options ?? []).map(o => o.value))
  if (known.has(raw)) return [raw]
  const parts = raw.split(',')
  const out: string[] = []
  let i = 0
  while (i < parts.length) {
    let matched = false
    for (let j = parts.length; j > i; j--) {
      const candidate = parts.slice(i, j).join(',').trim()
      if (known.has(candidate)) {
        out.push(candidate)
        i = j
        matched = true
        break
      }
    }
    if (!matched) {
      out.push(parts[i].trim())
      i++
    }
  }
  return out.filter(Boolean)
}

/**
 * Converte os valores do card no special_data que o backend espera (mesmas
 * regras de services/tickets.ts): select simples → string, select múltiplo →
 * string[], demais → string. Campo vazio fica de fora.
 */
export function toSpecialData(fields: SpecialFormField[], values: Record<string, unknown>): SpecialData {
  const data: SpecialData = {}
  for (const f of fields) {
    const raw = values[specialInputId(f.key)]
    if (f.type === 'select' && f.multiple) {
      const list = Array.isArray(raw) ? raw.map(str).filter(Boolean) : splitChoices(str(raw), f.options)
      if (list.length) data[f.key] = list
      continue
    }
    const text = str(Array.isArray(raw) ? raw[0] : raw)
    if (text) data[f.key] = text
  }
  return data
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Mesma checagem do portal (validateSpecialData) + formato de e-mail, data e opção. */
export function validateSpecialData(fields: SpecialFormField[], data: SpecialData): string | null {
  for (const f of fields) {
    const value = data[f.key]
    const empty = Array.isArray(value) ? value.length === 0 : !String(value ?? '').trim()
    if (empty) {
      if (f.required) return `Preencha o campo obrigatório: ${f.label}`
      continue
    }
    if (f.type === 'email' && !EMAIL_RE.test(String(value))) return `E-mail inválido no campo ${f.label}`
    if (f.type === 'date' && !DATE_RE.test(String(value))) return `Data inválida no campo ${f.label}`
    if (f.type === 'select' && f.options?.length) {
      const values = Array.isArray(value) ? value : [value]
      if (values.some(x => !f.options!.some(o => o.value === x))) return `Opção inválida para o campo ${f.label}`
    }
  }
  return null
}

export interface TicketDraft {
  subcategory_id: string
  title?: string
  description?: string
  special_data?: SpecialData
}

/** Monta o corpo de abertura a partir do submit do ticketFormCard, ou o erro para mostrar à pessoa. */
export function ticketFromSubmit(
  subcategory: CardSubcategory,
  values: Record<string, unknown>,
): { ok: true; ticket: TicketDraft } | { ok: false; error: string } {
  const fields = subcategory.is_special ? subcategory.special_form_schema ?? [] : []
  if (fields.length) {
    const special_data = toSpecialData(fields, values)
    const error = validateSpecialData(fields, special_data)
    return error ? { ok: false, error } : { ok: true, ticket: { subcategory_id: subcategory.id, special_data } }
  }
  const title = str(values[TITLE_INPUT])
  const description = str(values[DESCRIPTION_INPUT])
  if (!title) return { ok: false, error: 'Informe um título para o chamado' }
  if (!description) return { ok: false, error: 'Descreva o problema ou pedido' }
  return { ok: true, ticket: { subcategory_id: subcategory.id, title, description } }
}
