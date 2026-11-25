import { describe, it, expect, vi } from 'vitest'
import { errorHandler, AppError } from './errorHandler'
import type { Request, Response, NextFunction } from 'express'

// Res falso mínimo — só precisamos capturar status + body.
function fakeRes() {
  const captured: { status?: number; body?: any } = {}
  const res = {
    status(code: number) { captured.status = code; return this },
    json(body: any) { captured.body = body; return this },
  }
  return { res: res as unknown as Response, captured }
}

function run(err: unknown) {
  const { res, captured } = fakeRes()
  errorHandler(err, {} as Request, res, (() => {}) as NextFunction)
  return captured
}

describe('errorHandler — erros do Prisma', () => {
  it('traduz P2003 (FK violation) em 409 IN_USE', () => {
    const out = run({ code: 'P2003', message: 'Foreign key constraint failed' })
    expect(out.status).toBe(409)
    expect(out.body.code).toBe('IN_USE')
  })

  it('traduz P2014 (relação obrigatória) em 409 IN_USE', () => {
    expect(run({ code: 'P2014' }).status).toBe(409)
  })

  it('traduz P2025 (registro inexistente) em 404 NOT_FOUND', () => {
    const out = run({ code: 'P2025' })
    expect(out.status).toBe(404)
    expect(out.body.code).toBe('NOT_FOUND')
  })

  it('traduz P2002 (unique constraint) em 409 ALREADY_EXISTS', () => {
    // Caso real: adicionar um membro que já está no projeto viola
    // @@unique([project_id, user_id]) — sem este ramo, virava 500 opaco.
    const out = run({ code: 'P2002', message: 'Unique constraint failed' })
    expect(out.status).toBe(409)
    expect(out.body.code).toBe('ALREADY_EXISTS')
  })

  it('mantém 500 para erro desconhecido', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = run(new Error('boom'))
    expect(out.status).toBe(500)
    expect(out.body.code).toBe('INTERNAL_ERROR')
  })

  it('não deixa código do Prisma sequestrar um AppError', () => {
    // AppError tem .code ('APP_ERROR'), então a ordem das checagens importa:
    // o ramo do AppError precisa vir antes do ramo do Prisma.
    const out = run(new AppError(404, 'Pergunta não encontrada', 'NOT_FOUND'))
    expect(out.status).toBe(404)
    expect(out.body.error).toBe('Pergunta não encontrada')
  })

  it('delega ao Express em vez de chamar res.json de novo quando os headers já foram enviados', () => {
    // Caso real: o endpoint /mcp streama a resposta (SSE) e falha no meio —
    // res.json() aqui geraria ERR_HTTP_HEADERS_SENT.
    const { res, captured } = fakeRes()
    ;(res as any).headersSent = true
    const next = vi.fn()

    errorHandler(new Error('boom depois do stream começar'), {} as Request, res, next as unknown as NextFunction)

    expect(next).toHaveBeenCalledTimes(1)
    expect(captured.status).toBeUndefined()
    expect(captured.body).toBeUndefined()
  })
})
