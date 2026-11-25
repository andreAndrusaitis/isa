import { toast } from '@/store/toastStore'
import { useState, useEffect, useRef } from 'react'
import { surveyService, SurveyTemplate } from '@/services/surveyService'
import { macroService, type MacroVariable } from '@/services/macroService'
import {
  Btn,
  Field,
  Inp,
  Txta,
  Modal,
  Toggle,
  PageHeader,
  AlertModal,
  ConfirmModal,
  Loading,
} from '@/components/ui'
import { Trash2 } from 'lucide-react'
import { VariablePicker } from './VariablePicker'
import { unknownMessage } from './macroText'
import { useAuthStore } from '@/store/auth'
import { hasAreaPermission } from '@/utils/permissions'
import { SurveyQuestionBuilder } from './SurveyQuestionBuilder'
import { SurveyPreviewModal } from './SurveyPreviewModal'

type TargetField = 'corpo_convite_auto' | 'corpo_convite_macro' | 'assunto_email'

const QUICK_VARIABLES = [
  { key: 'link_pesquisa', label: 'Link pesquisa' },
  { key: 'primeiro_nome_usuario', label: 'Nome solicitante' },
  { key: 'numero_chamado', label: 'Nº do chamado' },
  { key: 'titulo_chamado', label: 'Título chamado' },
  { key: 'nome_analista', label: 'Analista' },
  { key: 'link_chamado', label: 'Link portal' },
]

const TARGET_FIELD_LABELS: Record<TargetField, string> = {
  corpo_convite_auto: 'Convite automático',
  corpo_convite_macro: 'Texto macro',
  assunto_email: 'Assunto do e-mail',
}

