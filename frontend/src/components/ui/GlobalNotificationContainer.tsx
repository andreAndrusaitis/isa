import { useToastStore, ToastType } from '@/store/toastStore'
import { useAlertStore } from '@/store/alertStore'
import { AlertModal, ConfirmModal } from './ConfirmModal'
import { X } from 'lucide-react'
import '../pops.css'

/** A cor só aparece no que exige ação; o resto é texto normal. */
const TONE: Partial<Record<ToastType, string>> = { error: 'var(--danger)', warning: 'var(--warning)' }

export function GlobalNotificationContainer() {
  const { toasts, removeToast } = useToastStore()
  const { alertDialog, confirmDialog, closeAlert, closeConfirm } = useAlertStore()

  return (
    <>
      <div className="toast-stack" style={{ top: 20 }}>
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pop toast-pop toast-line"
            role={t.type === 'error' || t.type === 'warning' ? 'alert' : 'status'}
            style={{ color: TONE[t.type] }}
          >
            <span>{t.message}</span>
            <button type="button" className="icon-act" onClick={() => removeToast(t.id)} aria-label="Fechar aviso"><X size={15} /></button>
          </div>
        ))}
      </div>

      {/* Global alert modal */}
      {alertDialog && (
        <AlertModal
          isOpen={alertDialog.isOpen}
          onClose={closeAlert}
          title={alertDialog.title}
          message={alertDialog.message}
          buttonText={alertDialog.buttonText}
          variant={alertDialog.variant}
        />
      )}

      {/* Global confirm modal */}
      {confirmDialog && (
        <ConfirmModal
          isOpen={confirmDialog.isOpen}
          onClose={() => {
            if (confirmDialog.onCancel) confirmDialog.onCancel()
            closeConfirm()
          }}
          onConfirm={() => {
            confirmDialog.onConfirm()
            closeConfirm()
          }}
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmText={confirmDialog.confirmText}
          cancelText={confirmDialog.cancelText}
          variant={confirmDialog.variant}
        />
      )}
    </>
  )
}
