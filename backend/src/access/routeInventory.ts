/**
 * Inventário de rotas: cada rota do app com as travas que ela atravessa.
 *
 * O Express 5 não guarda o caminho de montagem nas camadas, então o caminho é
 * gravado no registro: `installRouteRecorder()` precisa rodar ANTES de o app ser
 * importado. Uso só em teste (equivalência do porteiro, rota sem trava).
 */
import type { Gate } from '../middlewares/auth'

const MOUNT = Symbol('mountPath')

export interface InventoryRoute {
  method: string
  path: string
  gates: Gate[]
  /** As funções reais das travas, na ordem (para o teste chamar a trava da rota, não uma cópia). */
  gateFns: Array<((...args: any[]) => unknown) & { gate: Gate }>
  /** Middlewares sem etiqueta (checagens próprias: projeto, API key, escopo…). */
  others: string[]
}

let installed = false

export function installRouteRecorder() {
  if (installed) return
  installed = true
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Router = require('router')
  const use = Router.prototype.use
  Router.prototype.use = function (this: any, ...args: any[]) {
    let first = args[0]
    while (Array.isArray(first) && first.length) first = first[0]
    const path = typeof first === 'function' ? '/' : String(args[0])
    const before = this.stack.length
    const out = use.apply(this, args)
    for (let i = before; i < this.stack.length; i++) this.stack[i][MOUNT] = path
    return out
  }
}

const join = (a: string, b: string) => {
  const s = `${a.replace(/\/$/, '')}/${b.replace(/^\//, '')}`
  return s.length > 1 ? s.replace(/\/$/, '') : s
}
const under = (prefix: string, path: string) => prefix === '/' || path === prefix || path.startsWith(`${prefix}/`)

function gatesOf(fns: any[]) {
  const gates: Gate[] = []
  const gateFns: InventoryRoute['gateFns'] = []
  const others: string[] = []
  for (const fn of fns) {
    if (fn?.gate) { gates.push(fn.gate); gateFns.push(fn) }
    else if (fn?.name && fn.name !== 'handle' && fn.name !== '<anonymous>') others.push(fn.name)
  }
  return { gates, gateFns, others }
}

function walk(router: any, prefix: string, inherited: { fn: any; at: string }[], out: InventoryRoute[]) {
  const active = [...inherited]
  for (const layer of router.stack ?? []) {
    if (layer.route) {
      const path = join(prefix, layer.route.path)
      const routeFns = layer.route.stack.map((l: any) => l.handle)
      const applied = active.filter(a => under(a.at, path)).map(a => a.fn)
      const { gates, gateFns, others } = gatesOf([...applied, ...routeFns])
      const methods = Object.keys(layer.route.methods).filter(m => layer.route.methods[m])
      for (const method of methods) out.push({ method: method.toUpperCase(), path, gates, gateFns, others })
      continue
    }
    const at = join(prefix, layer[MOUNT] ?? '/')
    if (layer.handle?.stack) walk(layer.handle, at, active, out)
    else active.push({ fn: layer.handle, at })
  }
}

export function collectRoutes(app: any): InventoryRoute[] {
  const out: InventoryRoute[] = []
  walk(app.router ?? app._router, '/', [], out)
  return out
}
