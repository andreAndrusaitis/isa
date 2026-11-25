import type { ReactNode } from 'react'
import './cadastros.css'

/** Linha de ajuste: rótulo e explicação à esquerda, valor ou controle à direita. */
export function Row({ label, hint, required, flat, children }: {
  label: ReactNode; hint?: ReactNode; required?: boolean; children: ReactNode
  /** Valor ou chave, sem a folga que alinha o rótulo com um campo. */
  flat?: boolean
}) {
  return (
    <div className="setting" data-flat={flat || undefined}>
      <div>
        {label}{required && <span className="cad-req">*</span>}
        {hint && <small>{hint}</small>}
      </div>
      <div>{children}</div>
    </div>
  )
}

/** Seção do detalhe: título à esquerda, conteúdo à direita. */
export function Section({ title, hint, children }: { title: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="cad-section">
      <header><h2>{title}</h2>{hint && <p>{hint}</p>}</header>
      <div>{children}</div>
    </section>
  )
}

/** Cabeçalho do detalhe: volta para a lista, nome, dados em texto e ações. */
export function DetailHead({ back, onBack, title, meta, children }: {
  back: string; onBack: () => void; title: string; meta: ReactNode[]; children?: ReactNode
}) {
  return (
    <div className="cad-head">
      <div>
        <button type="button" className="cad-back" onClick={onBack}>← {back}</button>
        <h1>{title}</h1>
        <div className="cad-meta">{meta.filter(Boolean).map((m, i) => <span key={i}>{m}</span>)}</div>
      </div>
      {children && <div className="cad-actions">{children}</div>}
    </div>
  )
}

/** Filtro em texto com a contagem ao lado. */
export function TextFilter({ label, value, options, onPick }: {
  label: string; value: string; options: { value: string; label: string; count: number }[]; onPick: (value: string) => void
}) {
  return (
    <div className="text-filter" role="group" aria-label={label}>
      {options.map(o => (
        <button key={o.value} type="button" aria-pressed={value.split(',').includes(o.value)} onClick={() => onPick(o.value)}>
          {o.label}<b>{o.count}</b>
        </button>
      ))}
    </div>
  )
}
