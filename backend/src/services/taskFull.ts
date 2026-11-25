/**
 * Task completa para quem está fora do sistema (API pública e webhooks):
 * descrição, pessoas com nome e e-mail, status/tipo/lista/sprint com nome,
 * tags, campos personalizados, checklist, subtasks, dependências, documentos,
 * chamados vinculados, comentários e o link da task na tela. Uma consulta só,
 * em lote, para a lista paginada não virar N+1.
 */
import { Prisma } from '@prisma/client'
import prisma from '../config/prisma'
import { env } from '../config/env'
import { getEffectiveModules } from './moduleAccess'
import { getEffectiveScope } from './scope'
import { ticketVisibilityWhere } from './ticketAccess'

type Viewer = { sub: string; role: string }

/** Título no lugar do real quando quem lê não tem acesso ao chamado vinculado. */
export const RESTRICTED_TICKET_TITLE = 'Chamado restrito'

/**
 * Chamados de `where` que a pessoa pode ler. Ver o projeto não dá acesso ao
 * chamado: vale a mesma regra do getTicketAccess (carteira OU envolvimento; com
 * o módulo Chamados desligado, só os que ela abriu). Em lote, para lista não virar N+1.
 */
export async function readableTickets(viewer: Viewer, where: Prisma.TicketWhereInput) {
  const visibility = viewer.role === 'admin'
    ? {}
    : viewer.role === 'user' || !(await getEffectiveModules(viewer.sub, viewer.role)).tickets
      ? { user_id: viewer.sub }
      : ticketVisibilityWhere(viewer.sub, await getEffectiveScope(viewer.sub, viewer.role))
  return prisma.ticket.findMany({ where: { AND: [where, visibility] }, select: { id: true, display_number: true } })
}

const PERSON = { select: { id: true, name: true, email: true } } as const
const TASK_REF = { select: { id: true, seq: true, key: true, title: true } } as const

const FULL_INCLUDE = {
  project: { select: { id: true, name: true } },
  status: { select: { id: true, name: true, category: true, color: true } },
  task_type: { select: { id: true, name: true, prefix: true, color: true } },
  list: { select: { id: true, name: true } },
  sprint: { select: { id: true, name: true, status: true, start_date: true, end_date: true } },
  parent: TASK_REF,
  assignee: PERSON,
  creator: PERSON,
  multi_assignees: { select: { user: PERSON } },
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
  custom_field_values: { select: { value: true, custom_field: { select: { id: true, name: true, type: true } } } },
  checklist: { orderBy: { position: 'asc' }, select: { id: true, text: true, done: true, position: true } },
  subtasks: {
    where: { archived_at: null },
    orderBy: { seq: 'asc' },
    select: { id: true, seq: true, key: true, title: true, due_date: true, assignee_id: true, status: { select: { id: true, name: true, category: true } } },
  },
  dependents: { select: { id: true, depends_on: TASK_REF } },
  blocking: { select: { id: true, task: TASK_REF } },
  documents: { select: { document: { select: { id: true, title: true } } } },
  linked_tickets: { where: { deleted_at: null }, select: { id: true, display_number: true, title: true, status: true } },
  comments: { where: { deleted_at: null }, orderBy: { created_at: 'asc' }, select: { id: true, body: true, created_at: true, edited_at: true, author: PERSON } },
} satisfies Prisma.TaskInclude

type FullRow = Prisma.TaskGetPayload<{ include: typeof FULL_INCLUDE }>

function present(t: FullRow, readable: Set<string> | null) {
  const { multi_assignees, tags, custom_field_values, documents, dependents, blocking, linked_tickets, comments, ...rest } = t
  // Principal primeiro, como na tela (task antiga pode ter só assignee_id).
  const assignees = [...(t.assignee ? [t.assignee] : []), ...multi_assignees.map((a) => a.user).filter((u) => u.id !== t.assignee_id)]
  return {
    ...rest,
    number: `#${t.seq}`,
    url: `${env.PORTAL_URL.replace(/\/$/, '')}/projetos/${t.project_id}/tasks?task=${t.id}`,
    assignees,
    tags: tags.map((x) => x.tag),
    custom_fields: custom_field_values.map((v) => ({ ...v.custom_field, value: v.value })),
    blocked_by: dependents.map((d) => ({ dependency_id: d.id, task: d.depends_on })),
    blocks: blocking.map((d) => ({ dependency_id: d.id, task: d.task })),
    documents: documents.map((d) => d.document),
    tickets: readable ? linked_tickets.map((k) => (readable.has(k.id) ? k : { ...k, title: RESTRICTED_TICKET_TITLE })) : linked_tickets,
    comments,
    comments_count: comments.length,
  }
}

export type FullTask = ReturnType<typeof present>

/**
 * Na ordem dos ids pedidos; ids inexistentes ficam de fora. Com `viewer`, chamado
 * vinculado que ele não pode ler continua na lista, sem o título.
 */
export async function loadFullTasks(ids: string[], viewer?: Viewer): Promise<FullTask[]> {
  if (ids.length === 0) return []
  const rows = await prisma.task.findMany({ where: { id: { in: ids } }, include: FULL_INCLUDE })
  const ticketIds = rows.flatMap((r) => r.linked_tickets.map((k) => k.id))
  const readable = viewer ? new Set((await readableTickets(viewer, { id: { in: ticketIds } })).map((k) => k.id)) : null
  const byId = new Map(rows.map((r) => [r.id, present(r, readable)]))
  return ids.map((id) => byId.get(id)).filter((t): t is FullTask => !!t)
}

export async function loadFullTask(id: string, viewer?: Viewer): Promise<FullTask | null> {
  return (await loadFullTasks([id], viewer))[0] ?? null
}
