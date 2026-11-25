import type { ReactNode } from 'react'
import type { TaskActivityEvent } from '@/services/drillService'
import './projects.css'

const PRIORITY: Record<string, string> = { critical: 'Crítica', high: 'Alta', normal: 'Normal', low: 'Baixa', none: 'Sem prioridade' }
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : null)

const B = ({ children }: { children: ReactNode }) => <strong style={{ fontWeight: 600, color: 'var(--text-1)', overflowWrap: 'anywhere' }}>{children}</strong>

function change(what: string, from: ReactNode, to: ReactNode): ReactNode {
  if (from && to) return <>alterou {what} de <B>{from}</B> para <B>{to}</B></>
  if (to) return <>definiu {what} como <B>{to}</B></>
  if (from) return <>removeu {what} (era <B>{from}</B>)</>
  return <>alterou {what}</>
}

const list = (names: string[]) => names.join(', ')

/** O que aconteceu, sem o nome de quem fez (ele vem antes, na linha). */
export function activitySentence(e: TaskActivityEvent): ReactNode {
  const { from, to } = e
  switch (e.type) {
    case 'created': return 'criou a task'
    case 'status_changed': return from ? <>moveu de <B>{from}</B> para <B>{to}</B></> : <>moveu para <B>{to}</B></>
    case 'priority_changed': return change('a prioridade', PRIORITY[from ?? ''] ?? from, PRIORITY[to ?? ''] ?? to)
    case 'assignee_changed':
      if (from && to) return <>trocou o responsável de <B>{from}</B> para <B>{to}</B></>
      return to ? <>definiu <B>{to}</B> como responsável</> : <>removeu o responsável <B>{from}</B></>
    case 'assignees_changed': {
      const added = e.added ?? []
      const removed = e.removed ?? []
      if (added.length && removed.length) return <>adicionou <B>{list(added)}</B> e removeu <B>{list(removed)}</B> dos responsáveis</>
      if (added.length) return <>adicionou <B>{list(added)}</B> aos responsáveis</>
      if (removed.length) return <>removeu <B>{list(removed)}</B> dos responsáveis</>
      return 'alterou os responsáveis'
    }
    case 'due_date_changed': return change('o prazo', day(from), day(to))
    case 'start_date_changed': return change('o início', day(from), day(to))
    case 'title_changed': return <>renomeou de <B>{from}</B> para <B>{to}</B></>
    case 'description_changed': return 'alterou a descrição'
    case 'moved_list': return to ? <>moveu para a lista <B>{to}</B></> : 'tirou da lista'
    case 'task_type_changed': return change('o tipo', from, to)
    case 'sprint_changed': return to ? <>moveu para a sprint <B>{to}</B></> : <>tirou da sprint <B>{from}</B></>
    case 'story_points_changed': return change('os pontos', from, to)
    case 'milestone_changed': return to === 'true' ? 'marcou como ponto de controle' : 'desmarcou como ponto de controle'
    case 'checklist_changed':
      if (e.action === 'added') return <>adicionou ao checklist <B>{to}</B></>
      if (e.action === 'done') return <>concluiu no checklist <B>{to}</B></>
      if (e.action === 'reopened') return <>reabriu no checklist <B>{to}</B></>
      if (e.action === 'removed') return <>removeu do checklist <B>{to}</B></>
      return 'atualizou o checklist'
    case 'tag_changed': return to ? <>adicionou a tag <B>{to}</B></> : <>removeu a tag <B>{from}</B></>
    case 'dependency_changed': return to ? <>adicionou a dependência <B>{to}</B></> : <>removeu a dependência <B>{from}</B></>
    case 'relation_added': return <>relacionou com <B>{to}</B></>
    case 'relation_removed': return <>removeu a relação com <B>{from}</B></>
    case 'ticket_changed': return to ? <>vinculou o chamado <B>{to}</B></> : <>desvinculou o chamado <B>{from}</B></>
    case 'attachment_changed': return <>anexou <B>{to}</B></>
    case 'subtask_added': return <>criou a subtask <B>{to}</B></>
    case 'watcher_added': return e.actor.name === to ? 'passou a seguir a task' : <>incluiu <B>{to}</B> entre os seguidores</>
    case 'watcher_removed': return e.actor.name === from ? 'deixou de seguir a task' : <>tirou <B>{from}</B> dos seguidores</>
    case 'approval_requested': return <>pediu aprovação a <B>{to}</B></>
    case 'approval_decided': return to === 'approved' ? 'aprovou' : 'pediu alterações'
    case 'archived': return 'arquivou a task'
    case 'restored': return 'restaurou a task'
    default: return 'atualizou a task'
  }
}

/** "Hoje", "Ontem" ou a data por extenso. */
export function dayLabel(iso: string, now = new Date()) {
  const d = new Date(iso)
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((start(now) - start(d)) / 86_400_000)
  if (diff === 0) return 'Hoje'
  if (diff === 1) return 'Ontem'
  const text = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

export type FeedItem<C> =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'event'; key: string; event: TaskActivityEvent }
  | { kind: 'comment'; key: string; comment: C }

/**
 * Comentários e eventos numa fila só, do mais antigo ao mais novo, com um divisor
 * por dia. "commented" sai do histórico: o próprio comentário já aparece.
 */
export function buildFeed<C extends { id: string; createdAt?: string | null }>(comments: C[], events: TaskActivityEvent[], now = new Date()): Array<FeedItem<C>> {
  const items = [
    ...comments.map((comment) => ({ at: comment.createdAt ?? '', item: { kind: 'comment' as const, key: `c-${comment.id}`, comment } })),
    ...events.filter((e) => e.type !== 'commented').map((event) => ({ at: event.createdAt, item: { kind: 'event' as const, key: `e-${event.id}`, event } })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  const feed: Array<FeedItem<C>> = []
  let last = ''
  for (const { at, item } of items) {
    const label = at ? dayLabel(at, now) : ''
    if (label && label !== last) {
      feed.push({ kind: 'day', key: `d-${label}`, label })
      last = label
    }
    feed.push(item)
  }
  return feed
}

export function DayDivider({ label }: { label: string }) {
  return <div role="separator" aria-label={label} className="tk-day">{label}</div>
}

/** Uma linha do histórico: "14:32 André moveu de Em Andamento para QA". */
export function ActivityLine({ event }: { event: TaskActivityEvent }) {
  return (
    <div className="tk-log">
      <time dateTime={event.createdAt} title={new Date(event.createdAt).toLocaleString('pt-BR')}>{timeOf(event.createdAt)}</time>
      <div style={{ minWidth: 0 }}><B>{event.actor.name}</B> {activitySentence(event)}</div>
    </div>
  )
}
