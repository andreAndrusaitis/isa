/**
 * Linha da lista de chamados (admin, equipe e portal): número, assunto com o contexto
 * embaixo, situação, prioridade, responsável e prazo. O desenho fica em list.css.
 */
import { Fragment, type ReactNode } from 'react'
import { Avatar, PriorityBadge, SortHeader, StatusBadge, TruncatedText } from '@/components/ui'
import './list.css'
import type { SortDir } from '@/hooks/useTableSort'

const TYPE_LABEL: Record<string, string> = { incident: 'Incidente', request: 'Requisição', problem: 'Problema', change: 'Mudança' }

type Column<K extends string> = [key: K, label: string]

/** Cabeçalho alinhado às colunas. `main`: número e assunto. Sem chave, a coluna não ordena. */
export function TicketRowsHeader<K extends string>({ className, number, subject, status, priority, owner, due, header }: {
  className: string
  number: Column<K>
  subject: Column<K>
  status: Column<K>
  priority?: K
  /** Responsável (equipe) ou data (cliente). */
  owner?: Column<K>
  due: Column<K>
  header: (key: K) => { dir: SortDir | null; onClick: () => void }
}) {
  const col = ([key, label]: Column<K>) => <div><SortHeader label={label} {...header(key)} /></div>
  return (
    <div className={`tl-head ${className}`} data-plain={!priority || undefined}>
      {col(number)}{col(subject)}{col(status)}
      {priority && col([priority, 'Prioridade'])}
      {owner ? col(owner) : <div>Responsável</div>}
      {col(due)}
    </div>
  )
}

export function TicketRow({ className, status, number, title, type, meta, unread = 0, priority, deadline, owner, ownerName, done, onOpen }: {
  className: string
  status: string
  number?: ReactNode
  title: string
  type: string
  /** Contexto embaixo do assunto; os vazios somem. */
  meta: ReactNode[]
  unread?: number
  /** Ausente para o cliente: prioridade é linguagem de quem atende. */
  priority?: string
  deadline: ReactNode
  owner: ReactNode
  /** Responsável: desenha o avatar. */
  ownerName?: string
  done?: boolean
  onOpen: () => void
}) {
  return (
    <div className={`tl-row ${className}`} onClick={onOpen} data-done={done || undefined} data-unread={unread > 0 || undefined} data-plain={!priority || undefined}>
      <div className="tl-id"><span>{number}</span><small>{TYPE_LABEL[type] ?? TYPE_LABEL.incident}</small></div>
      <div className="tl-main">
        <div className="tl-title">
          <TruncatedText text={title} />
          {unread > 0 && <span className="tl-new" title="Nova mensagem">{unread} {unread === 1 ? 'nova' : 'novas'}</span>}
        </div>
        <div className="tl-meta">{meta.map((m, i) => m ? <Fragment key={i}>{m}</Fragment> : null)}</div>
      </div>
      <div><StatusBadge status={status} /></div>
      {priority && <div><PriorityBadge priority={priority} /></div>}
      <div className="tl-owner">{ownerName && <span aria-hidden><Avatar name={ownerName} size={30} /></span>}<span>{owner}</span></div>
      <div className="tl-due">{deadline}</div>
    </div>
  )
}
