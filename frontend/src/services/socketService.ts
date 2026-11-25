import { io, Socket } from 'socket.io-client'

// Com VITE_API_URL=/api (atrás do nginx) sobra vazio: vale o próprio endereço do portal.
const SOCKET_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace('/api', '') || window.location.origin

let socket: Socket | null = null

export function connectSocket(token: string): Socket {
  // Se já existe socket (conectado ou reconectando), atualiza o token e retorna
  // NUNCA destruir o socket aqui — listeners de TicketDetail/UserTicketDetail ficariam órfãos
  if (socket) {
    ;(socket.auth as any).token = token
    if (!socket.connected) socket.connect()
    return socket
  }

  socket = io(SOCKET_URL, {
    auth: { token },
    transports: ['websocket'], // WS puro: evita "400 Unknown session" no Azure App Service (polling exige sticky session)
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
    timeout: 20000,
  })

  socket.on('connect', () => {
    console.log('[Socket] Conectado:', socket?.id)
  })

  socket.on('disconnect', (reason) => {
    console.warn('[Socket] Desconectado:', reason)
  })

  socket.on('connect_error', (err) => {
    console.error('[Socket] Erro de conexão:', err.message)
  })

  return socket
}

export function disconnectSocket(): void {
  if (socket) {
    socket.removeAllListeners()
    socket.disconnect()
    socket = null
  }
}

export function getSocket(): Socket | null {
  return socket
}

export function joinTicketRoom(ticketId: string): void {
  socket?.emit('ticket:join', ticketId)
}

export function leaveTicketRoom(ticketId: string): void {
  socket?.emit('ticket:leave', ticketId)
}

export function joinProjectRoom(projectId: string): void {
  socket?.emit('project:join', projectId)
}

export function leaveProjectRoom(projectId: string): void {
  socket?.emit('project:leave', projectId)
}

type Listener = (...args: any[]) => void
interface Emitter { on(evt: string, fn: Listener): unknown; off(evt: string, fn?: Listener): unknown }

/**
 * Registra ouvintes e, na limpeza, desliga SÓ os que registrou. `socket.off(evt)`
 * sem a função tira o ouvinte de todo mundo (ex.: o detalhe do chamado aberto
 * parava de se atualizar quando a lista religava o socket ao renovar a sessão).
 */
export function listenAll(socket: Emitter) {
  const subs: Array<[string, Listener]> = []
  return {
    on(evt: string, fn: Listener) {
      socket.on(evt, fn)
      subs.push([evt, fn])
    },
    off() {
      for (const [evt, fn] of subs) socket.off(evt, fn)
      subs.length = 0
    },
  }
}
