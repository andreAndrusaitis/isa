import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, Check } from 'lucide-react'
import { ProjectStatus } from '@/types/projects'
import { ColorDot } from '@/components/ui'
import './projects.css'

type StatusLike = Pick<ProjectStatus, 'id' | 'name' | 'color'>

/** Próximo status na ordem do fluxo (só ativos); null quando já está no último. */
export function nextStatus(statuses: ProjectStatus[], currentId: string): ProjectStatus | null {
  const flow = statuses.filter(s => s.isActive !== false).sort((a, b) => a.position - b.position)
  const i = flow.findIndex(s => s.id === currentId)
  return i >= 0 && i < flow.length - 1 ? flow[i + 1] : null
}

/**
 * Status em texto, com um quadradinho na cor cadastrada. Com `onChange`: clicar
 * no nome abre a lista de status; a seta à direita avança direto para o
 * próximo status do fluxo. Sem `onChange`, é só o texto.
 */
export function StatusPill({ status, statuses, onChange }: {
  status: StatusLike
  statuses?: ProjectStatus[]
  onChange?: (statusId: string) => void
}) {
  const [menu, setMenu] = useState<{ top: number; left: number } | null>(null)
  const anchorRef = useRef<HTMLButtonElement>(null)

  // Fecha com clique fora, Esc ou rolagem (o menu é fixo na tela, não acompanharia a linha).
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); anchorRef.current?.focus() } }
    window.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('scroll', close, true); window.removeEventListener('keydown', onKey) }
  }, [menu])

  const content = <><ColorDot color={status.color || 'var(--text-3)'} size={9} /><span className="pj-cut">{status.name}</span></>

  if (!onChange || !statuses) return <span className="pj-status" title={status.name}>{content}</span>

  const next = nextStatus(statuses, status.id)
  const options = statuses.filter(s => s.isActive !== false).sort((a, b) => a.position - b.position)

  return (
    // stopPropagation: vive dentro de linhas clicáveis que abrem a task.
    <span style={{ display: 'inline-flex', alignItems: 'stretch', minWidth: 0, maxWidth: '100%' }} onClick={e => e.stopPropagation()}>
      <button
        ref={anchorRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={!!menu}
        aria-label={`Status: ${status.name}. Alterar status`}
        title={status.name}
        onClick={() => {
          const r = anchorRef.current!.getBoundingClientRect()
          setMenu(menu ? null : { top: r.bottom + 4, left: r.left })
        }}
        className="pj-status"
      >
        {content}
      </button>
      {next && (
        <button
          type="button"
          aria-label={`Avançar para ${next.name}`}
          title={`Avançar para ${next.name}`}
          onClick={() => onChange(next.id)}
          className="pj-next"
        >
          <ChevronRight size={13} />
        </button>
      )}
      {menu && createPortal(
        <div
          role="listbox"
          aria-label="Escolher status"
          onMouseDown={e => e.stopPropagation()}
          className="pj-pop"
          style={{ position: 'fixed', top: menu.top, left: menu.left, zIndex: 1100, minWidth: 200, maxHeight: 280, overflowY: 'auto', padding: '4px 0' }}
        >
          {options.map(s => (
            <button
              key={s.id}
              type="button"
              role="option"
              aria-selected={s.id === status.id}
              autoFocus={s.id === status.id}
              onClick={() => { setMenu(null); if (s.id !== status.id) onChange(s.id) }}
              className="pj-opt"
            >
              <ColorDot color={s.color} size={9} />
              <span style={{ flex: 1 }}>{s.name}</span>
              {s.id === status.id && <Check size={13} color="var(--text-3)" />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </span>
  )
}
