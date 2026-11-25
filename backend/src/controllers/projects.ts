import { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import * as projectsService from '../services/projects'
import * as structureService from '../services/projectStructure'
import * as taskTypesService from '../services/taskTypes'
import * as sprintsService from '../services/sprints'
import * as tasksService from '../services/tasks'
import * as checklistService from '../services/taskChecklist'
import * as commentsService from '../services/taskComments'
import * as assigneesService from '../services/taskAssignees'
import * as dependenciesService from '../services/taskDependencies'
import * as customFieldsService from '../services/customFields'
import * as tagsService from '../services/tags'
import * as approvalsService from '../services/taskApprovals'
import * as automationRulesService from '../services/automationRules'
import * as documentsService from '../services/documents'

const createDependencySchema = z.object({ dependsOnId: z.string() })

export function checkAccess(_req: Request, res: Response) {
  res.json({ allowed: true })
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const data = projectsService.createProjectSchema.parse(req.body)
    const project = await projectsService.createProject(req.user!.sub, data)
    res.status(201).json({ data: project })
  } catch (err) { next(err) }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const projects = await projectsService.listProjectsForUser(req.user!.sub)
    res.json({ data: projects })
  } catch (err) { next(err) }
}

export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    const project = await projectsService.getProjectById((req.params.projectId as string))
    // Papel de quem pede: o front esconde/desabilita o que o backend recusaria.
    res.json({ data: { ...project, myRole: req.projectMembership?.role ?? null } })
  } catch (err) { next(err) }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const data = projectsService.updateProjectSchema.parse(req.body)
    const project = await projectsService.updateProject((req.params.projectId as string), data, req.user!.sub)
    res.json({ data: project })
  } catch (err) { next(err) }
}

export async function archive(req: Request, res: Response, next: NextFunction) {
  try {
    await projectsService.archiveProject((req.params.projectId as string), req.user!.sub)
    res.status(204).send()
  } catch (err) { next(err) }
}

export async function addMember(req: Request, res: Response, next: NextFunction) {
  try {
    const data = projectsService.addMemberSchema.parse(req.body)
    const member = await projectsService.addMember((req.params.projectId as string), data, req.projectMembership?.role, req.user!.sub)
    res.status(201).json({ data: member })
  } catch (err) { next(err) }
}

export async function listMembers(req: Request, res: Response, next: NextFunction) {
  try {
    const members = await projectsService.listMembers((req.params.projectId as string))
    res.json({ data: members })
  } catch (err) { next(err) }
}

export async function updateMember(req: Request, res: Response, next: NextFunction) {
  try {
    const { role } = projectsService.addMemberSchema.pick({ role: true }).parse(req.body)
    const member = await projectsService.updateMemberRole((req.params.projectId as string), (req.params.userId as string), role, req.projectMembership?.role)
    res.json({ data: member })
  } catch (err) { next(err) }
}

export async function removeMember(req: Request, res: Response, next: NextFunction) {
  try {
    await projectsService.removeMember((req.params.projectId as string), (req.params.userId as string), req.projectMembership?.role, req.user!.sub)
    res.status(204).send()
  } catch (err) { next(err) }
}

export async function createFolder(req: Request, res: Response, next: NextFunction) {
  try {
    const data = structureService.createFolderSchema.parse(req.body)
    const folder = await structureService.createFolder((req.params.projectId as string), data)
    res.status(201).json({ data: folder })
  } catch (err) { next(err) }
}

export async function listFolders(req: Request, res: Response, next: NextFunction) {
  try {
    const folders = await structureService.listFolders((req.params.projectId as string))
    res.json({ data: folders })
  } catch (err) { next(err) }
}

export async function createList(req: Request, res: Response, next: NextFunction) {
  try {
    const data = structureService.createListSchema.parse(req.body)
    const list = await structureService.createList((req.params.projectId as string), data)
    res.status(201).json({ data: list })
  } catch (err) { next(err) }
}

export async function listLists(req: Request, res: Response, next: NextFunction) {
  try {
    const lists = await structureService.listLists((req.params.projectId as string))
    res.json({ data: lists })
  } catch (err) { next(err) }
}

export async function createStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const data = structureService.createStatusSchema.parse(req.body)
    const status = await structureService.createStatus((req.params.projectId as string), data)
    res.status(201).json({ data: status })
  } catch (err) { next(err) }
}

