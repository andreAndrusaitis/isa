import { useEffect, useState } from 'react'
import { ThumbsDown } from 'lucide-react'
import { aiService, type GuidanceInfo, type GuidanceStatus } from '@/services/aiService'
import { apiErrorMessage } from '@/services/api'
import { toast } from '@/store/toastStore'

const STATUS_LABEL: Record<GuidanceStatus, string> = {
  offered: 'Aguardando o solicitante',
  deflected: 'Resolvido pelo solicitante',
  declined: 'Não resolveu',
  duplicate_offered: 'Duplicado sugerido',
  linked: 'Vinculado pelo solicitante',
  skipped: 'Não se aplica',
  none: 'Nada enviado',
}

const pct = (v: number) => `${Math.round(v * 100)}%`
const sub = { margin: 0, padding: '10px 0 4px', borderTop: '1px solid var(--border)', color: 'var(--text-3)', fontSize: 13 }

/** Detalhe do chamado (equipe): o que o agente guidance ofereceu, dicas de equipe e 👎 por cartão. */
export function GuidancePanel({ ticketId, canVeto }: { ticketId: string; canVeto: boolean }) {
  const [info, setInfo] = useState<GuidanceInfo | null>(null)
  const [vetoed, setVetoed] = useState<Set<string>>(new Set())

  useEffect(() => {
    let alive = true
    aiService.getGuidance(ticketId).then(d => { if (alive) setInfo(d) }).catch(() => { })
    return () => { alive = false }
  }, [ticketId])

  const r = info?.run?.result
  const g = r?.guidance
  if (!r || r.skipReason || (!r.duplicate?.isDuplicate && !g?.steps.length && !g?.teamHints.length)) return null

  const veto = async (cardId: string) => {
    try {
      await aiService.disableExample(cardId)
      setVetoed(prev => new Set(prev).add(cardId))
      toast.success('Cartão desativado: não será mais sugerido.')
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível desativar o cartão.'))
    }
  }
  const vetoBtn = (cardId: string) => canVeto && (
    vetoed.has(cardId)
      ? <span style={{ fontSize: 13, color: 'var(--text-3)' }}>desativado</span>
      : <button type="button" onClick={() => veto(cardId)} className="icon-act danger" aria-label="Cartão ruim: desativar" title="Cartão ruim: desativar">
          <ThumbsDown size={14} aria-hidden="true" />
        </button>
  )
  const usedCards = g?.cards.filter(c => g.usedCards.includes(c.id)) ?? []

  return (
    <section aria-label="Orientação IA" style={{ padding: '14px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '2px 10px', marginBottom: 8, fontSize: 13, color: 'var(--text-3)' }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-1)' }}>Orientação IA</span>
        {info?.run?.mode !== 'apply' && <span>sombra</span>}
        {info?.guidance_status && <span>{STATUS_LABEL[info.guidance_status]}</span>}
      </div>
      <div style={{ fontSize: 14, color: 'var(--text-2)', display: 'flex', flexDirection: 'column', gap: 10, lineHeight: 1.5 }}>
        {r.duplicate?.isDuplicate && (
          <div>Possível duplicado de <strong>{r.duplicate.ticket.display_number}</strong> — {r.duplicate.ticket.title} ({pct(r.duplicate.confidence)})</div>
        )}
        {!!g?.steps.length && (
          <div>
            <div style={sub}>{info?.run?.mode === 'apply' ? 'Orientações ao solicitante' : 'Orientações que seriam enviadas'}</div>
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              {g.steps.map((s, i) => (
                <li key={i}>
                  {s.text} <span style={{ color: 'var(--text-3)' }}>[{s.source}]</span>
                  {!!s.how?.length && (
                    <ul style={{ margin: '2px 0 4px', paddingLeft: 16, color: 'var(--text-3)' }}>
                      {s.how.map((h, j) => <li key={j}>{h}</li>)}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
            {g.links.map(l => (
              <div key={l.url}><a href={l.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-fg)' }}>{l.title}</a></div>
            ))}
          </div>
        )}
        {!!g?.teamHints.length && (
          <div>
            <div style={sub}>Casos parecidos resolvidos pela equipe</div>
            {g.teamHints.map(h => (
              <div key={h.cardId} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>• {h.text} <span style={{ color: 'var(--text-3)' }}>({h.sourceDisplay}, {pct(h.score)})</span></span>
                {vetoBtn(h.cardId)}
              </div>
            ))}
          </div>
        )}
        {usedCards.length > 0 && (
          <div>
            <div style={sub}>Cartões usados nas orientações</div>
            {usedCards.map(c => (
              <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{c.ref} · {c.problem} <span style={{ color: 'var(--text-3)' }}>({c.sourceDisplay})</span></span>
                {vetoBtn(c.id)}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
