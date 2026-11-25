import { z } from 'zod'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'

export const createSprintSchema = z.object({
  name: z.string().min(1),
  startDate: z.string().datetime().nullable().optional(),
  endDate: z.string().datetime().nullable().optional(),
})

export const updateSprintSchema = z.object({
  name: z.string().min(1).optional(),
  startDate: z.string().datetime().nullable().optional(),
  endDate: z.string().datetime().nullable().optional(),
})

/**
 * Fim não vem antes do início. Fica fora dos schemas de propósito: `.refine` tira
 * o `.extend` de que a rota de sprint global precisa, e a edição depende do valor salvo.
 */
export function assertSprintDates(start: string | Date | null | undefined, end: string | Date | null | undefined) {
  if (start && end && new Date(end) < new Date(start)) {
    throw new AppError(400, 'A data de fim do sprint não pode ser anterior à de início.', 'SPRINT_DATES_INVERTED')
  }
}

/** Projeto que segue um calendário global não cria/edita sprints: quem manda é o Gerente. */
async function assertOwnSprints(projectId: string, sprintId?: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { sprint_source_id: true } })
  const linked = sprintId ? await prisma.sprint.count({ where: { id: sprintId, project_id: projectId, global_sprint_id: { not: null } } }) : 0
  if (project?.sprint_source_id || linked) {
    throw new AppError(409, 'Os sprints deste projeto vêm do calendário global do Gerente. Altere em Projetos › Sprints.', 'GLOBAL_SPRINT_MANAGED')
  }
}

export async function createSprint(projectId: string, data: z.infer<typeof createSprintSchema>) {
  await assertOwnSprints(projectId)
  assertSprintDates(data.startDate, data.endDate)
  const count = await prisma.sprint.count({ where: { project_id: projectId } })
  return prisma.sprint.create({
    data: {
      project_id: projectId,
      name: data.name,
      start_date: data.startDate ? new Date(data.startDate) : null,
      end_date: data.endDate ? new Date(data.endDate) : null,
      position: count,
    },
  })
}

/** Só os sprints da origem escolhida: os próprios, ou as cópias do calendário do Gerente seguido. */
export async function listSprints(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { sprint_source_id: true } })
  const source = project?.sprint_source_id
  return prisma.sprint.findMany({
    where: { project_id: projectId, ...(source ? { global_sprint: { owner_id: source } } : { global_sprint_id: null }) },
    orderBy: { position: 'asc' },
  })
}

export async function updateSprint(projectId: string, sprintId: string, data: z.infer<typeof updateSprintSchema>) {
  await assertOwnSprints(projectId, sprintId)
  // Só quando a data muda: renomear sprint antigo com datas invertidas continua valendo.
  if (data.startDate !== undefined || data.endDate !== undefined) {
    const saved = await prisma.sprint.findFirst({ where: { id: sprintId, project_id: projectId }, select: { start_date: true, end_date: true } })
    assertSprintDates(data.startDate !== undefined ? data.startDate : saved?.start_date, data.endDate !== undefined ? data.endDate : saved?.end_date)
  }
  const updated = await prisma.sprint.updateMany({
    where: { id: sprintId, project_id: projectId },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.startDate !== undefined ? { start_date: data.startDate ? new Date(data.startDate) : null } : {}),
      ...(data.endDate !== undefined ? { end_date: data.endDate ? new Date(data.endDate) : null } : {}),
    },
  })
  if (updated.count === 0) throw new AppError(404, 'Sprint não encontrado', 'NOT_FOUND')
  return prisma.sprint.findUniqueOrThrow({ where: { id: sprintId } })
}

/**
 * Ativa um sprint "planned". Recusa se já existe outro sprint "active" no
 * projeto — nunca encerra o outro automaticamente (side-effect silencioso
 * demais); quem estiver usando decide explicitamente encerrar antes.
 */
export async function startSprint(projectId: string, sprintId: string) {
  await assertOwnSprints(projectId, sprintId)
  const sprint = await prisma.sprint.findFirst({ where: { id: sprintId, project_id: projectId } })
  if (!sprint) throw new AppError(404, 'Sprint não encontrado', 'NOT_FOUND')

  const activeSprint = await prisma.sprint.findFirst({ where: { project_id: projectId, status: 'active', global_sprint_id: null } })
  if (activeSprint && activeSprint.id !== sprintId) {
    throw new AppError(409, 'Já existe um sprint ativo neste projeto. Encerre-o antes de iniciar outro.', 'SPRINT_ALREADY_ACTIVE')
  }

  return prisma.sprint.update({ where: { id: sprintId }, data: { status: 'active' } })
}

export async function completeSprint(projectId: string, sprintId: string) {
  await assertOwnSprints(projectId, sprintId)
  const updated = await prisma.sprint.updateMany({
    where: { id: sprintId, project_id: projectId },
    data: { status: 'completed' },
  })
  if (updated.count === 0) throw new AppError(404, 'Sprint não encontrado', 'NOT_FOUND')
  return prisma.sprint.findUniqueOrThrow({ where: { id: sprintId } })
}

/**
 * Exclusão real (não soft delete) — sprint não carrega histórico de
 * TaskActivity como status/tipo de tarefa carregam, então não há razão
 * para preservar a linha. Tasks vinculadas ficam sem sprint (a FK
 * onDelete: SetNull cuidaria disso de qualquer forma; explícito aqui só
 * para deixar claro o comportamento).
 */
export async function deleteSprint(projectId: string, sprintId: string) {
  await assertOwnSprints(projectId, sprintId)
  const sprint = await prisma.sprint.findFirst({ where: { id: sprintId, project_id: projectId } })
  if (!sprint) throw new AppError(404, 'Sprint não encontrado', 'NOT_FOUND')
  await prisma.sprint.delete({ where: { id: sprintId } })
}
