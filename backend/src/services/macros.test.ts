import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import prisma from '../config/prisma'
import { createMacro, deleteMacro, listMacros } from './macros'

describe('Macros Service - Exclusão', () => {
  let macroId: string

  beforeAll(async () => {
    await prisma.macro.deleteMany({ where: { title: 'TEST_MACRO_DELETE' } })
  })

  afterAll(async () => {
    await prisma.macro.deleteMany({ where: { title: 'TEST_MACRO_DELETE' } })
  })

  it('deve criar uma macro com sucesso', async () => {
    const macro = await createMacro({
      title: 'TEST_MACRO_DELETE',
      content: 'Conteúdo da macro de teste para exclusão.',
      active: true
    })
    expect(macro).toBeDefined()
    expect(macro.title).toBe('TEST_MACRO_DELETE')
    macroId = macro.id
  })

  it('deve listar a macro criada', async () => {
    const list = await listMacros()
    const found = list.find(m => m.id === macroId)
    expect(found).toBeDefined()
  })

  it('deve excluir a macro criada e não encontrá-la na listagem', async () => {
    await deleteMacro(macroId)
    const list = await listMacros()
    const found = list.find(m => m.id === macroId)
    expect(found).toBeUndefined()
  })

  it('deve falhar ao tentar excluir uma macro inexistente', async () => {
    await expect(deleteMacro('inexistente-id-12345')).rejects.toThrow('Macro não encontrada')
  })
})
