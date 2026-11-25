import { canDeleteTickets, getEffectivePermissions } from '@/utils/permissions'
import type { UserScope } from '@/types'
import { Row, Section } from '../Blocks'

interface UserAccessSummaryProps {
  user: any
  userScope: UserScope | null
  chief?: any
  team?: any[]
  queues: any[]
  orgs: any[]
}

export function UserAccessSummary({
  user,
  userScope,
  chief,
  team = [],
  queues,
  orgs,
}: UserAccessSummaryProps) {
  if (!user) return null

  const role = user.role || 'user'
  const hasDeleteTicketPerm = canDeleteTickets(user)
  const effectivePerms = getEffectivePermissions(user)
  const isAgent = role === 'agent'
  const isSupervisor = role === 'supervisor'
  const isManager = role === 'manager'
  const isAdmin = role === 'admin'

  // Filas do usuário
  const userQueueIds: string[] = user.queues || []
  const userQueues = queues.filter((q) => userQueueIds.includes(q.id))

  // Escopo de empresas
  const scopeAll = isAdmin || !!user.manager_global || !!userScope?.effective.scopeAll
  const scopeOrgIds = userScope?.effective.orgIds || []
  const scopeCount = scopeOrgIds.length

  // Empresa vinculada (para usuário final ou equipe)
  const assignedOrg = orgs.find((o) => o.id === (user.orgId || user.org_id))

  // Alertas de efeito prático
  const alerts: string[] = []

  if (user.active === false) {
    alerts.push('Conta inativa: o usuário não consegue efetuar login nem acessar o sistema.')
  }

  if (isAgent) {
    if (userQueues.length === 0) {
      alerts.push('Sem filas vinculadas: o analista não verá nenhum chamado até ser alocado em ao menos uma fila.')
    }
    if (!scopeAll && scopeCount === 0) {
      if (!user.manager_id) {
        alerts.push('Sem gestor no organograma: o analista não herda empresas da carteira e não verá chamados.')
      } else {
        alerts.push(`O gestor (${chief?.name || 'responsável'}) não possui empresas na carteira. O analista não verá nenhum chamado.`)
      }
    }
  }

  if (isSupervisor) {
    if (!scopeAll && scopeCount === 0) {
      alerts.push('Sem empresas na carteira: este Ticket Manager não conseguirá visualizar chamados da equipe.')
    }
  }

  if (isManager && !user.manager_global && !scopeAll && scopeCount === 0) {
    alerts.push('Nenhuma empresa selecionada: este gerente não verá nenhum chamado no sistema.')
  }

  // Frase principal de resumo em linguagem humana
  let summaryHeadline = ''
  const summaryDetails: Array<{ label: string; value: string; attention?: boolean }> = []

  if (isAdmin) {
    summaryHeadline = 'Administrador do sistema · Acesso irrestrito a todas as empresas, filas, configurações e logs.'
    summaryDetails.push(
      { label: 'Carteira', value: 'Todas as empresas (Global)' },
      { label: 'Filas', value: 'Todas as filas do sistema' },
      { label: 'Excluir chamados', value: 'Permitido (Admin)' }
    )
  } else if (isManager) {
    const orgScopeText = scopeAll
      ? 'Todas as empresas (inclusive novas)'
      : `${scopeCount} empresa${scopeCount === 1 ? '' : 's'} selecionada${scopeCount === 1 ? '' : 's'}`

    summaryHeadline = `Gerente · Acesso a ${orgScopeText} · Gestão de equipe e painéis analíticos.`
    summaryDetails.push(
      { label: 'Carteira', value: orgScopeText },
      { label: 'Equipe direta', value: `${team.length} liderado${team.length === 1 ? '' : 's'}` },
      { label: 'Permissões', value: `${effectivePerms.length} áreas liberadas` }
    )
  } else if (isSupervisor) {
    let carteiraText = ''
    if (scopeAll) {
      carteiraText = 'Todas as empresas'
    } else if (userScope?.mode === 'selected') {
      carteiraText = `Restrito a ${scopeCount} empresa${scopeCount === 1 ? '' : 's'}`
    } else if (chief) {
      carteiraText = `${scopeCount} empresa${scopeCount === 1 ? '' : 's'} (herdado de ${chief.name})`
    } else {
      carteiraText = `${scopeCount} empresa${scopeCount === 1 ? '' : 's'}`
    }

    summaryHeadline = `Ticket Manager · Supervisiona equipe de ${team.length} analista${team.length === 1 ? '' : 's'} · Carteira de empresas ${carteiraText}.`
    summaryDetails.push(
      { label: 'Carteira', value: carteiraText },
      { label: 'Supervisão', value: `${team.length} analista${team.length === 1 ? '' : 's'}` },
      { label: 'Filas', value: 'Supervisão geral de filas' },
      { label: 'Excluir chamados', value: hasDeleteTicketPerm ? 'Permitido' : 'Sem permissão' }
    )
  } else if (isAgent) {
    const queueListText = userQueues.length > 0
      ? userQueues.map((q) => q.name).join(', ')
      : 'Nenhuma fila vinculada'

    let carteiraText = ''
    if (scopeAll) {
      carteiraText = 'Todas as empresas'
    } else if (userScope?.mode === 'selected' || (user.org_scope_ids && user.org_scope_ids.length > 0)) {
      carteiraText = `Restrito a ${scopeCount} empresa${scopeCount === 1 ? '' : 's'} de ${chief?.name || 'seu gestor'}`
    } else if (chief) {
      carteiraText = `${scopeCount} empresa${scopeCount === 1 ? '' : 's'} (herdado de ${chief.name})`
    } else {
      carteiraText = 'Sem carteira definida'
    }

    const deleteText = hasDeleteTicketPerm ? 'Com permissão de excluir chamados' : 'Sem permissão de excluir chamados'

    summaryHeadline = `Atende as filas: ${queueListText} · ${carteiraText} · ${deleteText}.`
    summaryDetails.push(
      { label: 'Filas atendidas', value: queueListText, attention: userQueues.length === 0 },
      { label: 'Carteira efetiva', value: carteiraText, attention: !scopeAll && scopeCount === 0 },
      { label: 'Gestor direto', value: chief ? `${chief.name}` : 'Sem gestor', attention: !chief },
      { label: 'Excluir chamados', value: hasDeleteTicketPerm ? 'Permitido' : 'Bloqueado' }
    )
  } else {
    // Usuário final
    summaryHeadline = assignedOrg
      ? `Usuário final vinculado à empresa ${assignedOrg.name} · Abre e acompanha chamados de sua organização.`
      : 'Usuário final · Sem empresa cadastrada (não poderá abrir chamados).'

    summaryDetails.push(
      { label: 'Empresa', value: assignedOrg?.name || 'Não vinculada', attention: !assignedOrg },
      { label: 'Acesso a chamados', value: 'Chamados da própria empresa' },
      { label: 'Portal', value: 'Portal do solicitante' }
    )
  }

  return (
    <>
      <p className="cad-lead">{summaryHeadline}</p>
      {alerts.map((text) => <p key={text} className="cad-alert">{text}</p>)}
      <Section title="Acesso" hint="O que este usuário pode ver, atender e gerenciar.">
        {summaryDetails.map((item) => (
          <Row key={item.label} label={item.label}>
            <span style={item.attention ? { color: 'var(--danger)' } : undefined}>{item.value}</span>
          </Row>
        ))}
        <Row label="Conta">{user.active !== false ? 'Ativa' : <span style={{ color: 'var(--danger)' }}>Inativo</span>}</Row>
      </Section>
    </>
  )
}
