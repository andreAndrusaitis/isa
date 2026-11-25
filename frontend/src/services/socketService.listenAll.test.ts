import { describe, it, expect, vi } from 'vitest'
import { listenAll } from './socketService'

// Mesmo contrato do socket.io: off(evt, fn) tira um ouvinte; off(evt) tira todos.
const fakeSocket = () => {
  const map = new Map<string, Array<(...a: any[]) => void>>()
  return {
    on: (evt: string, fn: any) => { map.set(evt, [...(map.get(evt) ?? []), fn]) },
    off: (evt: string, fn?: any) => { map.set(evt, fn ? (map.get(evt) ?? []).filter(f => f !== fn) : []) },
    emit: (evt: string, ...a: any[]) => { for (const f of map.get(evt) ?? []) f(...a) },
  }
}

describe('ouvintes do tempo real', () => {
  it('o jeito antigo (off sem a função) derruba o ouvinte do detalhe do chamado', () => {
    const socket = fakeSocket()
    const detail = vi.fn()
    socket.on('ticket:updated', detail)            // detalhe do chamado aberto
    socket.on('ticket:updated', () => {})           // lista
    socket.off('ticket:updated')                    // limpeza antiga da lista
    socket.emit('ticket:updated', { id: 'X' })
    expect(detail).not.toHaveBeenCalled()           // o defeito
  })

  it('listenAll desliga só o que a lista registrou', () => {
    const socket = fakeSocket()
    const detail = vi.fn()
    const list = vi.fn()
    socket.on('ticket:updated', detail)
    const l = listenAll(socket)
    l.on('ticket:updated', list)
    l.off()                                         // lista religa ao renovar a sessão
    socket.emit('ticket:updated', { id: 'X' })
    expect(detail).toHaveBeenCalledTimes(1)
    expect(list).not.toHaveBeenCalled()
  })
})
