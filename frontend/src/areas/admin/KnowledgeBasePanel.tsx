import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { SKADI_NAME } from '@/utils/skadi'
import { Btn, ConfirmModal, EmptyState, PageHeader, Pagination, Sel, Loading } from '@/components/ui'
import { useKnowledgeArticles, type KnowledgeFilters } from '@/hooks/useKnowledgeArticles'
import { adminService } from '@/services/adminService'
import { apiErrorMessage } from '@/services/api'
import { knowledgeService } from '@/services/knowledgeService'
import { toast } from '@/store/toastStore'
import type { Category } from '@/types'
import type { KnowledgeArticle, KnowledgeArticleSummary, KnowledgeGaps } from '@/types/knowledge'
import { KnowledgeArticleForm } from './KnowledgeArticleForm'
import './admin.css'

const MAX_IMPORT_BYTES = 10 * 1024 * 1024
const IMPORT_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md', '.markdown']

const fmt = (d: string) => new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

type PendingAction = { kind: 'delete' | 'unpublish'; article: KnowledgeArticleSummary }

const PENDING_TEXT = {
  delete: {
    title: 'Excluir artigo', confirm: 'Excluir', done: 'Artigo excluído.', failed: 'Não foi possível excluir o artigo.',
    message: (t: string) => `"${t}" será removido da base e deixará de ser usado pela ${SKADI_NAME}.`,
  },
  unpublish: {
    title: 'Despublicar artigo', confirm: 'Despublicar', done: 'Artigo despublicado.', failed: 'Não foi possível despublicar o artigo.',
    message: (t: string) => `"${t}" volta para rascunho e deixa de ser usado pela ${SKADI_NAME} até ser publicado de novo.`,
  },
}

const TABS = [['articles', 'Artigos'], ['gaps', 'Lacunas']] as const
type Tab = typeof TABS[number][0]

const GAP_PERIODS = [7, 30, 90]

/** O que as pessoas perguntaram e a IA não soube responder: cada linha é candidata a artigo. */
function GapsTab({ onCreate }: { onCreate: (title: string) => void }) {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<KnowledgeGaps | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    knowledgeService.gaps(days)
      .then(d => { if (alive) setData(d) })
      .catch(err => {
        if (!alive) return
        setData(null)
        setError(apiErrorMessage(err, 'Não foi possível carregar as lacunas.'))
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [days, tick])

  return (
    <div style={{ padding: '16px var(--page-gutter) 40px', display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Sel aria-label="Período das lacunas" value={String(days)} style={{ width: 180 }} onChange={e => setDays(Number(e.target.value))}>
          {GAP_PERIODS.map(d => <option key={d} value={d}>Últimos {d} dias</option>)}
        </Sel>
        <p style={{ margin: 0, flex: '1 1 280px', fontSize: 13, color: 'var(--text-3)' }}>
          Perguntas sem resposta ou com resposta marcada como não útil, da mais frequente para a menos frequente. Falhas do provedor de IA não entram.
        </p>
      </div>

      {data?.grouped_by === 'text' && data.gaps.length > 0 && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)' }}>IA indisponível: só perguntas com o mesmo texto foram agrupadas.</p>
      )}
      {data?.truncated && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)' }}>Foram analisadas as {data.analyzed.toLocaleString('pt-BR')} interações mais recentes do período.</p>
      )}

      {error && (
        <div role="alert" className="notice" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, color: 'var(--danger)' }}>
          {error}
          <Btn size="sm" variant="secondary" onClick={() => setTick(t => t + 1)}>Tentar de novo</Btn>
        </div>
      )}

      {loading && !data && !error && <Loading label="Carregando lacunas…" />}

      {data && data.gaps.length === 0 && (
        <div className="adm-empty"><EmptyState title="Nenhuma lacuna no período" desc="Toda pergunta recebeu resposta e nenhuma foi marcada como não útil." /></div>
      )}

      {data && data.gaps.length > 0 && (
          <div className="adm-scroll">
            <table aria-label="Perguntas mais frequentes sem resposta" aria-busy={loading} className="table" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th scope="col">Pergunta (exemplo)</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Vezes</th>
                  <th scope="col">Última vez</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Ação</th>
                </tr>
              </thead>
              <tbody>
                {data.gaps.map(g => (
                  <tr key={g.example}>
                    <td style={{ overflowWrap: 'anywhere', minWidth: 280 }}>
                      <div title={g.example} style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'pre-line' }}>{g.example}</div>
                    </td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{g.count.toLocaleString('pt-BR')}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmt(g.last_at)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <Btn size="xs" variant="secondary" aria-label={`Criar artigo a partir disso: ${g.title}`} onClick={() => onCreate(g.title)}>Criar artigo a partir disso</Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      )}
    </div>
  )
}

