import { toast } from '@/store/toastStore'
import { useState } from 'react'
import {
  surveyService,
  SurveyQuestion,
  SurveyQuestionOption,
  SurveyQuestionType,
  SurveyQuestionStyle,
} from '@/services/surveyService'
import {
  Btn,
  Field,
  Inp,
  Txta,
  Sel,
  Toggle,
  Modal,
  AlertModal,
  ConfirmModal,
} from '@/components/ui'
import { Edit, Trash2, ChevronUp, ChevronDown, X } from 'lucide-react'
import './configuracoes.css'
import { useAuthStore } from '@/store/auth'
import { hasAreaPermission } from '@/utils/permissions'

// ── Helpers ──────────────────────────────────────────────────────────────────

const TIPO_OPTIONS: { value: SurveyQuestionType; label: string }[] = [
  { value: 'escala', label: 'Escala (nota)' },
  { value: 'escolha_unica', label: 'Escolha única' },
  { value: 'escolha_multipla', label: 'Escolha múltipla' },
  { value: 'texto_livre', label: 'Texto livre' },
  { value: 'nps', label: 'NPS (0–10)' },
]

const ESTILO_OPTIONS: { value: SurveyQuestionStyle; label: string }[] = [
  { value: 'emoji', label: 'Emoji' },
  { value: 'estrela', label: 'Estrela' },
  { value: 'numerico', label: 'Numérico' },
  { value: 'pill', label: 'Pill' },
]

function tipoLabel(tipo: SurveyQuestionType): string {
  // Mapeia também valores legados para um rótulo amigável
  switch (tipo) {
    case 'escala':
    case 'escala_1_5':
      return 'Escala'
    case 'escolha_unica':
    case 'unica_escolha':
      return 'Escolha única'
    case 'escolha_multipla':
      return 'Escolha múltipla'
    case 'texto_livre':
      return 'Texto livre'
    case 'nps':
      return 'NPS'
    default:
      return tipo
  }
}

function needsOptions(tipo: SurveyQuestionType): boolean {
  return tipo === 'escala' || tipo === 'escolha_unica' || tipo === 'escolha_multipla'
}

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

// Linha de opção em edição (estado local do form)
interface OptionDraft {
  rotulo: string
  valor: string
  emoji: string
  cor: string
  pontuacao: string // mantido como string no input; convertido no save
  reabrir: boolean
}

function optionToDraft(o: SurveyQuestionOption): OptionDraft {
  return {
    rotulo: o.rotulo ?? '',
    valor: o.valor ?? '',
    emoji: o.emoji ?? '',
    cor: o.cor ?? '',
    pontuacao: o.pontuacao == null ? '' : String(o.pontuacao),
    reabrir: o.acao === 'reabrir_chamado',
  }
}

function emptyDraft(): OptionDraft {
  return { rotulo: '', valor: '', emoji: '', cor: '', pontuacao: '', reabrir: false }
}

// ── Component ────────────────────────────────────────────────────────────────

