/** 1ª resposta do solicitante a um chamado 'incomplete': entra na descrição e a marca vira 'complemented' (uma rodada só). */
import prisma from '../../../config/prisma'

const stamp = (d: Date) => d.toLocaleString('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
})

export async function appendComplement(ticketId: string, description: string | null, text: string, at = new Date()): Promise<boolean> {
  const block = `— Complemento do solicitante (${stamp(at)}) —\n${text.trim() || '(enviou anexo na conversa)'}`
  // Condicional no where: duas respostas simultâneas não anexam duas vezes.
  const { count } = await prisma.ticket.updateMany({
    where: { id: ticketId, intake_status: 'incomplete' },
    data: { intake_status: 'complemented', description: description ? `${description}\n\n${block}` : block },
  })
  return count > 0
}