/** Artigos que alimentam as respostas da IA: o admin escreve ou importa, revisa e publica. */
export function KnowledgeBasePanel() {
  const kb = useKnowledgeArticles()
  const [categories, setCategories] = useState<Category[]>([])
  const [tab, setTab] = useState<Tab>('articles')
  const [editing, setEditing] = useState<{ article: KnowledgeArticle | null; title?: string } | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    adminService.getCategories()
      .then(setCategories)
      .catch(err => toast.error(apiErrorMessage(err, 'Não foi possível carregar as categorias.')))
  }, [])

  // O botão não fica disabled enquanto abre: perderia o foco, e o modal não teria para onde devolvê-lo.
  const openArticle = async (id: string) => {
    if (opening) return
    setOpening(id)
    try {
      setEditing({ article: await knowledgeService.get(id) })
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível abrir o artigo.'))
    } finally {
      setOpening(null)
    }
  }

  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // sem isso, escolher o mesmo arquivo de novo não dispara o change
    if (!file) return
    if (!IMPORT_EXTENSIONS.some(ext => file.name.toLowerCase().endsWith(ext))) {
      toast.error(`"${file.name}" não pode ser importado: envie PDF, DOCX, TXT ou Markdown.`)
      return
    }
    if (file.size > MAX_IMPORT_BYTES) {
      toast.error(`"${file.name}" passa do limite de 10 MB.`)
      return
    }
    setImporting(true)
    try {
      const article = await knowledgeService.importFile(file)
      void kb.reload()
      setEditing({ article })
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível importar o arquivo.'))
    } finally {
      setImporting(false)
    }
  }

  const runPending = async ({ kind, article }: PendingAction) => {
    try {
      if (kind === 'delete') await knowledgeService.remove(article.id)
      else await knowledgeService.unpublish(article.id)
      toast.success(PENDING_TEXT[kind].done)
      void kb.reload()
    } catch (err) {
      toast.error(apiErrorMessage(err, PENDING_TEXT[kind].failed))
    }
  }

  const empty = !kb.loading && !kb.error && kb.rows.length === 0

  const onTabKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next = TABS[(TABS.findIndex(([t]) => t === tab) + 1) % TABS.length][0]
    setTab(next)
    document.getElementById(`kb-tab-${next}`)?.focus()
  }

  return (
    <div className="adm" style={{ display: 'flex', flexDirection: 'column' }}>
      <PageHeader title="Base de conhecimento" subtitle={`Artigos que a ${SKADI_NAME} usa nas respostas. Só artigo publicado entra na busca. Importação: PDF, DOCX, TXT ou Markdown, até 10 MB.`}
        actions={<>
          <input ref={fileInput} type="file" aria-label="Arquivo para importar" accept={IMPORT_EXTENSIONS.join(',')} onChange={importFile} style={{ display: 'none' }} />
          <Btn variant="secondary" disabled={importing} onClick={() => fileInput.current?.click()}>
            {importing ? 'Importando…' : 'Importar arquivo'}
          </Btn>
          <Btn onClick={() => setEditing({ article: null })}>Novo artigo</Btn>
        </>} />

      <div role="tablist" aria-label="Seções da base de conhecimento" onKeyDown={onTabKeyDown} className="subtabs" style={{ padding: '0 var(--page-gutter)', marginLeft: -14 }}>
        {TABS.map(([t, label]) => (
          <button key={t} id={`kb-tab-${t}`} role="tab" type="button" aria-selected={tab === t} aria-controls={`kb-panel-${t}`}
            tabIndex={tab === t ? 0 : -1} onClick={() => setTab(t)}>{label}</button>
        ))}
      </div>

      <div role="tabpanel" id={`kb-panel-${tab}`} aria-labelledby={`kb-tab-${tab}`} style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      {tab === 'gaps' && <GapsTab onCreate={title => setEditing({ article: null, title })} />}
      {tab === 'articles' && <>
      <div style={{ padding: '16px var(--page-gutter) 40px', display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Sel aria-label="Filtrar por status" value={kb.filters.status} style={{ width: 180 }}
            onChange={e => kb.filterBy({ status: e.target.value as KnowledgeFilters['status'] })}>
            <option value="">Todos os status</option>
            <option value="draft">Rascunho</option>
            <option value="published">Publicado</option>
          </Sel>
          <Sel aria-label="Filtrar por categoria" value={kb.filters.categoryId} style={{ width: 240 }}
            onChange={e => kb.filterBy({ categoryId: e.target.value })}>
            <option value="">Todas as categorias</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.active === false ? `${c.name} (inativa)` : c.name}</option>)}
          </Sel>
        </div>

        {kb.error && (
          <div role="alert" className="notice" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, color: 'var(--danger)' }}>
            {kb.error}
            <Btn size="sm" variant="secondary" onClick={() => kb.reload()}>Tentar de novo</Btn>
          </div>
        )}

        {kb.loading && kb.rows.length === 0 && <Loading label="Carregando artigos…" />}

        {empty && <div className="adm-empty">{kb.filtered
          ? <EmptyState title="Nenhum artigo com esses filtros"
              action={<Btn size="sm" variant="secondary" onClick={kb.clearFilters}>Limpar filtros</Btn>} />
          : <EmptyState title="Nenhum artigo na base" desc={`Escreva um artigo ou importe um arquivo. Ele nasce como rascunho e só chega à ${SKADI_NAME} depois de publicado.`} />}</div>}

        {kb.rows.length > 0 && (
            <div className="adm-scroll">
              <table aria-label="Artigos da base de conhecimento" aria-busy={kb.loading} className="table" style={{ minWidth: 880 }}>
                <thead>
                  <tr>
                    <th scope="col">Título</th>
                    <th scope="col">Categorias</th>
                    <th scope="col">Status</th>
                    <th scope="col">Atualizado em</th>
                    <th scope="col">Origem</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {kb.rows.map(a => (
                    <tr key={a.id}>
                      <td style={{ fontWeight: 500, overflowWrap: 'anywhere', minWidth: 220 }}>{a.title}</td>
                      <td>
                        {a.categories.length > 0
                          ? a.categories.map((c, n) => <span key={c.id} title={c.active ? undefined : 'Categoria inativa'} style={c.active ? undefined : { color: 'var(--text-3)' }}>{n > 0 && ', '}<span>{c.name}</span></span>)
                          : <span style={{ color: 'var(--text-3)' }}>Sem categoria</span>}
                      </td>
                      <td>{a.status === 'published' ? 'Publicado' : <span style={{ color: 'var(--text-3)' }}>Rascunho</span>}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmt(a.updated_at)}</td>
                      <td style={{ overflowWrap: 'anywhere' }}>{a.source_filename ?? <span style={{ color: 'var(--text-3)' }}>Manual</span>}</td>
                      <td>
                        <div className="adm-actions">
                          <Btn size="xs" variant="ghost" aria-busy={opening === a.id} aria-label={`Editar ${a.title}`} onClick={() => openArticle(a.id)}>
                            {opening === a.id ? 'Abrindo…' : 'Editar'}
                          </Btn>
                          {a.status === 'published' && <Btn size="xs" variant="ghost" aria-label={`Despublicar ${a.title}`} onClick={() => setPending({ kind: 'unpublish', article: a })}>Despublicar</Btn>}
                          <Btn size="xs" variant="ghost" aria-label={`Excluir ${a.title}`} onClick={() => setPending({ kind: 'delete', article: a })}>Excluir</Btn>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        )}
      </div>

      <Pagination page={kb.page} pageSize={kb.pageSize} total={kb.total} label="artigos" onPageChange={kb.setPage} onPageSizeChange={kb.changePageSize} />
      </>}
      </div>

      {editing && (
        <KnowledgeArticleForm article={editing.article} initialTitle={editing.title} categories={categories} onClose={() => setEditing(null)} onChanged={() => void kb.reload()} />
      )}
      {pending && (
        <ConfirmModal isOpen onClose={() => setPending(null)} onConfirm={() => runPending(pending)} variant={pending.kind === 'delete' ? 'danger' : 'primary'}
          title={PENDING_TEXT[pending.kind].title} message={PENDING_TEXT[pending.kind].message(pending.article.title)} confirmText={PENDING_TEXT[pending.kind].confirm} />
      )}
    </div>
  )
}
