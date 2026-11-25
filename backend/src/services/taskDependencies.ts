import { Prisma } from '@prisma/client'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { logTaskActivity } from './taskActivity'

/**
 * Detecta se criar "task depende de dependsOnId" fecharia um ciclo: percorre
 * só a cadeia que parte de dependsOnId (CTE recursiva no banco, em vez de
 * carregar a tabela inteira) procurando a própria task. UNION descarta nós
 * repetidos, então a recursão termina mesmo diante de dados ruins.
 */
async function wouldCreateCycle(tx: Prisma.TransactionClient, taskId: string, dependsOnId: string): Promise<boolean> {
  if (taskId === dependsOnId) return true
  const hit = await tx.$queryRaw<Array<{ found: number }>>`
    WITH RECURSIVE chain(id) AS (
      SELECT depends_on_id FROM task_dependencies WHERE task_id = ${dependsOnId}
      UNION
      SELECT d.depends_on_id FROM task_dependencies d JOIN chain c ON d.task_id = c.id
    )
    SELECT 1 AS found FROM chain WHERE id = ${taskId} LIMIT 1`
  return hit.length > 0
}

export async function createDependency(taskId: string, dependsOnId: string, actorId?: string) {
  const [task, dependsOn] = await Promise.all([
    prisma.task.findUnique({ where: { id: taskId }, select: { project_id: true } }),
    prisma.task.findUnique({ where: { id: dependsOnId }, select: { project_id: true, archived_at: true } }),
  ])
  if (!task || !dependsOn || dependsOn.archived_at) throw new AppError(404, 'Task não encontrada', 'NOT_FOUND')
  // Dependência só dentro do mesmo projeto: fora dele vazaria a existência de tasks alheias.
  if (task.project_id !== dependsOn.project_id) {
    throw new AppError(400, 'Só é possível depender de tasks do mesmo projeto', 'DEPENDENCY_CROSS_PROJECT')
  }

  const dependency = await prisma.$transaction(async (tx) => {
    // Serializa as criações do projeto: duas dependências simultâneas (A→B e B→A)
    // passariam cada uma pela checagem sem ver a outra.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`task_dependencies:${task.project_id}`}))`
    if (await wouldCreateCycle(tx, taskId, dependsOnId)) {
      throw new AppError(409, 'Essa dependência criaria um ciclo entre tasks', 'DEPENDENCY_CYCLE')
    }
    return tx.taskDependency.create({ data: { task_id: taskId, depends_on_id: dependsOnId } })
  })
  if (actorId) await logTaskActivity(taskId, actorId, 'dependency_changed', { to: dependsOnId })
  return dependency
}

export async function listDependencies(taskId: string) {
  const [blockedBy, blocking] = await Promise.all([
    prisma.taskDependency.findMany({ where: { task_id: taskId } }),
    prisma.taskDependency.findMany({ where: { depends_on_id: taskId } }),
  ])
  return {
    blockedBy: blockedBy.map((d) => d.depends_on_id),
    blocking: blocking.map((d) => d.task_id),
  }
}

export async function removeDependency(dependencyId: string, actorId?: string) {
  const dependency = await prisma.taskDependency.delete({ where: { id: dependencyId } })
  if (actorId) await logTaskActivity(dependency.task_id, actorId, 'dependency_changed', { from: dependency.depends_on_id })
}
