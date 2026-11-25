import { useEffect, useMemo, useRef, useState } from 'react'
import { adminService } from '@/services/adminService'
import { apiErrorMessage } from '@/services/api'
import { toast } from '@/store/toastStore'
import { Modal, Btn, Inp, Sel, TierBadge, ConfirmModal, Loading } from '@/components/ui'

type Row = { id: string; name: string; tier: string; enabled: boolean }
type Data = { inPlan: Row[]; outOfPlan: Omit<Row, 'enabled'>[] }
type Status = 'all' | 'enabled' | 'disabled'

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Categorias › Empresas: quem tem a categoria do plano ligada ou desligada.
 * Seleção em massa sobre o resultado filtrado; só empresas cujo plano inclui a
 * categoria podem ser alteradas (desligar nunca adiciona categoria fora do plano).
 */
export function CategoryOrgsModal({ category, onClose, onChanged }: {
  category: { id: string; name: string }
  onClose: () => void
  onChanged: () => void
}) {
  const [data, setData] = useState<Data | null>(null)
  const [search, setSearch] = useState('')
  const [tier, setTier] = useState('')
  const [status, setStatus] = useState<Status>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [confirmDisable, setConfirmDisable] = useState(false)

  const [error, setError] = useState(false)
  const allRef = useRef<HTMLInputElement>(null)

  const load = (alive: () => boolean = () => true) => adminService.getCategoryOrgs(category.id)
    .then(d => { if (alive()) setData(d) })
    .catch((err: any) => {
      if (!alive()) return
      setError(true)
      toast.error('Erro ao carregar empresas: ' + apiErrorMessage(err, err.message))
    })
  useEffect(() => {
    let alive = true
    load(() => alive)
    return () => { alive = false }
  }, [category.id])
  // Seleção só vale para o que está visível: mudou o filtro, recomeça.
  useEffect(() => { setSelected(new Set()) }, [search, tier, status])

  const tiers = useMemo(() => [...new Set((data?.inPlan ?? []).map(o => o.tier))].sort(), [data])
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data?.inPlan ?? []).filter(o =>
      (!q || o.name.toLowerCase().includes(q)) &&
      (!tier || o.tier === tier) &&
      (status === 'all' || (status === 'enabled') === o.enabled))
  }, [data, search, tier, status])
  const allVisibleSelected = visible.length > 0 && visible.every(o => selected.has(o.id))
  const someVisibleSelected = !allVisibleSelected && visible.some(o => selected.has(o.id))
  useEffect(() => { if (allRef.current) allRef.current.indeterminate = someVisibleSelected }, [someVisibleSelected, data])

  const toggleAll = () => setSelected(prev => {
    const next = new Set(prev)
    visible.forEach(o => (allVisibleSelected ? next.delete(o.id) : next.add(o.id)))
    return next
  })
  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const apply = async (enabled: boolean) => {
    setSaving(true)
    try {
      const r = await adminService.setCategoryOrgs(category.id, [...selected], enabled)
      const skipped = r.skipped.length ? ` · ${plural(r.skipped.length, 'ignorada', 'ignoradas')} (fora do plano ou da carteira)` : ''
      if (r.updated === 0) toast.error(`Nenhuma empresa alterada${skipped}`)
      else toast.success(`${plural(r.updated, 'empresa', 'empresas')} ${enabled ? 'com a categoria habilitada' : 'com a categoria desligada'}${skipped}`)
      setSelected(new Set())
      await load()
      onChanged()
    } catch (err: any) {
      toast.error('Erro ao salvar: ' + apiErrorMessage(err, err.message))
    } finally {
      setSaving(false)
    }
  }

  const enabledCount = (data?.inPlan ?? []).filter(o => o.enabled).length

  return (
    <>
      <Modal
        isOpen
        onClose={onClose}
        title={`Empresas com acesso — ${category.name}`}
        width={720}
        footer={
          <>
            <span aria-live="polite" style={{ marginRight: 'auto', alignSelf: 'center', fontSize: 13, color: 'var(--text-3)' }}>{plural(selected.size, 'selecionada', 'selecionadas')}</span>
            <Btn variant="secondary" size="sm" disabled={!selected.size || saving} onClick={() => apply(true)}>Habilitar</Btn>
            <Btn variant="danger" size="sm" disabled={!selected.size || saving} onClick={() => setConfirmDisable(true)}>Desabilitar</Btn>
          </>
        }
      >
        {error && !data ? (
          <div style={{ color: 'var(--text-3)', fontSize: 14 }}>
            <p style={{ margin: '0 0 12px' }}>Não foi possível carregar as empresas.</p>
            <Btn variant="secondary" size="sm" onClick={() => { setError(false); load() }}>Tentar novamente</Btn>
          </div>
        ) : !data ? (
          <Loading size="compact" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 14, color: 'var(--text-3)' }}>
              {enabledCount} de {data.inPlan.length} empresas com esta categoria no plano estão com ela ativa.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Inp value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar empresa…" aria-label="Buscar empresa" style={{ flex: '1 1 200px' }} />
              <Sel value={tier} onChange={e => setTier(e.target.value)} aria-label="Filtrar por plano" style={{ flex: '0 1 160px' }}>
                <option value="">Todos os planos</option>
                {tiers.map(t => <option key={t} value={t}>{cap(t)}</option>)}
              </Sel>
              <Sel value={status} onChange={e => setStatus(e.target.value as Status)} aria-label="Filtrar por status" style={{ flex: '0 1 160px' }}>
                <option value="all">Todas</option>
                <option value="enabled">Ativas</option>
                <option value="disabled">Desligadas</option>
              </Sel>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col" style={{ width: 24 }}>
                    <input ref={allRef} type="checkbox" checked={allVisibleSelected} onChange={toggleAll} disabled={!visible.length} aria-label="Selecionar todas as empresas filtradas" />
                  </th>
                  <th scope="col">Empresa</th>
                  <th scope="col">Plano</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr><td colSpan={4} style={{ color: 'var(--text-3)' }}>Nenhuma empresa com esses filtros.</td></tr>
                ) : visible.map(o => (
                  <tr key={o.id} onClick={() => toggle(o.id)} style={{ cursor: 'pointer' }}>
                    <td onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} aria-label={`Selecionar ${o.name}`} />
                    </td>
                    <td style={{ fontWeight: 500 }}>{o.name}</td>
                    <td><TierBadge tier={o.tier} /></td>
                    <td style={{ color: o.enabled ? undefined : 'var(--text-3)' }}>{o.enabled ? 'Ativa' : 'Desligada'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.outOfPlan.length > 0 && (
              <details style={{ fontSize: 13, color: 'var(--text-3)' }}>
                <summary style={{ cursor: 'pointer' }}>
                  {data.outOfPlan.length === 1 ? '1 empresa não tem' : `${data.outOfPlan.length} empresas não têm`} esta categoria no plano
                </summary>
                <div style={{ marginTop: 6, lineHeight: 1.6 }}>
                  {data.outOfPlan.map(o => `${o.name} (${cap(o.tier)})`).join(' · ')}
                </div>
              </details>
            )}
          </div>
        )}
      </Modal>
      <ConfirmModal
        isOpen={confirmDisable}
        onClose={() => setConfirmDisable(false)}
        onConfirm={() => apply(false)}
        title="Desligar categoria"
        message={`${category.name} deixa de aparecer para ${plural(selected.size, 'empresa selecionada', 'empresas selecionadas')} na abertura de chamados. Chamados já abertos não mudam.`}
        confirmText={`Desabilitar ${selected.size}`}
        variant="danger"
      />
    </>
  )
}
