import { useState, useEffect, useMemo, useRef, FormEvent } from 'react'
import { suggestCategories, titleFrom } from './suggestCategory'
import { Btn, EmptyState, Field, Inp, Txta, Sel, SearchableSelect } from '@/components/ui'
import { ArrowLeft, Check, CheckCircle2 } from 'lucide-react'
import { ticketService } from '@/services/ticketService'
import { aiSuggestService, type AiSuggestion } from '@/services/aiSuggestService'
import type { Ticket } from '@/types'
import { toast } from '@/store/toastStore'
import { filterValidAttachments, ATTACHMENT_ACCEPT, fileDropPasteHandlers, PASTE_HINT } from '@/utils/attachments'
import { getApiErrorMessage } from '@/utils/apiError'
import { adminService } from '@/services/adminService'
import { useAuthStore } from '@/store/auth'
import { useAiSuggest } from '@/hooks/useAiSuggest'
import { readDialogMode, submitDialog } from '@/teams/dialog'
import { FileDrop } from '@/areas/chamados/detail/FileDrop'
import { SolutionSearching, SolutionSuggestionCard, type SuggestionAction } from './SolutionSuggestionCard'
import '@/areas/chamados/chamados.css'
import '@/areas/inicio/client.css'
import { CategoryCard, CategoryIcon } from './categoryIcon'

// Analista, Ticket Manager, Gerente e Admin podem abrir chamados em nome de um cliente.
export const ON_BEHALF_ROLES = ['agent', 'supervisor', 'manager', 'admin']

type SpecialDataValue = string | string[]

export function updateSpecialSelectionValue(
  current: SpecialDataValue | undefined,
  multiple: boolean,
  value: string,
): SpecialDataValue {
  if (!multiple) return value
  const values = Array.isArray(current) ? current : []
  return values.includes(value) ? values.filter(item => item !== value) : [...values, value]
}

export function validateSpecialData(
  fields: Array<{ key: string; label: string; required?: boolean; type?: string; multiple?: boolean }>,
  data: Record<string, SpecialDataValue>,
): string | null {
  const missing = fields.find(field => {
    if (!field.required) return false
    const value = data[field.key]
    return Array.isArray(value) ? value.length === 0 : !String(value ?? '').trim()
  })
  return missing ? `Preencha o campo obrigatório: ${missing.label}` : null
}

/** Segundos inteiros do formulário aberto ao envio, no máximo 1 dia. */
export function openingSecondsSince(openedAt: number, now = Date.now()): number {
  return Math.min(86_400, Math.max(0, Math.round((now - openedAt) / 1000)))
}

export function validateNewRequester(r: { name: string; email: string; orgId: string }): string | null {
  if (!r.name.trim()) return 'Informe o nome do cliente'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email.trim())) return 'Informe um e-mail válido para o cliente'
  if (!r.orgId) return 'Selecione a empresa do cliente'
  return null
}

type OpeningMode = 'self' | 'client' | 'proactive'
type TicketOutcome = 'opened' | 'resolved'

/** openingSeconds vem do clique em enviar: ler o card não é tempo de preencher o formulário. */
interface SuggestionOffer { suggestion: AiSuggestion; openingSeconds: number }

// Aqui os anexos vão num envio só; no atendimento humano, um por vez.
const ACCEPT_TOO_LARGE = 'Os anexos juntos são grandes demais para encerrar por aqui. Volte e remova algum, ou siga com o atendimento humano.'

const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result as string)
  reader.onerror = reject
  reader.readAsDataURL(file)
})

