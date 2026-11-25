/**
 * Skadi, a assistente de chamados no portal do solicitante. Mesmo
 * componente no navegador e na aba do Teams: botão com o rosto dela que abre um painel lateral
 * (tela cheia no celular). A conversa fica no estado do componente e no
 * sessionStorage (some ao fechar a aba). Escrita (abrir, responder, reabrir)
 * só depois de a pessoa clicar em Confirmar no card.
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, useLayoutEffect } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, RotateCcw, Send, X } from 'lucide-react'
import { Btn, SkadiAvatar } from '@/components/ui'
import { apiErrorMessage } from '@/services/api'
import { assistantService, type AssistantChatInput, type AssistantMessage, type AssistantSource, type PendingAction } from '@/services/assistantService'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { isTeamsHost, openInTeams } from '@/teams/teamsContext'
import { SKADI_NAME, SKADI_TAGLINE } from '@/utils/skadi'

export const SUGGESTIONS = ['Minha impressora não imprime', 'Ver meus chamados']
/** O servidor usa as últimas 20 mensagens; mandamos só elas. */
export const HISTORY_LIMIT = 20
const MAX_CHARS = 4000
const STORAGE_PREFIX = 'isa-assistant:'

export interface ChatItem {
  id: string
  role: 'user' | 'assistant'
  content: string
  pending?: PendingAction
  /** open = aguardando; done = confirmada; cancelled = cancelada ou vencida por mensagem nova. */
  pendingState?: 'open' | 'done' | 'cancelled'
  sources?: AssistantSource[]
  ticket?: { id: string; numero: string }
}

interface Stored { conversationId: string; items: ChatItem[] }

