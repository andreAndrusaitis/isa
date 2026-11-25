import { useEffect, useState } from 'react'
import { Btn, Inp, Sel } from '@/components/ui'
import { aiService, type ResolutionCard } from '@/services/aiService'
import { apiErrorMessage } from '@/services/api'
import { toast } from '@/store/toastStore'

type Filter = 'all' | 'active' | 'inactive'

/**
 * Base de resoluções do agente Orientação (Motor IA): cartões destilados dos chamados
 * fechados. O admin busca, vê o que a IA aprendeu e desativa/reativa um cartão.
 */
export function ResolutionBasePanel() {
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [cards, setCards] = useState<ResolutionCard[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [counts, setCounts] = useState<{ total: number; inactive: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  // Busca com pausa: não consulta a cada tecla.
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 300); return () => clearTimeout(t) }, [q])

  const load = async (more = false) => {
    setLoading(true)
    try {
      const page = await aiService.listResolutionCards({
        q: query || undefined, active: filter === 'all' ? undefined : filter === 'active', cursor: more ? cursor ?? undefined : undefined,
      })
      setCards(prev => (more ? [...prev, ...page.data] : page.data))
      setCursor(page.next_cursor)
      setCounts({ total: page.total, inactive: page.inactive })
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível carregar a base de resoluções.'))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [query, filter]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (c: ResolutionCard) => {
    setBusy(c.id)
    try {
      await aiService.setResolutionCardActive(c.id, !c.active)
      setCards(prev => prev.map(x => (x.id === c.id ? { ...x, active: !c.active } : x)))
      setCounts(prev => prev && { ...prev, inactive: prev.inactive + (c.active ? 1 : -1) })
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível alterar o cartão.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
        Soluções que a IA aprendeu dos chamados fechados. Cartão desativado deixa de ser usado nas orientações e nas dicas para o analista.
        {counts && <> · <strong>{counts.total.toLocaleString('pt-BR')}</strong> cartões, {counts.inactive} desativado(s)</>}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Inp type="search" aria-label="Buscar na base de resoluções" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar problema (ex.: Outlook, VPN)…" style={{ flex: '1 1 220px', width: 'auto' }} />
        <Sel aria-label="Filtrar cartões" value={filter} onChange={e => setFilter(e.target.value as Filter)} style={{ width: 160 }}>
          <option value="all">Todos</option>
          <option value="active">Ativos</option>
          <option value="inactive">Desativados</option>
        </Sel>
      </div>
      <ul aria-busy={loading} aria-label="Cartões da base de resoluções" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {cards.map(c => (
          <li key={c.id} style={{ borderTop: '1px solid var(--border)', padding: '12px 0', color: c.active ? undefined : 'var(--text-3)', overflowWrap: 'anywhere' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span style={{ flex: '1 1 200px', minWidth: 0 }}>{c.problem}</span>
              <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{c.selfService ? 'Autoatendimento' : 'Equipe'}{!c.active && ' · Desativado'}</span>
              <Btn size="xs" variant={c.active ? 'ghost' : 'secondary'} disabled={busy === c.id} onClick={() => toggle(c)}
                aria-label={`${c.active ? 'Desativar' : 'Reativar'} cartão: ${c.problem}`}>
                {busy === c.id ? 'Salvando…' : c.active ? 'Desativar' : 'Reativar'}
              </Btn>
            </div>
            <details style={{ fontSize: 13, color: 'var(--text-3)' }}>
              <summary style={{ cursor: 'pointer', minHeight: 24 }}>{c.selfService ? `${c.steps.length} passo(s)` : 'Ação da equipe'}{c.sourceDisplay ? ` · origem ${c.sourceDisplay}` : ''}</summary>
              {c.selfService
                ? <ol style={{ margin: '4px 0 0', paddingLeft: 18 }}>{c.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                : <p style={{ margin: '4px 0 0' }}>{c.teamAction}</p>}
            </details>
          </li>
        ))}
        {!loading && cards.length === 0 && <li style={{ fontSize: 13, color: 'var(--text-3)' }}>Nenhum cartão encontrado.</li>}
      </ul>
      {cursor && (
        <div>
          <Btn size="sm" variant="secondary" disabled={loading} onClick={() => load(true)}>{loading ? 'Carregando…' : 'Carregar mais'}</Btn>
        </div>
      )}
    </div>
  )
}
