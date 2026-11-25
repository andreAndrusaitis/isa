import { Router } from 'express'
import prisma from '../config/prisma'
import { AppError } from './errorHandler'

/**
 * IDOR entre projetos: requireProjectRole confere a participação no :projectId
 * da URL, mas os handlers usam o id do recurso direto. Aqui cada parâmetro de
 * recurso é conferido contra o :projectId (e o :taskId, quando aninhado) antes
 * de qualquer handler — 404 se for de outro projeto. Vale para rotas futuras
 * que usem estes nomes de parâmetro.
 */
type Owner = { projectId: string; taskId?: string } | null

const OWNERS: Record<string, (id: string) => Promise<Owner>> = {
  taskId: async (id) => { const r = await prisma.task.findUnique({ where: { id }, select: { project_id: true } }); return r && { projectId: r.project_id } },
  statusId: async (id) => { const r = await prisma.projectStatus.findUnique({ where: { id }, select: { project_id: true } }); return r && { projectId: r.project_id } },
  sprintId: async (id) => { const r = await prisma.sprint.findUnique({ where: { id }, select: { project_id: true } }); return r && { projectId: r.project_id } },
  tagId: async (id) => { const r = await prisma.tag.findUnique({ where: { id }, select: { project_id: true } }); return r && { projectId: r.project_id } },
  taskTypeId: async (id) => { const r = await prisma.taskType.findUnique({ where: { id }, select: { project_id: true } }); return r && { projectId: r.project_id } },
  customFieldId: async (id) => { const r = await prisma.customField.findUnique({ where: { id }, select: { project_id: true } }); return r && { projectId: r.project_id } },
  automationId: async (id) => { const r = await prisma.automation.findUnique({ where: { id }, select: { project_id: true } }); return r && { projectId: r.project_id } },
  viewId: async (id) => { const r = await prisma.customView.findUnique({ where: { id }, select: { project_id: true } }); return r && { projectId: r.project_id } },
  documentId: async (id) => { const r = await prisma.document.findUnique({ where: { id }, select: { project_id: true } }); return r && { projectId: r.project_id } },
  itemId: async (id) => { const r = await prisma.checklistItem.findUnique({ where: { id }, select: { task_id: true, task: { select: { project_id: true } } } }); return r && { projectId: r.task.project_id, taskId: r.task_id } },
  approvalId: async (id) => { const r = await prisma.approval.findUnique({ where: { id }, select: { task_id: true, task: { select: { project_id: true } } } }); return r && { projectId: r.task.project_id, taskId: r.task_id } },
  dependencyId: async (id) => { const r = await prisma.taskDependency.findUnique({ where: { id }, select: { task_id: true, task: { select: { project_id: true } } } }); return r && { projectId: r.task.project_id, taskId: r.task_id } },
  relationId: async (id) => { const r = await prisma.taskRelation.findUnique({ where: { id }, select: { from_task_id: true, from_task: { select: { project_id: true } } } }); return r && { projectId: r.from_task.project_id, taskId: r.from_task_id } },
}

/** `skip`: parâmetros que o router resolve por conta própria (ex.: taskId aceitando BUG-12 na API pública). */
export function scopeParamsToProject(router: Router, opts: { skip?: string[] } = {}) {
  for (const [param, ownerOf] of Object.entries(OWNERS)) {
    if (opts.skip?.includes(param)) continue
    router.param(param, async (req, _res, next, value) => {
      try {
        const projectId = req.params.projectId
        if (!projectId) return next()
        const owner = await ownerOf(String(value))
        const sameTask = !owner?.taskId || !req.params.taskId || owner.taskId === req.params.taskId
        if (!owner || owner.projectId !== projectId || !sameTask) {
          throw new AppError(404, 'Recurso não encontrado neste projeto', 'NOT_FOUND')
        }
        next()
      } catch (err) { next(err) }
    })
  }
}

/**
 * Referências vindas no corpo (statusId, sprintId...) também têm de ser do projeto.
 * Devolve o status de destino (quando há) para quem precisa da categoria.
 */
export async function assertRefsInProject(projectId: string, refs: { statusId?: string | null; listId?: string | null; sprintId?: string | null; taskTypeId?: string | null; parentId?: string | null; assigneeId?: string | null }) {
  const status = refs.statusId
    ? await prisma.projectStatus.findUnique({ where: { id: refs.statusId }, select: { project_id: true, is_active: true, category: true, requires_approval: true } })
    : null
  const checks: Array<[string | null | undefined, () => Promise<{ project_id: string } | null>]> = [
    [refs.statusId, async () => status],
    [refs.listId, () => prisma.projectList.findUnique({ where: { id: refs.listId! }, select: { project_id: true } })],
    [refs.sprintId, () => prisma.sprint.findUnique({ where: { id: refs.sprintId! }, select: { project_id: true } })],
    [refs.taskTypeId, () => prisma.taskType.findUnique({ where: { id: refs.taskTypeId! }, select: { project_id: true } })],
    [refs.parentId, () => prisma.task.findUnique({ where: { id: refs.parentId! }, select: { project_id: true } })],
  ]
  for (const [id, find] of checks) {
    if (!id) continue
    const row = await find()
    if (!row || row.project_id !== projectId) throw new AppError(400, 'Referência de outro projeto (status, lista, sprint, tipo ou task-pai).', 'CROSS_PROJECT_REFERENCE')
  }
  // Status excluído é só inativado (histórico): não volta a receber tasks.
  if (status && !status.is_active) throw new AppError(400, 'Este status foi excluído do projeto.', 'STATUS_INACTIVE')
  // Responsável precisa ser membro do projeto (visibilidade é por participação).
  if (refs.assigneeId) {
    const member = await prisma.projectMember.findUnique({ where: { project_id_user_id: { project_id: projectId, user_id: refs.assigneeId } }, select: { id: true } })
    if (!member) throw new AppError(400, 'Responsável precisa ser membro do projeto.', 'ASSIGNEE_NOT_MEMBER')
  }
  return { status }
}
