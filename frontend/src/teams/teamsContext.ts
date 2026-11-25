/**
 * Detecção do Microsoft Teams (aba pessoal). Fora do Teams nada aqui chama o
 * SDK: só inicializa com sinal de Teams (isInTeams do SSO ou o ?teams=1 do
 * contentUrl). O SDK é carregado sob demanda, como no SSO.
 * O estado síncrono (useInTeams) começa pelo ?teams=1, para o layout não
 * piscar o cabeçalho, e é confirmado pelo contexto do SDK.
 */
import { useSyncExternalStore } from 'react'
import type { app } from '@microsoft/teams-js'
import { isInTeams } from '@/services/teamsSso'

const FLAG_KEY = 'isa-teams'
const SDK_TIMEOUT_MS = 4000

function readFlag(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get('teams') === '1') {
      sessionStorage.setItem(FLAG_KEY, '1')
      return true
    }
    return sessionStorage.getItem(FLAG_KEY) === '1'
  } catch {
    return false
  }
}

function clearFlag() {
  try { sessionStorage.removeItem(FLAG_KEY) } catch {}
}

let inTeams = typeof window !== 'undefined' && readFlag()
const listeners = new Set<() => void>()

function setInTeams(value: boolean) {
  if (typeof document !== 'undefined') {
    if (value) document.documentElement.setAttribute('data-host', 'teams')
    else document.documentElement.removeAttribute('data-host')
  }
  if (value === inTeams) return
  inTeams = value
  listeners.forEach(l => l())
}
if (inTeams) setInTeams(true)

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('teams-timeout')), SDK_TIMEOUT_MS)),
  ])
}

let contextPromise: Promise<app.Context | null> | null = null

/** Contexto da aba no Teams (memoizado); null fora do Teams. */
export function getTeamsContext(): Promise<app.Context | null> {
  contextPromise ??= (async () => {
    if (!inTeams && !isInTeams()) return null
    try {
      const { app } = await import('@microsoft/teams-js')
      await withTimeout(app.initialize())
      const context = await withTimeout(app.getContext())
      setInTeams(true)
      return context
    } catch {
      clearFlag()
      setInTeams(false)
      return null
    }
  })()
  return contextPromise
}

/** Leitura síncrona: true quando a aba está (ou foi aberta como) Teams. */
export function isTeamsHost(): boolean {
  return inTeams
}

export function useInTeams(): boolean {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => inTeams,
    () => false,
  )
}

/**
 * Abre um endereço pelo Teams (o iframe da aba bloqueia downloads e popups).
 * Devolve false fora do Teams ou se o Teams recusar, para quem chamou seguir o caminho do navegador.
 */
export async function openInTeams(url: string): Promise<boolean> {
  if (!inTeams) return false
  try {
    if (!(await getTeamsContext())) return false
    const { app } = await import('@microsoft/teams-js')
    await app.openLink(new URL(url, window.location.origin).href)
    return true
  } catch {
    return false
  }
}

/** Só para testes: esquece o contexto e relê o ?teams=1. */
export function resetTeamsContext() {
  contextPromise = null
  setInTeams(readFlag())
}
