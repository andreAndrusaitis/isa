import { create } from 'zustand'

export type AlertModalType = 'primary' | 'danger' | 'warning'

interface AlertModalConfig {
  isOpen: boolean
  title: string
  message: string
  variant?: AlertModalType
  buttonText?: string
  onClose?: () => void
}

interface ConfirmModalConfig {
  isOpen: boolean
  title: string
  message: string
  variant?: AlertModalType
  confirmText?: string
  cancelText?: string
  onConfirm: () => void
  onCancel?: () => void
}

interface AlertStore {
  alertDialog: AlertModalConfig | null
  confirmDialog: ConfirmModalConfig | null
  showAlert: (config: Omit<AlertModalConfig, 'isOpen'>) => void
  showConfirm: (config: Omit<ConfirmModalConfig, 'isOpen'>) => void
  closeAlert: () => void
  closeConfirm: () => void
}

export const useAlertStore = create<AlertStore>((set) => ({
  alertDialog: null,
  confirmDialog: null,
  showAlert: (config) => set({
    alertDialog: { ...config, isOpen: true }
  }),
  showConfirm: (config) => set({
    confirmDialog: { ...config, isOpen: true }
  }),
  closeAlert: () => set((state) => {
    state.alertDialog?.onClose?.()
    return { alertDialog: null }
  }),
  closeConfirm: () => set({ confirmDialog: null }),
}))

export const sysAlert = {
  show: (title: string, message: string, variant: AlertModalType = 'primary', buttonText?: string) => {
    return new Promise<void>((resolve) => {
      useAlertStore.getState().showAlert({
        title,
        message,
        variant,
        buttonText,
        onClose: resolve
      })
    })
  },
  confirm: (title: string, message: string, variant: AlertModalType = 'primary', confirmText?: string, cancelText?: string) => {
    return new Promise<boolean>((resolve) => {
      useAlertStore.getState().showConfirm({
        title,
        message,
        variant,
        confirmText,
        cancelText,
        onConfirm: () => resolve(true),
        onCancel: () => {
          resolve(false)
        }
      })
    })
  }
}
