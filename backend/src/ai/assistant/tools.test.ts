import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

vi.mock('../core/learn', () => ({
  searchLearn: vi.fn(async () => [{ title: 'Redefinir senha', url: 'https://learn.microsoft.com/pt-br/x', content: 'passo a passo' }]),
}))

import prisma from '../../config/prisma'
import { TicketService } from '../../services/tickets'
import { assistantTools, autorDaMensagem, getAssistantTool } from './tools'
import { SYSTEM_USER_ID } from '../../utils/constants'

const SUFFIX = `assist-${Date.now()}`
const tool = (name: string) => getAssistantTool(name)!
let orgId: string, aliceId: string, bobId: string, agentId: string
let aliceTicket: { id: string; display_number: string }
let bobTicket: { id: string; display_number: string }

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })
  orgId = org.id
  const mk = (n: string, role = 'user') =>
    prisma.user.create({ data: { name: `${n} ${SUFFIX}`, email: `${n}-${SUFFIX}@t.com`, password: 'x', role: role as any, org_id: orgId } })
  aliceId = (await mk('alice')).id
  bobId = (await mk('bob')).id
  agentId = (await mk('analista', 'agent')).id

  aliceTicket = await TicketService.createTicket({ title: `Impressora ${SUFFIX}`, description: 'não imprime', user_id: aliceId, org_id: orgId })
  bobTicket = await TicketService.createTicket({ title: `VPN ${SUFFIX}`, description: 'não conecta', user_id: bobId, org_id: orgId })
  await prisma.ticketMessage.create({ data: { ticket_id: aliceTicket.id, user_id: agentId, type: 'agent', text: 'Pode reiniciar a impressora?' } })
  await prisma.ticketMessage.create({ data: { ticket_id: aliceTicket.id, user_id: agentId, type: 'internal', text: `NOTA INTERNA ${SUFFIX}` } })
})

afterAll(async () => {
  const ids = [aliceId, bobId, agentId]
  const tickets = await prisma.ticket.findMany({ where: { user_id: { in: ids } }, select: { id: true } })
  const ticketIds = tickets.map(t => t.id)
  await prisma.ticketMessage.deleteMany({ where: { ticket_id: { in: ticketIds } } }).catch(() => {})
  await prisma.ticketEvent.deleteMany({ where: { ticket_id: { in: ticketIds } } }).catch(() => {})
  await prisma.notification.deleteMany({ where: { ticket_id: { in: ticketIds } } }).catch(() => {})
  await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } }).catch(() => {})
  await prisma.auditLog.deleteMany({ where: { user_id: { in: ids } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {})
})

