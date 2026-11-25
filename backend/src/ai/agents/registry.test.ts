import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'

vi.mock('../../config/env', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../config/env')>()
  return { env: { ...mod.env, AI_TRIAGE_MODE: 'shadow', AI_INTAKE_MODE: 'off' } }
})

import prisma from '../../config/prisma'
import { AGENTS, agentMode, agentRuntime, checkLoadedOptions, describeSettings, normalizeConfig, setAgentConfig, setAgentMode, validateConfigInput } from './registry'

// Restaura a escolha do admin que existia antes do teste (só a linha do agente usado).
let saved: { agent: string; mode: string; config: any } | null | undefined
afterEach(async () => {
  if (saved === undefined) return
  if (saved) await prisma.aiAgentSetting.upsert({ where: { agent: saved.agent }, create: saved, update: { mode: saved.mode, config: saved.config } })
  else await prisma.aiAgentSetting.deleteMany({ where: { agent: 'intake' } })
  saved = undefined
})
const remember = async () => {
  const row = await prisma.aiAgentSetting.findUnique({ where: { agent: 'intake' } })
  saved = row ? { agent: row.agent, mode: row.mode, config: row.config ?? undefined } : null
  await prisma.aiAgentSetting.deleteMany({ where: { agent: 'intake' } })
}

describe('modo dos agentes', () => {
  it('sem escolha do admin vale o padrão do env', async () => {
    await remember()
    expect(await agentMode('intake')).toBe('off')
  })

  it('a escolha do admin vale no lugar do env, e pode ser trocada', async () => {
    await remember()
    await setAgentMode('intake', 'apply')
    expect(await agentMode('intake')).toBe('apply')
    await setAgentMode('intake', 'shadow')
    expect(await agentMode('intake')).toBe('shadow')
  })

  it('agente desconhecido fica desligado', async () => {
    expect(await agentMode('nao-existe')).toBe('off')
  })
})

describe('configurações dos agentes', () => {
  const intake = AGENTS.find(a => a.key === 'intake')!

  it('sem config gravada valem os padrões', async () => {
    await remember()
    expect((await agentRuntime('intake')).config).toEqual({ rigor: 'balanced', maxAsks: 3, personalize: true })
  })

  it('valor gravado inválido volta ao padrão; o válido vale', async () => {
    await remember()
    await prisma.aiAgentSetting.create({ data: { agent: 'intake', mode: 'shadow', config: { maxAsks: 9, personalize: false, rigor: 'extremo', lixo: 1 } } })
    expect(await agentRuntime('intake')).toEqual({ mode: 'shadow', config: { rigor: 'balanced', maxAsks: 3, personalize: false } })
  })

  it('setAgentConfig mescla com o que já existe e mantém o modo', async () => {
    await remember()
    await setAgentMode('intake', 'apply')
    await setAgentConfig('intake', { maxAsks: 1 })
    const r = await setAgentConfig('intake', { rigor: 'conservative' })
    expect(r.before).toMatchObject({ maxAsks: 1, rigor: 'balanced' })
    expect(await agentRuntime('intake')).toEqual({ mode: 'apply', config: { rigor: 'conservative', maxAsks: 1, personalize: true } })
  })

  it('validação: chave desconhecida, tipo errado e fora do intervalo são recusados', () => {
    expect(validateConfigInput(intake, { maxAsks: 2, rigor: 'bold' })).toEqual({ maxAsks: 2, rigor: 'bold' })
    expect(() => validateConfigInput(intake, { nada: true })).toThrow('desconhecida')
    expect(() => validateConfigInput(intake, { maxAsks: 4 })).toThrow('inválido')
    expect(() => validateConfigInput(intake, { personalize: 'sim' })).toThrow('inválido')
    const triage = AGENTS.find(a => a.key === 'triage')!
    expect(validateConfigInput(triage, { applyFields: ['priority', 'priority'] })).toEqual({ applyFields: ['priority'] })
    expect(() => validateConfigInput(triage, { applyFields: ['status'] })).toThrow('inválido')
  })
})

