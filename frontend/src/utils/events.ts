import { Ticket } from '@/types'

export type TicketUpdateEvent = Partial<Ticket> & { ticketId: string }

const channel = new BroadcastChannel('ticket-updates')

export const events = {
  dispatchTicketUpdate(data: TicketUpdateEvent) {
    // Dispatch locally
    window.dispatchEvent(new CustomEvent('ticket-updated', { detail: data }))
    // Dispatch to other tabs
    channel.postMessage(data)
  },
  
  onTicketUpdate(handler: (data: TicketUpdateEvent) => void) {
    const wrapper = (e: any) => handler(e.detail || e.data)
    
    // Listen to local events
    window.addEventListener('ticket-updated', wrapper)
    // Listen to other tabs
    channel.addEventListener('message', wrapper)
    
    return () => {
      window.removeEventListener('ticket-updated', wrapper)
      channel.removeEventListener('message', wrapper)
    }
  }
}
