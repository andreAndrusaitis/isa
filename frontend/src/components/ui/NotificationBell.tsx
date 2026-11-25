import { useEffect, useRef, useState } from 'react'
import { BellItem } from '@/store/notifications'
import { Bell } from 'lucide-react'
import { notificationService } from '@/services/notificationService'
import '../pops.css'

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'agora'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}min`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  return `${Math.floor(diff / 86_400_000)}d`
}

const TYPE_LABEL: Record<BellItem['type'], string> = {
  new_message: 'Nova mensagem',
  new_attachment: 'Novo arquivo',
  ticket_assigned: 'Atribuído a você',
  ticket_queue_moved: 'Movido para sua fila',
  new_ticket: 'Novo chamado',
  ticket_redirected: 'Redirecionado por inatividade',
  ticket_schedule_reopened: 'Agendamento venceu',
  routing_alert: 'Alerta de regra',
  task_updated: 'Tarefa',
  project_forecast: 'Previsão de projeto',
}

interface Props {
  bellItems: BellItem[]
  onOpenTicket: (ticketId: string) => void
  onMarkRead: (ticketId: string) => void
  onMarkAllRead: () => void
  // Sino de Projetos troca as chamadas de API de chamado pelas de tarefa.
  markReadRemote?: (ticketId: string) => Promise<void>
  markAllReadRemote?: () => Promise<void>
}

export function NotificationBell({
  bellItems, onOpenTicket, onMarkRead, onMarkAllRead,
  markReadRemote = notificationService.markTicketRead,
  markAllReadRemote = notificationService.markAllRead,
}: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const count = bellItems.length

  async function handleMarkTicketRead(ticketId: string) {
    onMarkRead(ticketId)
    try { await markReadRemote(ticketId) } catch { /* silent */ }
  }

  async function handleMarkAllRead() {
    onMarkAllRead()
    setOpen(false)
    try { await markAllReadRemote() } catch { /* silent */ }
  }

  async function handleOpenTicket(ticketId: string) {
    await handleMarkTicketRead(ticketId)
    onOpenTicket(ticketId)
    setOpen(false)
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button type="button" className="icon-btn" onClick={() => setOpen((v) => !v)} aria-label="Notificações" style={{ position: 'relative' }}>
        <Bell size={16} aria-hidden="true" />
        {count > 0 && <span className="bell-count">{count > 99 ? '99+' : count}</span>}
      </button>

      {open && (
        <div className="pop bell-pop">
          <div className="bell-head">
            <span>
              Notificações
              {count > 0 && <small>{count} nova{count !== 1 ? 's' : ''}</small>}
            </span>
            {count > 0 && <button type="button" onClick={handleMarkAllRead}>Marcar todas como lidas</button>}
          </div>

          <div className="bell-list">
            {count === 0 ? (
              <p>Nenhuma notificação</p>
            ) : (
              bellItems.map((item) => (
                <button key={item.id} type="button" onClick={() => handleOpenTicket(item.ticketId)}>
                  <strong>{item.title}</strong>
                  <span>{item.body}</span>
                  <small>{TYPE_LABEL[item.type]} · #{item.ticketNumber} · {timeAgo(item.createdAt)}</small>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
