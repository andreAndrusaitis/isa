import api from './api'
import type { BrandSeeds } from '@/lib/brandTheme'

export interface PublicConfig { appearance: BrandSeeds; login: { microsoft: boolean } }

export interface SsoSettings {
  source: 'admin' | 'env' | null
  active: boolean
  callbackUrl: string
  enabled: boolean
  clientId: string
  tenants: string[]
  authMethod: 'secret' | 'certificate'
  hasClientSecret: boolean
  hasCertificate: boolean
  certificateExpiresAt: string | null
}
export interface SsoInput {
  enabled: boolean
  clientId: string
  tenants: string[]
  authMethod: 'secret' | 'certificate'
  clientSecret?: string
  certificate?: string
  privateKey?: string
}

export interface AiSettings {
  source: 'admin' | 'env' | null
  active: boolean
  hasApiKey: boolean
  enabled: boolean
  kind: 'azure' | 'openai'
  endpoint: string
  chatModel: string
  embeddingModel: string
  apiVersion: string
  timeoutMs: number
  maxConcurrency: number
  assistantRateLimit: number
  assistantRateWindowMin: number
  assistantMaxConversationTokens: number
  assistantDailyTokenAlert: number
}
export type AiInput = Omit<AiSettings, 'source' | 'active' | 'hasApiKey'> & { apiKey?: string }
export interface TestResult { ok: boolean; message: string }

const BASE = '/system-config'
const data = <T>(p: Promise<{ data: { data: T } }>) => p.then(r => r.data.data)

export const systemConfigService = {
  getPublic: () => data<PublicConfig>(api.get(`${BASE}/public`)),
  saveAppearance: (seeds: BrandSeeds) => data<BrandSeeds>(api.put(`${BASE}/appearance`, seeds)),
  resetAppearance: () => data<BrandSeeds>(api.delete(`${BASE}/appearance`)),
  getSso: () => data<SsoSettings>(api.get(`${BASE}/sso`)),
  saveSso: (input: SsoInput) => data<SsoSettings>(api.put(`${BASE}/sso`, input)),
  resetSso: () => data<SsoSettings>(api.delete(`${BASE}/sso`)),
  testSso: () => data<TestResult>(api.post(`${BASE}/sso/test`)),
  getAi: () => data<AiSettings>(api.get(`${BASE}/ai`)),
  saveAi: (input: AiInput) => data<AiSettings>(api.put(`${BASE}/ai`, input)),
  resetAi: () => data<AiSettings>(api.delete(`${BASE}/ai`)),
  testAi: (input: AiInput) => data<TestResult>(api.post(`${BASE}/ai/test`, input)),
}
