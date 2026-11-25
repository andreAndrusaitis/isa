/**
 * Wizard do portal aberto como dialog do Teams: o bot abre
 * `/solicitacoes?teams=1&dialog=1&titulo=…&descricao=…` (ou `/solicitacoes/nova?…`)
 * num task module; com ?dialog=1 no Teams o portal já abre no wizard.
 * O wizard vem preenchido com o resumo da conversa e, ao criar o chamado,
 * devolve `{ ticketId, numero }` ao bot por `dialog.url.submit` (o Teams fecha
 * o dialog). Fora do Teams, ou sem ?dialog=1, nada muda.
 */
import { isInTeams } from '@/services/teamsSso'
import { getTeamsContext, isTeamsHost } from './teamsContext'

/** Mesmos limites da ferramenta abrir_chamado do assistente. */
export const DIALOG_TITLE_MAX = 200
export const DIALOG_DESCRIPTION_MAX = 5000

export interface DialogMode {
  title: string
  description: string
}

export interface DialogResult {
  ticketId: string
  numero: string
}

/** Texto vindo da URL: sem tags nem caracteres de controle, quebras normalizadas, limitado. */
export function sanitizeDialogText(raw: string | null | undefined, max: number): string {
  if (!raw) return ''
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, max)
    .trim()
}

/** Modo dialog: ?dialog=1 e dentro do Teams. Null = wizard normal. */
export function readDialogMode(search: string = typeof window !== 'undefined' ? window.location.search : ''): DialogMode | null {
  const params = new URLSearchParams(search)
  if (params.get('dialog') !== '1') return null
  if (!isTeamsHost() && !isInTeams()) return null
  return {
    title: sanitizeDialogText(params.get('titulo'), DIALOG_TITLE_MAX),
    description: sanitizeDialogText(params.get('descricao'), DIALOG_DESCRIPTION_MAX),
  }
}

/**
 * Devolve o chamado criado ao bot e fecha o dialog. False se o Teams não
 * respondeu: quem chamou segue o caminho normal do portal.
 */
export async function submitDialog(result: DialogResult): Promise<boolean> {
  try {
    if (!(await getTeamsContext())) return false
    const { dialog } = await import('@microsoft/teams-js')
    dialog.url.submit(result)
    return true
  } catch {
    return false
  }
}
