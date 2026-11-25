import { ReactNode } from 'react'
import { Modal } from './Modal'
import { Btn } from './Button'

interface ConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string | ReactNode
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'warning' | 'primary'
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  variant = 'primary'
}: ConfirmModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      width={400}
      footer={
        <>
          <Btn variant="secondary" size="sm" onClick={onClose}>{cancelText}</Btn>
          <Btn variant={variant === 'danger' ? 'danger' : 'primary'} size="sm" onClick={() => { onConfirm(); onClose(); }}>{confirmText}</Btn>
        </>
      }
    >
      <div style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.5 }}>
        {message}
      </div>
    </Modal>
  )
}

export function AlertModal({
  isOpen,
  onClose,
  title,
  message,
  buttonText = 'Entendido',
  variant = 'primary'
}: {
  isOpen: boolean
  onClose: () => void
  title: string
  message: string | ReactNode
  buttonText?: string
  variant?: 'danger' | 'warning' | 'primary'
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      width={400}
      footer={
        <Btn variant={variant === 'danger' ? 'danger' : 'primary'} size="sm" onClick={onClose}>{buttonText}</Btn>
      }
    >
      <div style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.5 }}>
        {message}
      </div>
    </Modal>
  )
}
