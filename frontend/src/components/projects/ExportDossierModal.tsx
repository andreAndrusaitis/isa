import { useEffect, useMemo, useState } from 'react'
import { Modal, Btn, Field, Inp } from '@/components/ui'
import { downloadProjectsExport } from '@/services/projectsService'
import { toast } from '@/store/toastStore'
import { Project } from '@/types/projects'

type Props = { isOpen: boolean; onClose: () => void; projects: Pick<Project, 'id' | 'name' | 'teamOnly'>[]; initialProjectIds?: string[] }

/** Dossiê dos projetos: HTML para ler/apresentar, Excel para analisar. */
export function ExportDossierModal({ isOpen, onClose, projects, initialProjectIds }: Props) {
  const [mode, setMode] = useState<'all' | 'pick'>(initialProjectIds?.length ? 'pick' : 'all')
  const [picked, setPicked] = useState<Set<string>>(new Set(initialProjectIds ?? []))
  const [format, setFormat] = useState<'html' | 'xlsx'>('html')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setMode(initialProjectIds?.length ? 'pick' : 'all')
    setPicked(new Set(initialProjectIds ?? []))
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return projects.filter((p) => !q || p.name.toLowerCase().includes(q))
  }, [projects, search])

  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const invalidPeriod = !!from && !!to && from > to
  const disabled = busy || invalidPeriod || (mode === 'pick' && picked.size === 0)

  async function generate() {
    setBusy(true)
    try {
      await downloadProjectsExport({ format, projectIds: mode === 'pick' ? [...picked] : undefined, from: from || undefined, to: to || undefined })
      toast.success('Dossiê gerado.')
      onClose()
    } catch (err: any) {
      toast.error(err?.message || 'Não foi possível gerar o dossiê.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Exportar dossiê" width={520}
      footer={<><Btn variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Btn><Btn onClick={generate} disabled={disabled}>{busy ? 'Gerando…' : 'Gerar'}</Btn></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <legend style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-1)', marginBottom: 8, padding: 0 }}>Projetos</legend>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
            <input type="radio" name="dossier-mode" checked={mode === 'all'} onChange={() => setMode('all')} /> Todos os meus projetos ({projects.length})
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
            <input type="radio" name="dossier-mode" checked={mode === 'pick'} onChange={() => setMode('pick')} /> Escolher projetos
          </label>
          {mode === 'pick' && (
            <div style={{ paddingLeft: 24 }}>
              <Inp value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar projeto…" aria-label="Buscar projeto" />
              <div style={{ maxHeight: 220, overflow: 'auto', marginTop: 4, display: 'flex', flexDirection: 'column' }}>
                {shown.map((p) => (
                  <label key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, minHeight: 40, borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
                    <input type="checkbox" aria-label={p.name} checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
                    <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{p.name}</span>
                    {p.teamOnly && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Equipe</span>}
                  </label>
                ))}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>{picked.size} selecionado(s)</div>
            </div>
          )}
        </fieldset>

        <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexWrap: 'wrap', gap: '8px 24px' }}>
          <legend style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-1)', marginBottom: 8, padding: 0 }}>Formato</legend>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
            <input type="radio" name="dossier-format" checked={format === 'html'} onChange={() => setFormat('html')} /> Dossiê HTML (ler e imprimir)
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
            <input type="radio" name="dossier-format" checked={format === 'xlsx'} onChange={() => setFormat('xlsx')} /> Excel (analisar)
          </label>
        </fieldset>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <Field label="De"><Inp type="date" aria-label="De" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Até"><Inp type="date" aria-label="Até" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <div style={{ fontSize: 13, marginTop: -12, color: invalidPeriod ? 'var(--danger)' : 'var(--text-3)' }}>
          {invalidPeriod ? 'A data inicial é depois da final.' : 'Período opcional: recorta só a seção "Entregas no período". Sem período, entra todo o histórico.'}
        </div>
      </div>
    </Modal>
  )
}
