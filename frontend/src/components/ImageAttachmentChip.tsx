import { Download, FileText } from 'lucide-react'
import { getFileTypeInfo } from '@/utils/attachments'
import type { MessageAttachment } from '@/utils/groupAttachmentMessages'

const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, maxWidth: 420, padding: '8px 0', borderTop: '1px solid var(--border)', fontSize: 13.5, color: 'var(--text-1)' }
const bare: React.CSSProperties = { border: 0, background: 'none', padding: 0, color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer' }
const nameStyle: React.CSSProperties = { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

/**
 * Anexos extras de uma mensagem (os "Anexo adicional" agrupados), um por linha
 * no rodapé: imagem abre no visualizador, demais arquivos baixam.
 */
export function AttachmentChipList({ items, onOpenImage, onDownload }: {
  items: MessageAttachment[]
  onOpenImage: (a: MessageAttachment) => void
  onDownload: (a: MessageAttachment) => void
}) {
  if (items.length === 0) return null
  return (
    <div style={{ marginTop: 6, whiteSpace: 'normal' }}>
      {items.map((a) => getFileTypeInfo(a.url).isImage ? (
        <ImageAttachmentChip key={a.id} url={a.url} name={a.name} onOpen={() => onOpenImage(a)} onDownload={() => onDownload(a)} />
      ) : (
        <FileAttachmentChip key={a.id} name={a.name} onClick={() => onDownload(a)} />
      ))}
    </div>
  )
}

/** Arquivo anexado a uma mensagem: nome e a ação por extenso. */
export function FileAttachmentChip({ name, onClick, action = 'Baixar' }: { name: string; onClick: () => void; action?: string }) {
  return (
    <button type="button" onClick={onClick} title={`${action} ${name}`} style={{ ...bare, ...row, width: '100%' }}>
      <FileText size={16} style={{ flexShrink: 0, color: 'var(--text-3)' }} />
      <span style={nameStyle}>{name}</span>
      <span style={{ flexShrink: 0, color: 'var(--accent-fg)' }}>{action}</span>
    </button>
  )
}

/**
 * Imagem anexada a uma mensagem: uma linha com miniatura e nome. O clique abre
 * o visualizador (lightbox) e o botão ao lado baixa o arquivo.
 */
export function ImageAttachmentChip({ url, name, onOpen, onDownload }: {
  url: string
  name: string
  onOpen: () => void
  onDownload?: () => void
}) {
  return (
    <div style={row}>
      <button type="button" onClick={onOpen} title={`Ver ${name}`} style={{ ...bare, display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, cursor: 'zoom-in' }}>
        <img src={url} alt="" style={{ width: 48, height: 36, objectFit: 'cover', flexShrink: 0, background: 'var(--tint)' }} />
        <span style={nameStyle}>{name}</span>
      </button>
      {onDownload && (
        <button type="button" className="icon-act" onClick={onDownload} title="Baixar" aria-label={`Baixar ${name}`}>
          <Download size={15} />
        </button>
      )}
    </div>
  )
}
