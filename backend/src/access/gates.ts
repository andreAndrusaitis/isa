/**
 * Equivalência trava → capacidade: qual capacidade do catálogo responde o mesmo
 * que uma trava de hoje (authorize / authorizeArea / requireModule). Base da
 * troca das travas e do teste de equivalência.
 */
import type { Gate } from '../middlewares/auth'
import { CAPABILITIES, CAPABILITY_KEYS, type CapabilityKey } from './capabilities'

// 'sla' aparecia como cargo em routes/sla.ts (pacotes): não existe cargo com esse nome.
const ROLE_NAMES = new Set(['manager', 'supervisor', 'agent', 'user'])
const roleSet = (roles: readonly string[]) => [...new Set(roles.filter(r => ROLE_NAMES.has(r)))].sort().join(',')

export function capabilityForGate(gate: Gate): CapabilityKey | null {
  if (gate.kind === 'auth' || gate.kind === 'requester') return null
  if (gate.kind === 'cap') return gate.cap in CAPABILITIES ? (gate.cap as CapabilityKey) : null
  for (const key of CAPABILITY_KEYS) {
    const cap = CAPABILITIES[key] as { roles: readonly string[]; area?: string; module?: string }
    if (gate.kind === 'module') {
      if (cap.module === gate.module) return key
      continue
    }
    if (cap.module) continue
    const area = gate.kind === 'area' ? gate.area : undefined
    if (cap.area === area && roleSet(cap.roles) === roleSet(gate.roles)) return key
  }
  return null
}
