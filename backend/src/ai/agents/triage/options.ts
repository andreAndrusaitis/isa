/**
 * O que a triagem pode responder vem do banco a cada chamado: tipos habilitados,
 * categorias e subcategorias ativas. Urgência e impacto são escalas fixas, com o
 * mesmo texto da rubrica usada para rotular a base de avaliação.
 */
import prisma from '../../../config/prisma'
import type { ChoiceQuestion, Option } from '../../core/choice'
import { getAvailableCategoriesForOrg } from '../../../services/categories'

export type TriageKey = 'type' | 'category' | 'subcategory' | 'urgency' | 'impact'
export type Level = 'low' | 'medium' | 'high'
export interface TriageQuestion extends ChoiceQuestion {
  key: TriageKey
  /** true = não mostra a categoria escolhida pelo cliente (validação às cegas). */
  blind: boolean
}

export const TYPE_OPTIONS: Option[] = [
  { value: 'incident', label: 'Incidente', description: 'algo que funcionava parou: erro, falha, lentidão, indisponibilidade, bloqueio indevido, alerta de segurança real' },
  { value: 'request', label: 'Requisição', description: 'pedido de algo novo ou de rotina: acesso, licença, criação/remoção de usuário, instalação, configuração, liberação, dúvida, relatório' },
  { value: 'problem', label: 'Problema', description: 'investigação da causa de falhas que se repetem' },
  { value: 'change', label: 'Mudança', description: 'alteração planejada de ambiente: migração, troca de servidor, mudança de política em produção, implantação' },
]

export const URGENCY_OPTIONS: Option[] = [
  { value: 'high', label: 'Alta', description: 'trabalho parado agora sem contorno, urgente, fora do ar, ameaça de segurança ativa, desligamento/bloqueio para hoje, bloqueio que impede uma atividade de negócio (faturar, emitir nota, atender cliente)' },
  { value: 'medium', label: 'Média', description: 'trabalho prejudicado mas com contorno, erro intermitente, pedido com data próxima' },
  { value: 'low', label: 'Baixa', description: 'pedido planejado, configuração, dúvida, melhoria, relatório, acesso sem prazo' },
]

export const IMPACT_OPTIONS: Option[] = [
  { value: 'high', label: 'Alto', description: 'empresa inteira, serviço crítico, servidor, ambiente/tenant; qualquer incidente de segurança (phishing, conta comprometida, vírus) mesmo afetando uma pessoa' },
  { value: 'medium', label: 'Médio', description: 'um setor, grupo, caixa compartilhada, site ou equipe' },
  { value: 'low', label: 'Baixo', description: 'uma pessoa ou um dispositivo' },
]

export async function loadTypeOptions(): Promise<Option[]> {
  // Mesma regra de computeTicketTypeChange: sem linha de config = habilitado.
  const disabled = new Set(
    (await prisma.ticketTypeConfig.findMany({ where: { enabled: false } })).map(c => c.type as string),
  )
  return TYPE_OPTIONS.filter(o => !disabled.has(o.value))
}

/** Escape para quando nenhuma opção serve (ex.: impressora sem categoria): nunca é aplicada. */
export const NONE_VALUE = '__none__'
export const NONE_OPTION: Option = { value: NONE_VALUE, label: 'Nenhuma das opções', description: 'o assunto não se encaixa em nenhuma opção acima ou o texto não permite saber' }

// Categoria pode não ter descrição: as subcategorias ativas dizem ao modelo o que
// cada uma cobre.
// Com a empresa do chamado, só as categorias a que ela tem acesso (plano menos as
// desligadas); sem empresa, ou empresa sem plano, todas as ativas.
export async function loadCategoryOptions(orgId?: string | null): Promise<Option[]> {
  const scoped = orgId ? await getAvailableCategoriesForOrg(orgId) : []
  const rows = scoped.length ? scoped : await prisma.category.findMany({
    where: { active: true }, orderBy: { name: 'asc' },
    select: { id: true, name: true, description: true, subcategories: { where: { active: true }, select: { name: true }, orderBy: { name: 'asc' } } },
  })
  return rows.map(c => {
    const subs = c.subcategories.map(s => s.name).join(', ')
    return { value: c.id, label: c.name, description: [c.description, subs && `inclui: ${subs}`].filter(Boolean).join(' — ') || null }
  })
}

export async function loadSubcategoryOptions(categoryId: string): Promise<Option[]> {
  if (categoryId === NONE_VALUE) return []
  const rows = await prisma.subcategory.findMany({
    where: { active: true, category_id: categoryId }, orderBy: { name: 'asc' }, select: { id: true, name: true, description: true },
  })
  return rows.map(s => ({ value: s.id, label: s.name, description: s.description }))
}

/** Perguntas com as opções dadas (o banco em produção, uma lista fixa na avaliação). */
export function buildQuestions(types: Option[], categories: Option[]): TriageQuestion[] {
  return [
    { key: 'type', prompt: 'Qual é o tipo deste chamado?', options: types, blind: false },
    { key: 'category', prompt: 'Qual categoria melhor descreve o assunto deste chamado?', options: [...categories, NONE_OPTION], blind: true },
    { key: 'urgency', prompt: 'Qual é a urgência deste chamado (quanto tempo dá para esperar)?', options: URGENCY_OPTIONS, blind: false },
    { key: 'impact', prompt: 'Qual é o impacto deste chamado (quantos são afetados)?', options: IMPACT_OPTIONS, blind: false },
  ]
}

export async function loadQuestions(orgId?: string | null): Promise<TriageQuestion[]> {
  const [types, categories] = await Promise.all([loadTypeOptions(), loadCategoryOptions(orgId)])
  return buildQuestions(types, categories)
}

export function subcategoryQuestion(options: Option[]): TriageQuestion {
  return { key: 'subcategory', prompt: 'Dentro dessa categoria, qual subcategoria melhor descreve o chamado?', options: [...options, NONE_OPTION], blind: true }
}

// Matriz urgência (linha) × impacto (coluna). Urgência alta = prioridade alta mesmo
// afetando uma pessoa só.
const PRIORITY_MATRIX: Record<Level, Record<Level, Level>> = {
  high:   { high: 'high',   medium: 'high',   low: 'high' },
  medium: { high: 'high',   medium: 'medium', low: 'low' },
  low:    { high: 'medium', medium: 'low',    low: 'low' },
}

export function priorityFrom(urgency: Level, impact: Level): Level {
  return PRIORITY_MATRIX[urgency][impact]
}
