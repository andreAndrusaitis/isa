import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { adminService } from '@/services/adminService'
import { apiErrorMessage } from '@/services/api'
import { toast } from '@/store/toastStore'
import { Btn, ConfirmModal, Loading } from '@/components/ui'
import { FilterSelect } from '@/components/filters/FilterSelect'
import './admin.css'

type Kind = 'email' | 'domain'
type Block = { id: string; kind: Kind; value: string; reason: string | null; hits: number; last_hit_at: string | null; created_at: string }

const KIND_LABEL: Record<Kind, string> = { email: 'E-mail', domain: 'Domínio' }
const PLACEHOLDER: Record<Kind, string> = { email: 'promocoes@exemplo.com', domain: 'exemplo.com' }

const fmt = (d: string) => new Date(d).toLocaleString('pt-BR')

/** Remetentes que não abrem chamado por e-mail nem pela API (spam, avisos automáticos). */
export function EmailBlocksPanel() {
  const [items, setItems] = useState<Block[]>([])
  const [system, setSystem] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [kind, setKind] = useState<Kind>('domain')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState<Block | null>(null)

  const load = () => adminService.getEmailBlocks()
    .then(d => { setItems(d.data); setSystem(d.system); setError('') })
    .catch(() => setError('Não foi possível carregar os bloqueios.'))
    .finally(() => setLoading(false))

  useEffect(() => { void load() }, [])

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!value.trim()) return
    setSaving(true)
    try {
      await adminService.createEmailBlock({ kind, value: value.trim(), reason: reason.trim() || undefined })
      toast.success(`${KIND_LABEL[kind]} bloqueado: não abre mais chamado.`)
      setValue(''); setReason('')
      await load()
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível bloquear.'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!removing) return
    try {
      await adminService.deleteEmailBlock(removing.id)
      toast.success(`${removing.value} liberado.`)
      setRemoving(null)
      await load()
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível excluir o bloqueio.'))
    }
  }

  return (
    <div style={{ padding: '0 var(--page-gutter) 40px' }}>
      <form onSubmit={add} className="adm-filters">
        <div className="field">Tipo
          <FilterSelect value={kind} onChange={v => setKind(v as Kind)} single>
            <option value="domain">Domínio (e subdomínios)</option>
            <option value="email">E-mail exato</option>
          </FilterSelect>
        </div>
        <label className="grow">{KIND_LABEL[kind]}
          <input required maxLength={255} placeholder={PLACEHOLDER[kind]} type={kind === 'email' ? 'email' : 'text'} value={value} onChange={e => setValue(e.target.value)} />
        </label>
        <label className="grow">Motivo (opcional)
          <input maxLength={300} placeholder="Ex.: spam, newsletter, aviso automático" value={reason} onChange={e => setReason(e.target.value)} />
        </label>
        <Btn type="submit" size="sm" disabled={saving || !value.trim()}>{saving ? 'Bloqueando...' : 'Bloquear'}</Btn>
      </form>
      <p className="adm-note" style={{ paddingBottom: 16 }}>
        E-mail recebido desses remetentes não abre chamado nem entra como resposta, e a API recusa a abertura (<code>SENDER_BLOCKED</code>).
        {system.length > 0 && <> Sempre bloqueados pelo sistema: {system.join(', ')}.</>}
      </p>
      {error ? <p role="alert" className="adm-error">{error}</p>
        : loading ? <Loading label="Carregando bloqueios…" />
        : (
          <div className="adm-scroll">
            <table className="table" aria-label="Remetentes bloqueados" style={{ minWidth: 720 }}>
              <thead><tr>{['Remetente', 'Tipo', 'Motivo', 'Bloqueou'].map(h => <th key={h} scope="col">{h}</th>)}<th scope="col" aria-label="Liberar" /></tr></thead>
              <tbody>
                {items.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--text-3)' }}>Nenhum bloqueio. Bloqueie um e-mail ou domínio acima para que ele não abra chamados.</td></tr>}
                {items.map(b => (
                  <tr key={b.id}>
                    <td style={{ overflowWrap: 'anywhere' }}>{b.kind === 'domain' ? `@${b.value}` : b.value}</td>
                    <td>{KIND_LABEL[b.kind]}</td>
                    <td style={{ overflowWrap: 'anywhere' }}>{b.reason || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {b.hits} {b.hits === 1 ? 'vez' : 'vezes'}
                      {b.last_hit_at && <div className="adm-sub">última: {fmt(b.last_hit_at)}</div>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="icon-act danger" onClick={() => setRemoving(b)} aria-label={`Liberar ${b.value}`} title="Liberar"><Trash2 size={15} aria-hidden /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      <ConfirmModal isOpen={!!removing} onClose={() => setRemoving(null)} onConfirm={remove} variant="danger"
        title="Liberar remetente" confirmText="Liberar"
        message={removing ? <>E-mails de <strong>{removing.kind === 'domain' ? `@${removing.value}` : removing.value}</strong> voltam a abrir chamado. Continuar?</> : ''} />
    </div>
  )
}
