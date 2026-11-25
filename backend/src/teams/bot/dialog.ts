/**
 * Dialog (task module) do Teams com o wizard de abertura do portal e
 * a extensão de mensagem "Abrir chamado a partir desta mensagem".
 * O wizard em modo dialog devolve { ticketId, numero } pelo submit do Teams.
 */
import { excerpt } from './cards'

/** Rota do wizard de abertura no front (frontend/src/access/routes.ts, tela new_ticket). */
export const TICKET_DIALOG_PATH = '/solicitacoes'
export const DIALOG_TITLE = 'Abrir chamado'
export const OPEN_FORM_LABEL = 'Abrir pelo formulário'
export const MESSAGE_ACTION_COMMAND = 'abrirChamadoDaMensagem'

const TITLE_MAX = 120
const DESCRIPTION_MAX = 1500

export interface DialogPrefill {
  titulo?: string | null
  descricao?: string | null
}

/** URL do wizard em dialog; título/descrição vão como texto puro, cortados para caber na URL. */
export function ticketDialogUrl(portalUrl: string, prefill: DialogPrefill = {}): string {
  const params = new URLSearchParams({ teams: '1', dialog: '1' })
  const titulo = excerpt(prefill.titulo ?? '', TITLE_MAX)
  const descricao = excerpt(prefill.descricao ?? '', DESCRIPTION_MAX)
  if (titulo) params.set('titulo', titulo)
  if (descricao) params.set('descricao', descricao)
  return `${portalUrl.replace(/\/+$/, '')}${TICKET_DIALOG_PATH}?${params.toString()}`
}

/** Resposta de task/fetch e composeExtension/fetchTask que abre o wizard. */
export function dialogContinue(url: string) {
  return { task: { type: 'continue', value: { title: DIALOG_TITLE, url, fallbackUrl: url, height: 'large', width: 'large' } } }
}

/** Resposta que mostra só um aviso no dialog. */
export function dialogMessage(text: string) {
  return { task: { type: 'message', value: text } }
}

/** Botão de card que abre o wizard no dialog (o Teams manda task/fetch com estes dados). */
export function openFormAction(prefill: DialogPrefill = {}) {
  return {
    type: 'Action.Submit',
    title: OPEN_FORM_LABEL,
    associatedInputs: 'none',
    data: {
      msteams: { type: 'task/fetch' },
      acao: 'formulario',
      ...(prefill.titulo ? { titulo: excerpt(prefill.titulo, TITLE_MAX) } : {}),
      ...(prefill.descricao ? { descricao: excerpt(prefill.descricao, DESCRIPTION_MAX) } : {}),
    },
  }
}

/** Título e descrição a partir da mensagem do Teams em que a extensão foi usada. */
export function prefillFromMessage(payload: unknown): DialogPrefill {
  const p = (payload ?? {}) as { subject?: unknown; body?: { content?: unknown } }
  // O Teams manda HTML em <div>/<li>: o fim de bloco vira espaço antes de tirar as tags.
  const html = typeof p.body?.content === 'string' ? p.body.content.replace(/<\/(div|li|h\d|tr|td)>/gi, ' ') : ''
  const text = excerpt(html, DESCRIPTION_MAX)
  const subject = typeof p.subject === 'string' ? excerpt(p.subject, TITLE_MAX) : ''
  return { titulo: subject || excerpt(text, TITLE_MAX) || null, descricao: text || null }
}
