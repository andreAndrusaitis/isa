import { useEffect, useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { ImageOff } from 'lucide-react'
import { docsService } from '@/services/docsService'

/** Imagem guardada como anexo: o documento leva só o id; o endereço é pedido na hora (e expira). */
function ImageView({ node, selected }: NodeViewProps) {
  const id = node.attrs.attachmentId as string | null
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    let url: string | null = null
    setFailed(false)
    if (!id) { setFailed(true); return }
    docsService.attachmentUrl(id).then(u => { url = u; if (alive) setSrc(u) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false; if (url?.startsWith('blob:')) URL.revokeObjectURL(url) }
  }, [id])
  return (
    <NodeViewWrapper className={`doc-image${selected ? ' selected' : ''}`} data-drag-handle>
      {failed ? <div className="doc-image-missing"><ImageOff size={18} aria-hidden /> Imagem indisponível</div>
        : src ? <img src={src} alt={node.attrs.alt || ''} onError={() => setFailed(true)} /> : <div className="doc-image-missing">Carregando imagem…</div>}
    </NodeViewWrapper>
  )
}

export const DocImage = Node.create({
  name: 'docImage',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes: () => ({ attachmentId: { default: null }, alt: { default: '' } }),
  parseHTML: () => [{ tag: 'img[data-attachment-id]', getAttrs: el => ({ attachmentId: el.getAttribute('data-attachment-id'), alt: el.getAttribute('alt') }) }],
  renderHTML: ({ HTMLAttributes }) => ['img', mergeAttributes({ 'data-attachment-id': HTMLAttributes.attachmentId, alt: HTMLAttributes.alt })],
  renderMarkdown: node => `![${node.attrs?.alt ?? 'imagem'}](anexo:${node.attrs?.attachmentId ?? ''})`,
  addNodeView: () => ReactNodeViewRenderer(ImageView),
})
