import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../../../app'

// O teto global de 15 MB cabe um anexo só: a lista do aceite vem num corpo único.
const bodyOf = (mb: number) => ({ attachment_url: `data:text/plain;base64,${'A'.repeat(mb * 1024 * 1024)}` })

describe('tamanho do corpo em POST /api/ai/suggest/:id/accept', () => {
  it('aceita acima do teto global (o 401 mostra que passou do parser)', async () => {
    expect((await request(app).post('/api/ai/suggest/x/accept').send(bodyOf(20))).status).toBe(401)
  })

  it('tem teto próprio', async () => {
    expect((await request(app).post('/api/ai/suggest/x/accept').send(bodyOf(31))).status).toBe(413)
  })

  it('as outras rotas seguem no teto global', async () => {
    expect((await request(app).post('/api/ai/suggest').send(bodyOf(20))).status).toBe(413)
    expect((await request(app).post('/api/ai/feedback').send(bodyOf(20))).status).toBe(413)
  })
})
