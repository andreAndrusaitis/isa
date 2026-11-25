import { Router } from 'express'
import { AppError } from '../middlewares/errorHandler'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'
import { listEmailLogs, listEmailLogsByTicket, getEmailLog, EmailLogQuery, listInboundEmails, getEmailSettings, testEmailConnection } from '../services/emailLogs'
import { createAuditLog } from '../services/audit'
import { listBlocks, createBlock, deleteBlock } from '../services/email/blocklist'

// Logs de todo e-mail disparado pelo sistema — somente admin.
const router = Router()

router.use(authenticate)
router.use(requireCap('email_logs.view'))

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

router.get('/', async (req, res, next) => {
  try {
    const q: EmailLogQuery = {
      page: Number(req.query.page) || undefined,
      limit: Number(req.query.limit) || undefined,
      kind: str(req.query.kind),
      status: str(req.query.status),
      ticketId: str(req.query.ticketId),
      search: str(req.query.search)?.slice(0, 100),
      startDate: str(req.query.startDate),
      endDate: str(req.query.endDate),
    }
    res.json(req.query.groupBy === 'ticket' ? await listEmailLogsByTicket(q) : await listEmailLogs(q))
  } catch (err) {
    next(err)
  }
})

// E-mails recebidos na caixa de atendimento e o que foi feito com cada um.
router.get('/inbound', async (req, res, next) => {
  try {
    res.json(await listInboundEmails({
      page: Number(req.query.page) || undefined,
      limit: Number(req.query.limit) || undefined,
      status: str(req.query.status),
      search: str(req.query.search)?.slice(0, 100),
      startDate: str(req.query.startDate),
      endDate: str(req.query.endDate),
    }))
  } catch (err) {
    next(err)
  }
})

// Estado da configuração de e-mail (vem das variáveis de ambiente; nunca expõe segredo).
router.get('/settings', async (_req, res, next) => {
  try {
    res.json(await getEmailSettings())
  } catch (err) {
    next(err)
  }
})

router.post('/settings/test', async (req, res, next) => {
  try {
    const result = await testEmailConnection()
    const user = (req as any).user
    createAuditLog({ userId: user?.sub, action: 'EMAIL_CONNECTION_TEST', resource: 'EMAIL', details: { ok: result.ok, error: result.error } })
    res.json(result)
  } catch (err) {
    next(err)
  }
})

// Remetentes bloqueados: e-mail/domínio que não abre chamado por e-mail nem pela API.
router.get('/blocks', async (_req, res, next) => {
  try {
    res.json(await listBlocks())
  } catch (err) {
    next(err)
  }
})

router.post('/blocks', async (req, res, next) => {
  try {
    res.status(201).json(await createBlock(req.body, (req as any).user?.sub))
  } catch (err) {
    next(err)
  }
})

router.delete('/blocks/:id', async (req, res, next) => {
  try {
    await deleteBlock(req.params.id as string, (req as any).user?.sub)
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

router.get('/:id', async (req, res, next) => {
  try {
    const log = await getEmailLog(req.params.id)
    if (!log) throw new AppError(404, 'Log de e-mail não encontrado', 'NOT_FOUND')
    res.json(log)
  } catch (err) {
    next(err)
  }
})

export default router
