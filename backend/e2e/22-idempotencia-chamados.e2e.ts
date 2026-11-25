// Retentativa simultânea na API de chamados. O 06-integrations cobre duas
// requisições, que quase nunca caem na janela entre gravar o log e marcá-lo como
// "processing". Aqui são rajadas: é o que um integrador com retry agressivo faz.
import { beforeAll, describe, expect, it } from 'vitest'
import { as, http, orgs, uid } from './helpers'

const RAJADAS = 5
const POR_RAJADA = 8

let key: string
const ext = (method: string, path: string, body?: unknown) =>
  http(method, `/api/integrations/v1${path}`, { headers: { authorization: `Bearer ${key}` }, body })

beforeAll(async () => {
  const r = await http('POST', '/api/integrations/keys', {
    token: await as('admin'),
    body: { name: `Idempotência ${uid()}`, scopes: ['create_ticket', 'read_tickets'], org_id: (await orgs()).acme.id },
  })
  if (r.status !== 201) throw new Error(`chave → ${r.status} ${JSON.stringify(r.body)}`)
  key = r.body.data.key ?? r.body.data.plainKey ?? r.body.data.token
})

describe('mesmo external_request_id em rajada', () => {
  it('nunca abre dois chamados para o mesmo pedido', async () => {
    const desde = new Date(Date.now() - 2000).toISOString()
    const duplicados: string[] = []

    for (let i = 0; i < RAJADAS; i++) {
      const idem = `rajada-${uid()}`
      const corpo = {
        external_request_id: idem,
        requester: { email: 'usuario1.acme@isa.local' },
        ticket: { title: `Rajada ${idem}`, description: 'Retentativa simultânea' },
      }
      const rs = await Promise.all(Array.from({ length: POR_RAJADA }, () => ext('POST', '/tickets', corpo)))
      expect(rs.filter(r => r.status >= 500).map(r => JSON.stringify(r.body))).toEqual([])

      const lista = await ext('GET', `/tickets?per_page=100&created_since=${encodeURIComponent(desde)}`)
      const abertos = (lista.body.data as any[]).filter(t => t.title === corpo.ticket.title).length
      if (abertos !== 1) duplicados.push(`${idem}: ${abertos} chamados`)
    }

    expect(duplicados).toEqual([])
  })
})