describe('registro de tools do assistente', () => {
  it('expõe as tools com nome único e marca as de escrita', () => {
    const names = assistantTools.map(t => t.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toEqual(['buscar_learn', 'meus_chamados', 'ver_chamado', 'abrir_chamado', 'responder_analista', 'reabrir_chamado'])
    expect(assistantTools.filter(t => t.write).map(t => t.name)).toEqual(['abrir_chamado', 'responder_analista', 'reabrir_chamado'])
    expect(getAssistantTool('nao_existe')).toBeUndefined()
  })

  it('buscar_learn devolve itens e sources', async () => {
    const r: any = await tool('buscar_learn').handler({ consulta: 'redefinir senha' }, { userId: aliceId, via: 'teams' })
    expect(r.sources).toEqual([{ title: 'Redefinir senha', url: 'https://learn.microsoft.com/pt-br/x' }])
    expect(r.itens[0].trecho).toBe('passo a passo')
  })
})

describe('leitura no escopo do solicitante', () => {
  it('meus_chamados traz só os chamados da própria pessoa', async () => {
    const r: any[] = await tool('meus_chamados').handler({ limite: 20 }, { userId: aliceId, via: 'teams' }) as any
    const numbers = r.map(t => t.numero)
    expect(numbers).toContain(aliceTicket.display_number)
    expect(numbers).not.toContain(bobTicket.display_number)
    expect(r[0].status).toBe('Aberto')
  })

  it('ver_chamado mostra a conversa pública e nunca a nota interna', async () => {
    const r: any = await tool('ver_chamado').handler({ chamado: aliceTicket.display_number }, { userId: aliceId, via: 'teams' })
    expect(r.numero).toBe(aliceTicket.display_number)
    expect(r.mensagens.map((m: any) => m.texto)).toContain('Pode reiniciar a impressora?')
    expect(JSON.stringify(r)).not.toContain('NOTA INTERNA')
    expect(r).not.toHaveProperty('events')
  })

  it('ver_chamado recusa chamado de outra pessoa (por número e por id)', async () => {
    await expect(tool('ver_chamado').handler({ chamado: bobTicket.display_number }, { userId: aliceId, via: 'teams' })).rejects.toThrow(/não encontrado/i)
    await expect(tool('ver_chamado').handler({ chamado: bobTicket.id }, { userId: aliceId, via: 'teams' })).rejects.toThrow(/não encontrado/i)
  })
})

describe('escrita exige confirmação', () => {
  it('abrir_chamado recusa sem confirmação e abre como a pessoa quando confirmado', async () => {
    const input = { titulo: `Outlook ${SUFFIX}`, descricao: 'não sincroniza desde ontem' }
    expect(tool('abrir_chamado').describe!(input)).toContain(`Abrir chamado "Outlook ${SUFFIX}"`)
    await expect(tool('abrir_chamado').handler(input, { userId: aliceId, via: 'teams' })).rejects.toThrow(/confirmada/)
    expect(await prisma.ticket.count({ where: { title: input.titulo } })).toBe(0)

    const r: any = await tool('abrir_chamado').handler(input, { userId: aliceId, via: 'teams', confirmed: true })
    const created = await prisma.ticket.findUnique({ where: { id: r.id } })
    expect(created).toMatchObject({ user_id: aliceId, org_id: orgId, status: 'open', channel: 'teams' })
    expect(r.numero).toBe(created!.display_number)
    const event = await prisma.ticketEvent.findFirst({ where: { ticket_id: r.id } })
    expect(event?.note).toBe('Chamado aberto pela Skadi (Teams)')
  })

  it('responder_analista recusa sem confirmação, recusa chamado alheio e envia mensagem pública quando confirmado', async () => {
    const input = { chamado: aliceTicket.display_number, mensagem: `Reiniciei e nada ${SUFFIX}` }
    await expect(tool('responder_analista').handler(input, { userId: aliceId, via: 'copilot' })).rejects.toThrow(/confirmada/)
    await expect(
      tool('responder_analista').handler({ ...input, chamado: bobTicket.display_number }, { userId: aliceId, via: 'copilot', confirmed: true }),
    ).rejects.toThrow(/não encontrado/i)

    await tool('responder_analista').handler(input, { userId: aliceId, via: 'copilot', confirmed: true })
    const msg = await prisma.ticketMessage.findFirst({ where: { ticket_id: aliceTicket.id, text: input.mensagem } })
    expect(msg).toMatchObject({ user_id: aliceId, type: 'user' })
  })

  it('reabrir_chamado reabre chamado resolvido da própria pessoa quando confirmado', async () => {
    await prisma.ticket.update({ where: { id: bobTicket.id }, data: { status: 'resolved', resolved_at: new Date() } })
    const input = { chamado: bobTicket.display_number, motivo: 'a VPN voltou a cair hoje cedo' }
    await expect(tool('reabrir_chamado').handler(input, { userId: bobId, via: 'teams' })).rejects.toThrow(/confirmada/)
    await expect(tool('reabrir_chamado').handler(input, { userId: aliceId, via: 'teams', confirmed: true })).rejects.toThrow(/não encontrado/i)

    const r: any = await tool('reabrir_chamado').handler(input, { userId: bobId, via: 'teams', confirmed: true })
    expect(r.status).toBe('Aberto')
    const t = await prisma.ticket.findUnique({ where: { id: bobTicket.id } })
    expect(t).toMatchObject({ status: 'open', is_reopened: true })
  })
})

describe('autorDaMensagem', () => {
  const sistema = { name: 'Sistema' }
  it('mensagem assinada pelo usuário de sistema é da Skadi', () => {
    expect(autorDaMensagem({ user_id: SYSTEM_USER_ID, text: 'Tente isto. — Skadi', user: sistema })).toBe('Skadi')
    expect(autorDaMensagem({ user_id: SYSTEM_USER_ID, text: 'Tente isto. — Assistente ISA', user: sistema })).toBe('Skadi')
  })
  it('o resto mantém o autor real', () => {
    expect(autorDaMensagem({ user_id: SYSTEM_USER_ID, text: 'Chamado fechado', user: sistema })).toBe('Sistema')
    expect(autorDaMensagem({ user_id: 'analista', text: 'Oi — Skadi', user: { name: 'Ana' } })).toBe('Ana')
  })
})
