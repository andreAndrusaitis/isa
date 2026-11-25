import { useState, useCallback, useRef } from 'react'
import Cropper, { Area } from 'react-easy-crop'
import { Modal } from '@/components/ui/Modal'
import { Btn } from '@/components/ui/Button'
import { toast } from '@/store/toastStore'

const ACCEPTED_TYPES = ['image/png', 'image/jpeg']
const MAX_BYTES = 5 * 1024 * 1024 // 5MB

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

async function cropToDataUrl(imageSrc: string, cropPixels: Area): Promise<string> {
  const image = await loadImage(imageSrc)
  const canvas = document.createElement('canvas')
  canvas.width = cropPixels.width
  canvas.height = cropPixels.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(
    image,
    cropPixels.x, cropPixels.y, cropPixels.width, cropPixels.height,
    0, 0, cropPixels.width, cropPixels.height,
  )
  return canvas.toDataURL('image/png')
}

export function AvatarUploadModal({ isOpen, onClose, onSave }: {
  isOpen: boolean
  onClose: () => void
  onSave: (dataUrl: string) => Promise<void>
}) {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [saving, setSaving] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error('Formato não suportado. Use PNG ou JPG.')
      return
    }
    if (file.size > MAX_BYTES) {
      toast.error('Imagem muito grande. Máximo de 5MB.')
      return
    }
    const dataUrl = await readFileAsDataUrl(file)
    setImageSrc(dataUrl)
  }

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels)
  }, [])

  const handleSave = async () => {
    if (!imageSrc || !croppedAreaPixels) return
    try {
      setSaving(true)
      const cropped = await cropToDataUrl(imageSrc, croppedAreaPixels)
      await onSave(cropped)
      handleClose()
    } catch (err) {
      toast.error('Erro ao salvar a foto de perfil.')
    } finally {
      setSaving(false)
    }
  }

  const handleClose = () => {
    setImageSrc(null)
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setCroppedAreaPixels(null)
    setDragActive(false)
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Alterar foto de perfil" width={420}>
      {!imageSrc ? (
        <div
          onDragOver={e => { e.preventDefault(); setDragActive(true) }}
          onDragLeave={e => { e.preventDefault(); setDragActive(false) }}
          onDrop={e => {
            e.preventDefault()
            setDragActive(false)
            handleFile(e.dataTransfer.files?.[0])
          }}
          onClick={() => fileInputRef.current?.click()}
          style={{
            padding: '36px 20px',
            border: `1px dashed ${dragActive ? 'var(--accent)' : 'var(--border-strong)'}`,
            background: dragActive ? 'var(--accent-soft)' : 'var(--tint)',
            textAlign: 'center',
            cursor: 'pointer',
            color: 'var(--text-1)',
          }}
        >
          <div style={{ fontSize: 14 }}>
            {dragActive ? 'Solte a imagem aqui' : 'Arraste a imagem aqui ou clique para selecionar'}
          </div>
          <div style={{ marginTop: 4, fontSize: 13, color: 'var(--text-3)' }}>PNG ou JPG, até 5MB</div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg"
            style={{ display: 'none' }}
            onChange={e => handleFile(e.target.files?.[0])}
          />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ position: 'relative', width: '100%', height: 280, background: 'var(--code-bg)' }}>
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          </div>
          <input
            type="range"
            min={1}
            max={3}
            step={0.1}
            value={zoom}
            onChange={e => setZoom(Number(e.target.value))}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Btn variant="ghost" onClick={handleClose} disabled={saving}>Cancelar</Btn>
            <Btn onClick={handleSave} disabled={saving || !croppedAreaPixels}>
              {saving ? 'Salvando...' : 'Salvar foto'}
            </Btn>
          </div>
        </div>
      )}
    </Modal>
  )
}
