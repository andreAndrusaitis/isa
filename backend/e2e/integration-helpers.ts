// Apoio aos cenários da suíte integrada (arquivos 15 em diante). Tudo passa pela
// API real: o helpers.ts cuida do HTTP e das contas do seed.
import { execFileSync } from 'node:child_process'
import { U, as, http, login, uid } from './helpers'

type Quem = keyof typeof U

const STUB = process.env.E2E_FOUNDRY_STUB ?? 'http://127.0.0.1:3024'

async function stubControl(action: string) {
  const r = await fetch(`${STUB}/${action}`, { method: 'POST' })
  if (!r.ok) throw new Error(`stub ${action} → ${r.status}`)
}

/** Controle do e2e/foundry-stub.mjs, que só existe no npm run test:integration. */
export const foundry = {
  requests: async (): Promise<{ route: string; body: any }[]> => (await fetch(`${STUB}/requests`)).json(),
  reset: () => stubControl('reset'),
  down: () => stubControl('down'),
  up: () => stubControl('up'),
}

const PG = ['exec', process.env.E2E_PG_CONTAINER ?? 'isa_integration']
const PG_DB = process.env.E2E_PG_DB ?? 'isa_integration'

/** Leitura direta no banco descartável, para conferir o que a API não mostra. */
export function sql(query: string): string {
  return execFileSync('docker', [...PG, 'psql', '-U', 'isa', '-d', PG_DB, '-At', '-c', query], { encoding: 'utf8' }).trim()
}

/** O texto aparece em alguma tabela? Olha o banco inteiro, não só as tabelas da IA. */
export function bancoContem(texto: string): boolean {
  const busca = 'pg_dump -U isa -d "$1" --data-only | grep -c -F -- "$2" || true'
  return Number(execFileSync('docker', [...PG, 'sh', '-c', busca, 'sh', PG_DB, texto], { encoding: 'utf8' }).trim()) > 0
}

/** Liga o módulo Projetos para as contas. Devolve a função que desfaz. */
export async function ligarProjetos(...quem: Quem[]) {
  const admin = await as('admin')
  const ids = await Promise.all(quem.map(async q => (await login(U[q])).user.id as string))
  for (const id of ids) {
    const r = await http('PATCH', `/api/users/${id}`, { token: admin, body: { module_projects: true } })
    if (r.status !== 200) throw new Error(`ligarProjetos → ${r.status} ${JSON.stringify(r.body)}`)
  }
  return async () => {
    for (const id of ids) await http('PATCH', `/api/users/${id}`, { token: admin, body: { module_projects: null } })
  }
}

export interface Projeto { id: string; name: string; statuses: any[]; base: string }

export async function novoProjeto(dono: Quem, extra: Record<string, unknown> = {}): Promise<Projeto> {
  const token = await as(dono)
  const r = await http('POST', '/api/projects', { token, body: { name: `Integração ${uid()}`, ...extra } })
  if (r.status !== 201) throw new Error(`novoProjeto → ${r.status} ${JSON.stringify(r.body)}`)
  const id = r.body.data.id as string
  const statuses = (await http('GET', `/api/projects/${id}/statuses`, { token })).body.data
  return { id, name: r.body.data.name, statuses, base: `/api/projects/${id}` }
}

export async function novaTask(p: Projeto, quem: Quem, extra: Record<string, unknown> = {}) {
  const r = await http('POST', `${p.base}/tasks`, {
    token: await as(quem),
    body: { title: `Task ${uid()}`, statusId: p.statuses[0].id, ...extra },
  })
  if (r.status !== 201) throw new Error(`novaTask → ${r.status} ${JSON.stringify(r.body)}`)
  return r.body.data
}

export async function adicionarMembro(p: Projeto, dono: Quem, membro: Quem, role = 'member') {
  const userId = (await login(U[membro])).user.id
  const r = await http('POST', `${p.base}/members`, { token: await as(dono), body: { userId, role } })
  if (r.status !== 201) throw new Error(`adicionarMembro → ${r.status} ${JSON.stringify(r.body)}`)
  return userId as string
}

/** Sem 5xx e sem sucesso: o pedido foi recusado de propósito. */
export const recusado = (status: number) => status === 401 || status === 403 || status === 404
