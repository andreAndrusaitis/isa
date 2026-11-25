import { revokeUserSockets } from '../config/socket'
import { Request, Response, NextFunction } from 'express'
import * as userService from '../services/users'
import * as statsService from '../services/stats'
import { AppError } from '../middlewares/errorHandler'
import { forbidden, roleLabel, joinPt } from '../utils/denials'
import { getEffectiveScope, validateCarteiraAgainstChief, assertOrgInScope, isInSubtree } from '../services/scope'
import { getAuditInfo } from '../utils/audit'
import { userHasPermission } from '../config/permissions'
import { reachableRoles, assertCanManage, assertChiefInTeam, grantPermissions, STAFF_ROLES, requestedOrgId, assertCarteiraWithinRequester, assertInheritWithinRequester, assertQueuesWithinRequester, resolveStaffChief } from '../access/grants'
import { getEffectiveModules } from '../services/moduleAccess'
import bcrypt from 'bcryptjs'
import prisma from '../config/prisma'
import { createAuditLog } from '../services/audit'
import { z } from 'zod'
import { storeAttachment, presentAttachment, checkAvatar } from '../services/uploads'
import { deactivateMcpTokens } from '../services/mcpTokens'

function sanitizeUser(u: any) {
  const { password, ...rest } = u
  return {
    ...rest,
    // A ficha da empresa (contrato, observações) não acompanha a pessoa.
    ...(rest.org ? { org: { id: rest.org.id, name: rest.org.name } } : {}),
    authProvider: rest.authProvider || rest.auth_provider || 'local',
    avatar: presentAttachment(rest.avatar),
  }
}

type UserRole = 'admin' | 'manager' | 'supervisor' | 'agent' | 'user'

const validRoles: UserRole[] = ['admin', 'manager', 'supervisor', 'agent', 'user']

function isUserRole(role: unknown): role is UserRole {
  return typeof role === 'string' && validRoles.includes(role as UserRole)
}

function getVisibleRoles(role: string): UserRole[] {
  return reachableRoles(role).filter(isUserRole)
}

function parseRoleQuery(value: unknown): UserRole[] | undefined {
  const values = Array.isArray(value) ? value : value ? [value] : []
  const roles = values
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(isUserRole)

  return roles.length ? Array.from(new Set(roles)) : undefined
}

// Pela ficha (PATCH /users/:id), quem não é admin altera em si mesmo só o que a
// tela de perfil já permite. Senha passa por /me/password (pede a atual).
const SELF_EDITABLE_FIELDS = ['name', 'phone', 'position', 'department', 'avatar', 'location']

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const requester = req.user!
    let orgId = typeof req.query.orgId === 'string' ? req.query.orgId : undefined
    const hasExplicitUsersPerm = Array.isArray(requester.permissions) && requester.permissions.includes('users')
    const hasAdminAreaPerm = hasExplicitUsersPerm ||
      userHasPermission(requester, 'webhooks') ||
      userHasPermission(requester, 'organograma') ||
      userHasPermission(requester, 'routing')
    const isStaff = ['admin', 'manager', 'supervisor', 'agent'].includes(requester.role)

    const nonAdminRoles: UserRole[] = ['manager', 'supervisor', 'agent', 'user']

    const visibleRoles = requester.role === 'admin'
      ? validRoles
      : (hasExplicitUsersPerm ? nonAdminRoles : getVisibleRoles(requester.role))

    const requestedRoles = parseRoleQuery(req.query.role)
    let roles = requestedRoles
      ? visibleRoles.filter((role) => requestedRoles.includes(role))
      : visibleRoles

    if (requestedRoles && (hasAdminAreaPerm || (isStaff && requestedRoles.every(r => validRoles.includes(r))))) {
      roles = requester.role === 'admin'
        ? requestedRoles
        : requestedRoles.filter(r => r !== 'admin')
    }

    if (requester.role !== 'admin') {
      roles = roles.filter(r => r !== 'admin')
    }

    if (requester.role !== 'admin' && requester.role !== 'supervisor' && requester.role !== 'agent' && requester.role !== 'manager') {
      orgId = requester.orgId || 'NONE'
    }

    // Staff só vê clientes das empresas da própria carteira (nome, e-mail, telefone).
    const scope = ['agent', 'supervisor', 'manager'].includes(requester.role)
      ? await getEffectiveScope(requester.sub, requester.role)
      : null
    const users = await userService.listUsers({
      orgId,
      roles,
      userId: requester.role === 'user' ? requester.sub : undefined,
      clientOrgIds: scope && !scope.scopeAll ? scope.orgIds : undefined,
    })

    const result = users.map(sanitizeUser)

    // Organograma: inclui o próprio requester e a cadeia de gerentes acima dele
    // (que fica fora do escopo normal), para que supervisor/analista vejam o
    // gerente padrão acima de si. Opt-in via ?includeManagerChain=true.
    if (
      (requester.role === 'supervisor' || requester.role === 'agent') &&
      String(req.query.includeManagerChain) === 'true'
    ) {
      const chain = await userService.getSelfAndAncestors(requester.sub)
      const byId = new Map(result.map((u: any) => [u.id, u]))
      for (const u of chain) {
        if (u.role === 'admin') continue
        if (!byId.has(u.id)) byId.set(u.id, sanitizeUser(u))
      }
      res.json({ data: Array.from(byId.values()) })
      return
    }

    res.json({ data: result })
  } catch (err) { next(err) }
}