describe('agente knowledge', () => {
  const knowledge = AGENTS.find(a => a.key === 'knowledge')!

  it('nasce desligado, com rigor Equilibrado e piloto vazio', async () => {
    await prisma.aiAgentSetting.deleteMany({ where: { agent: 'knowledge' } })
    expect(await agentRuntime('knowledge')).toEqual({ mode: 'off', config: { rigor: 'balanced', pilotOrgIds: [], pilotCategoryIds: [] } })
  })

  it('rigor é escolha fechada: número não entra', () => {
    expect(() => validateConfigInput(knowledge, { rigor: 0.85 })).toThrow('inválido')
    expect(knowledge.settings.find(f => f.key === 'rigor')?.kind).toBe('rigor')
  })

  it('lista vinda do banco: aceita ids, recusa o que não é lista de texto', () => {
    expect(validateConfigInput(knowledge, { pilotOrgIds: ['a', 'a', 'b'] })).toEqual({ pilotOrgIds: ['a', 'b'] })
    expect(() => validateConfigInput(knowledge, { pilotOrgIds: 'a' })).toThrow('inválido')
    expect(() => validateConfigInput(knowledge, { pilotOrgIds: [1] })).toThrow('inválido')
    expect(() => validateConfigInput(knowledge, { pilotCategoryIds: [''] })).toThrow('inválido')
  })

  it('id gravado que saiu do banco fica na lista: voltar ao padrão vazio abriria o piloto para todos', () => {
    expect(normalizeConfig(knowledge, { pilotOrgIds: ['sumiu'] })).toMatchObject({ pilotOrgIds: ['sumiu'] })
  })

  describe('com empresa e categoria no banco', () => {
    const SUFFIX = `regkb-${Date.now()}`
    let orgId: string, catId: string, inactiveOrgId: string

    beforeAll(async () => {
      orgId = (await prisma.organization.create({ data: { name: `Org ${SUFFIX}` } })).id
      inactiveOrgId = (await prisma.organization.create({ data: { name: `Inativa ${SUFFIX}`, active: false } })).id
      catId = (await prisma.category.create({ data: { name: `Cat ${SUFFIX}` } })).id
    })
    afterAll(async () => {
      await prisma.aiAgentSetting.deleteMany({ where: { agent: 'knowledge' } })
      await prisma.organization.deleteMany({ where: { id: { in: [orgId, inactiveOrgId] } } })
      await prisma.category.deleteMany({ where: { id: catId } })
    })

    it('a declaração para a tela traz as opções do banco, sem as funções internas', async () => {
      const fields = await describeSettings(knowledge, normalizeConfig(knowledge, {}))
      const orgs = fields.find(f => f.key === 'pilotOrgIds')!
      expect(orgs).toMatchObject({ kind: 'multi', label: expect.any(String), help: expect.stringContaining('todas') })
      expect(orgs.options).toContainEqual({ value: orgId, label: `Org ${SUFFIX}` })
      expect(orgs.options?.some(o => o.value === inactiveOrgId)).toBe(false)
      expect(fields.find(f => f.key === 'pilotCategoryIds')!.options).toContainEqual({ value: catId, label: `Cat ${SUFFIX}` })
      expect(orgs).not.toHaveProperty('default')
      expect(orgs).not.toHaveProperty('loadOptions')
    })

    it('marcada que saiu do banco aparece na tela, para o admin poder desmarcar', async () => {
      const fields = await describeSettings(knowledge, normalizeConfig(knowledge, { pilotOrgIds: [inactiveOrgId] }))
      expect(fields.find(f => f.key === 'pilotOrgIds')!.options).toContainEqual({ value: inactiveOrgId, label: 'Removida ou inativa' })
    })

    it('agente de opções fixas continua igual', async () => {
      const intake = AGENTS.find(a => a.key === 'intake')!
      const fields = await describeSettings(intake, normalizeConfig(intake, {}))
      expect(fields.map(f => f.key)).toEqual(['rigor', 'maxAsks', 'personalize'])
      expect(fields[0]).not.toHaveProperty('default')
    })

    it('id desconhecido é recusado; o que já estava gravado segue aceito', async () => {
      await prisma.aiAgentSetting.deleteMany({ where: { agent: 'knowledge' } })
      await expect(checkLoadedOptions(knowledge, { pilotOrgIds: [orgId] })).resolves.toBeUndefined()
      await expect(checkLoadedOptions(knowledge, { pilotOrgIds: ['nao-existe'] })).rejects.toThrow('inválido')
      await expect(checkLoadedOptions(knowledge, { rigor: 'bold' })).resolves.toBeUndefined()
      await setAgentConfig('knowledge', { pilotOrgIds: ['ja-gravada'] })
      await expect(checkLoadedOptions(knowledge, { pilotOrgIds: ['ja-gravada', orgId] })).resolves.toBeUndefined()
    })
  })
})
