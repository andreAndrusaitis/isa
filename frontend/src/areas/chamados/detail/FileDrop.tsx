import { useState } from 'react'
import { X } from 'lucide-react'

/** Faixa para soltar ou escolher arquivos, com a lista do que já foi anexado embaixo. */
export function FileDrop({ id, hint, accept, multiple = true, files, onFiles, onRemove }: {
  id?: string
  hint: string
  accept?: string
  multiple?: boolean
  files: File[]
  onFiles: (files: File[]) => void
  onRemove: (index: number) => void
}) {
  const [over, setOver] = useState(false)
  const drag = (on: boolean) => (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setOver(on) }
  return (
    <div>
      <label
        className="file-drop"
        data-over={over || undefined}
        onDragEnter={drag(true)}
        onDragOver={drag(true)}
        onDragLeave={drag(false)}
        onDrop={e => { drag(false)(e); onFiles(Array.from(e.dataTransfer.files ?? [])) }}
      >
        <span>{over ? 'Solte aqui' : multiple ? 'Arraste arquivos ou clique para escolher' : 'Arraste a imagem ou clique para escolher'}</span>
        <small>{hint}</small>
        <input id={id} type="file" accept={accept} multiple={multiple} onChange={e => { onFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
      </label>
      {files.map((f, i) => (
        <div key={i} className="file-drop-item">
          <span title={f.name}>{f.name}</span>
          <button type="button" className="icon-act danger" aria-label={`Remover ${f.name}`} onClick={() => onRemove(i)}><X size={14} /></button>
        </div>
      ))}
    </div>
  )
}
