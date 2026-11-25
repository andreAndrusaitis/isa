/**
 * Início do cliente: boas-vindas com o pedido de ajuda, números dos chamados, assuntos
 * em cartões e o andamento, com o que depende da pessoa em primeiro lugar.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, CircleDot, Hourglass, MessageCircleReply, Play } from 'lucide-react'
import { Btn, Figures, Loading, Modal, Field, StatCard, StatusBadge, Txta } from '@/components/ui'
import { CategoryCard } from '@/areas/solicitacoes/categoryIcon'
import { ticketService } from '@/services/ticketService'
import { apiErrorMessage } from '@/services/api'
import { toast } from '@/store/toastStore'
import type { AuthUser } from '@/store/auth'
import type { Ticket } from '@/types'
import { ago, clientForecast } from './clock'
import { RequestSteps } from './RequestSteps'
import './home.css'
import './client.css'

/** Separa o que depende da pessoa do que está com a equipe. */
export function splitRequests(tickets: Ticket[]): { needs: Ticket[]; moving: Ticket[] } {
  const needs = tickets.filter(t => (t.status === 'pending' && t.pendingReason === 'pending_user') || (t.status === 'resolved' && t.canReopen))
  return { needs, moving: tickets.filter(t => !needs.includes(t) && !['resolved', 'closed'].includes(t.status)) }
}

/** Facetas do símbolo da ISA, em escala de cartaz. */
function HeroArt() {
  return (
    <svg className="cl-art" viewBox="0 0 300 260" aria-hidden="true">
      <g transform="translate(70 -20) scale(1.75)">
        <path fill="var(--login-glow)" d="M76 0 44 32V90.4L76 122.4Z" />
        <path fill="var(--login-glow)" opacity=".7" d="M84 41.6 116 73.6V132L84 164Z" />
        <path fill="var(--login-accent)" d="M84 0 116 32V62.4L84 30.4Z" />
        <path fill="var(--login-accent)" opacity=".85" d="M44 101.6 76 133.6V164L44 132Z" />
      </g>
    </svg>
  )
}

