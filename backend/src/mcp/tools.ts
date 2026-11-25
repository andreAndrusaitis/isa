import { z } from 'zod'
import prisma from '../config/prisma'
import { effectiveProjectRole } from '../services/projectAccess'
import { AppError } from '../middlewares/errorHandler'
import * as ProjectsService from '../services/projects'
import * as TasksService from '../services/tasks'
import { createTaskSchema, updateTaskSchema } from '../services/tasks'

// Mesmos grupos das rotas web (routes/projects.ts): visualizador só lê.
const CAN_EDIT = ['owner', 'manager', 'member']

async function assertMember(projectId: string, userId: string, roles?: string[]) {
  const role = await effectiveProjectRole(projectId, userId)
  if (!role) {
    throw new AppError(404, 'Projeto não encontrado', 'NOT_FOUND')
  }
  if (roles && !roles.includes(role)) {
    throw new AppError(403, 'Seu papel neste projeto não permite esta ação.', 'PROJECT_ROLE_FORBIDDEN')
  }
  return { role }
}

async function assertMemberOfTask(taskId: string, userId: string, roles?: string[]) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { project_id: true } })
  if (!task) {
    throw new AppError(404, 'Tarefa não encontrada', 'NOT_FOUND')
  }
  await assertMember(task.project_id, userId, roles)
  return task
}

export const mcpTools = {
  list_projects: {
    description: 'Lista os projetos em que o usuário autenticado é membro.',
    inputSchema: z.object({}),
    handler: async (_input: {}, userId: string) => {
      return ProjectsService.listProjectsForUser(userId)
    },
  },

  get_project: {
    description: 'Retorna os detalhes de um projeto pelo id.',
    inputSchema: z.object({ projectId: z.string().uuid() }),
    handler: async (input: { projectId: string }, userId: string) => {
      await assertMember(input.projectId, userId)
      return ProjectsService.getProjectById(input.projectId)
    },
  },

  list_tasks: {
    description: 'Lista as tarefas de um projeto, com filtros opcionais de status e responsável.',
    inputSchema: z.object({
      projectId: z.string().uuid(),
      statusId: z.string().uuid().optional(),
      assigneeId: z.string().uuid().optional(),
    }),
    handler: async (input: { projectId: string; statusId?: string; assigneeId?: string }, userId: string) => {
      await assertMember(input.projectId, userId)
      return TasksService.listTasksByProject(input.projectId, {
        statusId: input.statusId,
        assigneeId: input.assigneeId,
      })
    },
  },

  get_task: {
    description: 'Retorna os detalhes de uma tarefa pelo id.',
    inputSchema: z.object({ taskId: z.string().uuid() }),
    handler: async (input: { taskId: string }, userId: string) => {
      await assertMemberOfTask(input.taskId, userId)
      return TasksService.getTaskById(input.taskId)
    },
  },

  create_task: {
    description: 'Cria uma tarefa em um projeto.',
    inputSchema: createTaskSchema.extend({ projectId: z.string().uuid() }),
    handler: async (input: z.input<typeof createTaskSchema> & { projectId: string }, userId: string) => {
      await assertMember(input.projectId, userId, CAN_EDIT)
      const { projectId, ...rest } = input
      return TasksService.createTask(projectId, userId, rest)
    },
  },

  update_task: {
    description: 'Atualiza campos de uma tarefa existente (título, descrição, status, responsável, prioridade, datas).',
    inputSchema: updateTaskSchema.extend({ taskId: z.string().uuid() }),
    handler: async (input: z.infer<typeof updateTaskSchema> & { taskId: string }, userId: string) => {
      await assertMemberOfTask(input.taskId, userId, CAN_EDIT)
      const { taskId, ...rest } = input
      // updateTask devolve { task, activities } — não a task direto (única
      // diferença real do design original vs. a assinatura do service).
      const { task } = await TasksService.updateTask(taskId, userId, rest)
      return task
    },
  },
} as const