export function SurveyConfigPanel() {
  const user = useAuthStore((s) => s.user)
  const canManageSurvey = user?.role === 'admin' || hasAreaPermission(user, 'survey')
  const [templates, setTemplates] = useState<SurveyTemplate[]>([])
  // Mesma lista oficial de variáveis das macros.
  const [variables, setVariables] = useState<MacroVariable[]>([])
  useEffect(() => { macroService.getVariables().then(setVariables).catch(() => setVariables([])) }, [])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editTemplate, setEditTemplate] = useState<SurveyTemplate | null>(null)
  const [showHelpModal, setShowHelpModal] = useState(false)
  const [previewTemplate, setPreviewTemplate] = useState<SurveyTemplate | null>(null)

  const [form, setForm] = useState({
    nome: '',
    assunto_email: '',
    corpo_convite_auto: '',
    corpo_convite_macro: '',
    ativo: false
  })
  
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<'editor' | 'preview'>('editor')
  const [targetField, setTargetField] = useState<TargetField>('corpo_convite_auto')
  const [recentlyInserted, setRecentlyInserted] = useState<string | null>(null)
  const [preview, setPreview] = useState({
    assunto: '',
    autoBody: '',
    macroBody: '',
    unknown: [] as string[]
  })
  const fieldCursors = useRef<Record<TargetField, number | null>>({
    assunto_email: null,
    corpo_convite_auto: null,
    corpo_convite_macro: null,
  })

  const [alert, setAlert] = useState<{
    isOpen: boolean
    title: string
    message: string
    variant: 'danger' | 'warning' | 'primary'
  }>({ isOpen: false, title: '', message: '', variant: 'warning' })
  const [confirmDeleteModal, setConfirmDeleteModal] = useState<{
    isOpen: boolean
    template: SurveyTemplate | null
  }>({ isOpen: false, template: null })

  const loadData = async () => {
    setLoading(true)
    try {
      const data = await surveyService.getTemplates()
      setTemplates(data)
    } catch {
      setAlert({ isOpen: true, title: 'Erro', message: 'Não foi possível carregar os modelos de pesquisa.', variant: 'danger' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (!showModal) {
      setPreview({ assunto: '', autoBody: '', macroBody: '', unknown: [] })
      return
    }
    const t = setTimeout(async () => {
      try {
        const [resAssunto, resAuto, resMacro] = await Promise.all([
          form.assunto_email ? macroService.render(form.assunto_email) : Promise.resolve({ content: '', unknown: [] }),
          form.corpo_convite_auto ? macroService.render(form.corpo_convite_auto) : Promise.resolve({ content: '', unknown: [] }),
          form.corpo_convite_macro ? macroService.render(form.corpo_convite_macro) : Promise.resolve({ content: '', unknown: [] }),
        ])
        const allUnknown = Array.from(new Set([...resAssunto.unknown, ...resAuto.unknown, ...resMacro.unknown]))
        setPreview({
          assunto: resAssunto.content,
          autoBody: resAuto.content,
          macroBody: resMacro.content,
          unknown: allUnknown
        })
      } catch {
        // Ignora erros de preview
      }
    }, 300)
    return () => clearTimeout(t)
  }, [form.assunto_email, form.corpo_convite_auto, form.corpo_convite_macro, showModal])

  const insertVariable = (key: string, field = targetField) => {
    const token = `{${key}}`
    const currentVal = form[field]
    const pos = fieldCursors.current[field] ?? currentVal.length
    const maxLen = field === 'assunto_email' ? 150 : field === 'corpo_convite_auto' ? 2000 : 1000
    const updated = (currentVal.slice(0, pos) + token + currentVal.slice(pos)).slice(0, maxLen)
    setForm((prev) => ({ ...prev, [field]: updated }))
    const next = pos + token.length
    fieldCursors.current[field] = next
    setRecentlyInserted(key)
    setTimeout(() => {
      setRecentlyInserted((prev) => (prev === key ? null : prev))
    }, 1200)

    if (activeTab === 'preview') {
      setActiveTab('editor')
    }

    requestAnimationFrame(() => {
      const el = document.getElementById(`survey-${field}`) as HTMLInputElement | HTMLTextAreaElement | null
      el?.focus()
      el?.setSelectionRange(next, next)
    })
  }

  const openNew = () => {
    if (!canManageSurvey) return
    setEditTemplate(null)
    setForm({
      nome: '',
      assunto_email: 'Pesquisa de satisfação: Chamado {numero_chamado}',
      corpo_convite_auto: 'Olá {nome_cliente},\n\nO seu chamado de número {numero_chamado} com o título "{titulo_chamado}" foi concluído.\n\nPor favor, reserve um minuto para nos dizer como foi o atendimento acessando o link exclusivo abaixo:\n{link_pesquisa}\n\nAgradecemos por nos ajudar a melhorar continuamente!\n\nAtenciosamente,\nEquipe de TI',
      corpo_convite_macro: 'Olá {nome_cliente},\n\nConcluí o seu chamado "{titulo_chamado}". Poderia avaliar meu atendimento por favor? É bem rápido!\n\nBasta clicar no link: {link_pesquisa}\n\nObrigado!',
      ativo: false
    })
    setTargetField('corpo_convite_auto')
    fieldCursors.current = { assunto_email: null, corpo_convite_auto: null, corpo_convite_macro: null }
    setActiveTab('editor')
    setRecentlyInserted(null)
    setShowModal(true)
  }

  const openEdit = (template: SurveyTemplate) => {
    if (!canManageSurvey) return
    setEditTemplate(template)
    setForm({
      nome: template.nome,
      assunto_email: template.assunto_email,
      corpo_convite_auto: template.corpo_convite_auto,
      corpo_convite_macro: template.corpo_convite_macro,
      ativo: template.ativo
    })
    setTargetField('corpo_convite_auto')
    fieldCursors.current = { assunto_email: null, corpo_convite_auto: null, corpo_convite_macro: null }
    setActiveTab('editor')
    setRecentlyInserted(null)
    setShowModal(true)
  }

  const save = async () => {
    const nome = form.nome.trim()
    const assunto = form.assunto_email.trim()
    const autoBody = form.corpo_convite_auto.trim()
    const macroBody = form.corpo_convite_macro.trim()

    if (!nome) {
      setAlert({ isOpen: true, title: 'Validação', message: 'O nome do modelo é obrigatório.', variant: 'warning' })
      return
    }
    if (!assunto) {
      setAlert({ isOpen: true, title: 'Validação', message: 'O assunto do e-mail é obrigatório.', variant: 'warning' })
      return
    }
    if (!autoBody) {
      setAlert({ isOpen: true, title: 'Validação', message: 'O campo "Convite automático (E-mail / Chat do chamado)" é obrigatório.', variant: 'warning' })
      return
    }
    if (!autoBody.includes('{link_pesquisa}')) {
      setAlert({ isOpen: true, title: 'Validação', message: 'O campo "Convite automático (E-mail / Chat do chamado)" precisa conter a variável {link_pesquisa}, que será substituída pelo link da pesquisa no envio.', variant: 'warning' })
      return
    }
    if (!macroBody) {
      setAlert({ isOpen: true, title: 'Validação', message: 'O campo "Texto de macro do analista" é obrigatório.', variant: 'warning' })
      return
    }
    if (!macroBody.includes('{link_pesquisa}')) {
      setAlert({ isOpen: true, title: 'Validação', message: 'O campo "Texto de macro do analista" precisa conter a variável {link_pesquisa}, que será substituída pelo link da pesquisa no envio.', variant: 'warning' })
      return
    }

    setSaving(true)
    try {
      const payload = {
        nome,
        assunto_email: assunto,
        corpo_convite_auto: autoBody,
        corpo_convite_macro: macroBody,
        ativo: form.ativo
      }

      if (editTemplate) {
        await surveyService.updateTemplate(editTemplate.id, payload)
      } else {
        await surveyService.createTemplate(payload)
      }
      setShowModal(false)
      loadData()
      if (preview.unknown.length > 0) {
        setAlert({ isOpen: true, title: 'Modelo salvo com aviso', message: unknownMessage(preview.unknown), variant: 'warning' })
      } else {
        toast.success(editTemplate ? 'Modelo de pesquisa atualizado.' : 'Modelo de pesquisa criado.')
      }
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Erro ao salvar o modelo de pesquisa.'
      setAlert({ isOpen: true, title: 'Erro', message: msg, variant: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (template: SurveyTemplate) => {
    // Se já estiver ativo, não permite desativar (deve haver sempre um ativo, ou pode desativar?
    // O service setActiveTemplate ativa e desativa os outros.
    // Se clicar em ativar, ativa ele)
    if (template.ativo) return // já está ativo
    if (!canManageSurvey) return

    try {
      await surveyService.setActiveTemplate(template.id)
      loadData()
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Erro ao ativar o modelo de pesquisa.'
      setAlert({ isOpen: true, title: 'Erro', message: msg, variant: 'danger' })
    }
  }

  const handleDelete = (template: SurveyTemplate) => {
    if (!canManageSurvey) return
    if (template.ativo) {
      setAlert({ isOpen: true, title: 'Bloqueado', message: 'Não é possível excluir o modelo ativo principal.', variant: 'warning' })
      return
    }
    setConfirmDeleteModal({ isOpen: true, template })
  }

  const confirmDelete = async () => {
    const template = confirmDeleteModal.template
    if (!template) return

    try {
      await surveyService.deleteTemplate(template.id)
      setAlert({ isOpen: true, title: 'Sucesso', message: 'Modelo excluído com sucesso.', variant: 'primary' })
      loadData()
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Erro ao excluir o modelo.'
      setAlert({ isOpen: true, title: 'Erro', message: msg, variant: 'danger' })
    }
    setConfirmDeleteModal({ isOpen: false, template: null })
  }

  return (
    <div className="cfg-page">
      <PageHeader
        title="Pesquisas"
        subtitle="Configure o envio e o questionário da satisfação do cliente"
        actions={
          <>
            <Btn size="sm" variant="ghost" onClick={() => setShowHelpModal(true)}>Instruções de uso</Btn>
            {canManageSurvey && <Btn size="sm" onClick={openNew}>Novo modelo</Btn>}
          </>
        }
      />

      <div className="cfg-body">
        <p className="cfg-sub" style={{ margin: '0 0 24px' }}>
          O sistema utiliza um modelo principal para disparos automáticos e geração de links de chat. Assunto e mensagens aceitam as mesmas variáveis das macros.
        </p>
        {loading && templates.length === 0 && (
          <Loading size="compact" label="Carregando modelos…" />
        )}
        {!loading && templates.length === 0 && <div className="cfg-empty">Nenhum modelo cadastrado.</div>}

        {templates.map((template, i) => (
          <section key={template.id} className="cfg-section" style={i === 0 ? { marginTop: 0 } : undefined}>
            <div className="cfg-section-head">
              <div style={{ minWidth: 0 }}>
                <h2 style={{ overflowWrap: 'anywhere' }}>{template.nome}</h2>
                <p className="cfg-sub">{template.ativo && 'Modelo principal. '}Criado em {new Date(template.created_at).toLocaleDateString()}</p>
              </div>
              <div className="cfg-inline" style={{ gap: 4 }}>
                {!template.ativo && canManageSurvey && (
                  <span className="cfg-inline" style={{ fontSize: 13, color: 'var(--text-2)', marginRight: 10 }} title="Definir como modelo ativo">
                    Tornar ativo
                    <Toggle value={template.ativo} onChange={() => toggleActive(template)} label={`Tornar ${template.nome} o modelo ativo`} />
                  </span>
                )}
                <Btn variant="ghost" size="xs" onClick={() => setPreviewTemplate(template)}>Visualizar</Btn>
                {canManageSurvey && <Btn variant="ghost" size="xs" onClick={() => openEdit(template)}>Editar</Btn>}
                {!template.ativo && canManageSurvey && (
                  <button type="button" className="icon-act danger" aria-label={`Excluir ${template.nome}`} title="Excluir modelo" onClick={() => handleDelete(template)}><Trash2 size={15} /></button>
                )}
              </div>
            </div>

            <div className="cfg-settings">
              <div className="setting">
                <div>Assunto do e-mail</div>
                <div className="msg-text cfg-wide">{template.assunto_email}</div>
              </div>
              <div className="setting">
                <div>Convite automático<small>E-mail e chat, depois da conclusão do chamado.</small></div>
                <div className="msg-text cfg-wide">{template.corpo_convite_auto}</div>
              </div>
              <div className="setting">
                <div>Resposta da macro<small>Texto que o analista envia pelo chat.</small></div>
                <div className="msg-text cfg-wide">{template.corpo_convite_macro}</div>
              </div>
              <SurveyQuestionBuilder
                templateId={template.id}
                questions={template.questions || []}
                onChange={loadData}
              />
            </div>
          </section>
        ))}
      </div>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editTemplate ? 'Editar modelo de pesquisa' : 'Novo modelo de pesquisa'}
        width={820}
        footer={
          <>
            <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancelar</Btn>
            <Btn onClick={save} disabled={saving}>{saving ? 'Salvando...' : 'Salvar modelo'}</Btn>
          </>
        }
      >
        <div className="cfg-form">
          <Field label="Nome do modelo" required>
            <Inp
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="Ex: Modelo de Pesquisa de TI"
              maxLength={100}
              showCount
            />
          </Field>
          <div className="cfg-row">
            Definir como modelo ativo principal
            <Toggle value={form.ativo} onChange={(v) => setForm({ ...form, ativo: v })} label="Definir como modelo ativo principal" />
          </div>

          <div className="cfg-group">
            <div className="cfg-group-head" style={{ alignItems: 'center' }}>
              <div><h4>Assunto e mensagens</h4><p className="cfg-sub">No envio, as variáveis viram os dados reais do chamado.</p></div>
              <div className="subtabs">
                <button type="button" aria-pressed={activeTab === 'editor'} onClick={() => setActiveTab('editor')}>Escrever</button>
                <button type="button" aria-pressed={activeTab === 'preview'} onClick={() => setActiveTab('preview')}>Pré-visualizar</button>
              </div>
            </div>

            {activeTab === 'editor' ? (
              <>
                <Field label="Assunto do e-mail" required>
                  <Inp
                    id="survey-assunto_email"
                    value={form.assunto_email}
                    onChange={(e) => setForm({ ...form, assunto_email: e.target.value })}
                    onFocus={() => setTargetField('assunto_email')}
                    onSelect={(e) => { fieldCursors.current.assunto_email = e.currentTarget.selectionStart }}
                    placeholder="Ex: Pesquisa de satisfação: Chamado {numero_chamado}"
                    maxLength={150}
                    showCount
                  />
                </Field>

                <Field label="Convite automático (E-mail / Chat do chamado)" required>
                  <div className="cfg-sub" style={{ margin: 0 }}>Enviado automaticamente após a conclusão. Obrigatório conter <code className="cfg-mono">{'{link_pesquisa}'}</code>.</div>
                  <Txta
                    id="survey-corpo_convite_auto"
                    value={form.corpo_convite_auto}
                    onChange={(e) => setForm({ ...form, corpo_convite_auto: e.target.value })}
                    onFocus={() => setTargetField('corpo_convite_auto')}
                    onSelect={(e) => { fieldCursors.current.corpo_convite_auto = e.currentTarget.selectionStart }}
                    rows={6}
                    placeholder="Digite o texto de envio. Certifique-se de incluir a tag {link_pesquisa}."
                    style={{ lineHeight: 1.6 }}
                    maxLength={2000}
                    showCount
                  />
                </Field>

                <Field label="Texto de macro do analista" required>
                  <div className="cfg-sub" style={{ margin: 0 }}>Disponível para o analista enviar pelo chat. Obrigatório conter <code className="cfg-mono">{'{link_pesquisa}'}</code>.</div>
                  <Txta
                    id="survey-corpo_convite_macro"
                    value={form.corpo_convite_macro}
                    onChange={(e) => setForm({ ...form, corpo_convite_macro: e.target.value })}
                    onFocus={() => setTargetField('corpo_convite_macro')}
                    onSelect={(e) => { fieldCursors.current.corpo_convite_macro = e.currentTarget.selectionStart }}
                    rows={4}
                    placeholder="Digite o texto simplificado para uso via chat macro. Certifique-se de incluir a tag {link_pesquisa}."
                    style={{ lineHeight: 1.6 }}
                    maxLength={1000}
                    showCount
                  />
                </Field>
              </>
            ) : (
              <div>
                <div className="msg-preview">
                  <div style={{ fontSize: 14, fontWeight: 500 }}>E-mail automático / notificação</div>
                  <div className="cfg-sub" style={{ margin: '2px 0 12px' }}>Assunto: {preview.assunto || 'Sem assunto'}</div>
                  <p className="msg-text">{preview.autoBody || <span className="cfg-off">Nenhum conteúdo no convite automático.</span>}</p>
                </div>
                <div className="msg-preview">
                  <div style={{ fontSize: 14, fontWeight: 500 }}>João Lima</div>
                  <div className="cfg-sub" style={{ margin: '2px 0 12px' }}>Atendente • Chat do Chamado #INC-000123</div>
                  <p className="msg-text">{preview.macroBody || <span className="cfg-off">Nenhum conteúdo no texto de macro.</span>}</p>
                </div>
                <p className="cfg-sub">As variáveis foram substituídas com base no chamado de teste Maria Souza (#INC-000123).</p>
              </div>
            )}

            {preview.unknown.length > 0 && (
              <div role="alert" className="notice">
                <span style={{ color: 'var(--warning)', fontWeight: 600 }}>Variável não reconhecida.</span> {unknownMessage(preview.unknown)}
              </div>
            )}
          </div>
        </div>

        <VariablePicker
          variables={variables}
          hint={
            <div className="subtabs" role="group" aria-label="Campo de destino da variável">
              {(['corpo_convite_auto', 'corpo_convite_macro', 'assunto_email'] as TargetField[]).map((fld) => (
                <button
                  key={fld}
                  type="button"
                  aria-pressed={targetField === fld}
                  style={{ padding: '6px 10px', fontSize: 13 }}
                  onClick={() => {
                    setTargetField(fld)
                    requestAnimationFrame(() => document.getElementById(`survey-${fld}`)?.focus())
                  }}
                >
                  {fld === 'corpo_convite_auto' ? 'Convite auto' : fld === 'corpo_convite_macro' ? 'Texto macro' : 'Assunto'}
                </button>
              ))}
            </div>
          }
          inserted={recentlyInserted}
          onInsert={insertVariable}
          target={TARGET_FIELD_LABELS[targetField]}
        >
          <div className="var-quick">
            <span>Inserir em {TARGET_FIELD_LABELS[targetField]}:</span>
            {QUICK_VARIABLES.map((qv) => (
              <button key={qv.key} type="button" className="cfg-link" onClick={() => insertVariable(qv.key)}>+ {qv.label}</button>
            ))}
          </div>
        </VariablePicker>
      </Modal>

      {/* ── Help / Info Modal ── */}
      <Modal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        title="Instruções de configuração e uso"
        width={720}
        footer={
          <Btn onClick={() => setShowHelpModal(false)}>Entendi</Btn>
        }
      >
        <div className="cfg-form" style={{ gap: 28 }}>
          <div>
            <h4 style={helpHeadingStyle}>1. Funcionamento dos Modelos</h4>
            <p style={helpTextStyle}>
              O sistema permite criar múltiplos modelos de pesquisa de satisfação, mas apenas <strong>um modelo ativo principal</strong> pode vigorar por vez. Ele é usado nos envios de e-mails automáticos após encerramento de chamados e macros de chat dos analistas.
            </p>
          </div>

          <div>
            <h4 style={helpHeadingStyle}>2. Variáveis de Mensagem (Assunto e Corpo)</h4>
            <p style={helpTextStyle}>
              Ao configurar o e-mail ou o texto da macro, você deve usar as tags que serão preenchidas dinamicamente pelo sistema:
            </p>
            <ul style={helpListStyle}>
              {variables.map(v => (
                <li key={v.key}><code className="cfg-mono">{`{${v.key}}`}</code>: {v.label}{v.key === 'link_pesquisa' && ' (obrigatório)'}.</li>
              ))}
              <li><code className="cfg-mono">{'{nome_cliente}'}</code>: nome antigo de {'{nome_usuario}'}, continua funcionando.</li>
            </ul>
          </div>

          <div>
            <h4 style={helpHeadingStyle}>3. Tipos de Pergunta do Questionário</h4>
            <p style={helpTextStyle}>
              Ao gerenciar as perguntas do questionário no botão "Adicionar pergunta", escolha o tipo ideal de controle:
            </p>
            <ul style={helpListStyle}>
              <li><strong>Escala (nota)</strong>: Ideal para perguntas CSAT (Satisfação Geral ou cordialidade). Possui estilos visuais:
                <ul style={{ paddingLeft: 18, marginTop: 4, listStyleType: 'circle' }}>
                  <li><em>Emoji</em>: Ícones de reações de satisfação. Exige cores e emojis individuais.</li>
                  <li><em>Estrela</em>: Clássica avaliação por estrelas de 1 a N.</li>
                  <li><em>Numérico / pill</em>: Botões numerados ou em formato de cápsula.</li>
                </ul>
              </li>
              <li><strong>NPS (0–10)</strong>: Net Promoter Score padrão de mercado. Agrega no dashboard as faixas de detratores, neutros e promotores.</li>
              <li><strong>Escolha única / escolha múltipla</strong>: Opções customizadas de múltipla escolha para o usuário.</li>
              <li><strong>Texto livre</strong>: Caixa para comentário ou justificativa aberta.</li>
            </ul>
          </div>

          <div>
            <h4 style={helpHeadingStyle}>4. Fluxo de Reabertura de Chamado</h4>
            <p style={helpTextStyle}>
              Você pode atrelar a reabertura automática do chamado a qualquer opção de pergunta de <strong>Escolha única</strong> ou <strong>Múltipla</strong>. Por exemplo, na opção <em>"Não"</em> para a pergunta <em>"O seu problema foi resolvido?"</em>, marque a caixa <strong>Reabre</strong>.
            </p>
            <p style={helpTextStyle}>
              Quando o cliente selecionar essa opção específica:
            </p>
            <ul style={helpListStyle}>
              <li>O portal exigirá que ele digite um motivo (mínimo 10 caracteres) e permitirá anexar uma captura de tela.</li>
              <li>Ao enviar, o chamado será reaberto no painel do analista mudando o status para <strong>Em Andamento</strong> e enviando a justificativa.</li>
            </ul>
          </div>

          <div>
            <h4 style={helpHeadingStyle}>5. Pontuação (Score de Média)</h4>
            <p style={helpTextStyle}>
              Para perguntas de <strong>Escala (nota)</strong>, você pode associar uma pontuação (Pontos) para cada opção. O dashboard usará esses valores para calcular a média ponderada das avaliações e gerar gráficos de evolução temporal.
            </p>
          </div>
        </div>
      </Modal>

      <AlertModal
        isOpen={alert.isOpen}
        onClose={() => setAlert({ ...alert, isOpen: false })}
        title={alert.title}
        message={alert.message}
        variant={alert.variant}
      />

      <ConfirmModal
        isOpen={confirmDeleteModal.isOpen}
        onClose={() => setConfirmDeleteModal({ isOpen: false, template: null })}
        onConfirm={confirmDelete}
        title="Confirmar exclusão"
        message={`Tem certeza que deseja excluir o modelo de pesquisa "${confirmDeleteModal.template?.nome}"?`}
        confirmText="Confirmar exclusão"
        cancelText="Cancelar"
        variant="danger"
      />

      {previewTemplate && (
        <SurveyPreviewModal
          isOpen={!!previewTemplate}
          onClose={() => setPreviewTemplate(null)}
          template={previewTemplate}
        />
      )}
    </div>
  )
}

// ── Local Styles ─────────────────────────────────────────────────────────────

const helpHeadingStyle: React.CSSProperties = { margin: '0 0 8px', fontSize: 16, fontWeight: 500, color: 'var(--text-1)' }

const helpTextStyle: React.CSSProperties = { margin: '0 0 8px', fontSize: 14, color: 'var(--text-2)', lineHeight: 1.55 }

const helpListStyle: React.CSSProperties = { margin: 0, fontSize: 14, color: 'var(--text-2)', lineHeight: 1.65, paddingLeft: 18 }
