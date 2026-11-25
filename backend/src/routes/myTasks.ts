import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middlewares/auth'
import { requireCap } from '../access/middleware'
import * as tasksService from '../services/tasks'
import { camelize } from '../utils/serialize'
import prisma from '../config/prisma'

const router = Router()

router.use(authenticate, requireCap('projects.use')) // módulo efetivo (carteira do gerente)

router.get('/', async (req, res, next) => {
  try {
    const tasks = await tasksService.listTasksForUser(req.user!.sub)
    res.json({ data: camelize(tasks) })
  } catch (err) { next(err) }
})

const columnsSchema = z.array(z.object({ key: z.string(), visible: z.boolean() }))

// Preferência pessoal de colunas visíveis/ordem na tabela de Minhas Tarefas.
// Guardada como JSON livre em users.my_tasks_columns — não há schema fixo de
// colunas no backend, o frontend é quem sabe interpretar as chaves.
router.get('/columns', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.sub }, select: { my_tasks_columns: true } })
    res.json({ data: user?.my_tasks_columns ?? null })
  } catch (err) { next(err) }
})

router.put('/columns', async (req, res, next) => {
  try {
    const columns = columnsSchema.parse(req.body.columns)
    await prisma.user.update({ where: { id: req.user!.sub }, data: { my_tasks_columns: columns } })
    res.json({ data: columns })
  } catch (err) { next(err) }
})

export default router
