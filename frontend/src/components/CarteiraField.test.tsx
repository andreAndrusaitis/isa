import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CarteiraField } from './CarteiraField'
import type { UserScope } from '@/types'

const orgs = [{ id: 'A', name: 'Acme' }, { id: 'B', name: 'Beta' }, { id: 'C', name: 'Casa' }]
const chief = (orgIds: string[], scopeAll = false): UserScope => ({
  mode: scopeAll ? 'all' : 'selected',
  own: orgIds,
  effective: { scopeAll, orgIds, queueIds: [], enforceQueues: false },
})

const base = { allOrgs: orgs, chiefScope: null, orgIds: [], all: false, canSetAll: false, hasQueues: true, onChange: vi.fn() }

describe('CarteiraField', () => {
  it('gerente em Selecionadas sem empresa avisa que não verá nenhum chamado', () => {
    render(<CarteiraField {...base} role="manager" />)
    expect(screen.getByRole('alert')).toHaveTextContent('não verá nenhum chamado')
  })

  it('"Todas" fica desabilitado para quem não é admin', () => {
    render(<CarteiraField {...base} role="manager" />)
    expect(screen.getByLabelText(/Todas as empresas/)).toBeDisabled()
  })

  it('analista ao restringir só vê empresas da carteira do chefe', () => {
    render(<CarteiraField {...base} role="agent" chiefName="Gerente X" chiefScope={chief(['A', 'B'])} />)
    expect(screen.getByText(/Herda de Gerente X: 2 empresas/)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/Restringir/))
    expect(screen.getByLabelText('Acme')).toBeInTheDocument()
    expect(screen.queryByLabelText('Casa')).not.toBeInTheDocument()
  })

  it('analista sem fila é avisado', () => {
    render(<CarteiraField {...base} role="agent" chiefScope={chief([], true)} hasQueues={false} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Sem filas')
  })

  it('chefe sem empresas: avisa que ninguém verá chamados', () => {
    render(<CarteiraField {...base} role="supervisor" chiefName="Gerente Y" chiefScope={chief([])} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Gerente Y não tem empresas na carteira')
  })

  it('busca sem resultado sugere o que fazer', () => {
    render(<CarteiraField {...base} role="manager" orgIds={['A']} />)
    fireEvent.change(screen.getByLabelText('Buscar empresa na carteira'), { target: { value: 'zzz' } })
    expect(screen.getByText(/Nenhuma empresa com "zzz"/)).toBeInTheDocument()
  })
})
