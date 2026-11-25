import { useState, type ReactNode } from 'react'
import type { MacroVariable } from '@/services/macroService'
import './configuracoes.css'

type VariableCategory = 'all' | 'user' | 'ticket' | 'service' | 'links'

const CATEGORIES: { id: VariableCategory; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'user', label: 'Solicitante' },
  { id: 'ticket', label: 'Chamado' },
  { id: 'service', label: 'Atendimento' },
  { id: 'links', label: 'Links' },
]

function getCategoryForKey(key: string): VariableCategory {
  if (['nome_usuario', 'primeiro_nome_usuario', 'email_usuario', 'empresa'].includes(key)) return 'user'
  if (['nome_analista', 'data_abertura', 'prazo_sla'].includes(key)) return 'service'
  if (['link_chamado', 'link_pesquisa'].includes(key)) return 'links'
  return 'ticket'
}

/** Variáveis aceitas nas respostas prontas e nas mensagens da pesquisa. */
export function VariablePicker({ variables, hint, inserted, onInsert, target, children }: {
  variables: MacroVariable[]
  /** Ao lado do título: explicação curta ou escolha do campo de destino. */
  hint: ReactNode
  inserted: string | null
  onInsert: (key: string) => void
  /** Nome do campo que recebe a variável, quando há mais de um. */
  target?: string
  children?: ReactNode
}) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<VariableCategory>('all')
  const q = search.toLowerCase().trim()
  const filtered = variables.filter((v) =>
    (category === 'all' || getCategoryForKey(v.key) === category) &&
    (!q || v.label.toLowerCase().includes(q) || v.key.toLowerCase().includes(q) || v.example?.toLowerCase().includes(q)))

  return (
    <aside aria-label="Variáveis disponíveis" className="var-dock">
      <div className="cfg-group-head">
        <h4 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>Variáveis disponíveis</h4>
        <div className="cfg-sub" style={{ margin: 0 }}>{hint}</div>
      </div>
      {children}
      <div className="var-tools">
        <input type="text" className="cfg-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar variável (ex: nome, sla, link)..." />
        <div className="subtabs">
          {CATEGORIES.map((cat) => (
            <button key={cat.id} type="button" aria-pressed={category === cat.id} onClick={() => setCategory(cat.id)}>
              {cat.label} {cat.id === 'all' ? variables.length : variables.filter((v) => getCategoryForKey(v.key) === cat.id).length}
            </button>
          ))}
        </div>
      </div>
      <div className="var-list">
        {filtered.map((v) => (
          <button key={v.key} type="button" onClick={() => onInsert(v.key)} title={`Inserir {${v.key}}${target ? ` no campo ${target}` : ''} • Exemplo: ${v.example}`}>
            <span>{v.label}</span>
            <code className="cfg-mono">{inserted === v.key ? 'Inserido' : `{${v.key}}`}</code>
          </button>
        ))}
        {filtered.length === 0 && <div className="cfg-sub" style={{ padding: '10px 0' }}>Nenhuma variável encontrada para "{search}".</div>}
      </div>
    </aside>
  )
}
