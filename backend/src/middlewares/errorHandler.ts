/**
 * Middleware de Tratamento de Erros Centralizado
 * 
 * Este módulo captura todas as exceções lançadas na aplicação e as transforma
 * em uma resposta JSON padronizada para o cliente.
 */

import { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import { env } from '../config/env'
import { logger } from '../utils/logger'

/**
 * Classe customizada para erros da aplicação.
 * Permite definir o status HTTP, uma mensagem amigável e um código de erro interno.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number, // HTTP Status Code (ex: 400, 401, 404)
    public readonly message: string,    // Mensagem de erro para o usuário
    public readonly code: string = 'APP_ERROR', // Código interno para o frontend (ex: 'USER_NOT_FOUND')
    public readonly details?: unknown,  // Detalhes técnicos adicionais (opcional)
  ) {
    super(message)
    this.name = 'AppError'
  }
}

/**
 * Middleware global de erro do Express.
 * Deve ser o último middleware registrado no app.ts.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  // Se a resposta já começou a ser enviada (ex: stream do endpoint /mcp que
  // falha no meio), não dá para chamar res.json() de novo — delega ao
  // handler padrão do Express, que só encerra a conexão.
  if (res.headersSent) {
    return next(err)
  }

  // 1. Tratamento de erros conhecidos da aplicação (AppError)
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      // Detalhes técnicos só aparecem fora do ambiente de produção.
      ...(env.NODE_ENV !== 'production' && err.details ? { details: err.details } : {}),
    })
  }

  // 2. Tratamento de erros de validação do Zod
  if (err instanceof ZodError) {
    // Flatten transforma o erro do Zod em um formato de fácil leitura: { campo: ['erro'] }.
    // O primeiro problema vai na mensagem para o usuário saber o que corrigir.
    const flat = err.flatten()
    const [field, msgs] = Object.entries(flat.fieldErrors).find(([, m]) => (m as string[] | undefined)?.length) ?? []
    const first = field ? `${field}: ${(msgs as string[])[0]}` : flat.formErrors[0]
    return res.status(400).json({
      error: first ? `Dados inválidos — ${first}` : 'Dados inválidos',
      code: 'VALIDATION_ERROR',
      details: flat.fieldErrors,
    })
  }

  // 2b. Erros do body-parser já trazem o status certo (JSON quebrado, corpo grande demais).
  const bodyErr = err as { type?: unknown; status?: unknown } | null
  if (bodyErr && typeof bodyErr === 'object' && typeof bodyErr.type === 'string' && typeof bodyErr.status === 'number') {
    const status = bodyErr.status
    if (status === 413) {
      return res.status(413).json({ error: 'Arquivo grande demais: cada anexo pode ter no máximo 10 MB.', code: 'PAYLOAD_TOO_LARGE' })
    }
    if (status === 400) {
      return res.status(400).json({ error: 'Corpo da requisição inválido (JSON malformado).', code: 'INVALID_JSON' })
    }
  }

  // 3. Erros conhecidos do Prisma que têm tradução HTTP direta.
  // Checagem por 'code' em vez de instanceof PrismaClientKnownRequestError
  // para não acoplar o handler ao import do @prisma/client.
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code
    // P2003: FK violation. P2014: violação de relação obrigatória.
    if (code === 'P2003' || code === 'P2014') {
      return res.status(409).json({
        error: 'Registro em uso por outros dados e não pode ser excluído',
        code: 'IN_USE',
        ...(env.NODE_ENV !== 'production' ? { details: String(err) } : {}),
      })
    }
    // P2025: registro alvo do update/delete não existe.
    if (code === 'P2025') {
      return res.status(404).json({
        error: 'Registro não encontrado',
        code: 'NOT_FOUND',
      })
    }
    // P2002: violação de unique constraint (ex: adicionar membro já existente).
    if (code === 'P2002') {
      return res.status(409).json({
        error: 'Este registro já existe',
        code: 'ALREADY_EXISTS',
        ...(env.NODE_ENV !== 'production' ? { details: String(err) } : {}),
      })
    }
  }

  // 4. Erros inesperados (Erros de banco, syntax errors, etc.)
  // Registramos no log para depuração futura.
  logger.error('[ISA] Erro inesperado:', err)

  // Retornamos 500 sem expor a stack trace ou detalhes sensíveis em produção.
  return res.status(500).json({
    error: 'Erro interno do servidor',
    code: 'INTERNAL_ERROR',
    ...(env.NODE_ENV !== 'production' ? { details: String(err) } : {}),
  })
}
