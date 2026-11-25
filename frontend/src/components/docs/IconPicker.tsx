import { useEffect, useRef, useState } from 'react'

const ICONS = ['📄', '📘', '📗', '📙', '📓', '🗂️', '📌', '📎', '✅', '📝', '📊', '📈', '🧭', '🗺️', '🎯', '🚀', '🛠️', '⚙️', '🔐', '🛡️', '🔌', '💾', '🖥️', '📱', '🌐', '☁️', '❄️', '🧊', '🏔️', '🌲', '🔥', '💡', '🧪', '🐞', '🚨', '📞', '💬', '📣', '👥', '🤝', '🏢', '📅', '⏱️', '💰', '🧾', '📦', '🎓', '⭐']

export function IconPicker({ value, onChange, label, disabled }: { value: string | null; onChange: (icon: string | null) => void; label: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [open])
  return (
    <div className="doc-iconpick" ref={ref}>
      <button type="button" className="doc-iconpick-btn" aria-label={label} aria-expanded={open} disabled={disabled} onClick={() => setOpen(o => !o)}>{value ?? '📄'}</button>
      {open && (
        <div className="doc-iconpick-pop">
          {ICONS.map(i => <button key={i} type="button" aria-label={`Ícone ${i}`} aria-pressed={i === value} onClick={() => { onChange(i); setOpen(false) }}>{i}</button>)}
          {value && <button type="button" className="clear" onClick={() => { onChange(null); setOpen(false) }}>Sem ícone</button>}
        </div>
      )}
    </div>
  )
}
