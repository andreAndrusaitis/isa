import { useEffect, useRef, useState } from 'react'
import type { Ticket, TicketMessage } from '@/types'
import { ticketService } from '@/services/ticketService'
import { getSocket, joinTicketRoom, leaveTicketRoom } from '@/services/socketService'

/**
 * Mensagens do chamado aberto: carga inicial, sala do chamado no tempo real
 * (nova, editada, apagada, chamado atualizado) e recuperação do que se perdeu
 * numa reconexão. Extraído do TicketDetail sem mudar o comportamento.
 */
export function useTicketMessages(
  ticket: Ticket,
  { onTicketUpdate, onChatRead }: { onTicketUpdate: (id: string, updates: any) => void; onChatRead?: () => void },
) {
  const [messages, setMessages] = useState<TicketMessage[]>(ticket.messages || [])
  const [messagesLoaded, setMessagesLoaded] = useState(false)
  const hasConnectedRef = useRef(false)

  useEffect(() => {
    ticketService.getMessages(ticket.id)
      .then(msgs => { setMessages(msgs); setMessagesLoaded(true) })
      .catch(() => { setMessages(ticket.messages || []); setMessagesLoaded(true) })
    // Ticket opens with chat tab active — mark as read immediately
    onChatRead?.()
  }, [ticket.id])

  useEffect(() => {
    const socket = getSocket()
    if (!socket) return

    const handleMessage = (msg: any) => {
      setMessages(prev => {
        if (prev.some(m => m.id === msg.id)) return prev
        return [...prev, msg]
      })
    }

    const handleTicketUpdate = (updatedTicket: any) => {
      if (updatedTicket.id === ticket.id) {
        onTicketUpdate(ticket.id, updatedTicket)
      }
    }

    socket.on('ticket:message', handleMessage)
    socket.on('ticket:updated', handleTicketUpdate)

    const handleMessageUpdate = (msg: any) => {
      setMessages(prev => prev.map(m => m.id === msg.id ? msg : m))
    }

    const handleMessageDelete = (data: { messageId: string }) => {
      setMessages(prev => prev.filter(m => m.id !== data.messageId))
    }

    socket.on('ticket:message:updated', handleMessageUpdate)
    socket.on('ticket:message:deleted', handleMessageDelete)

    const doJoin = () => {
      joinTicketRoom(ticket.id)
      if (hasConnectedRef.current) {
        // reconexão — busca mensagens perdidas durante a janela de desconexão
        ticketService.getMessages(ticket.id)
          .then(msgs => setMessages(msgs))
          .catch(() => {})
      }
      hasConnectedRef.current = true
    }
    if (socket.connected) {
      doJoin()
    }
    socket.on('connect', doJoin)

    return () => {
      socket.off('ticket:message', handleMessage)
      socket.off('ticket:message:updated', handleMessageUpdate)
      socket.off('ticket:message:deleted', handleMessageDelete)
      socket.off('ticket:updated', handleTicketUpdate)
      socket.off('connect', doJoin)
      leaveTicketRoom(ticket.id)
      hasConnectedRef.current = false
    }
  }, [ticket.id])

  return { messages, setMessages, messagesLoaded }
}
