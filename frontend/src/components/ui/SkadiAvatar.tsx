import { useState, type CSSProperties } from 'react'
import { SKADI_AVATAR_SRC, SKADI_NAME } from '@/utils/skadi'

/**
 * Rosto da Skadi. decorative: o nome já está no texto ao lado e o leitor de
 * tela não deve repeti-lo (dentro de um botão, viraria "Skadi Skadi").
 */
export function SkadiAvatar({ size = 32, decorative = false, style }: { size?: number; decorative?: boolean; style?: CSSProperties }) {
  const [failed, setFailed] = useState(false)
  const box: CSSProperties = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--tint)', color: 'var(--text-1)',
    fontSize: size * 0.38, fontWeight: 600, lineHeight: 1,
    ...style,
  }

  if (failed) {
    return decorative
      ? <span aria-hidden="true" style={box}>S</span>
      : <span role="img" aria-label={SKADI_NAME} style={box}>S</span>
  }
  return (
    <span style={box}>
      <img
        src={SKADI_AVATAR_SRC}
        alt={decorative ? '' : SKADI_NAME}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    </span>
  )
}
