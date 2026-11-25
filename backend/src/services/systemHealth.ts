/** Saúde do sistema para o administrador: o que falta ligar, o que está funcionando e o que mudou. */
import prisma from '../config/prisma'
import { describeAi } from '../ai/core/provider'
import { describeSso } from './ssoSettings'
import { isGraphConfigured } from './email/graph'
import { isAcsConfigured } from './email/mailer'

export type CheckState = 'ok' | 'todo' | 'alert'
/** `view` é a tela que resolve o item (frontend/src/access/routes.ts). */
export interface HealthCheck { id: string; label: string; detail: string; state: CheckState; view: string }

const HOUR = 3_600_000
// Mudanças que interessam ao admin; login, mensagem e chamado ficam na Auditoria.
const CHANGE_PREFIXES = ['CREATE_', 'UPDATE_', 'DELETE_', 'RESET_', 'SET_', 'ENABLE_', 'DISABLE_', 'REGENERATE_', 'REORDER_', 'RESTORE_', 'PURGE_']
const NOT_CONFIG = ['TICKET', 'MESSAGE', 'DOC_PAGE', 'DOCUMENT', 'TASK', 'PROJECT']

export async function getSystemHealth() {
  const now = Date.now()
  const [ai, sso, hours, plans, queues, categories, rules, orgs, orgsNoPlan, emptyQueues, lastEmail, emailFailures, inboundFailures, loginFailures, changes] = await Promise.all([
    describeAi(),
    describeSso(),
    prisma.businessHoursConfig.count(),
    prisma.slaConfig.count(),
    prisma.queue.findMany({ where: { active: true }, select: { id: true, name: true } }),
    prisma.category.count({ where: { active: true } }),
    prisma.routingRule.findMany({ select: { name: true, enabled: true } }),
    prisma.organization.count({ where: { active: true, deleted_at: null } }),
    prisma.organization.count({ where: { active: true, deleted_at: null, sla_config: null } }),
    prisma.user.findMany({ where: { active: true, deleted_at: null, role: 'agent' }, select: { queues: true } }),
    prisma.emailLog.findFirst({ where: { status: 'SUCCESS' }, orderBy: { created_at: 'desc' }, select: { created_at: true } }),
    prisma.emailLog.count({ where: { status: 'FAILED', created_at: { gte: new Date(now - 24 * HOUR) } } }),
    prisma.inboundEmail.count({ where: { status: 'failed', received_at: { gte: new Date(now - 24 * HOUR) } } }),
    prisma.auditLog.count({ where: { action: 'LOGIN_FAILED', created_at: { gte: new Date(now - 24 * HOUR) } } }),
    prisma.auditLog.findMany({
      where: {
        created_at: { gte: new Date(now - 7 * 24 * HOUR) },
        OR: CHANGE_PREFIXES.map(p => ({ action: { startsWith: p } })),
        NOT: NOT_CONFIG.map(w => ({ action: { contains: w } })),
      },
      orderBy: { created_at: 'desc' }, take: 8,
      select: { id: true, action: true, resource: true, details: true, created_at: true, user: { select: { name: true } } },
    }),
  ])

  const covered = new Set(emptyQueues.flatMap(a => a.queues))
  const uncovered = queues.filter(q => !covered.has(q.id))
  const disabled = rules.filter(r => !r.enabled)
  const emailOn = isGraphConfigured() || isAcsConfigured()
  const check = (id: string, label: string, view: string, state: CheckState, detail: string): HealthCheck => ({ id, label, view, state, detail })

  const checks: HealthCheck[] = [
    check('hours', 'Expediente', 'admin_business_hours', hours ? 'ok' : 'todo', hours ? 'Dias e horários definidos.' : 'Sem expediente próprio: valem segunda a sexta, 8h às 18h.'),
    check('plans', 'Planos e prazos', 'admin_sla', !plans ? 'todo' : orgsNoPlan ? 'alert' : 'ok',
      !plans ? 'Nenhum plano cadastrado.' : orgsNoPlan ? `${orgsNoPlan} de ${orgs} ${orgs === 1 ? 'empresa' : 'empresas'} sem plano: valem 24 horas.` : `${plans} ${plans === 1 ? 'plano' : 'planos'} em uso.`),
    check('queues', 'Filas com atendimento', 'admin_queues', !queues.length ? 'todo' : uncovered.length ? 'alert' : 'ok',
      !queues.length ? 'Nenhuma fila ativa.' : uncovered.length ? `Sem analista: ${uncovered.slice(0, 3).map(q => q.name).join(', ')}${uncovered.length > 3 ? ` e mais ${uncovered.length - 3}` : ''}.` : `${queues.length} ${queues.length === 1 ? 'fila' : 'filas'}, todas com analista.`),
    check('categories', 'Categorias', 'admin_categories', categories ? 'ok' : 'todo', categories ? `${categories} em uso.` : 'Sem categorias, ninguém abre chamado.'),
    check('routing', 'Roteamento', 'admin_routing', !rules.length ? 'todo' : disabled.length ? 'alert' : 'ok',
      !rules.length ? 'Sem regras: tudo entra sem fila.' : disabled.length ? `${disabled.length} ${disabled.length === 1 ? 'regra desligada' : 'regras desligadas'}: ${disabled.slice(0, 2).map(r => r.name).join(', ')}${disabled.length > 2 ? '…' : '.'}` : `${rules.length} ${rules.length === 1 ? 'regra ativa' : 'regras ativas'}.`),
    check('email', 'E-mail', 'admin_email_logs', !emailOn ? 'todo' : emailFailures ? 'alert' : 'ok',
      !emailOn ? 'Sem caixa de envio: ninguém recebe aviso por e-mail.' : emailFailures ? `${emailFailures} ${emailFailures === 1 ? 'falha' : 'falhas'} nas últimas 24 horas.` : 'Envio configurado.'),
    check('sso', 'Login Microsoft', 'admin_sso', sso.active ? 'ok' : 'todo', sso.active ? 'Ligado.' : 'Só senha local por enquanto.'),
    check('ai', 'Provedor de IA', 'admin_ai_provider', ai.active ? 'ok' : 'todo', ai.active ? 'Ligado.' : 'Sem endereço e chave: a Skadi e os agentes ficam parados.'),
  ]

  return {
    checks,
    signals: {
      lastEmailAt: lastEmail?.created_at ?? null, emailFailures, inboundFailures, loginFailures,
      rulesOn: rules.length - disabled.length, orgs,
    },
    changes: changes.map(c => ({
      id: c.id, action: c.action, resource: c.resource, at: c.created_at, who: c.user?.name ?? 'Sistema',
      target: nameIn(c.details),
    })),
  }
}

/** Nome do que mudou, quando o registro traz um. */
function nameIn(details: unknown): string | null {
  if (!details || typeof details !== 'object') return null
  const d = details as Record<string, any>
  const found = d.name ?? d.after?.name ?? d.before?.name ?? d.key ?? d.tier
  return typeof found === 'string' ? found : null
}