export async function listStatuses(req: Request, res: Response, next: NextFunction) {
  try {
    const statuses = await structureService.listStatuses((req.params.projectId as string))
    res.json({ data: statuses })
  } catch (err) { next(err) }
}

export async function updateStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const data = structureService.updateStatusSchema.parse(req.body)
    const status = await structureService.updateStatus(req.params.projectId as string, req.params.statusId as string, data)
    res.json({ data: status })
  } catch (err) { next(err) }
}

export async function reorderStatuses(req: Request, res: Response, next: NextFunction) {
  try {
    const data = structureService.reorderStatusesSchema.parse(req.body)
    const statuses = await structureService.reorderStatuses(req.params.projectId as string, data)
    res.json({ data: statuses })
  } catch (err) { next(err) }
}

export async function deleteStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const data = structureService.deleteStatusSchema.parse(req.body)
    const result = await structureService.deleteStatus(req.params.projectId as string, req.params.statusId as string, req.user!.sub, data)
    res.json({ data: result })
  } catch (err) { next(err) }
}

export async function createTaskType(req: Request, res: Response, next: NextFunction) {
  try {
    const data = taskTypesService.createTaskTypeSchema.parse(req.body)
    const taskType = await taskTypesService.createTaskType(req.params.projectId as string, data)
    res.status(201).json({ data: taskType })
  } catch (err) { next(err) }
}

export async function listTaskTypes(req: Request, res: Response, next: NextFunction) {
  try {
    const taskTypes = await taskTypesService.listTaskTypes(req.params.projectId as string)
    res.json({ data: taskTypes })
  } catch (err) { next(err) }
}

export async function updateTaskType(req: Request, res: Response, next: NextFunction) {
  try {
    const data = taskTypesService.updateTaskTypeSchema.parse(req.body)
    const taskType = await taskTypesService.updateTaskType(req.params.projectId as string, req.params.taskTypeId as string, data)
    res.json({ data: taskType })
  } catch (err) { next(err) }
}

export async function deleteTaskType(req: Request, res: Response, next: NextFunction) {
  try {
    const { replacementTypeId } = taskTypesService.deleteTaskTypeSchema.parse(req.query)
    await taskTypesService.deleteTaskType(req.params.projectId as string, req.params.taskTypeId as string, replacementTypeId)
    res.status(204).send()
  } catch (err) { next(err) }
}

export async function createSprint(req: Request, res: Response, next: NextFunction) {
  try {
    const data = sprintsService.createSprintSchema.parse(req.body)
    const sprint = await sprintsService.createSprint(req.params.projectId as string, data)
    res.status(201).json({ data: sprint })
  } catch (err) { next(err) }
}

export async function listSprints(req: Request, res: Response, next: NextFunction) {
  try {
    const sprints = await sprintsService.listSprints(req.params.projectId as string)
    res.json({ data: sprints })
  } catch (err) { next(err) }
}

export async function updateSprint(req: Request, res: Response, next: NextFunction) {
  try {
    const data = sprintsService.updateSprintSchema.parse(req.body)
    const sprint = await sprintsService.updateSprint(req.params.projectId as string, req.params.sprintId as string, data)
    res.json({ data: sprint })
  } catch (err) { next(err) }
}

export async function deleteSprint(req: Request, res: Response, next: NextFunction) {
  try {
    await sprintsService.deleteSprint(req.params.projectId as string, req.params.sprintId as string)
    res.status(204).send()
  } catch (err) { next(err) }
}

export async function startSprint(req: Request, res: Response, next: NextFunction) {
  try {
    const sprint = await sprintsService.startSprint(req.params.projectId as string, req.params.sprintId as string)
    res.json({ data: sprint })
  } catch (err) { next(err) }
}

export async function completeSprint(req: Request, res: Response, next: NextFunction) {
  try {
    const sprint = await sprintsService.completeSprint(req.params.projectId as string, req.params.sprintId as string)
    res.json({ data: sprint })
  } catch (err) { next(err) }
}

export async function createTask(req: Request, res: Response, next: NextFunction) {
  try {
    const data = tasksService.createTaskSchema.parse(req.body)
    const task = await tasksService.createTask(req.params.projectId as string, req.user!.sub, data)
    res.status(201).json({ data: task })
  } catch (err) { next(err) }
}

export async function listTasks(req: Request, res: Response, next: NextFunction) {
  try {
    const { status, assignee, listId } = req.query as Record<string, string | undefined>
    const tasks = await tasksService.listTasksByProject(req.params.projectId as string, {
      statusId: status, assigneeId: assignee, listId,
    })
    res.json({ data: tasks })
  } catch (err) { next(err) }
}

