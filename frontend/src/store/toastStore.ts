import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  id: string
  message: string
  type: ToastType
  duration?: number
}

interface ToastStore {
  toasts: Toast[]
  addToast: (message: string, type: ToastType, duration?: number) => void
  removeToast: (id: string) => void
  success: (message: string, duration?: number) => void
  error: (message: string, duration?: number) => void
  info: (message: string, duration?: number) => void
  warning: (message: string, duration?: number) => void
}

// Tempo de leitura: mensagens explicativas (o quê + por quê + como resolver) são
// longas; 4s fixos sumiam antes de serem lidas. ~60ms por caractere, entre 4s e 15s.
export function readingTime(message: string): number {
  return Math.min(15000, Math.max(4000, message.length * 60))
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (message, type, duration = readingTime(message)) => {
    const id = `${Date.now()}-${Math.random()}`
    set((state) => ({
      toasts: [...state.toasts, { id, message, type, duration }]
    }))
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id)
      }))
    }, duration)
  },
  removeToast: (id) => set((state) => ({
    toasts: state.toasts.filter((t) => t.id !== id)
  })),
  success: (msg, dur) => useToastStore.getState().addToast(msg, 'success', dur),
  error: (msg, dur) => useToastStore.getState().addToast(msg, 'error', dur),
  info: (msg, dur) => useToastStore.getState().addToast(msg, 'info', dur),
  warning: (msg, dur) => useToastStore.getState().addToast(msg, 'warning', dur),
}))

export const toast = {
  success: (msg: string, dur?: number) => useToastStore.getState().success(msg, dur),
  error: (msg: string, dur?: number) => useToastStore.getState().error(msg, dur),
  info: (msg: string, dur?: number) => useToastStore.getState().info(msg, dur),
  warning: (msg: string, dur?: number) => useToastStore.getState().warning(msg, dur),
}
