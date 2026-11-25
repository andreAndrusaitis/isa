import { Request, Response, NextFunction } from 'express'
import * as McpTokens from '../services/mcpTokens'

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await McpTokens.listMcpTokens(req.user!.sub) })
  } catch (error) {
    next(error)
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const token = await McpTokens.createMcpToken(req.user!.sub, req.body)
    res.status(201).json({ data: token })
  } catch (error) {
    next(error)
  }
}

export async function revoke(req: Request, res: Response, next: NextFunction) {
  try {
    await McpTokens.revokeMcpToken(req.user!.sub, req.params.tokenId as string)
    res.status(204).send()
  } catch (error) {
    next(error)
  }
}
