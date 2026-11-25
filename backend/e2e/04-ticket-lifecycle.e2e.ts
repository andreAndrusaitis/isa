// Ciclo de vida completo de um chamado, com os papéis reais:
// cliente abre → analista assume → pendente (pausa SLA) → cliente responde →
// analista resolve → cliente reabre → resolve → TM fecha. Mais regras de papel e validação.
import { beforeAll, describe, expect, it } from 'vitest'
import { as, http, openTicket, orgs, uid } from './helpers'

const ids: Record<string, string> = {}
beforeAll(async () => {
  const admin = await as('admin')
  for (const role of ['agent', 'supervisor', 'manager', 'user']) {
    for (const u of (await http('GET', `/api/users?role=${role}`, { token: admin })).body.data) ids[u.email] = u.id
  }
})
const id = (email: string) => ids[email]
const patch = async (who: any, t: string, body: any) => http('PATCH', `/api/tickets/${t}`, { token: await as(who), body })
const msg = async (who: any, t: string, text: string, type = 'user') => http('POST', `/api/tickets/${t}/messages`, { token: await as(who), body: { text, type } })
const fetchT = async (t: string) => (await http('GET', `/api/tickets/${t}`, { token: await as('tm') })).body.data

describe('fluxo feliz ponta a ponta', () => {
  let t: any
  it('cliente abre chamado: status open, SLA calculado, número sequencial, fila da empresa', async () => {
    t = await openTicket('acme1')
    expect(t.status).toBe('open')
    expect(t.id).toMatch(/^ISA-\d+$/)
    expect(new Date(t.sla_deadline ?? t.slaDeadline).getTime()).toBeGreaterThan(Date.now())
    expect(t.org_id ?? t.orgId).toBe((await orgs()).acme.id)
  })

  it('analista assume (autoatribuição)', async () => {
    const r = await patch('an1', t.id, { assigned_to_id: id('analista1.teste@isa.local'), status: 'in_progress' })
    expect(r.status).toBe(200)
    expect(r.body.data.assigned_to_id).toBe(id('analista1.teste@isa.local'))
  })

  // Tipo e justificativa obrigatórios; evidência opcional.
  it('pendente exige motivo e justificativa; evidência é opcional', async () => {
    expect((await patch('an1', t.id, { status: 'pending' })).status).toBe(400)
    expect((await patch('an1', t.id, { status: 'pending', pending_reason: 'pending_user' })).status).toBe(400)
    const ok = await patch('an1', t.id, { status: 'pending', pending_reason: 'pending_user', note: 'aguardando print' })
    expect(ok.status).toBe(200)
    expect(ok.body.data.sla_paused_at).toBeTruthy()
  })

  it('cliente responde → volta a Em Atendimento e despausa o SLA', async () => {
    expect((await msg('acme1', t.id, 'segue o print')).status).toBe(201)
    const now = await fetchT(t.id)
    expect(now.status).toBe('in_progress')
    expect(now.sla_paused_at).toBeNull()
  })

  it('resolver exige detalhamento (≥10 caracteres)', async () => {
    expect((await patch('an1', t.id, { status: 'resolved' })).status).toBe(400)
    expect((await patch('an1', t.id, { status: 'resolved', resolution_details: 'curto' })).status).toBe(400)
    const r = await patch('an1', t.id, { status: 'resolved', resolution_details: 'Reinstalado o driver da impressora' })
    expect(r.status).toBe(200)
    expect(r.body.data.resolved_at).toBeTruthy()
  })

  it('cliente reabre com motivo; motivo curto é recusado', async () => {
    expect((await http('POST', `/api/tickets/${t.id}/reopen`, { token: await as('acme1'), body: { reason: 'não' } })).status).toBe(400)
    const r = await http('POST', `/api/tickets/${t.id}/reopen`, { token: await as('acme1'), body: { reason: 'O problema voltou depois do reboot' } })
    expect(r.status).toBe(200)
    expect(r.body.data.status).toBe('open')
  })

  it('outro cliente da mesma empresa NÃO reabre chamado alheio', async () => {
    await patch('an1', t.id, { status: 'resolved', resolution_details: 'Trocado o cabo de rede da estação' })
    const r = await http('POST', `/api/tickets/${t.id}/reopen`, { token: await as('acme2' as any), body: { reason: 'tentando reabrir o de outro' } })
    expect(r.status).toBe(403)
  })

  it('TM fecha; analista e admin não fecham', async () => {
    expect((await patch('an1', t.id, { status: 'closed', resolution_details: 'fechando direto aqui' })).status).toBe(403)
    expect((await patch('admin', t.id, { status: 'closed' })).status).toBe(403)
    const r = await patch('tm', t.id, { status: 'closed' })
    expect(r.status).toBe(200)
    expect(r.body.data.closed_at).toBeTruthy()
  })

  it('chamado fechado não reabre por /reopen', async () => {
    const r = await http('POST', `/api/tickets/${t.id}/reopen`, { token: await as('acme1'), body: { reason: 'quero reabrir o fechado' } })
    expect(r.status).toBe(400)
  })

  it('chamado FECHADO também não reabre por mensagem do cliente (coerente com /reopen)', async () => {
    const r = await msg('acme1', t.id, 'oi, voltou a acontecer')
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('TICKET_CLOSED')
    expect((await fetchT(t.id)).status).toBe('closed')
  })

  it('histórico (events) registra cada transição', async () => {
    const ev = (await fetchT(t.id)).events.map((e: any) => `${e.from_status}->${e.to_status}`)
    for (const step of ['open->in_progress', 'in_progress->pending', 'pending->in_progress', 'in_progress->resolved', 'resolved->open', 'resolved->closed']) {
      expect(ev).toContain(step)
    }
  })
})