export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id as string
    const requester = req.user!
    const user = await userService.getUserById(id)

    if (user.role === 'admin' && requester.role !== 'admin') {
      throw forbidden('ADMIN_RESTRICTED', 'Apenas administradores podem visualizar dados de administradores.')
    }

    if (!['admin', 'supervisor', 'agent', 'manager'].includes(requester.role) && user.org_id !== requester.orgId) {
      throw forbidden('ORG_NOT_OWN', 'Você só pode consultar usuários da sua própria empresa.')
    }

    // Mesma regra da lista: cliente só pela carteira. Equipe é visível a toda a equipe.
    if (user.role === 'user') await assertCanManage(requester, user)

    res.json({ data: sanitizeUser(user) })
  } catch (err) { next(err) }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const requester = req.user!
    const body = { ...req.body }

    // Valida a role solicitada contra a hierarquia ANTES de qualquer processamento.
    const hasExplicitUsersPerm = Array.isArray(requester.permissions) && requester.permissions.includes('users')
    const requestedRole = body.role

    // A permissão "users" abre a tela; o perfil que pode ser criado segue o cargo.
    const creatable = requester.role === 'admin'
      ? validRoles
      : getVisibleRoles(requester.role)

    if (!isUserRole(requestedRole) || !creatable.includes(requestedRole)) {
      if (hasExplicitUsersPerm && requestedRole === 'admin') {
        throw forbidden('ADMIN_RESTRICTED', 'Apenas administradores podem criar novos administradores.')
      }
      throw forbidden('ROLE_HIERARCHY', creatable.length
        ? `Seu perfil (${roleLabel(requester.role)}) só pode criar usuários com perfil ${joinPt(creatable.map(roleLabel))}.`
        : `Seu perfil (${roleLabel(requester.role)}) não pode criar usuários.`)
    }

    if (requester.role === 'supervisor') {
      const requestedManagerId = typeof body.manager_id === 'string' && body.manager_id.trim() ? body.manager_id : null
      if (body.role === 'agent') {
        if (requestedManagerId && requestedManagerId !== requester.sub) {
          throw forbidden('SUPERVISOR_LINK_SELF', 'Como Ticket Manager, você só pode vincular analistas à sua própria equipe (você como chefe). Para colocar em outro time, peça ao Gerente.')
        }
        body.manager_id = requester.sub
      } else if (requestedManagerId) {
        throw forbidden('SUPERVISOR_LINK_AGENTS', 'Como Ticket Manager, você só pode definir o chefe de analistas. Para Ticket Managers e Gerentes, peça ao Gerente ou ao administrador.')
      }
    } else if (requester.role === 'manager') {
      // Quem o gerente cria entra na equipe dele por padrão — com a carteira
      // fail-closed, analista sem chefe não veria nenhum chamado.
      if (body.role !== 'user' && !(typeof body.manager_id === 'string' && body.manager_id.trim())) body.manager_id = requester.sub
      else if (typeof body.manager_id === 'string' && body.manager_id.trim()) await assertChiefInTeam(requester, body.manager_id)
    } else if (requester.role !== 'admin') {
      // Analista criando analista: mesmo time dele.
      const me = await prisma.user.findUnique({ where: { id: requester.sub }, select: { manager_id: true } })
      body.manager_id = body.role === 'user' ? undefined : me?.manager_id ?? undefined
    }
    // "Todas as empresas" só o administrador concede.
    if (requester.role !== 'admin') delete body.manager_global
    // Empresa e carteira da conta nova cabem na carteira de quem cria (senão um
    // cliente ou analista "laranja" de outra empresa vira porta de entrada).
    const createOrgId = requestedOrgId(body)
    if (requester.role !== 'admin') {
      if (createOrgId && createOrgId !== requester.orgId) await assertOrgInScope(requester, createOrgId)
      await assertCarteiraWithinRequester(requester, body.org_scope_ids)
      await assertQueuesWithinRequester(requester, body.queues)
    }

    if (requester.role !== 'admin' && !hasExplicitUsersPerm && requester.role !== 'manager') {
      delete body.permissions
    }
    if (requester.role !== 'admin' && STAFF_ROLES.includes(body.role)) {
      body.manager_id = await resolveStaffChief(requester, body.role, null, typeof body.manager_id === 'string' && body.manager_id.trim() ? body.manager_id : undefined)
      if (!Array.isArray(body.org_scope_ids) || body.org_scope_ids.length === 0) await assertInheritWithinRequester(requester, body.manager_id)
    }
    // Ninguém cria uma conta com acesso que ele mesmo não tem.
    if (Array.isArray(body.permissions)) {
      body.permissions = grantPermissions(requester, { role: String(body.role), permissions: [] }, body.permissions)
    }

    const data = userService.createUserSchema.parse(body)
    if (data.avatar) data.avatar = await storeAttachment(checkAvatar(data.avatar), 'avatars')
    await validateCarteiraAgainstChief(data.manager_id, data.org_scope_ids)
    const audit = getAuditInfo(req)
    const user = await userService.createUser(data, audit)
    res.status(201).json({ data: sanitizeUser(user) })
  } catch (err) { next(err) }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const requester = req.user!
    const targetId = req.params.id as string
    let body = req.body

    const targetUser = await userService.getUserById(targetId)
    const hasExplicitUsersPerm = Array.isArray(requester.permissions) && requester.permissions.includes('users')

    if (targetUser.role === 'admin' && requester.role !== 'admin') {
      throw forbidden('ADMIN_RESTRICTED', 'Apenas administradores podem alterar usuários administradores.')
    }

    if (body.role === 'admin' && requester.role !== 'admin') {
      throw forbidden('ADMIN_RESTRICTED', 'Apenas administradores podem atribuir o perfil de administrador.')
    }

    const isSelf = targetUser.id === requester.sub

    if (requester.role !== 'admin' && isSelf) {
      // Autoedição: só dados de perfil. Cargo, filas, carteira, permissões, senha e
      // método de login de si mesmo não mudam por aqui (driblava a senha atual e o MFA).
      const filtered: any = {}
      for (const key of SELF_EDITABLE_FIELDS) {
        if (body[key] !== undefined) filtered[key] = body[key]
      }
      body = filtered
    } else if (requester.role !== 'admin') {
      // Hierarquia: o cargo do alvo precisa estar abaixo; a permissão "users" não fura isso.
      if (!reachableRoles(requester.role).includes(targetUser.role)) {
        throw forbidden('ROLE_HIERARCHY', `Seu perfil (${roleLabel(requester.role)}) não pode editar usuários com perfil ${roleLabel(targetUser.role)}.`)
      }
      await assertCanManage(requester, targetUser)

      // Método de login (local/Microsoft) e senha seguem a mesma hierarquia acima;
      // analista não troca credenciais de colega da equipe.
      const allowed = ['name', 'queues', 'active', 'phone', 'position', 'department', 'avatar', 'location', 'authProvider', 'password', 'role', 'orgId', 'org_id', 'org_scope_ids']
      if (requester.role === 'agent' && targetUser.role !== 'user') {
        const currentProvider = targetUser.authProvider ?? 'local'
        if (body.password || (body.authProvider !== undefined && body.authProvider !== currentProvider)) {
          throw forbidden('CREDENTIALS_RESTRICTED', 'Senha e método de login de alguém da equipe só o chefe dela (ou o administrador) altera.')
        }
      }
      // Perfil: só para um que a pessoa poderia criar (admin já barrado acima).
      const roleChanges = body.role !== undefined && body.role !== targetUser.role
      if (roleChanges && !reachableRoles(requester.role).includes(body.role)) {
        throw forbidden('ROLE_HIERARCHY', `Seu perfil (${roleLabel(requester.role)}) não pode definir o perfil ${roleLabel(body.role)}.`)
      }
      // Analista não muda o cargo de colega: rebaixar a cliente e promover de volta
      // tirava a pessoa da regra de credenciais acima.
      if (roleChanges && requester.role === 'agent' && targetUser.role !== 'user') {
        throw forbidden('ROLE_HIERARCHY', 'Como Analista, você não altera o perfil de colegas da equipe.')
      }
      // Empresa: só para uma da carteira de quem edita.
      const newOrgId = requestedOrgId(body)
      if (newOrgId && newOrgId !== targetUser.org_id) await assertOrgInScope(requester, newOrgId)
      await assertCarteiraWithinRequester(requester, body.org_scope_ids)
      await assertQueuesWithinRequester(requester, body.queues, targetUser.queues)
      if (requester.role === 'manager' || hasExplicitUsersPerm) {
        allowed.push('permissions')
      }
      // Módulos (Chamados/Projetos/Documentos): gerente ajusta exceções da equipe, nunca o próprio
      // acesso (ligar a carteira é decisão do admin), e só libera o que ele mesmo tem.
      // Sem o módulo, ele só desliga: voltar a herdar (null) podia religar pela cadeia.
      if (requester.role === 'manager' && targetUser.role !== 'user') {
        for (const [field, mod, label] of [['module_tickets', 'tickets', 'Chamados'], ['module_projects', 'projects', 'Projetos'], ['module_documents', 'documents', 'Documentos']] as const) {
          if (body[field] === undefined || body[field] === targetUser[field]) continue
          if (body[field] !== false && !(await getEffectiveModules(requester.sub, requester.role))[mod]) {
            throw forbidden('MODULE_NOT_OWNED', `Você só pode liberar o módulo ${label} se ele estiver habilitado para você.`)
          }
          allowed.push(field)
        }
      }
      const filtered: any = {}
      for (const key of allowed) {
        if (body[key] !== undefined) filtered[key] = body[key]
      }

      const requestedManagerId = typeof body.manager_id === 'string' && body.manager_id.trim() ? body.manager_id : null
      if (requester.role === 'supervisor' && requestedManagerId) {
        if (targetUser.role !== 'agent') {
          throw forbidden('SUPERVISOR_LINK_AGENTS', 'Como Ticket Manager, você só pode definir o chefe de analistas. Para Ticket Managers e Gerentes, peça ao Gerente ou ao administrador.')
        }
        if (requestedManagerId !== requester.sub) {
          throw forbidden('SUPERVISOR_LINK_SELF', 'Como Ticket Manager, você só pode vincular analistas à sua própria equipe (você como chefe). Para colocar em outro time, peça ao Gerente.')
        }
        filtered.manager_id = requestedManagerId
      }

      // Gerente pode reatribuir o responsável (manager_id) de supervisores/analistas
      // da sua árvore — é como move analista entre supervisores no organograma.
      if (requester.role === 'manager' && body.manager_id !== undefined) {
        if (requestedManagerId && requestedManagerId !== targetUser.manager_id) await assertChiefInTeam(requester, requestedManagerId)
        filtered.manager_id = requestedManagerId
      }

      const finalRole = filtered.role ?? targetUser.role
      if (STAFF_ROLES.includes(finalRole)) {
        const chief = await resolveStaffChief(requester, finalRole, targetUser.manager_id ?? null, filtered.manager_id)
        if (chief !== targetUser.manager_id) filtered.manager_id = chief
        // Só quando a pessoa passa a herdar agora: a tela reenvia [] de quem já herda.
        const nextCarteira = filtered.org_scope_ids ?? targetUser.orgScopeIds
        const startsInheriting = targetUser.orgScopeIds.length > 0 || !STAFF_ROLES.includes(targetUser.role)
        if (nextCarteira.length === 0 && startsInheriting) await assertInheritWithinRequester(requester, chief)
      }

      body = filtered
    }

    // Módulos só valem para a equipe: em cliente final ficariam gravados à toa e
    // passariam a valer numa promoção futura.
    if ((body.role ?? targetUser.role) === 'user') {
      delete body.module_tickets
      delete body.module_projects
      delete body.module_documents
    }

    // Permissões: ninguém mexe nas próprias (só o admin) e quem não é admin só
    // concede o que ele mesmo tem; delete_tickets fica como está.
    if (Array.isArray(body.permissions)) {
      body.permissions = grantPermissions(requester, targetUser, body.permissions)
    }

    const data = userService.updateUserSchema.parse(body)
    if (data.avatar) data.avatar = await storeAttachment(checkAvatar(data.avatar), 'avatars')
    await validateCarteiraAgainstChief(data.manager_id !== undefined ? data.manager_id : targetUser.manager_id, data.org_scope_ids)
    const audit = getAuditInfo(req)
    const user = await userService.updateUser(targetId, data, audit)
    res.json({ data: sanitizeUser(user) })
  } catch (err) { next(err) }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const requester = req.user!
    const targetId = req.params.id as string

    const targetUser = await userService.getUserById(targetId)

    if (targetUser.role === 'admin' && requester.role !== 'admin') {
      throw forbidden('ADMIN_RESTRICTED', 'Apenas administradores podem remover usuários administradores.')
    }

    if (requester.role !== 'admin' && targetUser.id === requester.sub) {
      throw forbidden('SELF_DELETE', 'Você não pode remover o seu próprio usuário. Peça ao administrador.')
    }

    // A permissão "users" abre a tela; o que se remove segue o cargo e a equipe.
    const targetUserRole = targetUser.role
    const deletable = reachableRoles(requester.role)

    if (!deletable.includes(targetUserRole)) {
      throw forbidden('ROLE_HIERARCHY', `Seu perfil (${roleLabel(requester.role)}) não pode remover usuários com perfil ${roleLabel(targetUserRole)}.`)
    }

    await assertCanManage(requester, targetUser)

    const audit = getAuditInfo(req)
    await userService.deleteUser(targetId, audit)
    res.status(204).end()
  } catch (err) { next(err) }
}

