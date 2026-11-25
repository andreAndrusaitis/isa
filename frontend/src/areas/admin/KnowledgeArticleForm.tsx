import { useState } from 'react'
import { SKADI_NAME } from '@/utils/skadi'
import { Btn, ConfirmModal, Field, Inp, Modal, Txta } from '@/components/ui'
import { apiErrorMessage } from '@/services/api'
import { knowledgeService } from '@/services/knowledgeService'
import { toast } from '@/store/toastStore'
import type { Category } from '@/types'
import type { KnowledgeArticle } from '@/types/knowledge'

const TITLE_ID = 'kb-article-title'
const CONTENT_ID = 'kb-article-content'
const MAX_TITLE_CHARS = 200
const MAX_CONTENT_CHARS = 500_000

type Action = 'save' | 'publish'
type FieldErrors = { title?: string; content?: string }

const aiUnavailable = (err: unknown) => (err as { response?: { status?: number } })?.response?.status === 503

const errorText = { fontSize: 13, color: 'var(--danger)' }
const hint = { fontSize: 13, color: 'var(--text-3)', marginTop: 6 }

/**
 * Criar e editar artigo. Publicar grava primeiro e publica depois: se a publicação
 * falhar, o texto já está salvo como rascunho e o formulário segue aberto nele, para
 * a nova tentativa não criar um segundo artigo.
 */
