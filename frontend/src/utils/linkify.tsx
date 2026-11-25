
export function linkify(text: string) {
  if (!text) return null
  const urlRegex = /(https?:\/\/[^\s]+)/g
  const parts = text.split(urlRegex)
  return parts.map((part, index) => {
    if (part.match(urlRegex)) {
      return (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: 'var(--accent-fg)',
            textDecoration: 'underline',
            wordBreak: 'break-all'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      )
    }
    return part
  })
}

/**
 * linkify + **negrito** (só isso: sem HTML, nada é interpretado além do par de
 * asteriscos). Usado nas notas internas, onde a Triagem IA formata a decisão.
 */
export function richText(text: string) {
  if (!text) return null
  return text.split(/\*\*([^*\n]+)\*\*/g).map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{linkify(part)}</strong> : <span key={i}>{linkify(part)}</span>,
  )
}
