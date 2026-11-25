import { useId, useMemo, useState } from 'react'
import type { UserScope } from '@/types'

interface Org { id: string; name: string }

interface CarteiraFieldProps {
  /** Papel de quem está sendo editado. Gerente escolhe Todas/Selecionadas; analista/TM Herdar/Restringir. */
  role: 'manager' | 'supervisor' | 'agent'
  allOrgs: Org[]
  /** Carteira efetiva do chefe (null = sem chefe ou chefe sem acesso). */
  chiefScope: UserScope | null
  chiefName?: string
  orgIds: string[]
  all: boolean
  /** Só o admin marca "Todas as empresas". */
  canSetAll: boolean
  hasQueues: boolean
  onChange: (next: { orgIds: string[]; all: boolean }) => void
}

const radioRow: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', fontSize: 14, lineHeight: 1.4, color: 'var(--text-1)' }
const hint: React.CSSProperties = { fontSize: 13, color: 'var(--text-3)' }
const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', padding: '4px 2px', cursor: 'pointer',
  color: 'var(--accent-fg)', fontSize: 13.5, fontFamily: 'var(--font)',
}

/**
 * Carteira de empresas de um usuário (apresentação). A regra de herança é do
 * backend: aqui só se escolhe o modo e as empresas, e se mostra o efeito.
 */
