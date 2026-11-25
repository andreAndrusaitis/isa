/**
 * Regras de concessão e de alcance, no porteiro:
 * - ninguém dá o que não tem; áreas de plataforma só o admin libera;
 * - ninguém mexe na própria ficha (fora dados pessoais) nem fora do próprio time;
 * - carteira e chefe dados por quem não é admin cabem na árvore/carteira dele.
 */
import type { Request } from 'express'
import prisma from '../config/prisma'
import { AppError } from '../middlewares/errorHandler'
import { forbidden } from '../utils/denials'
import { DELETE_TICKETS_PERMISSION, DEFAULT_ROLE_PERMISSIONS, SYSTEM_PERMISSIONS, userHasPermission } from '../config/permissions'
import { assertOrgInScope, getEffectiveScope, isInSubtree, loadChain, scopeFromChain } from '../services/scope'

/**
 * Áreas de plataforma: só o admin concede, mesmo a quem já as tem. Várias rotas
 * delas só deixam passar o admin ou quem tem a área explícita, então repassá-las
 * daria ao outro mais do que quem concede consegue fazer.
 */
export const PLATFORM_PERMISSIONS: readonly string[] = [
  'webhooks', 'sla', 'packages', 'business_hours', 'inactivity', 'reopen_sla',
  'auto_close', 'ticket_types', 'survey', 'trash', 'email_logs', DELETE_TICKETS_PERMISSION,
]

export function isKnownPermission(permission: string): boolean {
  return permission === DELETE_TICKETS_PERMISSION || (SYSTEM_PERMISSIONS as readonly string[]).includes(permission)
}

/**
 * Lista de permissões a gravar quando alguém edita as de outra pessoa.
 * - Nome desconhecido novo → erro; desconhecido já gravado (legado) é descartado.
 * - Quem não é admin só concede/retira o que ele mesmo tem; o resto fica como está no alvo.
 * - Áreas de plataforma (PLATFORM_PERMISSIONS, inclui `delete_tickets`) só o admin mexe.
 * Devolve `{ unknown }` ou `{ notOwned }` quando a concessão precisa ser recusada.
 */
export function resolvePermissionGrant(
  requester: { role: string; permissions?: string[] | null },
  target: { role: string; permissions?: string[] | null } | null,
  requested: string[],
): { permissions: string[] } | { unknown: string[] } | { notOwned: string[] } {
  const stored = target?.permissions ?? []
  const unknown = requested.filter(p => !isKnownPermission(p) && !stored.includes(p))
  if (unknown.length) return { unknown }
  const wanted = [...new Set(requested.filter(isKnownPermission))]
  if (requester.role === 'admin') return { permissions: wanted }

  const owns = (p: string) => !PLATFORM_PERMISSIONS.includes(p) && userHasPermission(requester, p)
  const targetHas = (p: string) => !!target && userHasPermission(target, p)
  const notOwned = wanted.filter(p => !owns(p) && !targetHas(p))
  if (notOwned.length) return { notOwned }

  // O que o solicitante não tem fica como estava no alvo (inclusive delete_tickets).
  // Alvo sem lista própria usa o padrão do cargo: gravar a lista não pode tirar isso dele.
  const effective = stored.length ? stored : (target ? DEFAULT_ROLE_PERMISSIONS[target.role] ?? [] : [])
  const kept = effective.filter(p => isKnownPermission(p) && !owns(p))
  return { permissions: [...new Set([...wanted.filter(owns), ...kept])] }
}

export type Requester = NonNullable<Request['user']>

/**
 * Cargos que cada cargo alcança na gestão de pessoas: ver, criar, editar, excluir
 * e definir como perfil de alguém. Uma tabela só (antes eram quatro cópias em
 * controllers/users.ts). O alcance real ainda passa por assertCanManage (time/carteira).
 */
export const ROLE_REACH: Record<string, readonly string[]> = {
  admin: ['admin', 'manager', 'supervisor', 'agent', 'user'],
  manager: ['supervisor', 'agent', 'user'],
  supervisor: ['agent', 'user'],
  agent: ['agent', 'user'],
  user: [],
}

export const reachableRoles = (role: string): readonly string[] => ROLE_REACH[role] ?? []

/**
 * Quem não é admin só mexe em quem está sob sua responsabilidade:
 * - cliente: empresa própria ou da carteira;
 * - equipe: Gerente e TM só em quem está abaixo deles no organograma;
 *   Analista só em colega do mesmo time.
 * A permissão "users" abre a tela, não amplia esse alcance.
 */
export async function assertCanManage(requester: Requester, target: { id: string; role: string; name?: string; org_id?: string | null; manager_id?: string | null }) {
  if (requester.role === 'admin') return
  if (target.role === 'user') {
    if (target.org_id && target.org_id !== requester.orgId) await assertOrgInScope(requester, target.org_id)
    return
  }
  if (requester.role === 'agent') {
    const me = await prisma.user.findUnique({ where: { id: requester.sub }, select: { manager_id: true } })
    if (me?.manager_id && me.manager_id === target.manager_id) return
    throw forbidden('NOT_IN_TEAM', 'Como Analista, você só pode alterar colegas do seu próprio time.')
  }
  if (await isInSubtree(requester.sub, target.id)) return
  throw forbidden('NOT_IN_TEAM', `${target.name ?? 'Esta pessoa'} não está na sua equipe. Só quem está acima dela no organograma (ou o administrador) pode alterar.`)
}