const newId = () => {
  try { return crypto.randomUUID() } catch { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` }
}

function load(key: string): Stored | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const data = JSON.parse(raw) as Stored
    return typeof data?.conversationId === 'string' && Array.isArray(data.items) ? data : null
  } catch { return null }
}

function save(key: string, data: Stored) {
  try { sessionStorage.setItem(key, JSON.stringify(data)) } catch { /* armazenamento bloqueado: só em memória */ }
}

function clearStored(key: string) {
  try { sessionStorage.removeItem(key) } catch { /* idem */ }
}

export function toHistory(items: ChatItem[]): AssistantMessage[] {
  return items.slice(-HISTORY_LIMIT).map(i => ({ role: i.role, content: i.content }))
}

/** Link externo (Microsoft Learn): no Teams abre pelo Teams, que bloqueia popup do iframe. */
function SourceLink({ source }: { source: AssistantSource }) {
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => {
        if (!isTeamsHost()) return
        e.preventDefault()
        void openInTeams(source.url).then(ok => { if (!ok) window.open(source.url, '_blank', 'noopener') })
      }}
      className="isa-turn-link"
    >
      {source.title}
      <ExternalLink size={12} aria-hidden="true" style={{ flexShrink: 0 }} />
      <span className="isa-sr-only">(abre em nova janela)</span>
    </a>
  )
}

/** Uma fala: autor em cima, texto corrido. A da pessoa vem recuada, em faixa clara. */
function Turn({ item, busy, onConfirm, onCancel }: {
  item: ChatItem
  busy: boolean
  onConfirm: (item: ChatItem) => void
  onCancel: (item: ChatItem) => void
}) {
  const mine = item.role === 'user'
  return (
    <li className={mine ? 'isa-turn mine' : 'isa-turn'}>
      <div className="isa-turn-author">{mine ? 'Você' : SKADI_NAME}</div>
      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{item.content}</div>

      {!!item.sources?.length && (
        <div style={{ marginTop: 10 }}>
          <span className="isa-turn-author">Fontes</span>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
            {item.sources.map(s => <li key={s.url}><SourceLink source={s} /></li>)}
          </ul>
        </div>
      )}

      {item.pending && item.pendingState === 'open' && (
        <div role="group" aria-label={`Confirmar ação da ${SKADI_NAME}`} className="notice" style={{ marginTop: 12, color: 'var(--text-1)' }}>
          <div className="isa-turn-author">Confirma esta ação?</div>
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{item.pending.summary}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <Btn size="sm" disabled={busy} onClick={() => onConfirm(item)} style={{ minHeight: 36 }}>Confirmar</Btn>
            <Btn size="sm" variant="ghost" disabled={busy} onClick={() => onCancel(item)} style={{ minHeight: 36 }}>Cancelar</Btn>
          </div>
        </div>
      )}
      {item.pending && item.pendingState === 'cancelled' && (
        <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text-3)' }}>Ação não executada.</div>
      )}

      {item.ticket && (
        <Link to={`/c/${encodeURIComponent(item.ticket.id)}`} className="isa-turn-link" style={{ display: 'inline-block', marginTop: 8 }}>
          Ver chamado {item.ticket.numero}
        </Link>
      )}
    </li>
  )
}

/** onTicketChange: chamado aberto ou alterado pela Skadi — a tela de trás recarrega a lista. */
export function AssistantPanel({ userId, onClose, onTicketChange }: { userId: string; onClose: () => void; onTicketChange?: () => void }) {
  const storageKey = `${STORAGE_PREFIX}${userId}`
  const isMobile = useMediaQuery('(max-width: 640px)')
  const titleId = useId()
  const inputId = useId()
  const [state, setState] = useState<Stored>(() => load(storageKey) ?? { conversationId: newId(), items: [] })
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState<{ payload: AssistantChatInput; message: string } | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft])
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { save(storageKey, state) }, [storageKey, state])
  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state.items.length, loading, failed])

  const request = useCallback(async (payload: AssistantChatInput) => {
    setLoading(true)
    setFailed(null)
    try {
      const reply = await assistantService.chat(payload)
      if (reply.ticket) onTicketChange?.()
      setState(s => ({
        ...s,
        items: [...s.items, {
          id: newId(), role: 'assistant', content: reply.text,
          ...(reply.pending ? { pending: reply.pending, pendingState: 'open' as const } : {}),
          ...(reply.sources?.length ? { sources: reply.sources } : {}),
          ...(reply.ticket ? { ticket: reply.ticket } : {}),
        }],
      }))
    } catch (err) {
      setFailed({ payload, message: apiErrorMessage(err, `Não foi possível falar com a ${SKADI_NAME} agora.`) })
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }, [onTicketChange])

  const send = useCallback((text: string, confirm?: { item: ChatItem; pending: PendingAction }) => {
    const message = text.trim().slice(0, MAX_CHARS)
    if (!message || loading) return
    const history = toHistory(state.items)
    setState(s => ({
      ...s,
      items: [
        // Mensagem nova vence a pendência aberta; a confirmada fica marcada como feita.
        ...s.items.map(i => (i.pendingState === 'open'
          ? { ...i, pendingState: confirm && i.id === confirm.item.id ? 'done' as const : 'cancelled' as const }
          : i)),
        { id: newId(), role: 'user', content: message },
      ],
    }))
    setDraft('')
    void request({ message, history, conversationId: state.conversationId, ...(confirm ? { confirm: confirm.pending } : {}) })
  }, [loading, request, state.conversationId, state.items])

  const confirmAction = (item: ChatItem) => { if (item.pending) send('Confirmar', { item, pending: item.pending }) }
  const cancelAction = (item: ChatItem) => setState(s => ({
    ...s,
    items: [
      ...s.items.map(i => (i.id === item.id ? { ...i, pendingState: 'cancelled' as const } : i)),
      { id: newId(), role: 'user', content: 'Cancelar' },
      { id: newId(), role: 'assistant', content: 'Tudo bem, não fiz nada. Posso ajudar com mais alguma coisa?' },
    ],
  }))

  const restart = () => {
    clearStored(storageKey)
    setState({ conversationId: newId(), items: [] })
    setFailed(null)
    setDraft('')
    inputRef.current?.focus()
  }

  const onPanelKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose() }
  }
  const onInputKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send(draft)
    }
  }

  const empty = state.items.length === 0

  return (
    <section
      role="dialog"
      aria-modal={isMobile}
      aria-labelledby={titleId}
      onKeyDown={onPanelKey}
      className="isa-assistant-panel"
      style={{
        position: 'fixed', zIndex: 900, display: 'flex', flexDirection: 'column',
        background: 'var(--bg-card)', color: 'var(--text-1)', fontFamily: 'var(--font)',
        ...(isMobile
          ? { inset: 0 }
          : {
            top: 'var(--topbar-height)', right: 0, bottom: 0, width: 'min(440px, 100vw)', borderLeft: '1px solid var(--border-strong)', boxShadow: 'var(--pop-shadow)',
          }),
      }}
    >
      <style>{`
        .isa-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
        .isa-assistant-panel button:focus-visible, .isa-assistant-panel a:focus-visible, .isa-assistant-panel textarea:focus-visible {
          outline: 2px solid var(--accent); outline-offset: 2px;
        }
        .isa-assistant-panel { animation: isa-assistant-in .16s ease-out; }
        @keyframes isa-assistant-in { from { opacity: 0; transform: translateX(20px) } to { opacity: 1; transform: none } }
        .isa-assistant-panel .isa-assistant-composer textarea:focus-visible { outline: none; }
        .isa-turn { list-style: none; padding: 16px 0; border-top: 1px solid var(--border); font-size: 14px; line-height: 1.55; }
        .isa-turn:first-child { border-top: 0; }
        .isa-turn.mine { margin-left: 40px; padding: 12px 16px; border-top: 0; background: var(--tint); }
        .isa-turn.mine + .isa-turn { border-top: 0; }
        .isa-turn-author { display: block; margin-bottom: 3px; font-size: 13px; color: var(--text-3); }
        .isa-turn-link { font-size: 14px; color: var(--accent-fg); text-decoration: underline; text-underline-offset: 2px; word-break: break-word; }
        .isa-turn-link svg { margin-left: 4px; vertical-align: -1px; }
        .isa-assistant-ask { display: block; width: 100%; min-height: 44px; padding: 0; border: 0; border-top: 1px solid var(--border); background: none; text-align: left; font: 400 14px var(--font); color: var(--accent-fg); cursor: pointer; }
        .isa-assistant-ask:hover { background: var(--hover-overlay); }
        @media (prefers-reduced-motion: reduce) { .isa-assistant-panel { animation: none } }
      `}</style>

      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 14px 16px 24px', borderBottom: '1px solid var(--rule)', paddingTop: isMobile ? 'max(16px, env(safe-area-inset-top))' : 16 }}>
        <SkadiAvatar size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 id={titleId} style={{ fontSize: 18, fontWeight: 500, margin: 0, color: 'var(--text-1)' }}>{SKADI_NAME}</h2>
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{SKADI_TAGLINE}</div>
        </div>
        <button type="button" onClick={restart} aria-label="Nova conversa" title="Nova conversa" disabled={loading || empty} className="icon-act" style={loading || empty ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}>
          <RotateCcw size={16} aria-hidden="true" />
        </button>
        <button type="button" onClick={onClose} aria-label={`Fechar conversa com a ${SKADI_NAME}`} title="Fechar" className="icon-act">
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 24px' }}>
        {empty && !loading && (
          <div style={{ padding: '12px 0', fontSize: 14, lineHeight: 1.55, color: 'var(--text-2)' }}>
            <div style={{ fontSize: 22, fontWeight: 500, lineHeight: 1.25, letterSpacing: '-0.02em', color: 'var(--text-1)' }}>Olá! Eu sou a {SKADI_NAME}.</div>
            <div style={{ margin: '4px 0 10px', fontSize: 16, color: 'var(--text-1)' }}>Como posso ajudar?</div>
            <p style={{ margin: '0 0 20px' }}>Sou a assistente de IA do ISA. Descreva o problema: eu procuro a solução e, se precisar, abro o chamado com você.</p>
            {SUGGESTIONS.map(s => <button key={s} type="button" className="isa-assistant-ask" onClick={() => send(s)}>{s}</button>)}
          </div>
        )}

        <ol role="log" aria-live="polite" aria-relevant="additions" aria-label={`Conversa com a ${SKADI_NAME}`} style={{ margin: 0, padding: 0 }}>
          {state.items.map(item => (
            <Turn key={item.id} item={item} busy={loading} onConfirm={confirmAction} onCancel={cancelAction} />
          ))}
        </ol>

        {loading && <div role="status" style={{ padding: '14px 0', fontSize: 13, color: 'var(--text-3)' }}>{SKADI_NAME} está digitando…</div>}

        {failed && !loading && (
          <div role="alert" className="notice" style={{ color: 'var(--danger)' }}>
            {failed.message}
            <div style={{ marginTop: 10 }}><Btn size="sm" variant="secondary" onClick={() => void request(failed.payload)}>Tentar de novo</Btn></div>
          </div>
        )}
      </div>

      <form
        onSubmit={e => { e.preventDefault(); send(draft) }}
        style={{ padding: '14px 24px', paddingBottom: isMobile ? 'max(14px, env(safe-area-inset-bottom))' : 20 }}
      >
        <label htmlFor={inputId} className="isa-sr-only">Mensagem para a {SKADI_NAME}</label>
        <div className="isa-assistant-composer" style={{ display: 'flex', alignItems: 'flex-end', gap: 6, padding: '4px 4px 4px 8px', background: 'var(--bg-input)', borderBottom: '1px solid var(--field-line)' }}>
          <textarea
            id={inputId}
            ref={inputRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={onInputKey}
            rows={1}
            maxLength={MAX_CHARS}
            placeholder={`Mensagem para a ${SKADI_NAME}…`}
            style={{
              flex: 1, minWidth: 0, resize: 'none', maxHeight: 120, padding: '8px 4px', border: 'none', outline: 'none',
              background: 'transparent', color: 'var(--text-1)', fontFamily: 'var(--font)',
              fontSize: isMobile ? 16 : 14, lineHeight: 1.4,
            }}
          />
          <Btn type="submit" aria-label="Enviar mensagem" disabled={loading || !draft.trim()} style={{ width: 36, minWidth: 36, height: 36, minHeight: 36, padding: 0, flexShrink: 0 }}>
            <Send size={16} aria-hidden="true" />
          </Btn>
        </div>
      </form>
    </section>
  )
}

/** Botão flutuante da Skadi + painel. Fechar devolve o foco ao botão. */
export function AssistantLauncher({ userId, onTicketChange }: { userId: string; onTicketChange?: () => void }) {
  const [open, setOpen] = useState(false)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)

  useEffect(() => {
    if (wasOpen.current && !open) launcherRef.current?.focus()
    wasOpen.current = open
  }, [open])

  return (
    <>
      {!open && (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={false}
          style={{
            position: 'fixed', right: 20, bottom: 'max(20px, env(safe-area-inset-bottom))', zIndex: 900,
            display: 'inline-flex', alignItems: 'center', gap: 10, minHeight: 48, padding: '6px 18px 6px 12px',
            border: 0, borderRadius: 99, background: 'var(--bg-card)', color: 'var(--text-1)',
            fontFamily: 'var(--font)', fontSize: 15, fontWeight: 600, cursor: 'pointer', boxShadow: 'var(--pop-shadow)',
          }}
        >
          <SkadiAvatar size={32} decorative />
          {SKADI_NAME}
        </button>
      )}
      {open && <AssistantPanel userId={userId} onClose={() => setOpen(false)} onTicketChange={onTicketChange} />}
    </>
  )
}
