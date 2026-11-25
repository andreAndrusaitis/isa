import type { PrismaClient } from '@prisma/client'
import { buildDocState, docFromState, extractText, type DocNode } from '../src/services/docContent'

// Ids fixos: rodar de novo não duplica nem sobrescreve o que a equipe já editou.
const SPACE_ID = '0d0c5000-0000-4000-8000-000000000001'
const PAGE_IDS = ['0d0c5000-0000-4000-8000-000000000011', '0d0c5000-0000-4000-8000-000000000012', '0d0c5000-0000-4000-8000-000000000013']

const t = (text: string, ...marks: string[]): DocNode => ({ type: 'text', text, marks })
const inline = (c: string | DocNode[]): DocNode[] => (typeof c === 'string' ? [t(c)] : c)
const p = (c: string | DocNode[]): DocNode => ({ type: 'paragraph', content: inline(c) })
const h = (level: number, text: string): DocNode => ({ type: 'heading', attrs: { level }, content: [t(text)] })
const ul = (...items: (string | DocNode[])[]): DocNode => ({ type: 'bulletList', content: items.map(i => ({ type: 'listItem', content: [p(i)] })) })
const ol = (...items: (string | DocNode[])[]): DocNode => ({ type: 'orderedList', attrs: { start: 1 }, content: items.map(i => ({ type: 'listItem', content: [p(i)] })) })
const tasks = (...items: [boolean, string][]): DocNode => ({
  type: 'taskList', content: items.map(([checked, text]) => ({ type: 'taskItem', attrs: { checked }, content: [p(text)] })),
})
const quote = (text: string): DocNode => ({ type: 'blockquote', content: [p(text)] })
const code = (text: string): DocNode => ({ type: 'codeBlock', attrs: { language: 'plaintext' }, content: [t(text)] })

const PAGES: { title: string; icon: string; nodes: DocNode[] }[] = [
  {
    title: 'Comece por aqui', icon: '👋',
    nodes: [
      h(1, 'Bem-vindo ao ISA'),
      p([t('Este espaço é o '), t('guia da equipe', 'bold'), t(': o que cada área faz, como atendemos e onde encontrar as coisas. Todo mundo com o módulo Documentos lê; quem é membro edita.')]),
      h(2, 'O que tem no ISA'),
      ul(
        [t('Chamados', 'bold'), t(': abertura, filas, prazos (SLA) e conversa com o cliente.')],
        [t('Projetos', 'bold'), t(': quadros, sprints, horas e relatórios.')],
        [t('Documentos', 'bold'), t(': páginas como esta, escritas a várias mãos.')],
      ),
      h(2, 'Primeiros passos'),
      tasks(
        [true, 'Entrar no ISA e conferir o seu perfil'],
        [false, 'Ver as filas em que você atende'],
        [false, 'Ler a página Atendimento no dia a dia'],
        [false, 'Criar a sua primeira página em um espaço da equipe'],
      ),
      quote('Dúvida que aparece duas vezes merece virar página.'),
    ],
  },
  {
    title: 'Atendimento no dia a dia', icon: '🎧',
    nodes: [
      h(1, 'Atendimento no dia a dia'),
      p('O caminho de um chamado, do começo ao fim:'),
      ol(
        'O cliente abre o chamado pelo portal, por e-mail ou pelo Teams.',
        'O roteamento escolhe a fila e o prazo começa a contar.',
        'Alguém da fila assume e responde dentro do prazo de primeira resposta.',
        'Resolvido o problema, registre a solução antes de encerrar.',
      ),
      h(2, 'Antes de responder'),
      tasks(
        [false, 'Conferir a empresa e o plano do cliente'],
        [false, 'Procurar chamados parecidos e a base de conhecimento'],
        [false, 'Usar nota interna para o que o cliente não deve ver'],
      ),
      h(2, 'Quando escalar'),
      p([t('Escale quando o prazo estiver em risco ou quando faltar acesso. Explique na '), t('nota interna', 'italic'), t(' o que já foi tentado.')]),
      quote('Quem recebe um chamado escalado deve entender o caso sem precisar perguntar de novo.'),
    ],
  },
  {
    title: 'Modelos de resposta', icon: '✍️',
    nodes: [
      h(1, 'Modelos de resposta'),
      p('Copie, ajuste e envie. Para os que se repetem muito, crie uma resposta pronta em Configurações.'),
      h(2, 'Primeiro contato'),
      code('Olá, {nome}! Recebemos o seu chamado e já estamos analisando.\nEm breve retorno com o próximo passo.'),
      h(2, 'Pedido de mais informações'),
      code('Olá, {nome}! Para avançar, preciso de:\n- o horário em que aconteceu\n- uma imagem da mensagem de erro'),
      h(2, 'Boas práticas'),
      ul('Frases curtas e sem jargão.', 'Diga o próximo passo e quando ele acontece.', 'Confirme a solução com o cliente antes de encerrar.'),
    ],
  },
]

export async function seedDocsGuide(prisma: PrismaClient, people: { owners: string[]; editors: string[] }) {
  console.log('Seeding docs guide...')
  const author = people.owners[0]
  await prisma.docSpace.upsert({
    where: { id: SPACE_ID },
    update: {},
    create: {
      id: SPACE_ID, name: 'Guia da equipe', icon: '📘', color: '#0f73ac', visibility: 'internal', created_by_id: author,
      description: 'Como trabalhamos e como usar o ISA.',
      members: {
        create: [
          ...people.owners.map(user_id => ({ user_id, role: 'owner' as const })),
          ...people.editors.map(user_id => ({ user_id, role: 'editor' as const })),
        ],
      },
    },
  })
  // Cada página dentro da anterior.
  for (const [i, page] of PAGES.entries()) {
    const ydoc = buildDocState(page.nodes)
    await prisma.docPage.upsert({
      where: { id: PAGE_IDS[i] },
      update: {},
      create: {
        id: PAGE_IDS[i], space_id: SPACE_ID, parent_id: i ? PAGE_IDS[i - 1] : null, title: page.title, icon: page.icon, position: 1,
        ydoc, content_text: extractText(docFromState(ydoc)), revision: 1, created_by_id: author, updated_by_id: author,
      },
    })
  }
}