/** Novo chefe definido por Gerente/TM: ele mesmo ou alguém da equipe dele. */
export async function assertChiefInTeam(requester: Requester, managerId: string) {
  if (requester.role === 'admin' || managerId === requester.sub) return
  if (await isInSubtree(requester.sub, managerId)) return
  throw forbidden('CHIEF_OUT_OF_TEAM', 'Você só pode colocar a pessoa sob você ou sob alguém da sua equipe.')
}

/** Aplica resolvePermissionGrant e converte recusa em erro HTTP. */
export function grantPermissions(requester: Requester, target: { role: string; permissions?: string[] | null } | null, requested: string[]) {
  const result = resolvePermissionGrant(requester, target, requested)
  if ('unknown' in result) {
    throw new AppError(400, `Permissão desconhecida: ${result.unknown.join(', ')}.`, 'UNKNOWN_PERMISSION')
  }
  if ('notOwned' in result) {
    throw forbidden('PERMISSION_NOT_OWNED', `Você só pode liberar acessos que você mesmo tem. Fora do seu acesso: ${result.notOwned.join(', ')}.`)
  }
  return result.permissions
}

export const STAFF_ROLES = ['agent', 'supervisor', 'manager']

/** Empresa pedida no corpo: orgId e org_id juntos precisam concordar (o serviço grava orgId primeiro). */
export function requestedOrgId(body: any): string | null | undefined {
  if (body.orgId !== undefined && body.org_id !== undefined && body.orgId !== body.org_id) {
    throw new AppError(400, 'orgId e org_id divergem.', 'ORG_MISMATCH')
  }
  return body.orgId !== undefined ? body.orgId : body.org_id
}

/** Carteira dada por quem não é admin cabe na carteira dele. */
export async function assertCarteiraWithinRequester(requester: Requester, orgIds: unknown) {
  if (requester.role === 'admin' || !Array.isArray(orgIds) || orgIds.length === 0) return
  for (const orgId of orgIds) await assertOrgInScope(requester, String(orgId))
}

/**
 * "Herdar" (sem carteira própria) vale a carteira do chefe, que pode ser maior que
 * a de quem edita: é o caso do Analista, que não está na cadeia do colega. Quem
 * está na cadeia não precisa de checagem, a interseção já cabe na carteira dele.
 */
export async function assertInheritWithinRequester(requester: Requester, chiefId: string | null | undefined) {
  if (requester.role === 'admin' || !chiefId) return
  const chain = await loadChain(chiefId)
  if (chain.some(n => n.id === requester.sub)) return
  const mine = await getEffectiveScope(requester.sub, requester.role)
  if (mine.scopeAll) return
  const inherited = scopeFromChain(chain, chain[0]?.role ?? 'agent')
  if (!inherited.scopeAll && inherited.orgIds.every(id => mine.orgIds.includes(id))) return
  throw forbidden('CARTEIRA_INHERIT_RESTRICTED', 'A carteira do chefe é maior que a sua. Escolha as empresas da pessoa entre as que você atende.')
}

/**
 * Fila define o que o Analista vê: ele só repassa as que tem (o alvo mantém as que
 * já tinha). Gerente e TM não são filtrados por fila, então não dão nada a mais.
 */
export async function assertQueuesWithinRequester(requester: Requester, queues: unknown, current?: string[] | null) {
  if (requester.role !== 'agent' || !Array.isArray(queues)) return
  const added = queues.map(String).filter(q => !current?.includes(q))
  if (added.length === 0) return
  const { queueIds } = await getEffectiveScope(requester.sub, requester.role)
  if (added.every(q => queueIds.includes(q))) return
  throw forbidden('QUEUE_NOT_OWNED', 'Você só pode liberar filas que você mesmo atende. Para as demais, peça ao seu chefe.')
}

/**
 * Equipe precisa de chefe dentro da árvore de quem edita. Sem chefe a carteira
 * fica sem teto (a validação contra o chefe é pulada), então quem não é admin
 * não deixa ninguém da equipe sem chefe.
 */
export async function resolveStaffChief(requester: Requester, role: string, current: string | null, requested: string | null | undefined): Promise<string> {
  let chief = requested !== undefined ? requested : current
  if (!chief) {
    if (requester.role === 'manager' || requester.role === 'supervisor') chief = requester.sub
    else {
      const me = await prisma.user.findUnique({ where: { id: requester.sub }, select: { manager_id: true } })
      chief = me?.manager_id ?? null
    }
  }
  if (!chief) throw forbidden('CHIEF_REQUIRED', 'Pessoas da equipe precisam de um chefe. Peça ao administrador para definir o seu chefe antes.')
  if (chief === current) return chief
  if (requester.role === 'manager') await assertChiefInTeam(requester, chief)
  else if (requester.role === 'supervisor') {
    if (chief !== requester.sub || role !== 'agent') throw forbidden('SUPERVISOR_LINK_SELF', 'Como Ticket Manager, você só pode vincular analistas à sua própria equipe (você como chefe). Para colocar em outro time, peça ao Gerente.')
  } else {
    const me = await prisma.user.findUnique({ where: { id: requester.sub }, select: { manager_id: true } })
    if (!me?.manager_id || chief !== me.manager_id) throw forbidden('CHIEF_OUT_OF_TEAM', 'Como Analista, você só pode colocar a pessoa no seu próprio time.')
  }
  return chief
}
