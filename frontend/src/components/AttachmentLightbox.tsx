/**
 * Lightbox de anexo — popup em tela cheia para visualizar a imagem e baixá-la.
 */

import { useEffect } from 'react'
import { X, Download } from 'lucide-react'
import { downloadAttachment } from '@/utils/attachments'

export function AttachmentLightbox({
  url,
  filename = 'anexo',
  onClose,
}: {
  url: string | null
  filename?: string
  onClose: () => void
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (url) {
      document.addEventListener('keydown', onKey)
      // Evita scroll do fundo enquanto o popup está aberto.
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [url, onClose])

  if (!url) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.88)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      {/* Barra de ações */}
      <div style={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: 10 }}>
        <button
          onClick={(e) => { e.stopPropagation(); downloadAttachment(url, filename) }}
          title="Baixar"
          aria-label="Baixar"
          style={actionBtnStyle}
        >
          <Download size={18} />
        </button>
        <button onClick={onClose} title="Fechar (Esc)" aria-label="Fechar" style={actionBtnStyle}>
          <X size={18} />
        </button>
      </div>

      <img
        src={url}
        alt={filename}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '92vw', maxHeight: '88vh', objectFit: 'contain' }}
      />
    </div>
  )
}

const actionBtnStyle: React.CSSProperties = {
  width: 40, height: 40, border: 'none', cursor: 'pointer',
  background: 'none', color: '#fff',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
