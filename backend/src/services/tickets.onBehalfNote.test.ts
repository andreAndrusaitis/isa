import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import prisma from '../config/prisma'
import { TicketController } from '../controllers/tickets'
import { TicketService } from './tickets'

// O histórico de abertura em nome do cliente mostrava só o id do
// cliente. Agora grava "Nome (Empresa)" — inclusive para empresa e cliente
// cadastrados segundos antes — e traduz as notas antigas na leitura.

vi.mock('./email/mailer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./email/mailer')>()),
  sendWelcomeEmail: vi.fn(async () => ({ status: 'SKIPPED_ACS_NOT_CONFIGURED' as const })),
}))

const SUFFIX = `onbehalf-note-${Date.now()}`
let orgId: string
let agentId: string
let requesterId: string
const createdTicketIds: string[] = []
const createdUserIds: string[] = []

function makeReqRes(body: any, user: any) {
  const req: any = { body, user, ip: '127.0.0.1', headers: {}, socket: {} }
  const json = vi.fn()
  const status = vi.fn(() => ({ json }))
  const res: any = { status, json }
  const next = vi.fn()
  return { req, res, next, json, status }
}

async function openingNote(ticketId: string) {
  const event = await prisma.ticketEvent.findFirst({ where: { ticket_id: ticketId, to_status: 'open' }, orderBy: { created_at: 'asc' } })
  return event?.note
}

beforeAll(async () => {
  const org = await prisma.organization.create({ data: { name: `Empresa Nova ${SUFFIX}` } })
  orgId = org.id
  const agent = await prisma.user.create({ data: { name: `Analista ${SUFFIX}`, email: `ag-${SUFFIX}@t.com`, password: 'x', role: 'agent' } })
  agentId = agent.id
  await prisma.userOrgScope.create({ data: { user_id: agentId, org_id: orgId } })
  const requester = await prisma.user.create({ data: { name: `Cliente ${SUFFIX}`, email: `cli-${SUFFIX}@t.com`, password: 'x', role: 'user', org_id: orgId } })
  requesterId = requester.id
}, 30_000)

afterAll(async () => {
  await prisma.ticketEvent.deleteMany({ where: { ticket_id: { in: createdTicketIds } } }).catch(() => {})
  await prisma.ticket.deleteMany({ where: { id: { in: createdTicketIds } } }).catch(() => {})
  await prisma.userOrgScope.deleteMany({ where: { user_id: agentId } }).catch(() => {})
  await prisma.auditLog.deleteMany({ where: { user_id: { in: [agentId, requesterId, ...createdUserIds] } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: [agentId, requesterId, ...createdUserIds] } } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {})
}, 30_000)

describe('histórico de abertura em nome do cliente', () => {
  it('grava o nome do cliente e da empresa, não o id', async () => {
    const ticket = await TicketService.createTicket({ title: 't', description: 'd', user_id: requesterId, org_id: orgId }, agentId)
    createdTicketIds.push(ticket!.id)

    const note = await openingNote(ticket!.id)
    expect(note).toBe(`Chamado aberto em nome de Cliente ${SUFFIX} (Empresa Nova ${SUFFIX})`)
    expect(note).not.toContain(requesterId)
  })

  it('cliente cadastrado na hora (cadastro rápido) já sai com nome e empresa', async () => {
    const email = `rapido-${SUFFIX}@t.com`
    const { req, res, next, json } = makeReqRes(
      { title: 't', description: 'd', newRequester: { name: `Rápido ${SUFFIX}`, email, orgId } },
      { sub: agentId, role: 'agent', orgId: null },
    )
    await TicketController.create(req, res, next)
    expect(next).not.toHaveBeenCalled()
    const ticket = json.mock.calls[0][0].data
    createdTicketIds.push(ticket.id)
    const created = await prisma.user.findUnique({ where: { email } })
    createdUserIds.push(created!.id)

    expect(await openingNote(ticket.id)).toBe(`Chamado aberto em nome de Rápido ${SUFFIX} (Empresa Nova ${SUFFIX})`)

    // O detalhe traz solicitante e empresa completos para a tela não depender de listas em cache.
    const detail: any = await TicketService.getTicketById(ticket.id)
    expect(detail.user).toMatchObject({ id: created!.id, name: `Rápido ${SUFFIX}`, email })
    expect(detail.org).toMatchObject({ id: orgId, name: `Empresa Nova ${SUFFIX}` })
  })

  it('traduz na leitura a nota antiga que só tinha o id', async () => {
    const ticket = await TicketService.createTicket({ title: 't', description: 'd', user_id: requesterId, org_id: orgId }, agentId)
    createdTicketIds.push(ticket!.id)
    await prisma.ticketEvent.updateMany({
      where: { ticket_id: ticket!.id, to_status: 'open' },
      data: { note: `Chamado aberto em nome do cliente ${requesterId}` },
    })

    const detail: any = await TicketService.getTicketById(ticket!.id)
    const opening = detail.events.find((e: any) => e.toStatus === 'open')
    expect(opening.note).toBe(`Chamado aberto em nome de Cliente ${SUFFIX} (Empresa Nova ${SUFFIX})`)
  })

  it('abertura pelo próprio cliente continua sem nota', async () => {
    const ticket = await TicketService.createTicket({ title: 't', description: 'd', user_id: requesterId, org_id: orgId }, requesterId)
    createdTicketIds.push(ticket!.id)
    expect(await openingNote(ticket!.id)).toBeNull()
  })
})
