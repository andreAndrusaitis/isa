import { create } from 'zustand'
import { parseSeeds, storeSeeds } from '@/lib/brandTheme'
import { systemConfigService } from '@/services/systemConfigService'

interface PublicConfigState {
  /** null enquanto a resposta não chega. */
  microsoftLogin: boolean | null
  load: () => Promise<void>
}

/** O que a tela precisa saber antes do login: cores da organização e logins disponíveis. */
export const usePublicConfig = create<PublicConfigState>(set => ({
  microsoftLogin: null,
  load: async () => {
    try {
      const config = await systemConfigService.getPublic()
      const seeds = parseSeeds(config.appearance)
      if (seeds) storeSeeds(seeds)
      set({ microsoftLogin: Boolean(config.login?.microsoft) })
    } catch {
      set(s => ({ microsoftLogin: s.microsoftLogin ?? false }))
    }
  },
}))