describe('regras de status por mensagem', () => {
  it('mensagem do PRÓPRIO cliente em chamado aberto não o coloca "Em Atendimento"', async () => {
    const t = await openTicket('acme1')
    await msg('acme1', t.id, 'esqueci de dizer: é no 3º andar')
    expect((await fetchT(t.id)).status).toBe('open')
  })

  it('nota interna não conta como primeiro atendimento ao cliente', async () => {
    const t = await openTicket('acme1')
    await patch('an1', t.id, { assigned_to_id: id('analista1.teste@isa.local') })
    await msg('an1', t.id, 'anotação só para a equipe', 'internal')
    expect((await fetchT(t.id)).status).toBe('open')
  })
})

describe('papéis em chamados', () => {
  let t: any
  beforeAll(async () => { t = await openTicket('acme1') })

  it('admin é somente leitura: não abre, não edita, não comenta', async () => {
    expect((await http('POST', '/api/tickets', { token: await as('admin'), body: { title: 'x', description: 'y' } })).status).toBe(403)
    expect((await patch('admin', t.id, { priority: 'low' })).status).toBe(403)
    expect((await msg('admin', t.id, 'oi', 'agent')).status).toBe(403)
  })

  it('cliente não edita o chamado (status/prioridade/responsável)', async () => {
    expect((await patch('acme1', t.id, { priority: 'high' })).status).toBe(403)
    expect((await patch('acme1', t.id, { status: 'closed' })).status).toBe(403)
  })

  it('analista não-responsável só pode se autoatribuir', async () => {
    await patch('an1', t.id, { assigned_to_id: id('analista1.teste@isa.local') })
    const other = await patch('an2', t.id, { priority: 'low' })
    expect([403]).toContain(other.status)
  })

  it('TM só resolve o chamado que assumiu (atende como o analista)', async () => {
    // t está com o Analista 1 (teste anterior): o TM não resolve o chamado de outro responsável
    const other = await patch('tm', t.id, { status: 'resolved', resolution_details: 'resolvendo como TM aqui' })
    expect(other.status).toBe(403)
    expect(other.body.code).toBe('ROLE_CANNOT_RESOLVE')
    const mine = await openTicket('acme1')
    const r = await patch('tm', mine.id, { assigned_to_id: id('tm.teste@isa.local'), status: 'resolved', resolution_details: 'resolvido pelo TM que assumiu' })
    expect(r.status).toBe(200)
    expect(r.body.data.status).toBe('resolved')
  })

  it('ninguém no atendimento altera o prazo de SLA manualmente', async () => {
    expect((await patch('tm', t.id, { sla_deadline: new Date(Date.now() + 864e5 * 30).toISOString() })).status).toBe(403)
  })

  it('não dá para atribuir chamado a um CLIENTE, a usuário inexistente ou a analista fora da carteira', async () => {
    const toClient = await patch('tm', t.id, { assigned_to_id: id('usuario2.acme@isa.local') })
    expect(toClient.status).toBeGreaterThanOrEqual(400)
    const ghost = await patch('tm', t.id, { assigned_to_id: '00000000-0000-0000-0000-00000000dead' })
    expect(ghost.status).toBeGreaterThanOrEqual(400)
    expect(ghost.status).toBeLessThan(500)
    const outScope = await patch('tm', t.id, { assigned_to_id: id('analista3.teste@isa.local') })
    expect(outScope.status).toBeGreaterThanOrEqual(400)
  })

  it('mover para fila inexistente é recusado (não cria fila fantasma)', async () => {
    const r = await patch('tm', t.id, { queue: `fila-fantasma-${uid()}` })
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(r.status).toBeLessThan(500)
  })

  it('categoria inexistente → 4xx, não 500', async () => {
    const r = await patch('tm', t.id, { category_id: '00000000-0000-0000-0000-00000000beef' })
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(r.status).toBeLessThan(500)
  })
})