export function KnowledgeArticleForm({ article, initialTitle = '', categories, onClose, onChanged }: {
  article: KnowledgeArticle | null
  /** Título já preenchido num artigo novo, como o sugerido pelas lacunas. */
  initialTitle?: string
  categories: Category[]
  onClose: () => void
  /** O artigo mudou no servidor: a lista precisa recarregar. */
  onChanged: () => void
}) {
  const [current, setCurrent] = useState(article)
  const [title, setTitle] = useState(article?.title ?? initialTitle)
  const [content, setContent] = useState(article?.content ?? '')
  const [categoryIds, setCategoryIds] = useState(article?.categories.map(c => c.id) ?? [])
  const [dirty, setDirty] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [busy, setBusy] = useState<Action | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const published = current?.status === 'published'

  // Categoria inativa não se escolhe, mas a já vinculada aparece: sumir com ela desfaria o vínculo ao salvar.
  const activeOptions = categories.filter(c => c.active !== false).map(c => ({ id: c.id, name: c.name, active: true }))
  const options = [...activeOptions, ...(current?.categories ?? []).filter(c => !activeOptions.some(o => o.id === c.id))]

  const edit = <T,>(set: (value: T) => void, value: T) => {
    set(value)
    setDirty(true)
  }

  const toggleCategory = (id: string) =>
    edit(setCategoryIds, categoryIds.includes(id) ? categoryIds.filter(c => c !== id) : [...categoryIds, id])

  const validate = () => {
    const found: FieldErrors = {}
    if (!title.trim()) found.title = 'Informe o título'
    if (!content.trim()) found.content = 'Informe o conteúdo'
    else if (content.trim().length > MAX_CONTENT_CHARS) found.content = `O conteúdo passa do limite de ${MAX_CONTENT_CHARS.toLocaleString('pt-BR')} caracteres`
    setErrors(found)
    const firstInvalid = found.title ? TITLE_ID : found.content ? CONTENT_ID : null
    if (firstInvalid) document.getElementById(firstInvalid)?.focus()
    return !firstInvalid
  }

  const saveFailure = (err: unknown) => {
    const message = apiErrorMessage(err, 'Não foi possível salvar o artigo.')
    return published && aiUnavailable(err)
      ? `O artigo segue publicado com o texto anterior, e o que você escreveu continua aqui no formulário. ${message}`
      : message
  }

  const publishFailure = (err: unknown) => {
    const message = apiErrorMessage(err, 'Não foi possível publicar o artigo.')
    return aiUnavailable(err) ? `Não publicado: o artigo segue como rascunho, com o texto salvo. ${message}` : message
  }

  const submit = async (action: Action) => {
    if (!validate()) return
    setBusy(action)
    setFailure(null)
    let saved: KnowledgeArticle | null = null
    try {
      const input = { title: title.trim(), content: content.trim(), categoryIds }
      saved = current ? await knowledgeService.update(current.id, input) : await knowledgeService.create(input)
      setCurrent(saved)
      setDirty(false)
      if (action === 'publish') await knowledgeService.publish(saved.id)
      onChanged()
      toast.success(action === 'publish' ? 'Artigo publicado.' : 'Artigo salvo.')
      onClose()
    } catch (err) {
      if (saved) onChanged()
      setFailure(saved ? publishFailure(err) : saveFailure(err))
    } finally {
      setBusy(null)
    }
  }

  const requestClose = () => {
    if (busy) return
    if (dirty) setConfirmDiscard(true)
    else onClose()
  }

  return (
    <>
      <Modal isOpen onClose={requestClose} title={current ? 'Editar artigo' : 'Novo artigo'} width={720}
        footer={<>
          {failure && <div role="alert" style={{ flexBasis: '100%', fontSize: 13.5, lineHeight: 1.5, color: 'var(--danger)' }}>{failure}</div>}
          <Btn variant="ghost" disabled={!!busy} onClick={requestClose}>Cancelar</Btn>
          <Btn variant={published ? 'primary' : 'secondary'} disabled={!!busy} onClick={() => submit('save')}>
            {busy === 'save' ? 'Salvando…' : published ? 'Salvar alterações' : 'Salvar rascunho'}
          </Btn>
          {!published && <Btn disabled={!!busy} onClick={() => submit('publish')}>{busy === 'publish' ? 'Publicando…' : 'Publicar'}</Btn>}
        </>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {published && (
            <div className="notice">
              Este artigo está publicado. Se o conteúdo mudar, ele será reindexado ao salvar, e a {SKADI_NAME} passa a usar o texto novo.
            </div>
          )}
          {!published && current?.source_filename && (
            <div className="notice">
              Importado de <strong style={{ overflowWrap: 'anywhere' }}>{current.source_filename}</strong>. Revise o texto extraído e escolha as categorias antes de publicar.
            </div>
          )}
          <Field label="Título" required>
            <Inp id={TITLE_ID} aria-label="Título" aria-required aria-invalid={!!errors.title} aria-describedby={errors.title ? `${TITLE_ID}-error` : undefined}
              autoFocus maxLength={MAX_TITLE_CHARS} value={title} onChange={e => edit(setTitle, e.target.value)} />
            {errors.title && <span id={`${TITLE_ID}-error`} style={errorText}>{errors.title}</span>}
          </Field>
          <fieldset style={{ border: 'none', margin: 0, padding: 0, minWidth: 0 }}>
            <legend style={{ padding: 0, marginBottom: 6, fontSize: 13, fontWeight: 500, color: 'var(--text-2)' }}>Categorias</legend>
            {options.length > 0
              ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '2px 12px', maxHeight: 148, overflowY: 'auto' }}>
                  {options.map(c => (
                    <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 28, fontSize: 14, color: 'var(--text-1)', cursor: 'pointer', minWidth: 0, overflowWrap: 'anywhere' }}>
                      <input type="checkbox" checked={categoryIds.includes(c.id)} onChange={() => toggleCategory(c.id)} />
                      <span>{c.name}</span>
                      {!c.active && <span style={{ fontSize: 13, color: 'var(--text-3)' }}>inativa</span>}
                    </label>
                  ))}
                </div>
              : <div style={hint}>Nenhuma categoria ativa cadastrada.</div>}
            <div style={hint}>O artigo só alcança quem tem acesso às categorias dele. Publicar exige ao menos uma ativa.</div>
          </fieldset>
          <Field label="Conteúdo" required>
            <Txta id={CONTENT_ID} aria-label="Conteúdo" aria-required aria-invalid={!!errors.content} aria-describedby={errors.content ? `${CONTENT_ID}-error` : undefined}
              rows={14} value={content} onChange={e => edit(setContent, e.target.value)} />
            {errors.content && <span id={`${CONTENT_ID}-error`} style={errorText}>{errors.content}</span>}
          </Field>
        </div>
      </Modal>
      {confirmDiscard && (
        <ConfirmModal isOpen onClose={() => setConfirmDiscard(false)} onConfirm={onClose} title="Descartar alterações?" variant="danger"
          message="O que você mudou desde o último salvamento será perdido." confirmText="Descartar" cancelText="Continuar editando" />
      )}
    </>
  )
}