export function NewTicketWizard({ categories, org, organizations, initial, onBack, onRefresh }: {
  categories: any[]
  org: any
  organizations?: any[]
  /** O que a pessoa já disse na tela inicial. */
  initial?: { text?: string; category?: string }
  onBack: () => void
  onRefresh: () => Promise<void>
}) {
  const firstCategory = categories.find((c: any) => c.id === initial?.category)
  const [newStep, setNewStep] = useState<1 | 2 | 3>(firstCategory ? (firstCategory.subcategories?.length ? 2 : 3) : 1)
  const suggested = useMemo(() => suggestCategories(initial?.text ?? '', categories), [initial?.text, categories])
  const currentUser = useAuthStore(s => s.user)
  const canOpenOnBehalf = !!currentUser && ON_BEHALF_ROLES.includes(currentUser.role)
  const [clients, setClients] = useState<Array<{ id: string; name: string; email: string }>>([])
  const [onBehalfOfUserId, setOnBehalfOfUserId] = useState('')
  const [openingMode, setOpeningMode] = useState<OpeningMode>('self')
  const [proactiveOrgId, setProactiveOrgId] = useState('')
  // Cadastro rápido: cliente ainda não existe no sistema.
  const [quickCreate, setQuickCreate] = useState(false)
  const [newRequester, setNewRequester] = useState({ name: '', email: '', orgId: '' })
  // Aberto pelo bot como dialog do Teams — vem preenchido e devolve o chamado ao bot.
  const [dialogMode] = useState(() => readDialogMode())
  const [form, setForm] = useState({ title: dialogMode?.title ?? titleFrom(initial?.text ?? ''), category: firstCategory?.id ?? '', subcategory: '', priority: 'medium', description: dialogMode?.description ?? initial?.text ?? '', attachmentName: '', attachmentData: '', specialData: {} as Record<string, SpecialDataValue> })
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [outcome, setOutcome] = useState<TicketOutcome | null>(null)
  const aiSuggest = useAiSuggest()
  const [searching, setSearching] = useState(false)
  const [offer, setOffer] = useState<SuggestionOffer | null>(null)
  const [offerBusy, setOfferBusy] = useState<SuggestionAction | null>(null)
  const [offerError, setOfferError] = useState<string | null>(null)
  // Tempo entre abrir o formulário e enviar (linha de base do canal portal).
  const openedAt = useRef(Date.now())

  // Lista de clientes já vem filtrada pelo escopo do usuário no backend.
  useEffect(() => {
    if (!canOpenOnBehalf) return
    adminService.getUsers({ role: 'user' })
      .then(list => setClients(list ?? []))
      .catch(() => setClients([]))
  }, [canOpenOnBehalf])

  const proactiveOrg = organizations?.find(o => o.id === proactiveOrgId)
  // Card de SLA reflete a empresa-alvo em modo proativo, não a org do próprio atendente
  const effectiveOrg = openingMode === 'proactive' ? proactiveOrg : org

  const selectedCategory = categories.find((c: any) => c.id === form.category)
  const selectedSubcategory = selectedCategory?.subcategories?.find((s: any) => s.id === form.subcategory)
  const isSpecial = !!selectedSubcategory?.is_special
  // A sugestão fala com quem tem o problema, e formulário especial não tem texto livre para a busca.
  const suggestsSolution = openingMode === 'self' && !isSpecial

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (isSpecial) {
      const validationError = validateSpecialData(selectedSubcategory?.special_form_schema ?? [], form.specialData)
      if (validationError) {
        toast.error(validationError)
        return
      }
    }
    if (canOpenOnBehalf && openingMode === 'client' && quickCreate) {
      const quickError = validateNewRequester(newRequester)
      if (quickError) {
        toast.error(quickError)
        return
      }
    }
    const openingSeconds = openingSecondsSince(openedAt.current)
    const suggestInput = { title: form.title, description: form.description, categoryId: form.category || undefined }
    setSubmitting(true)
    try {
      if (suggestsSolution && aiSuggest.status.enabled) {
        setSearching(true)
        const found = await aiSuggest.search(suggestInput)
        setSearching(false)
        if (found === 'cancelled') return
        if (found) {
          setOffer({ suggestion: found, openingSeconds })
          return
        }
      } else if (suggestsSolution && aiSuggest.status.shadow) {
        aiSuggest.collect(suggestInput)
      }
      await concludeTicket(await createTicket(openingSeconds), 'opened')
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Erro ao abrir chamado. Tente novamente.'))
    } finally {
      setSubmitting(false)
    }
  }

  async function buildTicketBody(openingSeconds: number) {
    const attachment_url = selectedFiles.length > 0 ? await readAsDataUrl(selectedFiles[0]) : undefined
    const onBehalf = canOpenOnBehalf && openingMode === 'client' && quickCreate
      ? { newRequester: { name: newRequester.name.trim(), email: newRequester.email.trim(), orgId: newRequester.orgId } }
      : canOpenOnBehalf && openingMode === 'client' && onBehalfOfUserId
      ? { onBehalfOfUserId }
      : canOpenOnBehalf && openingMode === 'proactive' && proactiveOrgId
        ? { proactiveOrgId }
        : {}
    return isSpecial ? {
      special_data: form.specialData,
      priority: form.priority,
      categoryId: form.category || undefined,
      subcategoryId: form.subcategory || undefined,
      attachment_url,
      openingSeconds,
      ...onBehalf
    } : {
      title: form.title,
      description: form.description,
      priority: form.priority,
      categoryId: form.category || undefined,
      subcategoryId: form.subcategory || undefined,
      attachment_url,
      openingSeconds,
      ...onBehalf
    }
  }

  async function createTicket(openingSeconds: number, aiInteractionId?: string) {
    const body = await buildTicketBody(openingSeconds)
    const ticket = await ticketService.createTicket(aiInteractionId ? { ...body, aiInteractionId } : body)

    // Envia arquivos adicionais como mensagens consecutivas de anexo no chamado recém-criado
    for (const file of selectedFiles.slice(1)) {
      await ticketService.addMessage(ticket.id, `Anexo adicional: ${file.name}`, 'user', await readAsDataUrl(file))
    }
    return ticket
  }

  async function concludeTicket(ticket: Ticket, result: TicketOutcome) {
    setOffer(null)
    setOutcome(result)
    toast.success(result === 'resolved' ? 'Chamado resolvido!' : 'Chamado aberto com sucesso!')
    // Dialog do Teams: o bot recebe o chamado e fecha o dialog (sem voltar à lista).
    if (dialogMode && await submitDialog({ ticketId: ticket.id, numero: ticket.displayNumber ?? (ticket as any).display_number })) return
    await onRefresh()
    setTimeout(() => {
      setOutcome(null)
      onBack()
    }, 2000)
  }

  async function runOfferAction(action: SuggestionAction, fallbackError: string, send: (o: SuggestionOffer) => Promise<Ticket>, result: TicketOutcome) {
    if (!offer) return
    setOfferBusy(action)
    setOfferError(null)
    try {
      await concludeTicket(await send(offer), result)
    } catch (err) {
      const tooLarge = action === 'accept' && (err as { response?: { status?: number } })?.response?.status === 413
      setOfferError(tooLarge ? ACCEPT_TOO_LARGE : getApiErrorMessage(err, fallbackError))
    } finally {
      setOfferBusy(null)
    }
  }

  const acceptOffer = () => runOfferAction(
    'accept',
    'Não foi possível encerrar agora. Você pode tentar de novo ou seguir com o atendimento humano.',
    async o => aiSuggestService.accept(o.suggestion.interactionId, {
      ...await buildTicketBody(o.openingSeconds),
      extra_attachments: await Promise.all(selectedFiles.slice(1).map(async f => ({ name: f.name, url: await readAsDataUrl(f) }))),
    }),
    'resolved',
  )

  const proceedFromOffer = () => runOfferAction(
    'proceed',
    'Erro ao abrir chamado. Tente novamente.',
    o => createTicket(o.openingSeconds, o.suggestion.interactionId),
    'opened',
  )

  function handleBack() {
    if (searching) {
      aiSuggest.cancel()
      setSearching(false)
    } else if (offer) {
      setOffer(null)
      setOfferError(null)
    } else if (newStep === 1) onBack()
    else if (newStep === 3 && !selectedCategory?.subcategories?.length) setNewStep(1)
    else setNewStep(prev => (prev - 1) as 1 | 2 | 3)
  }

  function addFiles(files: File[]) {
    if (files.length === 0) return
    const valid = filterValidAttachments(files, msg => toast.error(msg))
    if (valid.length > 0) setSelectedFiles(prev => [...prev, ...valid])
  }

  return (
    <div className="nt">
      <button type="button" className="td-back" disabled={!!offerBusy} onClick={handleBack}><ArrowLeft size={15} />Voltar</button>
      <h1>Nova solicitação</h1>
      <p className="nt-lead">{newStep === 1 ? 'Escolha o assunto para começar.' : newStep === 2 ? `O que há de errado com ${selectedCategory?.name}?` : 'Conte um pouco mais. Quanto mais detalhe, mais rápido resolvemos.'}</p>

      {outcome
        ? (
          <EmptyState
            icon={<CheckCircle2 size={40} strokeWidth={1.6} />}
            title={outcome === 'resolved' ? 'Chamado resolvido!' : 'Chamado enviado!'}
            desc={outcome === 'resolved'
              ? 'Que bom que a solução ajudou. O chamado foi registrado como resolvido e continua disponível para consulta.'
              : 'Sua solicitação foi registrada e nossa equipe já está ciente.'}
          />
        ) : (
          <div>
            <ol className="nt-steps" aria-label="Etapas">
              {(['Assunto', 'Tipo', 'Detalhes'] as const).map((label, i) => (
                <li key={label} data-done={newStep > i + 1 || undefined} aria-current={newStep === i + 1 ? 'step' : undefined}>
                  <i aria-hidden>{newStep > i + 1 ? <Check size={16} /> : i + 1}</i><span>{label}</span>
                </li>
              ))}
            </ol>
            <div className={newStep === 3 ? 'nt-cols' : undefined}>
            <div className={newStep === 3 ? 'nt-card' : undefined}>
            {newStep < 3 && initial?.text && <p className="nt-said">{initial.text}</p>}
            {newStep === 1 && (categories.length === 0
              ? <p className="nt-intro">Nenhuma categoria está liberada para o plano da sua empresa, então ainda não é possível abrir chamados por aqui. Fale com o administrador do sistema.</p>
              : <>
                {suggested.length > 0 && <>
                  <p className="nt-intro">Parece ser sobre</p>
                  <div className="nt-guess">{suggested.map(s => (
                    <Btn key={`${s.category.id}-${s.subcategory?.id ?? ''}`} onClick={() => {
                      setForm({ ...form, category: s.category.id, subcategory: s.subcategory?.id ?? '' })
                      setNewStep(s.subcategory || !s.category.subcategories?.length ? 3 : 2)
                    }}>{s.category.name}{s.subcategory ? ` › ${s.subcategory.name}` : ''}</Btn>
                  ))}</div>
                  <p className="nt-intro">Ou escolha outro assunto</p>
                </>}
                <div className="cl-cats">
                  {categories.map((cat: any) => <CategoryCard key={cat.id} category={cat} on={form.category === cat.id} onPick={() => { setForm({ ...form, category: cat.id, subcategory: '' }); setNewStep(cat.subcategories?.length ? 2 : 3) }} />)}
                </div>
              </>
            )}

            {newStep === 2 && (
              <div className="cl-cats">
                {(selectedCategory?.subcategories ?? []).map((sub: any) => <CategoryCard key={sub.id} category={{ color: selectedCategory?.color, ...sub }} on={form.subcategory === sub.id} onPick={() => { setForm({ ...form, subcategory: sub.id }); setNewStep(3) }} />)}
              </div>
            )}

            {newStep === 3 && <div role="status" aria-live="polite">{searching && <SolutionSearching />}</div>}

            {newStep === 3 && offer && (
              <SolutionSuggestionCard
                suggestion={offer.suggestion}
                busy={offerBusy}
                error={offerError}
                onAccept={acceptOffer}
                onProceed={proceedFromOffer}
              />
            )}

            {newStep === 3 && !searching && !offer && (
              <form onSubmit={handleSubmit} className="nt-form">
                {canOpenOnBehalf && (
                  <Field label="Abrir chamado">
                    <Sel value={openingMode} onChange={e => {
                      const mode = e.target.value as OpeningMode
                      setOpeningMode(mode)
                      if (mode !== 'client') { setOnBehalfOfUserId(''); setQuickCreate(false) }
                      if (mode !== 'proactive') setProactiveOrgId('')
                    }}>
                      <option value="self">Eu mesmo ({currentUser?.name})</option>
                      <option value="client">Em nome de um cliente</option>
                      <option value="proactive">Ação proativa para uma empresa</option>
                    </Sel>
                  </Field>
                )}
                {canOpenOnBehalf && openingMode === 'client' && quickCreate && (
                  <>
                    <div style={{ fontSize: 13.5, color: 'var(--text-3)' }}>
                      O cliente será cadastrado nesta empresa e receberá o acesso por e-mail (SSO Microsoft se o domínio estiver autorizado).
                    </div>
                    <Field label="Nome do cliente" required>
                      <Inp value={newRequester.name} maxLength={50} autoComplete="off"
                        onChange={e => setNewRequester(r => ({ ...r, name: e.target.value }))} />
                    </Field>
                    <Field label="E-mail do cliente" required>
                      <Inp type="email" value={newRequester.email} autoComplete="off"
                        onChange={e => setNewRequester(r => ({ ...r, email: e.target.value }))} />
                    </Field>
                    <Field label="Empresa" required>
                      <SearchableSelect
                        value={newRequester.orgId}
                        onChange={v => setNewRequester(r => ({ ...r, orgId: v }))}
                        placeholder="Selecione uma empresa"
                        searchPlaceholder="Buscar empresa por nome..."
                        options={[
                          { value: '', label: 'Selecione uma empresa' },
                          ...(organizations ?? []).map(o => ({ value: o.id, label: o.name })),
                        ]}
                      />
                    </Field>
                    <div>
                      <Btn type="button" variant="secondary" size="sm" onClick={() => setQuickCreate(false)}>
                        Voltar para a lista de clientes
                      </Btn>
                    </div>
                    <hr />
                  </>
                )}
                {canOpenOnBehalf && openingMode === 'client' && !quickCreate && (
                  <Field label="Cliente">
                    <SearchableSelect
                      value={onBehalfOfUserId}
                      onChange={v => setOnBehalfOfUserId(v)}
                      placeholder="Selecione um cliente"
                      searchPlaceholder="Buscar cliente por nome ou e-mail..."
                      options={[
                        { value: '', label: 'Selecione um cliente' },
                        ...clients.map(c => ({ value: c.id, label: `${c.name} — ${c.email}` })),
                      ]}
                    />
                    <div>
                      <Btn type="button" variant="ghost" size="xs" onClick={() => {
                        setQuickCreate(true)
                        setOnBehalfOfUserId('')
                        setNewRequester(r => ({ ...r, orgId: r.orgId || (organizations?.length === 1 ? organizations[0].id : '') }))
                      }}>
                        Cliente não encontrado? Cadastrar rápido
                      </Btn>
                    </div>
                  </Field>
                )}
                {canOpenOnBehalf && openingMode === 'proactive' && (
                  <Field label="Empresa">
                    <SearchableSelect
                      value={proactiveOrgId}
                      onChange={v => setProactiveOrgId(v)}
                      placeholder="Selecione uma empresa"
                      searchPlaceholder="Buscar empresa por nome..."
                      options={[
                        { value: '', label: 'Selecione uma empresa' },
                        ...(organizations ?? []).map(o => ({ value: o.id, label: o.name })),
                      ]}
                    />
                  </Field>
                )}
                {isSpecial ? (
                  (selectedSubcategory?.special_form_schema ?? []).map((f: any, idx: number) => (
                    <Field key={f.key} label={f.label} required={f.required}>
                      {f.type === 'select' ? (
                        <div role="group" aria-label={f.label} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {(f.options ?? []).map((option: { value: string; label: string }) => {
                            const current = form.specialData[f.key]
                            const checked = f.multiple
                              ? Array.isArray(current) && current.includes(option.value)
                              : current === option.value
                            return (
                              <label key={option.value} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-2)' }}>
                                <input
                                  type={f.multiple ? 'checkbox' : 'radio'}
                                  name={`special-${f.key}`}
                                  value={option.value}
                                  checked={checked}
                                  onChange={() => setForm({
                                    ...form,
                                    specialData: {
                                      ...form.specialData,
                                      [f.key]: updateSpecialSelectionValue(current, !!f.multiple, option.value),
                                    },
                                  })}
                                />
                                {option.label}
                              </label>
                            )
                          })}
                        </div>
                      ) : f.type === 'textarea' ? (
                        <Txta
                          value={form.specialData[f.key] ?? ''}
                          onChange={e => setForm({ ...form, specialData: { ...form.specialData, [f.key]: e.target.value } })}
                          rows={4}
                          required={f.required}
                          autoFocus={idx === 0}
                          maxLength={2000}
                          showCount
                          {...fileDropPasteHandlers(addFiles)}
                        />
                      ) : (
                        <Inp
                          type={f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : 'text'}
                          value={form.specialData[f.key] ?? ''}
                          onChange={e => setForm({ ...form, specialData: { ...form.specialData, [f.key]: e.target.value } })}
                          required={f.required}
                          autoFocus={idx === 0}
                          maxLength={120}
                          showCount={f.type !== 'date'}
                        />
                      )}
                    </Field>
                  ))
                ) : (
                  <>
                    <Field label="Resumo do problema (título)" required>
                      <Inp value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Ex: Não consigo acessar meu e-mail" required autoFocus maxLength={500} showCount />
                    </Field>
                    <Field label="Descrição detalhada" required>
                      <Txta value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Por favor, descreva o que está acontecendo. Se houver alguma mensagem de erro, inclua-a aqui." rows={8} required maxLength={50000} showCount {...fileDropPasteHandlers(addFiles)} />
                    </Field>
                  </>
                )}
                <Field label="Anexos">
                  <FileDrop id="file-up" accept={ATTACHMENT_ACCEPT} hint={`Imagens, PDF, Word, Excel, Logs (Limite 10MB) · ${PASTE_HINT}`}
                    files={selectedFiles} onFiles={addFiles} onRemove={i => setSelectedFiles(prev => prev.filter((_, idx) => idx !== i))} />
                </Field>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 20px' }}>
                  <Btn type="submit" disabled={submitting}>{submitting ? 'Processando...' : 'Enviar solicitação'}</Btn>
                  <span style={{ flex: '1 1 260px', fontSize: 13, color: 'var(--text-3)', lineHeight: 1.45 }}>
                    Ao abrir este chamado, a equipe é avisada na hora.
                  </span>
                </div>
              </form>
            )}
            </div>
            {newStep === 3 && (
              <aside className="nt-card nt-side" aria-label="Resumo">
                {selectedCategory && <div><CategoryIcon category={selectedCategory} size={42} /><span><b>{selectedCategory.name}</b>{selectedSubcategory?.name}</span></div>}
                {effectiveOrg && <>
                  <hr />
                  <span><b>{effectiveOrg.name}</b>Plano {effectiveOrg.tier.charAt(0).toUpperCase() + effectiveOrg.tier.slice(1)}</span>
                  <span><b>Previsão de conclusão</b>{new Date(Date.now() + (effectiveOrg.sla_hours ?? 24) * 3600000).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}, estimada pelo plano</span>
                </>}
              </aside>
            )}
            </div>
          </div>
        )
      }
    </div>
  )
}