export async function updateMe(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Não autenticado', 'UNAUTHORIZED')
    
    // Only allow updating specific fields based on role
    const isEndUser = req.user.role === 'user'
    const allowedFields = isEndUser
      ? ['name', 'avatar']
      : ['name', 'avatar', 'position', 'department', 'phone', 'location']
    
    const filteredBody: any = {}
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) filteredBody[key] = req.body[key]
    }

    if (filteredBody.avatar) {
      filteredBody.avatar = await storeAttachment(checkAvatar(filteredBody.avatar), 'avatars')
    }

    const data = userService.updateUserSchema.parse(filteredBody)
    const audit = getAuditInfo(req)
    const user = await userService.updateUser(req.user.sub, data, audit)
    res.json({ data: sanitizeUser(user) })
  } catch (err) { next(err) }
}

// 72 bytes é o que o bcrypt considera: além disso o resto seria ignorado em silêncio.
const newPasswordSchema = z.string().min(8, 'A senha precisa de pelo menos 8 caracteres').refine(v => Buffer.byteLength(v) <= 72, 'A senha passa do tamanho máximo')
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: newPasswordSchema,
})

export async function changeMyPassword(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Não autenticado', 'UNAUTHORIZED')

    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body)

    const user = await prisma.user.findUnique({ where: { id: req.user.sub } })
    if (!user) throw new AppError(404, 'Usuário não encontrado', 'USER_NOT_FOUND')

    if (user.auth_provider === 'microsoft') {
      throw new AppError(400, 'Contas Microsoft não possuem senha local para trocar.', 'SSO_NO_LOCAL_PASSWORD')
    }

    const valid = await bcrypt.compare(currentPassword, user.password!)
    if (!valid) {
      throw new AppError(401, 'Senha atual incorreta', 'INVALID_CURRENT_PASSWORD')
    }

    if (newPassword === currentPassword) throw new AppError(400, 'A nova senha precisa ser diferente da atual.', 'SAME_PASSWORD')

    const hashed = await bcrypt.hash(newPassword, 10)
    // Senha nova invalida tudo: refresh tokens e access tokens já emitidos
    // (um refresh roubado não sobrevive à troca). O front refaz o login.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { password: hashed, must_change_password: false, session_invalidated_at: new Date() },
      }),
      prisma.refreshToken.deleteMany({ where: { user_id: user.id } }),
      deactivateMcpTokens(user.id),
    ])
    revokeUserSockets(user.id)

    const audit = getAuditInfo(req)
    await createAuditLog({
      userId: user.id,
      action: 'PASSWORD_CHANGED',
      resource: 'AUTH',
      ip: audit.ip,
      userAgent: audit.userAgent,
    })

    res.json({ data: { ok: true } })
  } catch (err) { next(err) }
}

