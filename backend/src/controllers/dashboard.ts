import { Request, Response } from 'express'
import { z } from 'zod'
import * as dashboardService from '../services/dashboard'
import { getPortfolio, getShift } from '../services/homes'
import { getChannelMetrics } from '../services/channelMetrics'
import { AppError } from '../middlewares/errorHandler'

export const DashboardController = {
  // Turno do supervisor: exceções, decisões e carga.
  async shift(req: Request, res: Response) {
    const user = req.user!
    res.json({ data: await getShift(user.role, user.sub) })
  },

  // Carteira do gerente: cumprimento do prazo por cliente.
  async portfolio(req: Request, res: Response) {
    const user = req.user!
    const { days } = z.object({ days: z.coerce.number().int().min(7).max(180).default(30) }).parse(req.query)
    res.json({ data: await getPortfolio(user.role, user.sub, days) })
  },

  async overview(req: Request, res: Response) {
    const user = req.user!
    const data = await dashboardService.getOverview(user.role, user.sub, req.query as any)
    res.json({ data })
  },

  async productivity(req: Request, res: Response) {
    const user = req.user!
    const data = await dashboardService.getProductivity(user.role, user.sub, req.query as any)
    res.json({ data })
  },

  async management(req: Request, res: Response) {
    const user = req.user!
    const data = await dashboardService.getManagement(user.role, user.sub, req.query as any)
    res.json({ data })
  },

  async corporations(req: Request, res: Response) {
    const user = req.user!
    const data = await dashboardService.getCorporations(user.role, user.sub, req.query as any)
    res.json({ data })
  },

  async inactivity(req: Request, res: Response) {
    const user = req.user!
    const data = await dashboardService.getInactivity(user.role, user.sub, req.query as any)
    res.json({ data })
  },

  async slaExpiring(req: Request, res: Response) {
    const user = req.user!
    const data = await dashboardService.getSlaExpiring(user.role, user.sub, req.query as any)
    res.json({ data })
  },

  // Métricas por canal de origem no período (padrão: últimos 30 dias, até 1 ano).
  async channels(req: Request, res: Response) {
    const user = req.user!
    const { from, to } = channelPeriod.parse(req.query)
    const end = to ?? new Date()
    const start = from ?? new Date(end.getTime() - 30 * 86_400_000)
    if (start > end || end.getTime() - start.getTime() > 366 * 86_400_000) {
      throw new AppError(400, 'Período inválido: a data inicial deve ser antes da final e o intervalo de no máximo 1 ano', 'INVALID_PERIOD')
    }
    res.json({ data: await getChannelMetrics(user.role, user.sub, { from: start, to: end }) })
  },
}

const channelPeriod = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() })
