import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UserAccessSummary } from './UserAccessSummary'
import type { UserScope } from '@/types'

const orgs = [
  { id: 'org-1', name: 'Empresa Alfa' },
  { id: 'org-2', name: 'Empresa Beta' },
]

const queues = [
  { id: 'q-1', name: 'N1 - Suporte' },
  { id: 'q-2', name: 'N2 - Especialistas' },
]

describe('UserAccessSummary', () => {
  it('mostra resumo humanizado para Analista com filas e escopo herdado', () => {
    const user = {
      id: 'agent-1',
      name: 'João Silva',
      role: 'agent',
      email: 'joao@empresa.com',
      queues: ['q-1', 'q-2'],
      manager_id: 'mgr-1',
      active: true,
    }

    const chief = { id: 'mgr-1', name: 'Carlos Gerente', role: 'manager' }

    const userScope: UserScope = {
      mode: 'inherit',
      own: [],
      effective: { scopeAll: false, orgIds: ['org-1', 'org-2'], queueIds: ['q-1', 'q-2'], enforceQueues: true },
    }

    render(
      <UserAccessSummary
        user={user}
        userScope={userScope}
        chief={chief}
        queues={queues}
        orgs={orgs}
      />
    )

    expect(screen.getAllByText(/N1 - Suporte, N2 - Especialistas/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/2 empresas \(herdado de Carlos Gerente\)/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/Sem permissão de excluir chamados/i).length).toBeGreaterThanOrEqual(1)
  })

  it('exibe alerta de atenção para Analista sem filas vinculadas', () => {
    const user = {
      id: 'agent-2',
      name: 'Maria Sem Fila',
      role: 'agent',
      email: 'maria@empresa.com',
      queues: [],
      active: true,
    }

    render(
      <UserAccessSummary
        user={user}
        userScope={null}
        queues={queues}
        orgs={orgs}
      />
    )

    expect(screen.getByText(/Sem filas vinculadas: o analista não verá nenhum chamado/i)).toBeInTheDocument()
  })

  it('mostra resumo adequado para Gerente com acesso a todas as empresas', () => {
    const user = {
      id: 'mgr-1',
      name: 'Roberto Gerente',
      role: 'manager',
      email: 'roberto@empresa.com',
      manager_global: true,
      active: true,
    }

    const team = [
      { id: 'sub-1', name: 'Sub 1' },
      { id: 'sub-2', name: 'Sub 2' },
    ]

    render(
      <UserAccessSummary
        user={user}
        userScope={null}
        team={team}
        queues={queues}
        orgs={orgs}
      />
    )

    expect(screen.getAllByText(/Todas as empresas \(inclusive novas\)/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/2 liderados/i)).toBeInTheDocument()
  })

  it('mostra empresa vinculada para Usuário final', () => {
    const user = {
      id: 'user-1',
      name: 'Cliente Final',
      role: 'user',
      email: 'cliente@alfa.com',
      orgId: 'org-1',
      active: true,
    }

    render(
      <UserAccessSummary
        user={user}
        userScope={null}
        queues={queues}
        orgs={orgs}
      />
    )

    expect(screen.getByText(/vinculado à empresa Empresa Alfa/i)).toBeInTheDocument()
    expect(screen.getByText(/Portal do solicitante/i)).toBeInTheDocument()
  })

  it('exibe alerta crítico quando a conta está inativa', () => {
    const user = {
      id: 'user-2',
      name: 'Usuário Desativado',
      role: 'agent',
      email: 'desativado@empresa.com',
      active: false,
    }

    render(
      <UserAccessSummary
        user={user}
        userScope={null}
        queues={queues}
        orgs={orgs}
      />
    )

    expect(screen.getByText(/Conta inativa: o usuário não consegue efetuar login/i)).toBeInTheDocument()
    expect(screen.getByText('Inativo')).toBeInTheDocument()
  })
})
