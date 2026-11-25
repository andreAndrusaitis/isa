import { generateKeyPairSync } from 'node:crypto'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import app from '../app'
import prisma from '../config/prisma'
import { createMcpToken } from '../services/mcpTokens'
import { TicketService } from '../services/tickets'

// Entra "de mentira": a chave pública de teste entra no JWKS (fetch) e o token é assinado com a privada.
const TENANT = '33333333-3333-4333-8333-333333333333'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'mcp-k1', use: 'sig', issuer: 'https://login.microsoftonline.com/{tenantid}/v2.0' }
const entraToken = (email: string, aud = '11111111-1111-4111-8111-111111111111') =>
  jwt.sign(
    { aud, iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, tid: TENANT, scp: 'access_as_user', preferred_username: email },
    privateKey,
    { algorithm: 'RS256', keyid: 'mcp-k1', expiresIn: '5m' },
  )

const SUFFIX = `mcpch-${Date.now()}`
const email = `ana-${SUFFIX}@t.com`
let orgId: string, userId: string, otherId: string, mcpToken: string, ticketNumber: string

function rpc(token: string, method: string, params: object = {}) {
  return request(app)
    .post('/mcp/chamados')
    .set('Authorization', `Bearer ${token}`)
    .set('Accept', 'application/json, text/event-stream')
    .send({ jsonrpc: '2.0', id: 1, method, params })
}

const body = (res: request.Response) => JSON.parse(res.text.split('\n').find(l => l.startsWith('data: '))!.slice(6))
const toolResult = (res: request.Response) => JSON.parse(body(res).result.content[0].text)

beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })))
  const org = await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })
  orgId = org.id
  userId = (await prisma.user.create({ data: { name: `Ana ${SUFFIX}`, email, role: 'user', org_id: orgId, auth_provider: 'microsoft' } })).id
  otherId = (await prisma.user.create({ data: { name: `Beto ${SUFFIX}`, email: `beto-${SUFFIX}@t.com`, role: 'user', org_id: orgId } })).id
  mcpToken = (await createMcpToken(userId, { name: 'Copilot teste' })).token
  ticketNumber = (await TicketService.createTicket({ title: `Teclado ${SUFFIX}`, description: 'teclas falhando', user_id: userId, org_id: orgId })).display_number
  await TicketService.createTicket({ title: `Monitor ${SUFFIX}`, description: 'sem imagem', user_id: otherId, org_id: orgId })
})

afterAll(async () => {
  vi.unstubAllGlobals()
  const ids = [userId, otherId]
  const ticketIds = (await prisma.ticket.findMany({ where: { user_id: { in: ids } }, select: { id: true } })).map(t => t.id)
  await prisma.ticketMessage.deleteMany({ where: { ticket_id: { in: ticketIds } } }).catch(() => {})
  await prisma.ticketEvent.deleteMany({ where: { ticket_id: { in: ticketIds } } }).catch(() => {})
  await prisma.notification.deleteMany({ where: { ticket_id: { in: ticketIds } } }).catch(() => {})
  await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } }).catch(() => {})
  await prisma.mcpToken.deleteMany({ where: { user_id: { in: ids } } }).catch(() => {})
  await prisma.auditLog.deleteMany({ where: { user_id: { in: ids } } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => {})
  await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => {})
})

describe('POST /mcp/chamados — autenticação', () => {
  it('rejeita sem token', async () => {
    const res = await request(app).post('/mcp/chamados').send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(res.status).toBe(401)
    expect(res.headers['www-authenticate']).toMatch(/^Bearer/)
  })

  it('rejeita token Entra de outro app e isamcp_ inválido', async () => {
    expect((await rpc(entraToken(email, 'outro-app'), 'tools/list')).status).toBe(401)
    const res = await rpc('isamcp_tokeninvalidoquenuncaexistiu', 'tools/list')
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('MCP_TOKEN_INVALID')
  })

  it('recusa conta Microsoft que não existe no ISA (não cria conta)', async () => {
    const res = await rpc(entraToken(`ninguem-${SUFFIX}@t.com`), 'tools/list')
    expect(res.status).toBe(403)
    expect(res.body.code).toBe('ENTRA_USER_NOT_FOUND')
    expect(await prisma.user.count({ where: { email: `ninguem-${SUFFIX}@t.com` } })).toBe(0)
  })

  it('aceita token pessoal isamcp_ sem exigir o módulo de projetos', async () => {
    const res = await rpc(mcpToken, 'tools/list')
    expect(res.status).toBe(200)
    const tools = body(res).result.tools
    expect(tools.map((t: any) => t.name)).toEqual(['buscar_learn', 'meus_chamados', 'ver_chamado', 'abrir_chamado', 'responder_analista', 'reabrir_chamado'])
    const abrir = tools.find((t: any) => t.name === 'abrir_chamado')
    expect(Object.keys(abrir.inputSchema.properties)).toContain('confirmado')
    expect(Object.keys(tools.find((t: any) => t.name === 'meus_chamados').inputSchema.properties)).not.toContain('confirmado')
  })
})

describe('POST /mcp/chamados — tools com token Entra', () => {
  it('meus_chamados traz só os chamados de quem está autenticado', async () => {
    const res = await rpc(entraToken(email), 'tools/call', { name: 'meus_chamados', arguments: { limite: 10 } })
    expect(res.status).toBe(200)
    const rows = toolResult(res)
    expect(rows.map((r: any) => r.numero)).toEqual([ticketNumber])
  })

  it('abrir_chamado sem confirmado devolve o resumo e não escreve; com confirmado abre como a pessoa', async () => {
    const args = { titulo: `Excel ${SUFFIX}`, descricao: 'trava ao abrir planilha grande' }
    const pending = toolResult(await rpc(entraToken(email), 'tools/call', { name: 'abrir_chamado', arguments: args }))
    expect(pending.confirmacaoNecessaria).toBe(true)
    expect(pending.resumo).toContain(`Abrir chamado "Excel ${SUFFIX}"`)
    expect(await prisma.ticket.count({ where: { title: args.titulo } })).toBe(0)

    const done = toolResult(await rpc(entraToken(email), 'tools/call', { name: 'abrir_chamado', arguments: { ...args, confirmado: true } }))
    const created = await prisma.ticket.findFirst({ where: { title: args.titulo } })
    expect(created).toMatchObject({ user_id: userId, display_number: done.numero })
    const event = await prisma.ticketEvent.findFirst({ where: { ticket_id: created!.id } })
    expect(event?.note).toBe('Chamado aberto pela Skadi (Copilot)')
  })

  it('erro de escopo volta como resultado de erro da tool', async () => {
    const other = await prisma.ticket.findFirst({ where: { user_id: otherId } })
    const res = await rpc(entraToken(email), 'tools/call', { name: 'ver_chamado', arguments: { chamado: other!.display_number } })
    const result = body(res).result
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/não encontrado/i)
  })
})
