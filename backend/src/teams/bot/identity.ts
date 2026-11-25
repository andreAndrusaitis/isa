/**
 * Quem está falando com o bot: tenant + AAD object id da atividade (assinada
 * pelo canal), nunca nome ou e-mail digitados. O e-mail/UPN vem do Teams
 * (TeamsInfo.getMember) e casa com a mesma regra do login Microsoft: conta
 * ativa com auth_provider 'microsoft'. Depois do primeiro vínculo, o AAD já
 * ligado a um usuário numa conversa salva dispensa a consulta ao Teams.
 */
import type { TurnContext } from '@microsoft/agents-hosting'
import { AI_NAME } from '../../ai/core/persona'
import prisma from '../../config/prisma'
import { findEntraUser } from '../../middlewares/entraAuth'
import { tenantAllowed, type BotConfig } from './config'

export interface TeamsMember {
  email?: string | null
  userPrincipalName?: string | null
  aadObjectId?: string | null
}

export type GetMember = (context: TurnContext, memberId: string) => Promise<TeamsMember | null>

export type TeamsIdentity =
  | { status: 'ok'; userId: string; tenantId: string; aadObjectId: string }
  | { status: 'tenant_not_allowed'; tenantId: string | null }
  | { status: 'unknown'; tenantId: string; aadObjectId: string | null }

export const UNKNOWN_USER_TEXT =
  'Ainda não encontrei sua conta no ISA. Entre uma vez pela aba **ISA** aqui no Teams (ou pelo portal) com a sua conta Microsoft e depois me chame de novo.'
export const TENANT_NOT_ALLOWED_TEXT =
  `A ${AI_NAME} ainda não está liberada para a sua organização. Fale com a equipe de TI.`

export function activityTenant(context: TurnContext): string | null {
  const a = context.activity as any
  const tid = a?.conversation?.tenantId ?? a?.channelData?.tenant?.id
  return typeof tid === 'string' && tid ? tid.toLowerCase() : null
}

async function activeMicrosoftUser(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { active: true, deleted_at: true, auth_provider: true } })
  return !!user && user.active && !user.deleted_at && user.auth_provider === 'microsoft'
}

export async function resolveTeamsUser(context: TurnContext, config: Pick<BotConfig, 'tenants'>, getMember: GetMember): Promise<TeamsIdentity> {
  const tenantId = activityTenant(context)
  if (!tenantId || !tenantAllowed(config, tenantId)) return { status: 'tenant_not_allowed', tenantId }
  const from = context.activity.from as { id?: string; aadObjectId?: string } | undefined
  const aadObjectId = from?.aadObjectId?.toLowerCase() ?? null
  if (!aadObjectId || !from?.id) return { status: 'unknown', tenantId, aadObjectId }

  const linked = await prisma.teamsConversation.findFirst({
    where: { tenant_id: tenantId, aad_object_id: aadObjectId, user_id: { not: null } },
    orderBy: { updated_at: 'desc' },
    select: { user_id: true },
  })
  if (linked?.user_id && await activeMicrosoftUser(linked.user_id)) return { status: 'ok', userId: linked.user_id, tenantId, aadObjectId }

  let member: TeamsMember | null = null
  try {
    member = await getMember(context, from.id)
  } catch (err: any) {
    console.error('[Teams:bot] getMember falhou:', err?.message ?? err)
  }
  if (!member || (member.aadObjectId && member.aadObjectId.toLowerCase() !== aadObjectId)) return { status: 'unknown', tenantId, aadObjectId }

  const candidates = [member.userPrincipalName, member.email]
    .map(v => v?.trim())
    .filter((v, i, all): v is string => !!v && /^[^\s@]+@[^\s@]+$/.test(v) && all.indexOf(v) === i)
  for (const email of candidates) {
    const user = await findEntraUser(email)
    if (user) return { status: 'ok', userId: user.id, tenantId, aadObjectId }
  }
  return { status: 'unknown', tenantId, aadObjectId }
}
