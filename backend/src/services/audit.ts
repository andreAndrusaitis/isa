import prisma from '../config/prisma'
import { multi } from '../utils/multiFilter'
import { getEffectiveScope } from './scope'
import { ticketVisibilityWhere } from './ticketAccess'

export interface CreateAuditLogDto {
  userId?: string
  action: string
  resource: string
  details?: any
  ip?: string
  userAgent?: string
}

export async function createAuditLog({
  userId,
  action,
  resource,
  details,
  ip,
  userAgent,
}: CreateAuditLogDto) {
  try {
    return await prisma.auditLog.create({
      data: {
        user_id: userId,
        action,
        resource,
        details: details || {},
        ip,
        user_agent: userAgent,
      },
    })
  } catch (error) {
    console.error('[AuditService] Failed to create audit log:', error)
    // We don't want to break the main flow if audit fails
    return undefined
  }
}

// Mesma profundidade máxima de loadChain; `seen` protege contra ciclo no organograma.
async function teamIds(rootId: string) {
  const seen = new Set([rootId])
  let level = [rootId]
  for (let depth = 0; depth < 6 && level.length; depth++) {
    const rows = await prisma.user.findMany({ where: { manager_id: { in: level } }, select: { id: true } })
    level = rows.map(r => r.id).filter(id => !seen.has(id))
    level.forEach(id => seen.add(id))
  }
  return [...seen]
}

export async function getAuditLogs(params: {
  page?: number
  limit?: number
  userId?: string
  action?: string
  resource?: string
  startDate?: string
  endDate?: string
  search?: string
}, viewer?: { sub: string; role: string }) {
  const { page = 1, limit = 50, userId, action, resource, startDate, endDate, search } = params
  const skip = (page - 1) * limit

  const where: any = {}
  if (userId) where.user_id = userId
  // Multisseleção (CSV); 'DELETE' = qualquer exclusão. AND para não colidir com o OR da busca.
  const actions = action?.split(',').filter(Boolean)
  if (actions?.length) {
    where.AND = [{ OR: actions.map(a => (a === 'DELETE' ? { action: { startsWith: 'DELETE' } } : { action: a })) }]
  }
  where.resource = multi(resource)
  
  if (startDate || endDate) {
    where.created_at = {}
    if (startDate) where.created_at.gte = new Date(startDate)
    if (endDate) {
      const end = new Date(endDate)
      end.setHours(23, 59, 59, 999)
      where.created_at.lte = end
    }
  }

  if (search) {
    where.OR = [
      { action: { contains: search, mode: 'insensitive' } },
      { resource: { contains: search, mode: 'insensitive' } },
      { ip: { contains: search, mode: 'insensitive' } },
      { user: { name: { contains: search, mode: 'insensitive' } } },
      { user: { email: { contains: search, mode: 'insensitive' } } },
      { details: { path: ['deletedUserName'], string_contains: search } },
      { details: { path: ['deletedUserEmail'], string_contains: search } },
    ]
  }

  // audit_logs não tem empresa: com carteira restrita o recorte é por quem agiu
  // (a própria pessoa, a equipe abaixo e os clientes das empresas da carteira).
  const scope = viewer ? await getEffectiveScope(viewer.sub, viewer.role) : null
  if (viewer && scope && !scope.scopeAll) {
    where.AND = [...(where.AND ?? []), {
      OR: [
        { user_id: { in: await teamIds(viewer.sub) } },
        { user: { role: 'user', org_id: { in: scope.orgIds } } },
      ],
    }]
  }

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
      skip,
      take: limit,
    }),
    prisma.auditLog.count({ where }),
  ])

  // Quem está na equipe pode agir em chamado fora da carteira do gestor (acompanhante,
  // por exemplo), e o details carrega título e texto: a linha fica, o conteúdo não.
  let items = rows
  if (viewer && scope && !scope.scopeAll) {
    const ticketOf = (r: (typeof rows)[number]) => (r.details as any)?.ticketId as string | undefined
    const ticketIds = [...new Set(rows.map(ticketOf).filter((id): id is string => !!id))]
    const visible = new Set((await prisma.ticket.findMany({
      where: { id: { in: ticketIds }, ...ticketVisibilityWhere(viewer.sub, scope) },
      select: { id: true },
    })).map(t => t.id))
    items = rows.map(r => {
      const ticketId = ticketOf(r)
      return ticketId && !visible.has(ticketId) ? { ...r, details: {} } : r
    })
  }

  return {
    items,
    total,
    pages: Math.ceil(total / limit),
    currentPage: page,
  }
}