export async function getTask(req: Request, res: Response, next: NextFunction) {
  try {
    const task = await tasksService.getTaskById(req.params.taskId as string)
    res.json({ data: task })
  } catch (err) { next(err) }
}

export async function updateTaskHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = tasksService.updateTaskSchema.parse(req.body)
    const result = await tasksService.updateTask(req.params.taskId as string, req.user!.sub, data)
    res.json({ data: result.task, activities: result.activities })
  } catch (err) { next(err) }
}

export async function archiveTask(req: Request, res: Response, next: NextFunction) {
  try {
    await tasksService.archiveTask(req.params.taskId as string, req.user!.sub)
    res.status(204).send()
  } catch (err) { next(err) }
}

export async function createChecklistItem(req: Request, res: Response, next: NextFunction) {
  try {
    const data = checklistService.createChecklistItemSchema.parse(req.body)
    const item = await checklistService.createChecklistItem(req.params.taskId as string, data, req.user!.sub)
    res.status(201).json({ data: item })
  } catch (err) { next(err) }
}

export async function toggleChecklistItem(req: Request, res: Response, next: NextFunction) {
  try {
    const { done } = req.body as { done: boolean }
    const item = await checklistService.toggleChecklistItem(req.params.itemId as string, done, req.user!.sub)
    res.json({ data: item })
  } catch (err) { next(err) }
}

export async function deleteChecklistItem(req: Request, res: Response, next: NextFunction) {
  try {
    await checklistService.deleteChecklistItem(req.params.itemId as string, req.user!.sub)
    res.status(204).send()
  } catch (err) { next(err) }
}

export async function createComment(req: Request, res: Response, next: NextFunction) {
  try {
    const data = commentsService.createCommentSchema.parse(req.body)
    const comment = await commentsService.createComment(req.params.taskId as string, req.user!.sub, data)
    res.status(201).json({ data: comment })
  } catch (err) { next(err) }
}

export async function listComments(req: Request, res: Response, next: NextFunction) {
  try {
    const comments = await commentsService.listComments(req.params.taskId as string)
    res.json({ data: comments })
  } catch (err) { next(err) }
}

export async function editComment(req: Request, res: Response, next: NextFunction) {
  try {
    const { body } = commentsService.editCommentSchema.parse(req.body)
    const comment = await commentsService.editComment(req.params.taskId as string, req.params.commentId as string, req.user!.sub, body)
    res.json({ data: comment })
  } catch (err) { next(err) }
}

export async function deleteComment(req: Request, res: Response, next: NextFunction) {
  try {
    const canModerate = ['owner', 'manager'].includes(req.projectMembership?.role ?? '')
    await commentsService.deleteComment(req.params.taskId as string, req.params.commentId as string, req.user!.sub, canModerate)
    res.status(204).send()
  } catch (err) { next(err) }
}

export async function setTaskAssignees(req: Request, res: Response, next: NextFunction) {
  try {
    const data = assigneesService.setAssigneesSchema.parse(req.body)
    const userIds = await assigneesService.setAssignees(req.params.taskId as string, req.user!.sub, data.userIds)
    res.json({ data: userIds })
  } catch (err) { next(err) }
}

export async function listTaskAssignees(req: Request, res: Response, next: NextFunction) {
  try {
    const userIds = await assigneesService.listAssignees(req.params.taskId as string)
    res.json({ data: userIds })
  } catch (err) { next(err) }
}

export async function createTaskDependency(req: Request, res: Response, next: NextFunction) {
  try {
    const { dependsOnId } = createDependencySchema.parse(req.body)
    const dependency = await dependenciesService.createDependency(req.params.taskId as string, dependsOnId, req.user!.sub)
    res.status(201).json({ data: dependency })
  } catch (err) { next(err) }
}

export async function listTaskDependencies(req: Request, res: Response, next: NextFunction) {
  try {
    const dependencies = await dependenciesService.listDependencies(req.params.taskId as string)
    res.json({ data: dependencies })
  } catch (err) { next(err) }
}

export async function removeTaskDependency(req: Request, res: Response, next: NextFunction) {
  try {
    await dependenciesService.removeDependency(req.params.dependencyId as string, req.user!.sub)
    res.status(204).send()
  } catch (err) { next(err) }
}

