import { useState, useEffect } from 'react'
import { adminService } from '@/services/adminService'
import { validateSingleDomain } from '@/utils/domainValidation'
import { Btn, Inp, Toggle, ConfirmModal, Loading } from '@/components/ui'
import { Trash2 } from 'lucide-react'
import { Section } from './Blocks'
import { toast } from '@/store/toastStore'

type AuthorizedDomain = {
  id: string
  domain: string
  active: boolean
  created_at: string
}

export function AuthorizedDomainsTab({ orgId, onAdded }: { orgId: string; onAdded?: (domain: string) => void }) {
  const [domains, setDomains] = useState<AuthorizedDomain[]>([])
  const [loading, setLoading] = useState(true)
  const [newDomain, setNewDomain] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<{ isOpen: boolean; id: string } | null>(null)

  const load = () => {
    setLoading(true)
    adminService.getAuthorizedDomains(orgId)
      .then(setDomains)
      .catch(() => toast.error('Erro ao carregar domínios autorizados.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [orgId])

  const handleAdd = async () => {
    const check = validateSingleDomain(newDomain, { required: true })
    if (!check.ok) { toast.warning(check.error); return }
    setSaving(true)
    try {
      const created = await adminService.createAuthorizedDomain(orgId, check.domain)
      setDomains([...domains, created])
      setNewDomain('')
      onAdded?.(created.domain)
      toast.success('Domínio autorizado cadastrado e incluído nos domínios da empresa!')
    } catch (err: any) {
      toast.error('Erro ao cadastrar domínio: ' + (err.response?.data?.error || err.message))
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (d: AuthorizedDomain) => {
    try {
      const updated = await adminService.updateAuthorizedDomain(orgId, d.id, { active: !d.active })
      setDomains(domains.map(x => x.id === d.id ? updated : x))
      toast.success(updated.active ? 'Domínio ativado!' : 'Domínio desativado!')
    } catch (err: any) {
      toast.error('Erro ao alterar domínio: ' + (err.response?.data?.error || err.message))
    }
  }

  const performDelete = async (id: string) => {
    try {
      await adminService.deleteAuthorizedDomain(orgId, id)
      setDomains(domains.filter(d => d.id !== id))
      toast.success('Domínio removido com sucesso!')
    } catch (err: any) {
      toast.error('Erro ao remover domínio: ' + (err.response?.data?.error || err.message))
    }
  }

  if (loading) {
    return <Loading size="compact" label="Carregando domínios…" />
  }

  return (
    <Section title="Domínios autorizados" hint="Quem tem e-mail destes domínios entra automaticamente com a conta Microsoft.">
      {domains.length === 0 ? (
        <p style={{ color: 'var(--text-2)' }}>Nenhum domínio autorizado. Cadastre um domínio de e-mail para permitir login automático via Microsoft para esta empresa.</p>
      ) : (
        <table className="table">
          <tbody>
            {domains.map(d => (
              <tr key={d.id}>
                <td style={{ overflowWrap: 'anywhere' }}>{d.domain}</td>
                <td style={{ width: 60 }}><Toggle value={d.active} onChange={() => handleToggle(d)} label={`Domínio ${d.domain} ativo`} /></td>
                <td style={{ width: 40 }}>
                  <button type="button" className="icon-act danger" onClick={() => setConfirmDelete({ isOpen: true, id: d.id })} title="Remover domínio" aria-label={`Remover domínio ${d.domain}`}>
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
        <div style={{ flex: '1 1 220px', maxWidth: 420 }}>
          <Inp
            value={newDomain}
            onChange={e => setNewDomain(e.target.value)}
            placeholder="empresa.com.br"
            aria-label="Novo domínio"
            onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
          />
        </div>
        <Btn variant="secondary" onClick={handleAdd} disabled={saving}>Adicionar</Btn>
      </div>

      {confirmDelete?.isOpen && (
        <ConfirmModal
          isOpen
          title="Remover domínio autorizado"
          message="Usuários já cadastrados não são afetados. Novos logins desse domínio deixarão de ser autorizados automaticamente. Deseja continuar?"
          confirmText="Remover"
          variant="danger"
          onConfirm={() => performDelete(confirmDelete.id)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </Section>
  )
}
