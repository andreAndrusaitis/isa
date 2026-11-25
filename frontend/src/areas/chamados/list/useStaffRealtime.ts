/**
 * Tempo real da lista de chamados da equipe: avisos de mensagem nova, sino,
 * alertas de fila, chamado criado/alterado/apagado e (só analista, hoje) "minhas
 * filas mudaram". Antes era copiado em AgentPage e SupervisorPage.
 * Na limpeza desliga só os próprios ouvintes (listenAll).
 */
import { useEffect, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { Ticket } from '@/types'
import { connectSocket, listenAll } from '@/services/socketService'
import { useNotificationsStore } from '@/store/notifications'
import { useAuthStore } from '@/store/auth'
import { playNotificationSound } from '@/components/ui/MessageNotificationPopup'
import { showBrowserNotification } from '@/utils/browserNotification'

export function useStaffRealtime({ accessToken, userId, selectedRef, reloadListRef, setTickets, setSelected, syncMyQueues }: {
  accessToken: string | null
  userId: string
  selectedRef: MutableRefObject<Ticket | null>
  reloadListRef: MutableRefObject<() => void>
  setTickets: Dispatch<SetStateAction<Ticket[]>>
  setSelected: Dispatch<SetStateAction<Ticket | null>>
  /** Atualiza as filas da sessão quando o cadastro muda (hoje só o analista). */
  syncMyQueues: boolean
}) {
  const { addNotification, addBellItem, addBellPopup } = useNotificationsStore()

  useEffect(() => {
    if (!accessToken) return
    const socket = connectSocket(accessToken)
    const listeners = listenAll(socket)

    // Toast popup para novas mensagens
    listeners.on('ticket:new_message', (data: {
      ticketId: string; ticketNumber: string; title: string; senderName: string; text: string; type: string
    }) => {
      if (selectedRef.current?.id === data.ticketId) return
      addNotification({ ticketId: data.ticketId, ticketNumber: data.ticketNumber, title: data.title, senderName: data.senderName, text: data.text })
      showBrowserNotification(`Nova mensagem — ${data.title}`, `${data.senderName}: ${data.text}`, data.ticketId)
    })

    // Sino persistente — todos os tipos de notificação
    listeners.on('notification:new', (data: {
      id: string; ticketId: string; ticketNumber: string; type: any; title: string; body: string; senderName: string | null; createdAt: string
    }) => {
      addBellItem({ id: data.id, ticketId: data.ticketId, ticketNumber: data.ticketNumber, type: data.type, title: data.title, body: data.body, senderName: data.senderName, createdAt: data.createdAt })
      // Popup para atribuição e alerta de regra ("Notificar fila/usuário"); new_ticket/ticket_queue_moved vêm via ticket:queue_alert
      if (data.type === 'ticket_assigned' || data.type === 'routing_alert') {
        playNotificationSound()
        showBrowserNotification(data.title, data.body, data.ticketId)
        addBellPopup({ id: data.id, ticketId: data.ticketId, ticketNumber: data.ticketNumber, type: data.type, title: data.title, body: data.body })
      }
    })

    // Alerta de fila — popup imediato
    listeners.on('ticket:queue_alert', (data: {
      ticketId: string; ticketNumber: string; type: 'new_ticket' | 'ticket_queue_moved'; title: string; body: string
    }) => {
      playNotificationSound()
      showBrowserNotification(data.title, data.body, data.ticketId)
      addBellPopup({ id: `qa-${data.ticketId}-${Date.now()}`, ticketId: data.ticketId, ticketNumber: data.ticketNumber, type: data.type, title: data.title, body: data.body })
    })

    listeners.on('ticket:created', () => reloadListRef.current())

    listeners.on('ticket:updated', (updatedTicket: Ticket) => {
      // Atualiza a linha na hora (mantendo latestMessage da listagem) e refaz a página
      setTickets(prev => prev.map(t => (t.id === updatedTicket.id ? { ...t, ...updatedTicket } : t)))
      reloadListRef.current()
      setSelected(current => (current && current.id === updatedTicket.id ? { ...current, ...updatedTicket } : current))
    })

    listeners.on('ticket:deleted', ({ id }: { id: string }) => {
      setTickets(prev => prev.filter(t => t.id !== id))
      reloadListRef.current()
      setSelected(current => (current?.id === id ? null : current))
    })

    // Minhas filas mudaram (cadastro do usuário ou tela de Filas): atualiza sem novo login
    if (syncMyQueues) {
      listeners.on('user:updated', ({ user: u }: { user?: { id?: string; queues?: string[] } }) => {
        if (u?.id !== userId || !Array.isArray(u.queues)) return
        const queues = u.queues
        useAuthStore.setState(s => (s.user ? { user: { ...s.user, queues } } : {}))
        reloadListRef.current()
      })
    }
    return () => listeners.off()
  }, [accessToken, userId]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** Alerta "chamado reaberto" para quem é responsável, colaborador ou da fila sem responsável. */
export function useReopenedAlert(accessToken: string | null, userId: string, queues: { id: string }[]) {
  const [reopenedAlert, setReopenedAlert] = useState<{ show: boolean; ticketId: string; title: string } | null>(null)
  useEffect(() => {
    if (!accessToken) return
    const socket = connectSocket(accessToken)
    const handleUpdated = (updatedTicket: Ticket) => {
      if (
        updatedTicket.is_reopened &&
        (updatedTicket.assignedToId === userId ||
          updatedTicket.participants?.some(p => p.agentId === userId && p.active && p.role === 'collaborator') ||
          (!updatedTicket.assignedToId && queues.some(q => q.id === updatedTicket.queue)))
      ) {
        setReopenedAlert({ show: true, ticketId: updatedTicket.id, title: updatedTicket.title })
      }
    }
    socket.on('ticket:updated', handleUpdated)
    return () => { socket.off('ticket:updated', handleUpdated) }
  }, [accessToken, userId, queues])
  return [reopenedAlert, setReopenedAlert] as const
}
