/**
 * Turno (supervisor): o que venceu, o que está para vencer, o que está sem dono e a
 * carga de cada pessoa. Cada linha já traz a decisão; não é preciso abrir o chamado.
 */
import { useCallback, useEffect, useState, type DragEvent } from 'react'
import { AlarmClock, AlarmClockOff, Hourglass, UserX } from 'lucide-react'
import { Avatar, Btn, EmptyState, Figures, Loading, PageHeader, PriorityBadge, StatCard } from '@/components/ui'
import { dashboardService } from '@/services/dashboardService'
import { homesService, type DeadlineState, type Shift, type ShiftDecision, type ShiftPerson } from '@/services/homesService'
import { apiErrorMessage } from '@/services/api'
import { toast } from '@/store/toastStore'
import type { AuthUser } from '@/store/auth'
import { ago, span, untilPhrase } from './clock'
import { useBusinessHours } from '@/hooks/useBusinessHours'
import { businessMsBetween, type BusinessHours } from '@/utils/businessTime'
import { ForecastModal } from './ForecastModal'
import './home.css'

const first = (name: string) => name.split(' ')[0]
const STATE_LABEL: Record<DeadlineState, string> = { ok: 'no prazo', soon: 'perto do prazo', late: 'vencido', paused: 'esperando' }

export function loadNote(p: ShiftPerson, people: ShiftPerson[]): string {
  const avg = people.reduce((s, x) => s + x.active, 0) / Math.max(1, people.length)
  if (!p.active) return 'livre'
  if (people.length > 1 && p.active >= avg * 1.6 && p.active - avg >= 3) return `${p.active}, acima da média do time`
  return `${p.active} ${p.active === 1 ? 'ativo' : 'ativos'}`
}

