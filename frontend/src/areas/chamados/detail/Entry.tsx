import type { ReactNode } from 'react'
import { Avatar } from '@/components/ui'
import { FileAttachmentChip, ImageAttachmentChip } from '@/components/ImageAttachmentChip'
import { downloadAttachment, getFileTypeInfo } from '@/utils/attachments'
import { formatDateTime } from '@/utils/dateTime'

/** Um registro da conversa: avatar e balão; evento é uma linha fina na mesma trilha. */
export function Entry({ kind, who, avatar, date, tags, actions, testId, textTestId, children }: {
  kind?: 'internal' | 'event'
  who: ReactNode
  avatar?: ReactNode
  date?: string | null
  tags?: ReactNode
  actions?: ReactNode
  testId?: string
  textTestId?: string
  children: ReactNode
}) {
  return (
    <article className="td-entry" data-kind={kind} data-testid={testId}>
      <span className="td-face" aria-hidden>{avatar || (kind === 'event' ? <i /> : typeof who === 'string' && <Avatar name={who} size={38} />)}</span>
      <div className="td-bubble">
        <div className="td-who">
          <strong>{who}</strong>
          {date && <time dateTime={date}>{formatDateTime(date)}</time>}
          {tags}
          {actions && <div className="td-acts">{actions}</div>}
        </div>
        <div className="td-text" data-testid={textTestId}>{children}</div>
      </div>
    </article>
  )
}

/** Anexo de uma mensagem: imagem abre no visualizador, o resto baixa. */
export function EntryAttachment({ url, name, downloadName, image, onView }: {
  url: string
  /** Já se sabe que é imagem (o endereço nem sempre diz). */
  image?: boolean
  name?: string
  downloadName: string
  onView: (image: { url: string; name: string }) => void
}) {
  const info = getFileTypeInfo(url)
  const label = name ?? info.friendlyName
  return (
    <div style={{ marginTop: 8, whiteSpace: 'normal' }}>
      {image || info.isImage
        ? <ImageAttachmentChip url={url} name={label} onOpen={() => onView({ url, name: downloadName })} onDownload={() => downloadAttachment(url, downloadName)} />
        : <FileAttachmentChip name={label} onClick={() => downloadAttachment(url, downloadName)} />}
    </div>
  )
}
