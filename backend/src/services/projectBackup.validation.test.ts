// Backup inconsistente vira 400 antes da transação (antes: 500 do Prisma no meio do import).
// Nada é gravado: toPlan recusa antes de qualquer escrita.
//   cd backend && npx vitest run --fileParallelism=false src/services/projectBackup.validation.test.ts
import { describe, expect, it } from 'vitest'
import prisma from '../config/prisma'
import { BACKUP_FORMAT, previewImport, runImport } from './projectBackup'

const importer = { id: '00000000-0000-0000-0000-000000000000', email: 'ninguem@test.local' }

function backup(over: { project?: Record<string, unknown>; tasks?: Array<Record<string, unknown>> } = {}) {
  return {
    format: BACKUP_FORMAT,
    version: 1,
    project: {
      name: `Validação ${Date.now()}`,
      statuses: [{ name: 'A Fazer', color: '#999', category: 'open' }, { name: 'Concluído', color: '#0a0', category: 'done' }],
      taskTypes: [{ name: 'Tarefa', prefix: 'TASK', icon: 'CheckSquare', color: '#2563eb' }],
      ...over.project,
    },
    tasks: over.tasks ?? [t(1), t(2, { parentSeq: 1 })],
  }
}
const t = (seq: number, extra: Record<string, unknown> = {}) => ({ seq, typePrefix: 'TASK', typeNumber: seq, title: `T${seq}`, status: 'A Fazer', ...extra })

async function rejects(raw: unknown, message: RegExp) {
  await expect(previewImport(importer, raw)).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_BACKUP', message: expect.stringMatching(message) })
}

describe('validação do backup antes de importar', () => {
  it('backup consistente passa na pré-visualização', async () => {
    const preview = await previewImport(importer, backup())
    expect(preview.totalTasks).toBe(2)
  })

  it('recusa hierarquia circular e não cria nada', async () => {
    const raw = backup({ tasks: [t(1, { parentSeq: 3 }), t(2, { parentSeq: 1 }), t(3, { parentSeq: 2 })] })
    await rejects(raw, /hierarquia circular entre as tasks #1 → #3 → #2 → #1/)
    await expect(runImport(importer, raw)).rejects.toMatchObject({ statusCode: 400 })
    expect(await prisma.project.count({ where: { name: raw.project.name as string } })).toBe(0)
  })

  it('recusa task que é pai de si mesma', async () => {
    await rejects(backup({ tasks: [t(1, { parentSeq: 1 })] }), /circular.*#1 → #1/)
  })

  it('recusa datas que não são ISO 8601', async () => {
    await rejects(backup({ tasks: [t(1, { dueDate: '31/12/2026' })] }), /tasks\.0\.dueDate.*data inválida/)
    await rejects(backup({ tasks: [t(1, { dueDate: '2026-13-45T00:00:00Z' })] }), /data inválida/)
    await rejects(backup({ project: { startDate: 'amanhã' } }), /project\.startDate/)
    await rejects(backup({ tasks: [t(1, { comments: [{ authorEmail: 'a@b.c', body: 'x', createdAt: 'ontem' }] })] }), /comments\.0\.createdAt/)
  })

  it('aceita data só com dia (YYYY-MM-DD)', async () => {
    await expect(previewImport(importer, backup({ tasks: [t(1, { dueDate: '2026-12-01' })] }))).resolves.toBeTruthy()
  })

  it('recusa status, prefixo, lista, sprint ou etiqueta repetidos', async () => {
    await rejects(backup({ project: { statuses: [{ name: 'A Fazer', color: '#1', category: 'open' }, { name: 'A Fazer', color: '#2', category: 'done' }] } }), /status com nome repetido: "A Fazer"/)
    await rejects(backup({ project: { taskTypes: [{ name: 'Tarefa', prefix: 'TASK', icon: 'x', color: '#1' }, { name: 'Outra', prefix: 'TASK', icon: 'x', color: '#2' }] } }), /prefixo repetido: "TASK"/)
    await rejects(backup({ project: { lists: ['Sprint', 'Sprint'] } }), /listas com nome repetido/)
    await rejects(backup({ project: { sprints: [{ name: 'S1', status: 'planned', startDate: null, endDate: null }, { name: 'S1', status: 'active', startDate: null, endDate: null }] } }), /sprints com nome repetido: "S1"/)
    await rejects(backup({ project: { tags: [{ name: 'x', color: '#1' }, { name: 'x', color: '#2' }] } }), /etiquetas com nome repetido/)
  })

  it('recusa prefixo fora do padrão', async () => {
    await rejects(backup({ project: { taskTypes: [{ name: 'Tarefa', prefix: 'task-1', icon: 'x', color: '#1' }] }, tasks: [t(1, { typePrefix: 'task-1' })] }), /prefix.*prefixo inválido/)
  })

  it('recusa número de task ou chave repetidos', async () => {
    await rejects(backup({ tasks: [t(1), t(1)] }), /tasks com número repetido: #1/)
    await rejects(backup({ tasks: [t(1), t(2, { typeNumber: 1 })] }), /chave repetida.*TASK-1/)
  })
})
