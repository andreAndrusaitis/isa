import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

// Toast temporário (auto-dismiss)
export interface MessageNotification {
  id: string
  ticketId: string
  ticketNumber: string
  title: string
  senderName: string
  text: string
  timestamp: number
}

// Item persistente do sino (vem do banco via API ou socket)
export interface BellItem {
  id: string
  ticketId: string
  ticketNumber: string
  type: 'new_message' | 'new_attachment' | 'ticket_assigned' | 'ticket_queue_moved' | 'new_ticket' | 'ticket_redirected' | 'ticket_schedule_reopened' | 'routing_alert' | 'task_updated' | 'project_forecast'
  title: string
  body: string
  senderName: string | null
  createdAt: string // ISO string
}

// Popup efêmero para eventos de fila/atribuição (auto-dismiss)
export type BellPopupType = 'new_ticket' | 'ticket_assigned' | 'ticket_queue_moved' | 'routing_alert'
export interface BellPopup {
  id: string
  ticketId: string
  ticketNumber: string
  type: BellPopupType
  title: string
  body: string
}

interface NotificationsState {
  notifications: MessageNotification[]
  bellItems: BellItem[]
  bellPopups: BellPopup[]
  unreadByTicket: Record<string, number>

  addNotification: (n: Omit<MessageNotification, 'id' | 'timestamp'>) => void
  setBellItems: (items: BellItem[]) => void
  addBellItem: (item: BellItem) => void
  addBellPopup: (p: BellPopup) => void
  dismissBellPopup: (id: string) => void
  dismissNotification: (id: string) => void
  markTicketRead: (ticketId: string) => void
  setUnreadBatch: (unread: Record<string, number>) => void
}

export const useNotificationsStore = create<NotificationsState>()(
  persist(
    (set) => ({
      notifications: [],
      bellItems: [],
      bellPopups: [],
      unreadByTicket: {},

      addNotification: (n) =>
        set((state) => ({
          notifications: [
            ...state.notifications,
            { ...n, id: `${Date.now()}-${Math.random()}`, timestamp: Date.now() },
          ],
          unreadByTicket: {
            ...state.unreadByTicket,
            [n.ticketId]: (state.unreadByTicket[n.ticketId] ?? 0) + 1,
          },
        })),

      setBellItems: (items) => set({ bellItems: items }),

      addBellItem: (item) =>
        set((state) => {
          if (state.bellItems.some((b) => b.id === item.id)) return state
          const isMessage = item.type === 'new_message' || item.type === 'new_attachment'
          return {
            bellItems: [item, ...state.bellItems],
            unreadByTicket: isMessage
              ? { ...state.unreadByTicket, [item.ticketId]: (state.unreadByTicket[item.ticketId] ?? 0) + 1 }
              : state.unreadByTicket,
          }
        }),

      addBellPopup: (p) =>
        set((state) => ({
          bellPopups: [...state.bellPopups, p],
        })),

      dismissBellPopup: (id) =>
        set((state) => ({
          bellPopups: state.bellPopups.filter((p) => p.id !== id),
        })),

      dismissNotification: (id) =>
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        })),

      markTicketRead: (ticketId) =>
        set((state) => {
          const { [ticketId]: _, ...rest } = state.unreadByTicket
          return {
            unreadByTicket: rest,
            bellItems: state.bellItems.filter((b) => b.ticketId !== ticketId),
          }
        }),

      setUnreadBatch: (unread) =>
        set((state) => ({
          unreadByTicket: {
            ...unread,
            ...Object.fromEntries(
              Object.entries(state.unreadByTicket).filter(
                ([id]) => !unread[id] && state.unreadByTicket[id] > 0
              )
            ),
          },
        })),
    }),
    {
      name: 'isa-notifications',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ unreadByTicket: state.unreadByTicket }),
    }
  )
)