export function SurveyQuestionBuilder({
  templateId,
  questions,
  onChange,
}: {
  templateId: string
  questions: SurveyQuestion[]
  onChange: () => void
}) {
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'admin' || hasAreaPermission(user, 'survey')

  // Perguntas arquivadas pela lixeira (já respondidas: viram inativas em vez de
  // serem apagadas) somem da lista. O toggle "Ativa" continua apenas pausando a
  // pergunta, sem escondê-la.
  const [arquivadas, setArquivadas] = useState<string[]>([])

  const sorted = [...questions]
    .filter(q => !arquivadas.includes(q.id))
    .sort((a, b) => a.ordem - b.ordem)

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<SurveyQuestion | null>(null)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)

  // Form state
  const [enunciado, setEnunciado] = useState('')
  const [descricao, setDescricao] = useState('')
  const [tipo, setTipo] = useState<SurveyQuestionType>('escala')
  const [estilo, setEstilo] = useState<SurveyQuestionStyle>('emoji')
  const [obrigatoria, setObrigatoria] = useState(true)
  const [ativa, setAtiva] = useState(true)
  const [options, setOptions] = useState<OptionDraft[]>([])

  const [alert, setAlert] = useState<{
    isOpen: boolean
    title: string
    message: string
    variant: 'danger' | 'warning' | 'primary'
  }>({ isOpen: false, title: '', message: '', variant: 'warning' })
  const [confirmDelete, setConfirmDelete] = useState<{ isOpen: boolean; question: SurveyQuestion | null }>({
    isOpen: false,
    question: null,
  })

  const showError = (message: string, title = 'Validação', variant: 'danger' | 'warning' = 'warning') =>
    setAlert({ isOpen: true, title, message, variant })

  // ── Modal open helpers ──
  const openNew = () => {
    if (!isAdmin) return
    setEditing(null)
    setEnunciado('')
    setDescricao('')
    setTipo('escala')
    setEstilo('emoji')
    setObrigatoria(true)
    setAtiva(true)
    setOptions([emptyDraft(), emptyDraft()])
    setShowModal(true)
  }

  const openEdit = (q: SurveyQuestion) => {
    if (!isAdmin) return
    setEditing(q)
    // Normaliza tipos legados para os valores canônicos do editor
    const canonicalTipo: SurveyQuestionType =
      q.tipo === 'escala_1_5' ? 'escala' : q.tipo === 'unica_escolha' ? 'escolha_unica' : q.tipo
    setEnunciado(q.enunciado ?? '')
    setDescricao(q.descricao ?? '')
    setTipo(canonicalTipo)
    setEstilo((q.estilo as SurveyQuestionStyle) ?? 'emoji')
    setObrigatoria(q.obrigatoria)
    setAtiva(q.ativa)
    setOptions((q.opcoes ?? []).map(optionToDraft))
    setShowModal(true)
  }

  // ── Option row mutators ──
  const updateOption = (idx: number, patch: Partial<OptionDraft>) => {
    setOptions((prev) => prev.map((o, i) => (i === idx ? { ...o, ...patch } : o)))
  }

  const handleRotuloChange = (idx: number, value: string) => {
    setOptions((prev) =>
      prev.map((o, i) => {
        if (i !== idx) return o
        // auto-sugere valor a partir do slug do rótulo se o valor estiver vazio
        const nextValor = o.valor.trim() === '' ? slugify(value) : o.valor
        return { ...o, rotulo: value, valor: nextValor }
      })
    )
  }

  const toggleReabrir = (idx: number, checked: boolean) => {
    // Apenas uma opção pode reabrir o chamado: ao marcar uma, desmarca as outras
    setOptions((prev) => prev.map((o, i) => ({ ...o, reabrir: i === idx ? checked : false })))
  }

  const addOption = () => setOptions((prev) => [...prev, emptyDraft()])
  const removeOption = (idx: number) => setOptions((prev) => prev.filter((_, i) => i !== idx))

  // ── Save ──
  const save = async () => {
    if (!isAdmin) return
    const enun = enunciado.trim()
    if (!enun) {
      showError('O enunciado da pergunta é obrigatório.')
      return
    }

    const withOptions = needsOptions(tipo)
    let opcoes: SurveyQuestionOption[] | undefined

    if (withOptions) {
      const cleaned = options
        .map((o) => ({ ...o, rotulo: o.rotulo.trim(), valor: o.valor.trim() }))
      if (cleaned.length < 2) {
        showError('Este tipo de pergunta exige pelo menos 2 opções.')
        return
      }
      for (const o of cleaned) {
        if (!o.rotulo) {
          showError('Todas as opções devem ter um rótulo preenchido.')
          return
        }
        if (!o.valor) {
          showError('Todas as opções devem ter um valor preenchido.')
          return
        }
      }
      const valores = cleaned.map((o) => o.valor)
      if (new Set(valores).size !== valores.length) {
        showError('Os valores das opções devem ser únicos.')
        return
      }

      const hasEmoji = tipo === 'escala' && estilo === 'emoji'
      const hasColor = tipo === 'escala' && estilo === 'emoji'
      const hasPontos = tipo === 'escala'

      opcoes = cleaned.map((o, idx) => {
        const pont = o.pontuacao.trim() === '' ? null : Number(o.pontuacao)
        return {
          ordem: idx,
          rotulo: o.rotulo,
          valor: o.valor,
          emoji: hasEmoji && o.emoji.trim() !== '' ? o.emoji.trim() : null,
          cor: hasColor && o.cor.trim() !== '' ? o.cor.trim() : null,
          pontuacao: hasPontos && pont != null && !Number.isNaN(pont) ? pont : null,
          acao: o.reabrir ? 'reabrir_chamado' : null,
        } as SurveyQuestionOption
      })
    }

    const payload: Partial<SurveyQuestion> = {
      enunciado: enun,
      descricao: descricao.trim() === '' ? null : descricao.trim(),
      tipo,
      estilo: tipo === 'escala' ? estilo : null,
      obrigatoria,
      ativa,
      opcoes: withOptions ? opcoes : [],
    }

    setSaving(true)
    try {
      if (editing) {
        await surveyService.updateQuestion(editing.id, payload)
      } else {
        await surveyService.addQuestion(templateId, payload)
      }
      setShowModal(false)
      onChange()
      toast.success(editing ? 'Pergunta atualizada.' : 'Pergunta adicionada.')
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Erro ao salvar a pergunta.'
      showError(msg, 'Erro', 'danger')
    } finally {
      setSaving(false)
    }
  }

  // ── Reorder ──
  const move = async (idx: number, dir: -1 | 1) => {
    if (!isAdmin || busy) return
    const target = idx + dir
    if (target < 0 || target >= sorted.length) return
    const ids = sorted.map((q) => q.id)
    ;[ids[idx], ids[target]] = [ids[target], ids[idx]]
    setBusy(true)
    try {
      await surveyService.reorderQuestions(templateId, ids)
      onChange()
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Erro ao reordenar perguntas.'
      showError(msg, 'Erro', 'danger')
    } finally {
      setBusy(false)
    }
  }

  // ── Delete ──
  const doDelete = async () => {
    const q = confirmDelete.question
    setConfirmDelete({ isOpen: false, question: null })
    if (!q || !isAdmin) return
    setBusy(true)
    try {
      const res: any = await surveyService.deleteQuestion(q.id)
      // Respondida => backend arquiva (ativa: false) em vez de apagar, para não
      // alterar o histórico do dashboard. Some da lista do mesmo jeito.
      if (res?.arquivada) setArquivadas(prev => [...prev, q.id])
      onChange()
      toast.success(res?.arquivada ? 'Pergunta arquivada (já tinha respostas).' : 'Pergunta excluída.')
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Erro ao excluir a pergunta.'
      showError(msg, 'Erro', 'danger')
    } finally {
      setBusy(false)
    }
  }

  const showOptionsEditor = needsOptions(tipo)
  const showEstilo = tipo === 'escala'

  const hasEmoji = tipo === 'escala' && estilo === 'emoji'
  const hasColor = tipo === 'escala' && estilo === 'emoji'
  const hasPontos = tipo === 'escala'

  return (
    <>
      <div className="setting">
        <div>
          Perguntas do questionário
          <small>Na ordem em que o cliente responde.</small>
          {isAdmin && <button type="button" className="cfg-link" style={{ marginTop: 10 }} onClick={openNew} disabled={busy}>Adicionar pergunta</button>}
        </div>
        {sorted.length === 0 ? (
          <div className="cfg-off" style={{ fontSize: 14 }}>Nenhuma pergunta configurada para este modelo.</div>
        ) : (
          <ol className="q-list cfg-wide">
            {sorted.map((q, idx) => (
              <li key={q.id}>
                <span>{q.ordem}</span>
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                  <span className={q.ativa ? undefined : 'cfg-off'}>{q.enunciado}</span>
                  <small>
                    {[
                      tipoLabel(q.tipo) + (q.estilo ? ` (${q.estilo})` : ''),
                      needsOptions(q.tipo) && `${q.opcoes?.length ?? 0} opções`,
                      q.obrigatoria && 'obrigatória',
                      !q.ativa && 'inativa',
                    ].filter(Boolean).join(', ')}
                  </small>
                </span>
                {isAdmin && (
                  <span className="cfg-actions" style={{ marginTop: -5 }}>
                    <button type="button" className="icon-act" aria-label="Mover para cima" title="Mover para cima" disabled={idx === 0 || busy} onClick={() => move(idx, -1)}><ChevronUp size={15} /></button>
                    <button type="button" className="icon-act" aria-label="Mover para baixo" title="Mover para baixo" disabled={idx === sorted.length - 1 || busy} onClick={() => move(idx, 1)}><ChevronDown size={15} /></button>
                    <button type="button" className="icon-act" aria-label="Editar pergunta" title="Editar" onClick={() => openEdit(q)} disabled={busy}><Edit size={14} /></button>
                    <button type="button" className="icon-act danger" aria-label="Excluir pergunta" title="Excluir" onClick={() => setConfirmDelete({ isOpen: true, question: q })} disabled={busy}><Trash2 size={14} /></button>
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* ── Editor Modal ── */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Editar pergunta' : 'Nova pergunta'}
        width={660}
        footer={
          <>
            <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancelar</Btn>
            <Btn onClick={save} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Btn>
          </>
        }
      >
        <div className="cfg-form">
          <Field label="Enunciado" required>
            <Inp
              value={enunciado}
              onChange={(e) => setEnunciado(e.target.value)}
              placeholder="Ex: Como você avalia o atendimento?"
              maxLength={300}
              showCount
            />
          </Field>

          <Field label="Descrição (opcional)">
            <Txta
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={2}
              placeholder="Texto de apoio exibido abaixo do enunciado."
              style={{ minHeight: 56 }}
              maxLength={500}
              showCount
            />
          </Field>

          <div className="cfg-pair">
            <Field label="Tipo">
              <Sel value={tipo} onChange={(e) => setTipo(e.target.value as SurveyQuestionType)}>
                {TIPO_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </Sel>
            </Field>

            {showEstilo && (
              <Field label="Estilo">
                <Sel value={estilo} onChange={(e) => setEstilo(e.target.value as SurveyQuestionStyle)}>
                  {ESTILO_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </Sel>
              </Field>
            )}
          </div>

          <div className="cfg-inline" style={{ gap: 28, fontSize: 14 }}>
            <span className="cfg-inline"><Toggle value={obrigatoria} onChange={setObrigatoria} label="Obrigatória" />Obrigatória</span>
            <span className="cfg-inline"><Toggle value={ativa} onChange={setAtiva} label="Ativa" />Ativa</span>
          </div>

          {showOptionsEditor && (
            <div className="cfg-group">
              <div className="cfg-group-head">
                <h4>Opções</h4>
                <button type="button" className="cfg-link" onClick={addOption}>Adicionar opção</button>
              </div>

              <div className="q-opts">
                <div data-head>
                  <span style={{ flex: 2 }}>Rótulo</span>
                  <span style={{ flex: 1.5 }}>Valor</span>
                  {hasEmoji && <span style={{ width: 52, textAlign: 'center' }}>Emoji</span>}
                  {hasColor && <span style={{ width: 70 }}>Cor</span>}
                  {hasPontos && <span style={{ width: 64 }}>Pontos</span>}
                  <span style={{ width: 60, textAlign: 'center' }}>Reabre</span>
                  <span style={{ width: 32 }} />
                </div>
                {options.length === 0 && <div className="cfg-off" style={{ fontSize: 14 }}>Nenhuma opção. Adicione pelo menos 2.</div>}
                {options.map((o, idx) => (
                  <div key={idx}>
                    <Inp
                      style={{ flex: 2 }}
                      value={o.rotulo}
                      onChange={(e) => handleRotuloChange(idx, e.target.value)}
                      placeholder="Rótulo"
                      maxLength={100}
                    />
                    <Inp
                      style={{ flex: 1.5 }}
                      value={o.valor}
                      onChange={(e) => updateOption(idx, { valor: e.target.value })}
                      placeholder="valor"
                      maxLength={50}
                    />
                    {hasEmoji && (
                      <Inp
                        style={{ width: 52, textAlign: 'center' }}
                        value={o.emoji}
                        onChange={(e) => updateOption(idx, { emoji: e.target.value })}
                        placeholder="🙂"
                        maxLength={4}
                      />
                    )}
                    {hasColor && (
                      <Inp
                        style={{ width: 70 }}
                        value={o.cor}
                        onChange={(e) => updateOption(idx, { cor: e.target.value })}
                        placeholder="#00b"
                        maxLength={20}
                      />
                    )}
                    {hasPontos && (
                      <Inp
                        style={{ width: 64 }}
                        type="number"
                        value={o.pontuacao}
                        onChange={(e) => updateOption(idx, { pontuacao: e.target.value })}
                        placeholder="0"
                      />
                    )}
                    <label style={{ width: 60, display: 'flex', justifyContent: 'center', cursor: 'pointer' }} title="Marcar reabre o chamado ao selecionar esta opção">
                      <input
                        type="checkbox"
                        aria-label="Reabre o chamado"
                        checked={o.reabrir}
                        onChange={(e) => toggleReabrir(idx, e.target.checked)}
                      />
                    </label>
                    <button type="button" className="icon-act danger" aria-label="Remover opção" title="Remover opção" onClick={() => removeOption(idx)}><X size={14} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}
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
        isOpen={confirmDelete.isOpen}
        onClose={() => setConfirmDelete({ isOpen: false, question: null })}
        onConfirm={doDelete}
        title="Excluir pergunta"
        message={`Tem certeza que deseja excluir a pergunta "${confirmDelete.question?.enunciado ?? ''}"?`}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="danger"
      />
    </>
  )
}
