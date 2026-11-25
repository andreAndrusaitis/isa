import { CSSProperties } from 'react'

// Texto com reticências; ao passar o mouse o GlobalTooltip mostra o conteúdo
// completo — só quando o texto está de fato cortado.
export function TruncatedText({ text, style }: { text: string; style?: CSSProperties }) {
  return (
    <span
      data-tooltip={text}
      style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, ...style }}
    >
      {text}
    </span>
  )
}
