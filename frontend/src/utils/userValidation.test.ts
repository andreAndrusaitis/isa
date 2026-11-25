import { describe, expect, it } from 'vitest'
import { validateNewUser, describeApiError, validateUpdateUserAuth } from './userValidation'

const valido = {
  name: 'Maria Souza',
  email: 'maria@empresa.com.br',
  password: 'senha123',
  role: 'user',
  orgId: 'org-1',
}

describe('validateNewUser — espelha o createUserSchema do backend', () => {
  it('aceita um cadastro completo e devolve nome e e-mail normalizados', () => {
    const r = validateNewUser({ ...valido, name: '  Maria Souza  ', email: ' maria@empresa.com.br ' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.values).toEqual({ name: 'Maria Souza', email: 'maria@empresa.com.br' })
  })

  // Bug 1.2: nome em branco e senha curta chegavam ao POST /users e voltavam 400.
  it('recusa nome vazio', () => {
    expect(validateNewUser({ ...valido, name: '' })).toMatchObject({ ok: false })
  })

  it('recusa nome só com espaços', () => {
    expect(validateNewUser({ ...valido, name: '   ' })).toMatchObject({ ok: false })
  })

  it('recusa senha com menos de 8 caracteres', () => {
    const r = validateNewUser({ ...valido, password: '1234567' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('8 caracteres')
  })

  it('aceita senha com exatamente 8 caracteres', () => {
    expect(validateNewUser({ ...valido, password: '12345678' }).ok).toBe(true)
  })

  it('recusa e-mail sem domínio', () => {
    expect(validateNewUser({ ...valido, email: 'maria@empresa' })).toMatchObject({ ok: false })
  })

  it('recusa perfil não-admin sem empresa', () => {
    const r = validateNewUser({ ...valido, orgId: '' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('Empresa')
  })

  it('aceita admin sem empresa', () => {
    expect(validateNewUser({ ...valido, role: 'admin', orgId: '' }).ok).toBe(true)
  })

  it('valida o nome antes do e-mail, na ordem dos campos do formulário', () => {
    const r = validateNewUser({ ...valido, name: '', email: 'invalido' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('Nome')
  })

  it('aceita telefone em branco', () => {
    expect(validateNewUser({ ...valido, phone: '' }).ok).toBe(true)
  })

  it('aceita telefone fixo completo (10 dígitos)', () => {
    expect(validateNewUser({ ...valido, phone: '(11) 3456-7890' }).ok).toBe(true)
  })

  it('aceita telefone celular completo (11 dígitos)', () => {
    expect(validateNewUser({ ...valido, phone: '(11) 91234-5678' }).ok).toBe(true)
  })

  // Bug 1.6-relacionado: telefone incompleto voltava só "Dados inválidos" do backend,
  // sem apontar o campo. Agora barra no front com mensagem específica.
  it('recusa telefone incompleto e aponta o campo', () => {
    const r = validateNewUser({ ...valido, phone: '(11) 123' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.title).toContain('Telefone')
      expect(r.message).toContain('incompleto')
    }
  })
})

describe('describeApiError — traduz details.fieldErrors do Zod em vez do "Dados inválidos" genérico', () => {
  it('aponta o campo específico quando o backend devolve details.fieldErrors', () => {
    const err = { response: { data: { error: 'Dados inválidos', code: 'VALIDATION_ERROR', details: { phone: ['Custom phone error'] } } } }
    expect(describeApiError(err)).toBe('Telefone: Custom phone error')
  })

  it('junta múltiplos campos com erro', () => {
    const err = { response: { data: { details: { name: ['Required'], email: ['Invalid email'] } } } }
    const msg = describeApiError(err)
    expect(msg).toContain('Nome: é obrigatório')
    expect(msg).toContain('E-mail: formato de e-mail inválido')
  })

  it('cai para o texto genérico quando não há details', () => {
    const err = { response: { data: { error: 'E-mail já cadastrado' } } }
    expect(describeApiError(err)).toBe('E-mail já cadastrado')
  })

  it('cai para o fallback quando não há resposta de API', () => {
    const err = new Error('Network Error')
    expect(describeApiError(err, 'Falha ao salvar.')).toBe('Network Error')
  })
})

describe('validateUpdateUserAuth — validação de transição de método de autenticação', () => {
  it('exige senha ao mudar de microsoft para local', () => {
    const res = validateUpdateUserAuth('microsoft', 'local', '')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.title).toContain('Senha obrigatória')
      expect(res.message).toContain('nova senha inicial')
    }
  })

  it('rejeita senha curta (< 8 caracteres) ao mudar de microsoft para local', () => {
    const res = validateUpdateUserAuth('microsoft', 'local', '12345')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.title).toContain('Senha')
      expect(res.message).toContain('8 caracteres')
    }
  })

  it('aceita senha válida (>= 8 caracteres) ao mudar de microsoft para local', () => {
    const res = validateUpdateUserAuth('microsoft', 'local', 'senha123')
    expect(res.ok).toBe(true)
  })

  it('permite mudar de local para microsoft sem senha', () => {
    const res = validateUpdateUserAuth('local', 'microsoft')
    expect(res.ok).toBe(true)
  })

  it('permite permanecer em local sem fornecer nova senha', () => {
    const res = validateUpdateUserAuth('local', 'local')
    expect(res.ok).toBe(true)
  })
})

