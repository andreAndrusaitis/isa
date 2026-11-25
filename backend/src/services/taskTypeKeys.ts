import { Prisma } from '@prisma/client'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'

type Tx = Prisma.TransactionClient

/**
 * Tipos com que todo projeto nasce. O prefixo vira o ID da task (BUG-12,
 * FEAT-3…), numerado por tipo dentro do projeto. "Tarefa" (TASK) é o tipo
 * de reserva quando quem cria a task (API, MCP, recorrência) não informa um.
 */
export const DEFAULT_TASK_TYPES = [
  { name: 'Epic', prefix: 'EPIC', icon: 'Zap', color: '#5a6d9c' },
  { name: 'Feature', prefix: 'FEAT', icon: 'Package', color: '#2f9fb3' },
  { name: 'User Story', prefix: 'US', icon: 'BookmarkCheck', color: '#3a7f6b' },
  { name: 'Tarefa', prefix: 'TASK', icon: 'CheckSquare', color: '#0f73ac' },
  { name: 'Bug', prefix: 'BUG', icon: 'Bug', color: '#b3402a' },
  { name: 'Melhoria', prefix: 'MEL', icon: 'Sparkles', color: '#a8761b' },
  { name: 'QA', prefix: 'QA', icon: 'FlaskConical', color: '#a8761b' },
  { name: 'Documentação', prefix: 'DOC', icon: 'FileText', color: '#6b7f8a' },
] as const

export const FALLBACK_PREFIX = 'TASK'
export const PREFIX_PATTERN = /^[A-Z][A-Z0-9]{0,7}$/

/** "Documentação técnica" → "DOCU". Sugestão para tipo novo sem prefixo informado. */
export function derivePrefix(name: string): string {
  const clean = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const prefix = clean.replace(/^[0-9]+/, '').slice(0, 4)
  return prefix || 'TIPO'
}

export function buildKey(prefix: string, number: number): string {
  return `${prefix}-${number}`
}

/**
 * Tipo da task: o informado (precisa ser ativo e do projeto) ou, sem tipo,
 * o "Tarefa" do projeto — toda task tem tipo e, portanto, ID.
 */
export async function resolveTaskType(tx: Tx, projectId: string, taskTypeId?: string | null) {
  if (taskTypeId) {
    const type = await tx.taskType.findFirst({ where: { id: taskTypeId, project_id: projectId, is_active: true } })
    if (!type) throw new AppError(400, 'Tipo de tarefa inválido para este projeto.', 'INVALID_TASK_TYPE')
    return type
  }
  const fallback = await tx.taskType.findFirst({ where: { project_id: projectId, is_active: true, prefix: FALLBACK_PREFIX } })
    ?? await tx.taskType.findFirst({ where: { project_id: projectId, is_active: true }, orderBy: { position: 'asc' } })
  if (fallback) return fallback
  // Projeto sem nenhum tipo ativo (criado fora do fluxo normal): ganha os padrão.
  await tx.taskType.createMany({ data: DEFAULT_TASK_TYPES.map((t, position) => ({ ...t, position, project_id: projectId })) })
  return tx.taskType.findFirstOrThrow({ where: { project_id: projectId, is_active: true, prefix: FALLBACK_PREFIX } })
}

/** Reserva o próximo número do tipo (incremento atômico dentro da transação). */
export async function allocateTypeNumber(tx: Tx, taskTypeId: string) {
  const type = await tx.taskType.update({
    where: { id: taskTypeId },
    data: { next_number: { increment: 1 } },
    select: { prefix: true, next_number: true },
  })
  const number = type.next_number - 1
  return { number, key: buildKey(type.prefix, number) }
}

export async function assertPrefixAvailable(projectId: string, prefix: string, exceptTypeId?: string) {
  if (!PREFIX_PATTERN.test(prefix)) {
    throw new AppError(400, 'Prefixo inválido: use de 1 a 8 letras maiúsculas ou números, começando por letra (ex.: BUG, FEAT).', 'INVALID_PREFIX')
  }
  // Só tipos ativos: o excluído já teve as tasks movidas para outro tipo,
  // então reaproveitar o prefixo dele não repete nenhuma chave existente.
  const clash = await prisma.taskType.findFirst({
    where: { project_id: projectId, prefix, is_active: true, ...(exceptTypeId ? { id: { not: exceptTypeId } } : {}) },
    select: { name: true },
  })
  if (clash) throw new AppError(409, `O prefixo ${prefix} já é usado pelo tipo "${clash.name}" neste projeto.`, 'PREFIX_TAKEN')
}
