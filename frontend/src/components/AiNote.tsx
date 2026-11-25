import { useId, useState, type ReactNode } from 'react'
import type { TicketMessage } from '@/types'
import { SKADI_SIGNATURES } from '@/utils/skadi'
import { richText } from '@/utils/linkify'
import { formatDateTime } from '@/utils/dateTime'

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'
// Cabeçalho das notas dos agentes de IA (novo formato e o antigo, com 🤖).
const HEADER = /^(?:🤖\s*)?\*\*(Triagem|Completude|Orientação) IA\*\*\s*[—–-]?\s*/

/** Nota interna escrita por um agente de IA (e não por uma pessoa). */
export function isAiNote(msg: Pick<TicketMessage, 'type' | 'userId' | 'text'>): boolean {
  return msg.type === 'internal' && msg.userId === SYSTEM_USER_ID && HEADER.test(msg.text ?? '')
}

const signatureOf = (text: string) => SKADI_SIGNATURES.find(s => text.trimEnd().endsWith(s))

/**
 * Mensagem pública que a IA escreveu ao cliente. Exige o usuário de sistema: uma pessoa
 * que digite a assinatura no fim do texto continua sendo ela mesma.
 */
export function isSkadiMessage(msg: Pick<TicketMessage, 'type' | 'userId' | 'text'>): boolean {
  return msg.type !== 'internal' && msg.userId === SYSTEM_USER_ID && !!signatureOf(msg.text ?? '')
}

/** Texto sem a assinatura do fim: a tela já mostra a autora. */
export function withoutSkadiSignature(text: string): string {
  const signature = signatureOf(text)
  return signature ? text.trimEnd().slice(0, -signature.length).trimEnd() : text
}

/** Linha 1 = resumo; o resto = detalhes (notas antigas seguem a mesma regra). */
function parse(text: string) {
  const m = HEADER.exec(text)!
  const [summary, ...rest] = text.slice(m[0].length).split('\n')
  return { agent: `${m[1]} IA`, summary, details: rest.join('\n').trim() }
}

/** `children`: ações sob o resumo, visíveis sem abrir os detalhes (ex.: sugestões da triagem). */
export function AiNote({ msg, children }: { msg: TicketMessage; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const { agent, summary, details } = parse(msg.text)
  return (
    <div style={{ width: '100%', boxSizing: 'border-box', padding: '10px 0', borderTop: '1px solid var(--border)', color: 'var(--text-1)', fontSize: 14, lineHeight: 1.5 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '2px 10px' }}>
        <span style={{ fontWeight: 600 }}>{agent}</span>
        <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{formatDateTime(msg.createdAt)}</span>
        <span style={{ flex: '1 1 220px', minWidth: 0, wordBreak: 'break-word' }}>{richText(summary)}</span>
        {details && (
          <button
            type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)}
            style={{
              minHeight: 44, padding: 0, margin: '-10px 0', border: 'none', background: 'none', cursor: 'pointer',
              color: 'var(--accent-fg)', fontSize: 13, fontFamily: 'var(--font)',
            }}
          >
            {open ? 'Ocultar detalhes' : 'Detalhes'}
          </button>
        )}
      </div>
      {children}
      {details && open && (
        <div id={id} style={{ marginTop: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-2)', fontSize: 13 }}>
          {richText(details)}
        </div>
      )}
    </div>
  )
}