export function ShiftPage({ user, onOpenTicket, onNavigate }: {
  user: Pick<AuthUser, 'role'>
  onOpenTicket: (id: string) => void
  onNavigate: (action: { view: string; filters?: any }) => void
}) {
  const [data, setData] = useState<Shift | null>(null)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [choosing, setChoosing] = useState<string | null>(null)
  const [forecast, setForecast] = useState<ShiftDecision | null>(null)
  const [over, setOver] = useState<string | null>(null)
  // Admin olha, mas não atua em chamado.
  const acts = user.role !== 'admin'
  const bh = useBusinessHours()

  const load = useCallback(() => homesService.getShift().then(d => { setData(d); setError(false) }).catch(() => setError(true)), [])
  useEffect(() => {
    void load()
    const t = setInterval(() => { void load() }, 60_000)
    return () => clearInterval(t)
  }, [load])

  async function pass(ticketId: string, person: { id: string; name: string }) {
    setBusy(ticketId)
    try {
      await dashboardService.assignTicket(ticketId, person.id)
      toast.success(`Passado para ${first(person.name)}.`)
      setChoosing(null)
      await load()
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível passar o chamado.'))
    } finally {
      setBusy(null)
    }
  }

  function drop(e: DragEvent, person: ShiftPerson) {
    e.preventDefault()
    setOver(null)
    const id = e.dataTransfer.getData('text/isa-ticket')
    if (id && !person.tickets.some(t => t.id === id)) void pass(id, person)
  }

  if (error && !data) return <EmptyState title="Não foi possível carregar o turno" desc="Verifique a conexão e tente de novo." action={<Btn onClick={() => void load()}>Tentar de novo</Btn>} />
  if (!data) return <Loading label="Carregando o turno…" />
  const { numbers: n, decisions, people } = data
  const go = (filters: object) => onNavigate({ view: 'queue', filters })
  const max = Math.max(1, ...people.map(p => p.active))

  return (
    <div className="hm">
      <PageHeader title="Turno" subtitle={new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })} />
      <div className="hm-body">
        <Figures>
          <StatCard icon={AlarmClockOff} label="Vencidos" value={n.late} tone={n.late ? 'late' : 'calm'} sub={n.lateTop ? (n.lateTop.count === n.late ? `todos da ${n.lateTop.name}` : `${n.lateTop.count} da ${n.lateTop.name}`) : 'nenhum agora'} onClick={() => go({ overdue: true, status: 'open,in_progress' })} />
          <StatCard icon={AlarmClock} label="Vencem em 4 h" value={n.soon} tone={n.soon ? 'soon' : 'calm'} sub="horas de expediente" />
          <StatCard icon={UserX} label="Sem responsável" value={n.unassigned} sub={n.unassignedOldest ? `mais antigo ${ago(n.unassignedOldest)}` : 'todos com dono'} onClick={() => go({ unassigned: true, status: 'open,in_progress,pending' })} />
          <StatCard icon={Hourglass} label="Esperando cliente" value={n.waiting} tone="calm" sub="prazo pausado" onClick={() => go({ status: 'pending' })} />
        </Figures>

        <div className="hm-cols">
          <section aria-labelledby="decide">
            <h2 id="decide">Decida agora</h2>
            {decisions.length === 0 && data.repeated.length === 0 && (
              <div className="hm-card"><b>Nada pedindo decisão</b><p className="hm-note">Nenhum vencido, perto do prazo ou sem dono na sua carteira.</p></div>
            )}
            {decisions.map((d, i) => (
              <article key={d.id} className="hm-card hm-decision" data-state={d.state === 'ok' ? 'free' : d.state} draggable={acts} onDragStart={e => e.dataTransfer.setData('text/isa-ticket', d.id)}>
                <header>
                  <button type="button" className="hm-title" onClick={() => onOpenTicket(d.id)}>{d.title}</button>
                  <span className="hm-when">{when(d, bh)}</span>
                </header>
                <div className="hm-meta">
                  <span>{d.number}</span>{d.org && <span>{d.org.name}</span>}{d.queue && <span>{d.queue}</span>}
                  <PriorityBadge priority={d.priority} />
                  {d.owner ? <span>com {first(d.owner.name)}</span> : <span>sem responsável</span>}
                </div>
                {acts && (
                  <div className="hm-actions">
                    {d.suggestion && (
                      <Btn size="sm" variant={i === 0 ? 'primary' : 'secondary'} disabled={busy === d.id} onClick={() => void pass(d.id, d.suggestion!)}>
                        <span aria-hidden><Avatar name={d.suggestion.name} src={d.suggestion.avatar} size={22} /></span>
                        {d.owner ? 'Passar para' : 'Dar a'} {first(d.suggestion.name)} · {d.suggestion.active} {d.suggestion.active === 1 ? 'ativo' : 'ativos'}{d.suggestion.otherTeam && ', outra equipe'}
                      </Btn>
                    )}
                    {d.needsForecast && d.owner && <Btn size="sm" variant="secondary" onClick={() => setForecast(d)}>Nova previsão</Btn>}
                    <Btn size="sm" variant={d.suggestion ? 'ghost' : 'secondary'} aria-expanded={choosing === d.id} onClick={() => setChoosing(choosing === d.id ? null : d.id)}>{d.suggestion ? 'Outra pessoa' : 'Escolher pessoa'}</Btn>
                    {!d.suggestion && !d.owner && <span className="hm-note">Ninguém disponível em {d.queue ?? 'sua equipe'}</span>}
                  </div>
                )}
                {choosing === d.id && (
                  <div className="hm-people" role="group" aria-label="Escolher pessoa">
                    {people.length === 0 && <p className="hm-note">Nenhum analista na sua equipe.</p>}
                    {[...people].sort((a, b) => a.active - b.active).filter(p => p.id !== d.owner?.id).map(p => (
                      <button key={p.id} type="button" disabled={busy === d.id || (!!d.queueId && !p.queues.includes(d.queueId))} onClick={() => void pass(d.id, p)}>
                        <span aria-hidden><Avatar name={p.name} src={p.avatar} size={26} /></span>
                        <span>{p.name}{d.queueId && !p.queues.includes(d.queueId) && <small>não atende esta fila</small>}</span>
                        <i style={{ '--w': `${(p.active / max) * 100}%` } as React.CSSProperties} aria-hidden />
                        <b>{p.active}</b>
                      </button>
                    ))}
                  </div>
                )}
              </article>
            ))}
            {data.repeated.map(r => (
              <article key={r.category.id} className="hm-card hm-decision" data-state="repeat">
                <header><b>{r.count} chamados de {r.category.name} em dois dias</b><span className="hm-when">{r.orgs.join(', ')}</span></header>
                <p className="hm-note">Pode ser uma causa só.</p>
                <div className="hm-actions"><Btn size="sm" variant="secondary" onClick={() => go({ categoryId: r.category.id, status: 'open,in_progress,pending' })}>Ver os {r.count}</Btn></div>
              </article>
            ))}
            {data.pending > 0 && <p className="hm-note">Mais {data.pending} na mesma situação em Chamados.</p>}
          </section>

          <section aria-labelledby="carga">
            <h2 id="carga">Carga do time</h2>
            {people.length === 0 && <div className="hm-card"><p className="hm-note">Nenhum analista na sua equipe. A carga aparece quando o analista tem você como chefe.</p></div>}
            {people.map(p => (
              <article key={p.id} className="hm-card hm-load" data-over={over === p.id || undefined}
                onDragOver={acts ? e => { e.preventDefault(); setOver(p.id) } : undefined} onDragLeave={() => setOver(null)} onDrop={acts ? e => drop(e, p) : undefined}>
                <header>
                  <Avatar name={p.name} src={p.avatar} size={34} />
                  <b>{p.name}</b>
                  <span className="hm-when">{loadNote(p, people)}{p.late > 0 && ` · ${p.late} ${p.late === 1 ? 'vencido' : 'vencidos'}`}</span>
                </header>
                <div className="hm-blocks">
                  {[...p.tickets].sort((a, b) => ORDER[a.state] - ORDER[b.state]).map(t => (
                    <button key={t.id} type="button" data-state={t.state} draggable={acts} title={`${t.number} · ${t.title} (${STATE_LABEL[t.state]})`} aria-label={`${t.number}, ${t.title}, ${STATE_LABEL[t.state]}`}
                      onDragStart={e => e.dataTransfer.setData('text/isa-ticket', t.id)} onClick={() => onOpenTicket(t.id)} />
                  ))}
                  {p.active > p.tickets.length && <span className="hm-more">+{p.active - p.tickets.length} fora da sua carteira</span>}
                </div>
              </article>
            ))}
            {people.length > 0 && (
              <p className="hm-legend">
                <span data-state="ok">no prazo</span><span data-state="soon">vence em 4 h</span><span data-state="late">vencido</span><span data-state="paused">esperando</span>
                {acts && <em>Arraste um bloco para outra pessoa.</em>}
              </p>
            )}
          </section>
        </div>
      </div>
      <ForecastModal ticket={forecast} onClose={() => setForecast(null)} onSaved={() => { void load() }} />
    </div>
  )
}

const ORDER: Record<DeadlineState, number> = { ok: 0, soon: 1, late: 2, paused: 3 }

// Vencido em horas de expediente, como na lista de chamados.
function when(d: ShiftDecision, bh: BusinessHours | null): string {
  const at = new Date(d.deadline).getTime(), now = Date.now()
  if (d.state === 'late') { const ms = bh ? businessMsBetween(at, now, bh) : now - at; return ms < 60_000 ? 'acabou de vencer' : `venceu há ${span(ms)}` }
  if (d.state === 'soon') return `vence ${untilPhrase(d.deadline).replace(', até', ', às').replace(' até', ' às')}`
  return `sem dono ${ago(d.createdAt)}`
}