export function CarteiraField({ role, allOrgs, chiefScope, chiefName, orgIds, all, canSetAll, hasQueues, onChange }: CarteiraFieldProps) {
  const id = useId()
  const isManager = role === 'manager'
  const [restrict, setRestrict] = useState(orgIds.length > 0)
  const [query, setQuery] = useState('')

  // Opções: gerente escolhe entre todas; subordinado só dentro do escopo do chefe.
  const chiefAll = chiefScope?.effective.scopeAll ?? false
  const chiefOrgIds = chiefScope?.effective.orgIds ?? []
  const options = useMemo(
    () => (isManager || chiefAll ? allOrgs : allOrgs.filter(o => chiefOrgIds.includes(o.id))),
    [isManager, chiefAll, allOrgs, chiefOrgIds],
  )
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter(o => o.name.toLowerCase().includes(q)) : options
  }, [options, query])

  const selecting = isManager ? !all : restrict
  const chiefCount = chiefAll ? 'todas as empresas' : `${chiefOrgIds.length} empresa${chiefOrgIds.length === 1 ? '' : 's'}`

  const toggle = (orgId: string) =>
    onChange({ all: false, orgIds: orgIds.includes(orgId) ? orgIds.filter(x => x !== orgId) : [...orgIds, orgId] })
  const markVisible = () => onChange({ all: false, orgIds: [...new Set([...orgIds, ...visible.map(o => o.id)])] })
  const clearVisible = () => onChange({ all: false, orgIds: orgIds.filter(x => !visible.some(o => o.id === x)) })

  // Resumo e avisos: o que a pessoa efetivamente vai ver.
  let summary: string
  const warnings: string[] = []
  if (isManager) {
    summary = all ? 'Todas as empresas, inclusive as cadastradas no futuro.' : `${orgIds.length} empresa${orgIds.length === 1 ? '' : 's'} selecionada${orgIds.length === 1 ? '' : 's'}.`
    if (!all && orgIds.length === 0) warnings.push('Este gerente não verá nenhum chamado: marque ao menos uma empresa.')
  } else if (restrict && orgIds.length > 0) {
    summary = `Restrito a ${orgIds.length} empresa${orgIds.length === 1 ? '' : 's'} (dentro da carteira de ${chiefName ?? 'seu chefe'}).`
  } else {
    summary = chiefScope ? `Herda de ${chiefName ?? 'seu chefe'}: ${chiefCount}.` : 'Sem chefe definido: não herda nenhuma empresa.'
    if (!chiefScope || (!chiefAll && chiefOrgIds.length === 0)) {
      warnings.push(chiefScope
        ? `${chiefName ?? 'O chefe'} não tem empresas na carteira — esta pessoa não verá nenhum chamado. Configure a carteira do chefe primeiro.`
        : 'Defina um chefe (gerente ou Ticket Manager) para esta pessoa herdar as empresas; sem isso ela não verá nenhum chamado.')
    }
    if (restrict && orgIds.length === 0) warnings.push('Nenhuma empresa marcada: enquanto isso, a pessoa herda a carteira do chefe.')
  }
  if (role === 'agent' && !hasQueues) warnings.push('Sem filas: o analista não verá nenhum chamado até ser vinculado a pelo menos uma fila.')

  const warnId = `${id}-warn`
  return (
    <fieldset style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: 0, padding: 0, border: 0, minWidth: 0 }} aria-describedby={warnings.length ? warnId : undefined}>
      <legend style={{ fontSize: 13, color: 'var(--text-3)', padding: 0, marginBottom: 10 }}>
        Empresas atendidas (carteira)
      </legend>

      {isManager ? (
        <>
          <label style={{ ...radioRow, opacity: canSetAll ? 1 : 0.6, cursor: canSetAll ? 'pointer' : 'not-allowed' }}>
            <input type="radio" name={`${id}-mode`} checked={all} disabled={!canSetAll}
              onChange={() => onChange({ all: true, orgIds: [] })} />
            <span>
              Todas as empresas (inclusive novas)
              {!canSetAll && <span style={{ ...hint, display: 'block' }}>Só o administrador define.</span>}
            </span>
          </label>
          <label style={radioRow}>
            <input type="radio" name={`${id}-mode`} checked={!all} onChange={() => onChange({ all: false, orgIds })} />
            <span>Selecionadas</span>
          </label>
        </>
      ) : (
        <>
          <label style={radioRow}>
            <input type="radio" name={`${id}-mode`} checked={!restrict}
              onChange={() => { setRestrict(false); onChange({ all: false, orgIds: [] }) }} />
            <span>Herdar de {chiefName ?? 'seu chefe'} <span style={hint}>({chiefScope ? chiefCount : 'sem chefe'})</span></span>
          </label>
          <label style={radioRow}>
            <input type="radio" name={`${id}-mode`} checked={restrict} onChange={() => setRestrict(true)} />
            <span>Restringir a algumas empresas</span>
          </label>
        </>
      )}

      {selecting && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar empresa…"
              aria-label="Buscar empresa na carteira"
              style={{ flex: 1, minWidth: 180, padding: '8px 10px', border: '1px solid var(--field-line)', background: 'var(--bg-input)', color: 'var(--text-1)', fontSize: 14, fontFamily: 'var(--font)' }}
            />
            <button type="button" style={linkBtn} onClick={markVisible} disabled={visible.length === 0}>Marcar {query ? 'encontradas' : 'todas'}</button>
            <button type="button" style={linkBtn} onClick={clearVisible} disabled={visible.length === 0}>Desmarcar {query ? 'encontradas' : 'todas'}</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '2px 20px', maxHeight: 220, overflowY: 'auto' }}>
            {visible.map(o => (
              <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '4px 0' }}>
                <input type="checkbox" checked={orgIds.includes(o.id)} onChange={() => toggle(o.id)} />
                <span style={{ fontSize: 14, color: 'var(--text-1)' }}>{o.name}</span>
              </label>
            ))}
            {visible.length === 0 && (
              <span style={hint}>
                {options.length === 0
                  ? `Não há empresas disponíveis — ${isManager ? 'cadastre uma empresa primeiro' : `a carteira de ${chiefName ?? 'seu chefe'} está vazia`}.`
                  : `Nenhuma empresa com "${query}". Tente parte do nome.`}
              </span>
            )}
          </div>
        </div>
      )}

      <div style={{ fontSize: 14, color: 'var(--text-2)' }}>Escopo efetivo: {summary}</div>

      {warnings.length > 0 && (
        <div id={warnId} role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {warnings.map(w => <div key={w} style={{ fontSize: 13.5, lineHeight: 1.45, color: 'var(--danger)' }}>{w}</div>)}
        </div>
      )}
    </fieldset>
  )
}
