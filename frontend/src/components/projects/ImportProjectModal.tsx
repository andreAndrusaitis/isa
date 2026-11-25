import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal, Btn } from '@/components/ui'
import { previewProjectImport, importProjects, ImportPreview } from '@/services/projectsService'
import { toast } from '@/store/toastStore'
import { apiErrorMessage } from '@/services/api'

const MAX_BYTES = 14 * 1024 * 1024 // abaixo do limite de corpo do backend (15 MB)

/**
 * Importa um backup de projeto do ISA ou o export JSON do ClickUp.
 * Fluxo em duas etapas: o arquivo é lido e validado no servidor (prévia, nada
 * gravado) e só depois a pessoa confirma a criação dos projetos.
 */
export function ImportProjectModal({ isOpen, onClose, onImported }: { isOpen: boolean; onClose: () => void; onImported?: () => void }) {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [payload, setPayload] = useState<unknown>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'reading' | 'importing' | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [focused, setFocused] = useState(false)

  function reset() {
    setFileName(null); setPayload(null); setPreview(null); setError(null); setBusy(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  function close() { reset(); onClose() }

  async function readFile(file: File) {
    setError(null); setPreview(null); setPayload(null); setFileName(file.name)
    if (!/\.json$/i.test(file.name)) { setError('Envie um arquivo .json.'); return }
    if (file.size > MAX_BYTES) { setError('Arquivo maior que 14 MB.'); return }
    setBusy('reading')
    try {
      const data = JSON.parse(await file.text())
      setPreview(await previewProjectImport(data))
      setPayload(data)
    } catch (err) {
      setError(err instanceof SyntaxError ? 'O arquivo não é um JSON válido.' : apiErrorMessage(err, 'Não foi possível ler o arquivo.'))
    } finally {
      setBusy(null)
    }
  }

  async function confirm() {
    if (!payload) return
    setBusy('importing')
    try {
      const result = await importProjects(payload)
      const tasks = result.projects.reduce((n, p) => n + p.tasks, 0)
      toast.success(`${result.projects.length} projeto(s) e ${tasks} task(s) importados.`)
      onImported?.()
      close()
      if (result.projects.length === 1) navigate(`/projetos/${result.projects[0].id}/overview`)
    } catch (err) {
      setError(apiErrorMessage(err, 'Não foi possível importar. Nada foi gravado no projeto que falhou.'))
      setBusy(null)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={close} title="Importar projetos" width={560}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--text-2)', lineHeight: 1.5 }}>
          Aceita o <strong>backup exportado pelo ISA</strong> (Configurações do projeto › Exportar) ou o <strong>export JSON do ClickUp</strong>.
          Você vira dono dos projetos criados; só entram como membros as pessoas que já usam o módulo Projetos.
        </p>

        <label
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) readFile(f) }}
          style={{
            display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '4px 16px', padding: '20px 0', position: 'relative', cursor: 'pointer',
            borderBlock: `1px solid ${dragOver ? 'var(--accent)' : 'var(--border-strong)'}`, background: dragOver ? 'var(--accent-soft)' : undefined,
            outline: focused ? '2px solid var(--accent)' : 'none', outlineOffset: 2,
          }}
        >
          <span style={{ flex: 1, minWidth: 200, fontSize: 14, fontWeight: 500, color: 'var(--accent-fg)' }}>
            {fileName ?? 'Arraste o arquivo .json aqui ou clique para escolher'}
          </span>
          <span style={{ fontSize: 13, color: 'var(--text-3)' }}>Até 14 MB</span>
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            aria-label="Arquivo de backup ou export do ClickUp"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f) }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
          />
        </label>

        {busy === 'reading' && <div role="status" style={{ fontSize: 13, color: 'var(--text-2)' }}>Lendo e validando o arquivo…</div>}

        {error && (
          <div role="alert" style={{ fontSize: 13.5, color: 'var(--danger)' }}>{error}</div>
        )}

        {preview && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--text-1)' }}>
              <strong style={{ fontWeight: 500 }}>{preview.format === 'clickup' ? 'Export do ClickUp' : 'Backup do ISA'}</strong>
              <span style={{ color: 'var(--text-2)' }}>· {preview.projects.length} projeto(s) · {preview.totalTasks} task(s)</span>
            </div>
            <div style={{ maxHeight: 220, overflow: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Projeto</th>
                    <th style={{ textAlign: 'right' }}>Tasks</th>
                    <th style={{ textAlign: 'right' }}>Membros</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.projects.map((p) => (
                    <tr key={p.name}>
                      <td>
                        {p.name}
                        {p.lists.length > 0 && <span style={{ color: 'var(--text-3)' }}> · listas: {p.lists.join(', ')}</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>{p.tasks}</td>
                      <td style={{ textAlign: 'right' }}>{p.members}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(preview.peopleMissing.length > 0 || preview.unmappedAssignees.length > 0) && (
              <div className="notice">
                <strong style={{ color: 'var(--warning)' }}>Ficam de fora (sem acesso ao módulo Projetos):</strong>{' '}
                {[...preview.peopleMissing, ...preview.unmappedAssignees].join(', ')}.
                {' '}As tasks delas entram sem responsável, com o nome registrado na descrição.
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Btn variant="secondary" size="sm" onClick={close} disabled={busy === 'importing'}>Cancelar</Btn>
          <Btn variant="primary" size="sm" onClick={confirm} disabled={!preview || !!busy}>
            {busy === 'importing' ? 'Importando…' : preview ? `Importar ${preview.projects.length} projeto(s)` : 'Importar'}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}
