import { useState } from 'react'

// `avatar` do usuário pode vir como iniciais ("LL"); só URL/data URI vira foto.
const isImageSrc = (s?: string | null): s is string => !!s && /^(https?:|data:image\/|\/)/.test(s)

export function Avatar({ name = '?', size = 28, src }: { name?: string; size?: number; src?: string | null; rounded?: boolean }) {
  const initials = name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
  const tone = `var(--c${([...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 6) + 1})`
  const baseStyle = { width: size, height: size, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.max(9, size * 0.36), fontWeight: 600, color: 'var(--avatar-ink)', overflow: 'hidden' as const }

  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  if (isImageSrc(src) && src !== failedSrc) {
    return (
      <div style={{ ...baseStyle, background: 'var(--avatar-img-bg)' }}>
        <img src={src} alt={name} onError={() => setFailedSrc(src)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    )
  }

  return (
    <div style={{ ...baseStyle, background: `color-mix(in srgb, ${tone} 24%, var(--bg-card))` }}>
      {initials}
    </div>
  )
}
