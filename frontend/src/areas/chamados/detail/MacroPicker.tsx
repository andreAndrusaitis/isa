import { useState } from 'react'
import { Btn } from '@/components/ui'
import type { Macro } from '@/types'

/** Botão com a lista de respostas prontas; `up` abre a lista para cima. */
export function MacroPicker({ macros, onPick, up = false }: { macros: Macro[]; onPick: (content: string) => void; up?: boolean }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const found = macros.filter(m => m.title.toLowerCase().includes(search.trim().toLowerCase()))
  return (
    <div style={{ position: 'relative' }}>
      <Btn type="button" variant="ghost" size="sm" title="Inserir resposta pronta" onClick={() => setOpen(o => !o)}>Respostas prontas</Btn>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
          <div className="td-pop" style={up ? { bottom: '100%', left: 0 } : { top: '100%', right: 0 }}>
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar macro..." maxLength={100} />
            {macros.length === 0 ? <p>Nenhuma macro disponível.</p> : found.length === 0 && <p>Nenhuma resposta encontrada.</p>}
            {found.map(m => (
              <button key={m.id} type="button" onClick={() => { onPick(m.content); setOpen(false); setSearch('') }}>
                {m.title}<small>{m.content}</small>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