describe('validação na abertura', () => {
  const post = async (body: any, who: any = 'acme1') => http('POST', '/api/tickets', { token: await as(who), body })

  it('título/descrição vazios ou só espaços → 400', async () => {
    expect((await post({ title: '', description: 'x' })).status).toBe(400)
    expect((await post({ title: '   ', description: 'x' })).status).toBe(400)
    expect((await post({ title: 'x', description: '   ' })).status).toBe(400)
  })

  it('prioridade "urgent" (não existe no banco) é recusada com 400, não 500', async () => {
    const r = await post({ title: 'x', description: 'y', priority: 'urgent' })
    expect(r.status).toBe(400)
  })

  it('categoria/subcategoria inexistentes → 4xx, não 500', async () => {
    expect((await post({ title: 'x', description: 'y', categoryId: '00000000-0000-0000-0000-00000000beef' })).status).toBeLessThan(500)
    expect((await post({ title: 'x', description: 'y', subcategoryId: '00000000-0000-0000-0000-00000000beef' })).status).toBeLessThan(500)
  })

  it('cliente não escolhe fila arbitrária nem abre em nome de outro', async () => {
    const r = await post({ title: 'x', description: 'y', queue: `fila-${uid()}` })
    if (r.status === 201) expect(r.body.data.queue).not.toMatch(/^fila-/)
    expect((await post({ title: 'x', description: 'y', onBehalfOfUserId: id('usuario2.acme@isa.local') })).status).toBe(403)
  })

  it('anexo com esquema perigoso é recusado', async () => {
    for (const url of ['javascript:alert(1)', 'vbscript:x', 'file:///etc/passwd']) {
      expect((await post({ title: 'x', description: 'y', attachment_url: url })).status).toBe(400)
    }
  })

  it('XSS no título é guardado como texto (não executado no back)', async () => {
    const r = await post({ title: '<img src=x onerror=alert(1)>', description: '<script>alert(1)</script>' })
    expect(r.status).toBe(201)
    expect(r.body.data.title).toBe('<img src=x onerror=alert(1)>')
  })

  it('título gigante (100 KB) não derruba', async () => {
    expect((await post({ title: 'a'.repeat(100_000), description: 'y' })).status).toBeLessThan(500)
  })

  it('analista abre em nome de cliente da carteira, mas não de fora', async () => {
    const ok = await post({ title: 'em nome', description: 'y', onBehalfOfUserId: id('usuario2.acme@isa.local') }, 'an1')
    expect(ok.status).toBe(201)
    expect(ok.body.data.user_id).toBe(id('usuario2.acme@isa.local'))
    const out = await post({ title: 'em nome', description: 'y', onBehalfOfUserId: id('usuario1.initech@isa.local') }, 'an1')
    expect(out.status).toBe(403)
  })

  // B7: decisão de produto (renumerar colide com números antigos) — não alterado.
  it.skip('número do chamado exibido corresponde ao id (INC-1234 para ISA-1234)', async () => {
    const t = await openTicket('acme1')
    expect(t.display_number ?? t.displayNumber).toBe(`INC-${t.id.replace('ISA-', '')}`)
  })
})

describe('mensagens', () => {
  let t: any
  beforeAll(async () => { t = await openTicket('acme1') })

  it('mensagem vazia → 400', async () => {
    expect((await msg('acme1', t.id, '')).status).toBe(400)
  })

  it('cliente não edita nem apaga mensagem de outra pessoa', async () => {
    await patch('an1', t.id, { assigned_to_id: id('analista1.teste@isa.local') })
    const m = await msg('an1', t.id, 'resposta do analista', 'agent')
    expect(m.status).toBe(201)
    expect((await http('PATCH', `/api/tickets/${t.id}/messages/${m.body.data.id}`, { token: await as('acme1'), body: { text: 'adulterado' } })).status).toBe(403)
    expect((await http('DELETE', `/api/tickets/${t.id}/messages/${m.body.data.id}`, { token: await as('acme1') })).status).toBe(403)
  })

  it('mensagem de um chamado não é editável pela rota de OUTRO chamado', async () => {
    const other = await openTicket('acme1')
    const m = await msg('acme1', t.id, 'minha msg')
    const r = await http('PATCH', `/api/tickets/${other.id}/messages/${m.body.data.id}`, { token: await as('acme1'), body: { text: 'x' } })
    expect(r.status).toBeGreaterThanOrEqual(400)
  })

  it('cliente não edita mensagem no chamado de outra pessoa mesmo sendo autor antigo (troca de requisitante)', async () => {
    const r = await http('GET', `/api/tickets/${t.id}/messages`, { token: await as('acme2' as any) })
    expect(r.status).toBe(403)
  })
})