export async function createCustomField(req: Request, res: Response, next: NextFunction) {
  try {
    const data = customFieldsService.createCustomFieldSchema.parse(req.body)
    const field = await customFieldsService.createCustomField(req.params.projectId as string, data)
    res.status(201).json({ data: field })
  } catch (err) { next(err) }
}

export async function listCustomFields(req: Request, res: Response, next: NextFunction) {
  try {
    const fields = await customFieldsService.listCustomFields(req.params.projectId as string)
    res.json({ data: fields })
  } catch (err) { next(err) }
}

export async function setCustomFieldValue(req: Request, res: Response, next: NextFunction) {
  try {
    const { value } = customFieldsService.setCustomFieldValueSchema.parse(req.body)
    const result = await customFieldsService.setCustomFieldValue(req.params.taskId as string, req.params.customFieldId as string, value)
    res.json({ data: result })
  } catch (err) { next(err) }
}

export async function createTag(req: Request, res: Response, next: NextFunction) {
  try {
    const data = tagsService.createTagSchema.parse(req.body)
    const tag = await tagsService.createTag(req.params.projectId as string, data)
    res.status(201).json({ data: tag })
  } catch (err) { next(err) }
}

export async function listTags(req: Request, res: Response, next: NextFunction) {
  try {
    const tags = await tagsService.listTagsWithUsage(req.params.projectId as string)
    res.json({ data: tags })
  } catch (err) { next(err) }
}

export async function deleteTag(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await tagsService.deleteTag(req.params.projectId as string, req.params.tagId as string, req.user!.sub)
    res.json({ data: result })
  } catch (err) { next(err) }
}

export async function addTagToTask(req: Request, res: Response, next: NextFunction) {
  try {
    const tag = await tagsService.addTagToTask(req.params.taskId as string, req.params.tagId as string, req.user!.sub)
    res.status(201).json({ data: tag })
  } catch (err) { next(err) }
}

export async function removeTagFromTask(req: Request, res: Response, next: NextFunction) {
  try {
    await tagsService.removeTagFromTask(req.params.taskId as string, req.params.tagId as string, req.user!.sub)
    res.status(204).send()
  } catch (err) { next(err) }
}

export async function linkTaskDocument(req: Request, res: Response, next: NextFunction) {
  try {
    const link = await documentsService.linkDocumentToTask(req.params.taskId as string, req.params.documentId as string)
    res.status(201).json({ data: link })
  } catch (err) { next(err) }
}

export async function unlinkTaskDocument(req: Request, res: Response, next: NextFunction) {
  try {
    await documentsService.unlinkDocumentFromTask(req.params.taskId as string, req.params.documentId as string)
    res.status(204).send()
  } catch (err) { next(err) }
}

export async function requestTaskApproval(req: Request, res: Response, next: NextFunction) {
  try {
    const data = approvalsService.requestApprovalSchema.parse(req.body)
    const approval = await approvalsService.requestApproval(req.params.taskId as string, data, req.user!.sub)
    res.status(201).json({ data: approval })
  } catch (err) { next(err) }
}

export async function decideTaskApproval(req: Request, res: Response, next: NextFunction) {
  try {
    const data = approvalsService.decideApprovalSchema.parse(req.body)
    const approval = await approvalsService.decideApproval(req.params.approvalId as string, req.user!.sub, data)
    res.json({ data: approval })
  } catch (err) { next(err) }
}

export async function createAutomation(req: Request, res: Response, next: NextFunction) {
  try {
    const data = automationRulesService.createAutomationSchema.parse(req.body)
    const automation = await automationRulesService.createAutomation(req.params.projectId as string, req.user!.sub, data)
    res.status(201).json({ data: automation })
  } catch (err) { next(err) }
}

export async function listAutomations(req: Request, res: Response, next: NextFunction) {
  try {
    const automations = await automationRulesService.listAutomations(req.params.projectId as string)
    res.json({ data: automations })
  } catch (err) { next(err) }
}

export async function updateAutomation(req: Request, res: Response, next: NextFunction) {
  try {
    const { isActive } = automationRulesService.updateAutomationSchema.parse(req.body)
    const automation = await automationRulesService.setAutomationActive(req.params.automationId as string, isActive)
    res.json({ data: automation })
  } catch (err) { next(err) }
}

export async function listAutomationRuns(req: Request, res: Response, next: NextFunction) {
  try {
    const runs = await automationRulesService.listAutomationRuns(req.params.automationId as string)
    res.json({ data: runs })
  } catch (err) { next(err) }
}
