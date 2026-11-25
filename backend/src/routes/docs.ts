/**
 * Módulo Documentos: espaços, páginas aninhadas, versões e anexos. O conteúdo das
 * páginas (Yjs) trafega pelo tempo real (realtime/docs.ts); aqui vão só os metadados.
 * Não confundir com a wiki por projeto (routes/documents.ts).
 */
import { Router, type Request } from 'express'
import { authenticate } from '../middlewares/auth'
import { AppError } from '../middlewares/errorHandler'
import { requireCap } from '../access/middleware'
import { camelizeResponses } from '../utils/serialize'
import { getAuditInfo } from '../utils/audit'
import * as spaces from '../services/docSpaces'
import * as pages from '../services/docPages'
import * as trash from '../services/docTrash'
import * as versions from '../services/docVersions'
import * as attachments from '../services/docAttachments'
import type { DocActor } from '../services/docAccess'

const router = Router()

router.use(authenticate, requireCap('documents.use'))
router.use(camelizeResponses)

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
for (const param of ['spaceId', 'pageId', 'userId', 'versionId', 'attachmentId']) {
  router.param(param, (_req, _res, next, value) => {
    next(UUID.test(String(value)) ? undefined : new AppError(404, 'Registro não encontrado', 'NOT_FOUND'))
  })
}

const me = (req: Request): DocActor => ({ id: req.user!.sub, role: req.user!.role })
const id = (req: Request, param: string) => req.params[param] as string
const q = (req: Request) => (typeof req.query.q === 'string' ? req.query.q : '')

router.get('/access', (_req, res) => { res.json({ data: { ok: true } }) })

// ── Espaços ──
router.get('/spaces', async (req, res) => { res.json({ data: await spaces.listSpaces(me(req), req.query.archived === 'true') }) })
router.post('/spaces', async (req, res) => { res.status(201).json({ data: await spaces.createSpace(me(req), req.body, getAuditInfo(req)) }) })
router.get('/spaces/:spaceId', async (req, res) => { res.json({ data: await spaces.getSpace(me(req), id(req, 'spaceId')) }) })
router.patch('/spaces/:spaceId', async (req, res) => { res.json({ data: await spaces.updateSpace(me(req), id(req, 'spaceId'), req.body, getAuditInfo(req)) }) })
router.delete('/spaces/:spaceId', async (req, res) => {
  await spaces.archiveSpace(me(req), id(req, 'spaceId'), getAuditInfo(req))
  res.status(204).end()
})

router.get('/spaces/:spaceId/members', async (req, res) => { res.json({ data: await spaces.listMembers(me(req), id(req, 'spaceId')) }) })
router.put('/spaces/:spaceId/members/:userId', async (req, res) => {
  res.json({ data: await spaces.setMember(me(req), id(req, 'spaceId'), id(req, 'userId'), req.body, getAuditInfo(req)) })
})
router.delete('/spaces/:spaceId/members/:userId', async (req, res) => {
  await spaces.removeMember(me(req), id(req, 'spaceId'), id(req, 'userId'), getAuditInfo(req))
  res.status(204).end()
})

router.get('/spaces/:spaceId/pages', async (req, res) => { res.json({ data: await pages.listTree(me(req), id(req, 'spaceId')) }) })
router.post('/spaces/:spaceId/pages', async (req, res) => { res.status(201).json({ data: await pages.createPage(me(req), id(req, 'spaceId'), req.body) }) })

// ── Listas da pessoa ──
router.get('/trash', async (req, res) => { res.json({ data: await trash.listTrash(me(req)) }) })
router.get('/search', async (req, res) => { res.json({ data: await pages.searchPages(me(req), q(req)) }) })
router.get('/recent', async (req, res) => { res.json({ data: await pages.recentPages(me(req)) }) })
router.get('/favorites', async (req, res) => { res.json({ data: await pages.listFavorites(me(req)) }) })
router.get('/people', async (req, res) => { res.json({ data: await spaces.searchPeople(q(req)) }) })

// ── Páginas ──
router.get('/pages/:pageId', async (req, res) => { res.json({ data: await pages.getPage(me(req), id(req, 'pageId')) }) })
router.patch('/pages/:pageId', async (req, res) => { res.json({ data: await pages.updatePage(me(req), id(req, 'pageId'), req.body) }) })
router.delete('/pages/:pageId', async (req, res) => {
  await trash.trashPage(me(req), id(req, 'pageId'), getAuditInfo(req))
  res.status(204).end()
})
router.post('/pages/:pageId/move', async (req, res) => { res.json({ data: await pages.movePage(me(req), id(req, 'pageId'), req.body, getAuditInfo(req)) }) })
router.post('/pages/:pageId/duplicate', async (req, res) => { res.status(201).json({ data: await pages.duplicatePage(me(req), id(req, 'pageId')) }) })
router.post('/pages/:pageId/restore', async (req, res) => { res.json({ data: await trash.restorePage(me(req), id(req, 'pageId'), getAuditInfo(req)) }) })
router.delete('/pages/:pageId/permanent', async (req, res) => {
  await trash.deletePagePermanently(me(req), id(req, 'pageId'), getAuditInfo(req))
  res.status(204).end()
})
router.put('/pages/:pageId/favorite', async (req, res) => { res.json({ data: await pages.setFavorite(me(req), id(req, 'pageId'), true) }) })
router.delete('/pages/:pageId/favorite', async (req, res) => { res.json({ data: await pages.setFavorite(me(req), id(req, 'pageId'), false) }) })

// ── Versões ──
router.get('/pages/:pageId/versions', async (req, res) => { res.json({ data: await versions.listVersions(me(req), id(req, 'pageId')) }) })
router.post('/pages/:pageId/versions', async (req, res) => { res.status(201).json({ data: await versions.createVersion(me(req), id(req, 'pageId'), req.body) }) })
router.get('/versions/:versionId/ydoc', async (req, res) => {
  const ydoc = await versions.versionYdoc(me(req), id(req, 'versionId'))
  res.setHeader('Content-Type', 'application/octet-stream')
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Length', ydoc.length)
  res.end(ydoc) // sem res.send: o log de requisições serializaria o binário
})
router.post('/pages/:pageId/versions/:versionId/restore', async (req, res) => {
  res.json({ data: await versions.restoreVersion(me(req), id(req, 'pageId'), id(req, 'versionId')) })
})

// ── Anexos ──
router.post('/pages/:pageId/attachments', async (req, res) => { res.status(201).json({ data: await attachments.createAttachment(me(req), id(req, 'pageId'), req.body) }) })
router.get('/attachments/:attachmentId', async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store')
  res.json({ data: await attachments.getAttachment(me(req), id(req, 'attachmentId')) })
})

export default router