export function ClientHome({ user, categories, counts = {}, disabled, reloadKey, onConfirmed, onAsk, onOpen, onFilter }: {
  user: Pick<AuthUser, 'name' | 'id'>
  categories: any[]
  /** Contadores do servidor por situação (`status_open`…). */
  counts?: Record<string, number>
  /** Contrato vencido: não abre chamado novo. */
  disabled?: boolean
  /** Muda quando chega novidade: recarrega a lista sem perder o que está sendo escrito. */
  reloadKey?: number
  /** Depois de confirmar que resolveu (a pesquisa vem aí). */
  onConfirmed?: () => void
  onAsk: (start: { text?: string; category?: string }) => void
  onOpen: (t: Ticket) => void
  /** Número clicado: abre a lista naquela situação. */
  onFilter?: (status: string) => void
}) {
  const [text, setText] = useState('')
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const [asked, setAsked] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [reopen, setReopen] = useState<Ticket | null>(null)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await ticketService.getTicketsPage({ page: 1, pageSize: 30, status: 'active,resolved', sort: 'portal', dir: 'asc' })
      setTickets(r.data)
    } catch {
      setTickets(cur => cur ?? [])
      toast.error('Não foi possível carregar os seus chamados.')
    }
  }, [])
  useEffect(() => { void load() }, [load, reloadKey])

  const ask = (e: FormEvent) => { e.preventDefault(); if (text.trim() && !disabled) onAsk({ text: text.trim() }) }

  async function confirm(t: Ticket) {
    setBusy(t.id)
    try {
      await ticketService.confirmResolution(t.id)
      toast.success('Obrigado por confirmar. Chamado encerrado.')
      onConfirmed?.()
      await load()
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível confirmar agora.'))
    } finally {
      setBusy(null)
    }
  }
  async function sendReopen() {
    if (!reopen || reason.trim().length < 10) return
    setBusy(reopen.id)
    try {
      await ticketService.reopenTicket(reopen.id, reason.trim())
      toast.success('A equipe voltou a cuidar do seu chamado.')
      setReopen(null); setReason('')
      await load()
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível reabrir o chamado.'))
    } finally {
      setBusy(null)
    }
  }

  const { needs, moving } = splitRequests(tickets ?? [])
  // A pergunta da equipe, para responder sem precisar abrir e procurar.
  const waiting = needs.filter(t => t.status === 'pending').slice(0, 5).map(t => t.id).join()
  useEffect(() => {
    if (!waiting) return
    let alive = true
    for (const id of waiting.split(',')) {
      ticketService.getMessages(id).then(list => {
        const last = [...list].reverse().find(m => m.type === 'agent' && m.userId !== user.id && m.text?.trim())
        if (alive && last) setAsked(a => ({ ...a, [id]: `${last.user?.name?.split(' ')[0] ?? 'Equipe'}: ${last.text.slice(0, 220)}` }))
      }).catch(() => {})
    }
    return () => { alive = false }
  }, [waiting, user.id])

  const n = (...keys: string[]) => keys.reduce((s, k) => s + (counts[`status_${k}`] ?? 0), 0)

  return (
    <div className="hm">
      <div className="cl">
        <section className="cl-hero">
          <div>
            <p>Olá, {user.name.split(' ')[0]}</p>
            <h1>Como podemos ajudar?</h1>
            <form className="cl-ask" onSubmit={ask}>
              <input aria-label="Conte o que aconteceu" maxLength={500} value={text} disabled={disabled} onChange={e => setText(e.target.value)} placeholder="Ex.: não consigo acessar a VPN" />
              <Btn type="submit" size="lg" disabled={disabled || !text.trim()}>Pedir ajuda</Btn>
            </form>
          </div>
          <HeroArt />
        </section>

        <Figures>
          <StatCard icon={MessageCircleReply} label="Aguardando você" value={n('pending')} tone={n('pending') ? 'soon' : 'calm'} onClick={() => onFilter?.('pending')} />
          <StatCard icon={CircleDot} label="Abertos" value={n('open')} onClick={() => onFilter?.('open')} />
          <StatCard icon={Play} label="Em andamento" value={n('in_progress')} tone="alt" onClick={() => onFilter?.('in_progress')} />
          <StatCard icon={CheckCircle2} label="Resolvidos" value={n('resolved', 'closed')} tone="ok" onClick={() => onFilter?.('resolved')} />
        </Figures>

        {needs.length > 0 && (
          <section aria-labelledby="precisa">
            <h2 id="precisa">Precisa de você</h2>
            <div className="cl-needs">
              {needs.map(t => (
                <article key={t.id} className="cl-need">
                  <header><StatusBadge status={t.status} compact /><time>{ago(t.updatedAt)}</time></header>
                  <button type="button" className="hm-title" onClick={() => onOpen(t)}>{t.title}</button>
                  <p>{t.status === 'resolved' ? (t.resolution_details?.slice(0, 180) || 'A equipe diz que resolveu.') : asked[t.id] ?? 'A equipe perguntou algo e espera a sua resposta.'}</p>
                  <div className="hm-actions">
                    {t.status === 'resolved' ? <>
                      <Btn size="sm" disabled={busy === t.id} onClick={() => void confirm(t)}>Resolveu</Btn>
                      <Btn size="sm" variant="secondary" onClick={() => { setReopen(t); setReason('') }}>Ainda não</Btn>
                    </> : <Btn size="sm" onClick={() => onOpen(t)}>Responder</Btn>}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {!disabled && categories.length > 0 && (
          <section aria-labelledby="assuntos">
            <h2 id="assuntos">Escolha um assunto</h2>
            <div className="cl-cats">
              {categories.map((c: any) => <CategoryCard key={c.id} category={c} onPick={() => onAsk({ text: text.trim() || undefined, category: c.id })} />)}
            </div>
          </section>
        )}

        <section aria-labelledby="andando">
          <h2 id="andando">Em andamento<Link to="/solicitacoes/todas">Ver todos os chamados</Link></h2>
          {!tickets ? <Loading size="compact" label="Carregando os seus chamados…" /> : moving.length === 0
            ? <div className="cl-move"><p className="hm-note">{needs.length ? 'Nada mais com a equipe agora.' : 'Nenhum chamado em andamento.'}</p></div>
            : (
              <div className="cl-moves">
                {moving.slice(0, 6).map(t => (
                  <button key={t.id} type="button" className="cl-move" onClick={() => onOpen(t)}>
                    <span className="cl-move-head"><small>{t.displayNumber}</small><StatusBadge status={t.status} compact /></span>
                    <b>{t.title}</b>
                    <RequestSteps status={t.status} />
                    <span className="cl-when"><Hourglass size={14} aria-hidden />{clientForecast(t).text}</span>
                  </button>
                ))}
              </div>
            )}
        </section>
      </div>

      <Modal isOpen={!!reopen} onClose={() => setReopen(null)} title="O que ainda acontece?" width={440}
        footer={<><Btn variant="ghost" onClick={() => setReopen(null)}>Cancelar</Btn><Btn disabled={reason.trim().length < 10 || !!busy} onClick={sendReopen}>Enviar para a equipe</Btn></>}>
        <Field label="Conte em uma frase (mínimo de 10 letras)"><Txta value={reason} onChange={e => setReason(e.target.value)} rows={4} maxLength={1000} autoFocus /></Field>
      </Modal>
    </div>
  )
}
