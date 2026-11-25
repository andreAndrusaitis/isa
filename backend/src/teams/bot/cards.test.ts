import { describe, expect, it } from 'vitest'
import {
  agentReplyCard, categoryCard, confirmationCard, excerpt, fieldInput, parseCardAction, subcategoryCard,
  ticketFormCard, ticketFromSubmit, toSpecialData, validateSpecialData,
  type AdaptiveCard, type CardSubcategory, type SpecialFormField,
} from './cards'

// Percorre o card inteiro (body, colunas, containers, actions, selectAction).
function walk(node: unknown, out: Array<Record<string, any>> = []): Array<Record<string, any>> {
  if (Array.isArray(node)) node.forEach(n => walk(n, out))
  else if (node && typeof node === 'object') {
    out.push(node as Record<string, any>)
    Object.values(node).forEach(v => walk(v, out))
  }
  return out
}
const ofType = (c: AdaptiveCard, type: string) => walk(c).filter(n => n.type === type)
const submits = (c: AdaptiveCard) => ofType(c, 'Action.Submit')

const expectEnvelope = (c: AdaptiveCard) =>
  expect(c).toMatchObject({ type: 'AdaptiveCard', version: '1.5', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json' })

const allTypes: SpecialFormField[] = [
  { key: 'nome_completo', label: 'Nome completo', type: 'text', required: true },
  { key: 'observacoes', label: 'Observações', type: 'textarea', required: false },
  { key: 'email_pessoal', label: 'E-mail pessoal', type: 'email', required: true },
  { key: 'data_inicio', label: 'Data de início', type: 'date', required: true },
  { key: 'cargo', label: 'Cargo', type: 'select', required: true, options: [{ value: 'dev', label: 'Desenvolvedor' }, { value: 'gp', label: 'Gerente de projetos' }] },
  { key: 'acessos', label: 'Acessos', type: 'select', multiple: true, required: false, options: [{ value: 'vpn', label: 'VPN' }, { value: 'erp,fin', label: 'ERP (financeiro)' }, { value: 'erp', label: 'ERP' }] },
  { key: 'legado', label: 'Campo antigo', required: false },
]
const onboarding: CardSubcategory = { id: 'sub-onb', name: 'Onboarding', icon: '🧑‍💻', description: 'Entrada de colaborador', is_special: true, special_form_schema: allTypes }
const comum: CardSubcategory = { id: 'sub-vpn', name: 'VPN', icon: '🔐', is_special: false, special_form_schema: null }

describe('categoryCard', () => {
  const cats = [
    { id: 'c1', name: 'Rede e VPN', icon: '☁', description: 'Assinaturas e recursos' },
    { id: 'c2', name: 'Segurança', icon: '🛡' },
    { id: 'c3', name: 'E-mail e colaboração', icon: 'data:image/png;base64,AAAA', image_url: 'https://cdn.exemplo.com/email.png' },
  ]

  it('monta a grade 2 por linha com um Action.Submit por categoria', () => {
    const c = categoryCard(cats)
    expectEnvelope(c)
    expect(c).toMatchSnapshot()
    expect(ofType(c, 'ColumnSet')).toHaveLength(2)
    expect(ofType(c, 'ColumnSet').every(r => r.columns.length === 2)).toBe(true)
    expect(submits(c).map(a => a.data)).toEqual([{ acao: 'categoria', id: 'c1' }, { acao: 'categoria', id: 'c2' }, { acao: 'categoria', id: 'c3' }])
  })

  it('ícone emoji vira prefixo, data:image é ignorado e image_url https vira Image', () => {
    const texts = ofType(categoryCard(cats), 'TextBlock').map(t => t.text)
    expect(texts).toContain('☁ Rede e VPN')
    expect(texts).toContain('E-mail e colaboração')
    expect(ofType(ticketFormCard(onboarding), 'TextBlock')[0].text).toBe('🧑‍💻 Onboarding')
    expect(ofType(categoryCard([{ id: 'x', name: 'Rede', icon: 'Monitor' }]), 'TextBlock').map(t => t.text)).toContain('Rede')
    expect(ofType(categoryCard(cats), 'Image')).toEqual([{ type: 'Image', url: 'https://cdn.exemplo.com/email.png', size: 'Small', altText: 'E-mail e colaboração' }])
  })

  it('sem categorias avisa em vez de mostrar grade vazia', () => {
    const c = categoryCard([])
    expect(c).toMatchSnapshot()
    expect(submits(c)).toHaveLength(0)
  })
})

describe('subcategoryCard', () => {
  it('lista as subcategorias com data de subcategoria e botão de voltar', () => {
    const c = subcategoryCard({ id: 'c1', name: 'Rede e VPN', icon: '☁' }, [{ id: 's1', name: 'Criar recurso' }, { id: 's2', name: 'Custos', description: 'Fatura e orçamento' }])
    expectEnvelope(c)
    expect(c).toMatchSnapshot()
    expect(submits(c).map(a => a.data)).toEqual([
      { acao: 'subcategoria', id: 's1', categoryId: 'c1' },
      { acao: 'subcategoria', id: 's2', categoryId: 'c1' },
      { acao: 'categorias' },
    ])
  })

  it('categoria sem subcategorias só oferece voltar', () => {
    const c = subcategoryCard({ id: 'c1', name: 'Vazia' }, [])
    expect(submits(c).map(a => a.data)).toEqual([{ acao: 'categorias' }])
  })
})

describe('fieldInput — mapeamento de cada tipo', () => {
  it('text → Input.Text', () => {
    expect(fieldInput(allTypes[0])).toEqual({ type: 'Input.Text', id: 'sf_nome_completo', label: 'Nome completo', isRequired: true, errorMessage: 'Preencha o campo obrigatório: Nome completo' })
  })
  it('textarea → Input.Text multilinha', () => {
    expect(fieldInput(allTypes[1])).toEqual({ type: 'Input.Text', id: 'sf_observacoes', label: 'Observações', isRequired: false, isMultiline: true })
  })
  it('email → Input.Text style Email', () => {
    expect(fieldInput(allTypes[2])).toMatchObject({ type: 'Input.Text', id: 'sf_email_pessoal', style: 'Email', isRequired: true, errorMessage: 'Preencha o campo obrigatório: E-mail pessoal' })
  })
  it('date → Input.Date', () => {
    expect(fieldInput(allTypes[3])).toEqual({ type: 'Input.Date', id: 'sf_data_inicio', label: 'Data de início', isRequired: true, errorMessage: 'Preencha o campo obrigatório: Data de início' })
  })
  it('select → Input.ChoiceSet compacto com as opções', () => {
    expect(fieldInput(allTypes[4])).toMatchObject({
      type: 'Input.ChoiceSet', id: 'sf_cargo', isMultiSelect: false, style: 'compact', isRequired: true,
      choices: [{ title: 'Desenvolvedor', value: 'dev' }, { title: 'Gerente de projetos', value: 'gp' }],
    })
  })
  it('select múltiplo → Input.ChoiceSet isMultiSelect expandido', () => {
    expect(fieldInput(allTypes[5])).toMatchObject({ type: 'Input.ChoiceSet', id: 'sf_acessos', isMultiSelect: true, style: 'expanded', isRequired: false })
    expect(fieldInput(allTypes[5])).not.toHaveProperty('errorMessage')
  })
  it('campo antigo sem tipo → Input.Text', () => {
    expect(fieldInput(allTypes[6])).toEqual({ type: 'Input.Text', id: 'sf_legado', label: 'Campo antigo', isRequired: false })
  })
})

describe('ticketFormCard', () => {
  it('subcategoria especial usa os campos do formulário dinâmico, sem título/descrição', () => {
    const c = ticketFormCard(onboarding, 'Pessoas')
    expectEnvelope(c)
    expect(c).toMatchSnapshot()
    const ids = walk(c.body).filter(n => typeof n.type === 'string' && n.type.startsWith('Input.')).map(n => n.id)
    expect(ids).toEqual(allTypes.map(f => `sf_${f.key}`))
    expect(walk(c.body).filter(n => n.isRequired).map(n => n.id)).toEqual(['sf_nome_completo', 'sf_email_pessoal', 'sf_data_inicio', 'sf_cargo'])
    expect(walk(c.body).filter(n => n.isRequired).every(n => n.errorMessage)).toBe(true)
    expect(c.actions?.[0]).toMatchObject({ type: 'Action.Submit', title: 'Abrir chamado', data: { acao: 'abrir', subcategoryId: 'sub-onb' } })
    expect(c.actions?.[1]).toMatchObject({ data: { acao: 'categorias' }, associatedInputs: 'none' })
  })

  it('subcategoria comum pede título e descrição obrigatórios', () => {
    const c = ticketFormCard(comum)
    expect(c).toMatchSnapshot()
    expect(walk(c.body).filter(n => n.type === 'Input.Text').map(n => [n.id, n.isRequired, !!n.isMultiline])).toEqual([['titulo', true, false], ['descricao', true, true]])
  })

  it('especial sem campos cai no formulário comum', () => {
    const ids = walk(ticketFormCard({ ...onboarding, special_form_schema: [] }).body).filter(n => n.id).map(n => n.id)
    expect(ids).toEqual(['titulo', 'descricao'])
  })
})

describe('confirmationCard', () => {
  it('mostra o resumo e os fatos, com Confirmar/Cancelar levando a ferramenta', () => {
    const c = confirmationCard({ tool: 'abrir_chamado', input: { title: 'VPN' }, summary: 'Abrir chamado "VPN caiu" em Infra › VPN' }, [{ title: 'Prioridade', value: 'Média' }])
    expectEnvelope(c)
    expect(c).toMatchSnapshot()
    expect(c.actions?.map(a => [a.title, a.data])).toEqual([
      ['Confirmar', { acao: 'confirmar', tool: 'abrir_chamado' }],
      ['Cancelar', { acao: 'cancelar', tool: 'abrir_chamado' }],
    ])
    expect(ofType(confirmationCard({ tool: 't', input: {}, summary: 's' }), 'FactSet')).toHaveLength(0)
  })
})

describe('agentReplyCard', () => {
  it('traz número, trecho e campo de resposta com Responder', () => {
    const c = agentReplyCard({ ticketId: 't-1', displayNumber: 'ISA-000123', title: 'VPN caiu', agentName: 'Maria', message: '<p>Olá!&nbsp;Pode testar de novo?</p><p>Reiniciei o túnel.</p>', url: 'https://isa.example.com/chamados/t-1' })
    expectEnvelope(c)
    expect(c).toMatchSnapshot()
    expect(ofType(c, 'TextBlock').map(t => t.text)).toContain('Olá! Pode testar de novo? Reiniciei o túnel.')
    expect(ofType(c, 'Input.Text')[0]).toMatchObject({ id: 'resposta', isRequired: true, isMultiline: true, errorMessage: expect.any(String) })
    expect(c.actions?.[0]).toMatchObject({ type: 'Action.Submit', title: 'Responder', data: { acao: 'responder', ticketId: 't-1' } })
    expect(c.actions?.[1]).toMatchObject({ type: 'Action.OpenUrl', url: 'https://isa.example.com/chamados/t-1' })
  })

  it('sem nome do analista e sem link', () => {
    const c = agentReplyCard({ ticketId: 't-2', displayNumber: 'ISA-2', message: 'ok' })
    expect(ofType(c, 'TextBlock')[0].text).toBe('O analista respondeu o chamado ISA-2')
    expect(c.actions).toHaveLength(1)
  })

  it('excerpt corta mensagens longas com reticências', () => {
    const e = excerpt('a'.repeat(500))
    expect(e).toHaveLength(300)
    expect(e.endsWith('…')).toBe(true)
  })
})

describe('parseCardAction', () => {
  it('lê cada ação dos cards', () => {
    expect(parseCardAction({ acao: 'categorias' })).toEqual({ acao: 'categorias' })
    expect(parseCardAction({ acao: 'categoria', id: 'c1' })).toEqual({ acao: 'categoria', id: 'c1' })
    expect(parseCardAction({ acao: 'subcategoria', id: 's1', categoryId: 'c1' })).toEqual({ acao: 'subcategoria', id: 's1', categoryId: 'c1' })
    expect(parseCardAction({ acao: 'abrir', subcategoryId: 'sub-onb', sf_nome_completo: 'Ana' })).toEqual({ acao: 'abrir', subcategoryId: 'sub-onb', values: { sf_nome_completo: 'Ana' } })
    expect(parseCardAction({ acao: 'confirmar', tool: 'abrir_chamado' })).toEqual({ acao: 'confirmar', tool: 'abrir_chamado' })
    expect(parseCardAction({ acao: 'cancelar' })).toEqual({ acao: 'cancelar' })
    expect(parseCardAction({ acao: 'responder', ticketId: 't-1', resposta: '  testei, voltou  ' })).toEqual({ acao: 'responder', ticketId: 't-1', text: 'testei, voltou' })
  })

  it('ignora o que não veio dos nossos cards', () => {
    for (const v of [null, undefined, 'texto', [], {}, { acao: 'outra' }, { acao: 'categoria' }, { acao: 'abrir' }, { acao: 'responder', resposta: 'x' }]) {
      expect(parseCardAction(v)).toBeNull()
    }
  })
})

describe('toSpecialData / validateSpecialData / ticketFromSubmit', () => {
  const values = {
    sf_nome_completo: '  Ana Souza ',
    sf_observacoes: '',
    sf_email_pessoal: 'ana@exemplo.com',
    sf_data_inicio: '2026-11-10',
    sf_cargo: 'dev',
    sf_acessos: 'vpn,erp,fin,erp',
    sf_legado: 'x',
    sf_nao_declarado: 'ignorar',
  }

  it('gera o special_data no formato do backend (select múltiplo vira lista, vazio fica de fora)', () => {
    expect(toSpecialData(allTypes, values)).toEqual({
      nome_completo: 'Ana Souza',
      email_pessoal: 'ana@exemplo.com',
      data_inicio: '2026-11-10',
      cargo: 'dev',
      acessos: ['vpn', 'erp,fin', 'erp'],
      legado: 'x',
    })
  })

  it('select múltiplo aceita lista e valor único', () => {
    expect(toSpecialData([allTypes[5]], { sf_acessos: ['vpn', ' erp '] })).toEqual({ acessos: ['vpn', 'erp'] })
    expect(toSpecialData([allTypes[5]], { sf_acessos: 'erp,fin' })).toEqual({ acessos: ['erp,fin'] })
    expect(toSpecialData([allTypes[5]], { sf_acessos: '' })).toEqual({})
  })

  it('valida obrigatórios, e-mail, data e opção', () => {
    expect(validateSpecialData(allTypes, toSpecialData(allTypes, values))).toBeNull()
    expect(validateSpecialData(allTypes, toSpecialData(allTypes, { ...values, sf_nome_completo: ' ' }))).toBe('Preencha o campo obrigatório: Nome completo')
    expect(validateSpecialData(allTypes, toSpecialData(allTypes, { ...values, sf_email_pessoal: 'ana' }))).toBe('E-mail inválido no campo E-mail pessoal')
    expect(validateSpecialData(allTypes, toSpecialData(allTypes, { ...values, sf_data_inicio: '10/11/2026' }))).toBe('Data inválida no campo Data de início')
    expect(validateSpecialData(allTypes, toSpecialData(allTypes, { ...values, sf_cargo: 'ceo' }))).toBe('Opção inválida para o campo Cargo')
    expect(validateSpecialData(allTypes, toSpecialData(allTypes, { ...values, sf_acessos: 'vpn,xyz' }))).toBe('Opção inválida para o campo Acessos')
    // Opcional vazio passa.
    expect(validateSpecialData(allTypes, toSpecialData(allTypes, { ...values, sf_acessos: '' }))).toBeNull()
  })

  it('ticketFromSubmit monta a abertura especial ou devolve o erro', () => {
    expect(ticketFromSubmit(onboarding, values)).toEqual({ ok: true, ticket: { subcategory_id: 'sub-onb', special_data: toSpecialData(allTypes, values) } })
    expect(ticketFromSubmit(onboarding, { ...values, sf_cargo: '' })).toEqual({ ok: false, error: 'Preencha o campo obrigatório: Cargo' })
  })

  it('ticketFromSubmit comum exige título e descrição', () => {
    expect(ticketFromSubmit(comum, { titulo: ' VPN caiu ', descricao: 'Desde as 9h' })).toEqual({ ok: true, ticket: { subcategory_id: 'sub-vpn', title: 'VPN caiu', description: 'Desde as 9h' } })
    expect(ticketFromSubmit(comum, { titulo: '', descricao: 'x' })).toEqual({ ok: false, error: 'Informe um título para o chamado' })
    expect(ticketFromSubmit(comum, { titulo: 'x' })).toEqual({ ok: false, error: 'Descreva o problema ou pedido' })
  })
})