export async function getMeStats(req: Request, res: Response, next: NextFunction) {

  try {
    if (!req.user) throw new AppError(401, 'Não autenticado', 'UNAUTHORIZED')
    
    // Quem está online é dado da equipe: cliente recebe a lista vazia.
    const [stats, onlineTeam] = await Promise.all([
      statsService.getAnalystStats(req.user.sub),
      req.user.role === 'user' ? [] : statsService.getOnlineTeam()
    ])

    res.json({ data: { ...stats, onlineTeam } })
  } catch (err) { next(err) }
}

// Escopo efetivo (carteira) de um usuário — usado pelas telas para mostrar
// "Herdar de <chefe> (N empresas)" e limitar as opções sem reimplementar a regra.
export async function getScope(req: Request, res: Response, next: NextFunction) {
  try {
    const requester = req.user!
    const target = await prisma.user.findFirst({
      where: { id: req.params.id as string, deleted_at: null },
      select: { id: true, name: true, role: true, org_id: true, manager_id: true, manager_global: true, org_scopes: { select: { org_id: true } } },
    })
    if (!target) throw new AppError(404, 'Usuário não encontrado', 'USER_NOT_FOUND')

    if (target.role === 'admin' && requester.role !== 'admin') {
      throw forbidden('ADMIN_RESTRICTED', 'Apenas administradores podem consultar o escopo de administradores.')
    }

    // Carteira alheia: a própria, a dos chefes acima (teto da herança) ou a de quem a pessoa gere.
    if (requester.role !== 'admin' && target.id !== requester.sub && !(await isInSubtree(target.id, requester.sub))) {
      await assertCanManage(requester, target)
    }

    const effective = await getEffectiveScope(target.id, target.role)
    const own = target.org_scopes.map(s => s.org_id)
    res.json({ data: { mode: target.manager_global ? 'all' : own.length ? 'selected' : 'inherit', own, effective } })
  } catch (err) { next(err) }
}
