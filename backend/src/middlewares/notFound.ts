import { Request, Response } from 'express'

export function notFound(req: Request, res: Response) {
  res.status(404).json({
    error: `Rota ${req.method} ${req.path} não encontrada`,
    code: 'NOT_FOUND',
  })
}
