import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Btn, ConfirmModal } from '@/components/ui'
import { bulkAction, BulkActionInput, BulkActionKind, listTags, listTaskTypes } from '@/services/projectsService'
import { ProjectStatus, ProjectMemberWithUser, Sprint, Tag, TaskType } from '@/types/projects'
import { toast } from '@/store/toastStore'
import { apiErrorMessage } from '@/services/api'
import './projects.css'

const ACTIONS: Array<{ value: BulkActionKind; label: string; configureOnly?: boolean }> = [
  { value: 'status', label: 'Mudar status' },
  { value: 'due_date', label: 'Mudar prazo' },
  { value: 'start_date', label: 'Mudar início' },
  { value: 'priority', label: 'Mudar prioridade' },
  { value: 'assignee', label: 'Mudar responsável' },
  { value: 'task_type', label: 'Mudar tipo (gera ID novo)' },
  { value: 'sprint', label: 'Mover para sprint' },
  { value: 'add_tag', label: 'Adicionar tag' },
  { value: 'archive', label: 'Arquivar', configureOnly: true },
]

const PRIORITIES = [
  { value: 'critical', label: 'Crítica' }, { value: 'high', label: 'Alta' }, { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Baixa' }, { value: 'none', label: 'Sem prioridade' },
]

/**
 * Barra de edição em massa das tasks selecionadas. Cada task passa pelo
 * mesmo caminho da edição individual no backend (histórico, automações,
 * socket); o lote não é atômico — quem falhar é informado e o resto é aplicado.
 */
export function BulkActionBar({
  projectId, selectedIds, visibleCount, statuses, members, sprints, canConfigure, onApplied, onClear, onSelectAllVisible,
}: {
  projectId: string
  selectedIds: string[]
  visibleCount: number
  statuses: ProjectStatus[]
  members: ProjectMemberWithUser[]
  sprints: Sprint[]
  canConfigure: boolean
  onApplied: () => void
  onClear: () => void
  onSelectAllVisible: () => void
}) {
  const [action, setAction] = useState<BulkActionKind>('status')
  const [value, setValue] = useState('')
  const [dateMode, setDateMode] = useState<'set' | 'shift'>('set')
  const [shiftDays, setShiftDays] = useState('7')
  const [tags, setTags] = useState<Tag[]>([])
  const [types, setTypes] = useState<TaskType[]>([])
  const [applying, setApplying] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)

  useEffect(() => {
    listTags(projectId).then(setTags).catch(() => setTags([]))
    listTaskTypes(projectId).then(setTypes).catch(() => setTypes([]))
  }, [projectId])

  useEffect(() => { setValue('') }, [action])

  const isDate = action === 'due_date' || action === 'start_date'
  const count = selectedIds.length

  function buildInput(): BulkActionInput | string {
    const base = { taskIds: selectedIds, action }
    switch (action) {
      case 'status': return value ? { ...base, statusId: value } : 'Escolha o status.'
      case 'priority': return value ? { ...base, priority: value } : 'Escolha a prioridade.'
      case 'assignee': return { ...base, assigneeId: value || null }
      case 'task_type': return value ? { ...base, taskTypeId: value } : 'Escolha o tipo.'
      case 'sprint': return { ...base, sprintId: value || null }
      case 'add_tag': return value ? { ...base, tagId: value } : 'Escolha a tag.'
      case 'archive': return base
      case 'due_date':
      case 'start_date': {
        if (dateMode === 'shift') {
          const days = Number(shiftDays)
          return Number.isInteger(days) && days !== 0 ? { ...base, shiftDays: days } : 'Informe quantos dias (ex.: 7 ou -2).'
        }
        // Meio-dia UTC: a data não "volta um dia" no fuso do Brasil.
        return { ...base, date: value ? `${value}T12:00:00.000Z` : null }
      }
      default: return base
    }
  }

  async function apply(confirmed = false) {
    const input = buildInput()
    if (typeof input === 'string') { toast.warning(input); return }
    if (action === 'archive' && !confirmed) { setConfirmArchive(true); return }
    setApplying(true)
    try {
      const result = await bulkAction(projectId, input)
      const ok = result.succeeded.length
      const failed = result.failed.length
      if (failed === 0) toast.success(`${ok} task(s) atualizada(s).`)
      else toast.warning(`${ok} atualizada(s), ${failed} não: ${result.failed[0].reason}`, 8000)
      onApplied()
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível aplicar a alteração em massa.'))
    } finally {
      setApplying(false)
    }
  }

  return (
    <div role="region" aria-label="Edição em massa" className="bulk">
      <span aria-live="polite" style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-1)', whiteSpace: 'nowrap' }}>
        {count} selecionada{count > 1 ? 's' : ''}
      </span>
      {count < visibleCount && (
        <button type="button" onClick={onSelectAllVisible} className="pj-link">Selecionar as {visibleCount} visíveis</button>
      )}

      <select aria-label="Ação em massa" value={action} onChange={(e) => setAction(e.target.value as BulkActionKind)}>
        {ACTIONS.filter((a) => !a.configureOnly || canConfigure).map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
      </select>

      {action === 'status' && (
        <select aria-label="Novo status" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">Status…</option>
          {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      {action === 'priority' && (
        <select aria-label="Nova prioridade" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">Prioridade…</option>
          {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      )}
      {action === 'assignee' && (
        <select aria-label="Novo responsável" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">Sem responsável</option>
          {members.map((m) => <option key={m.userId} value={m.userId}>{m.user.name}</option>)}
        </select>
      )}
      {action === 'task_type' && (
        <select aria-label="Novo tipo" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">Tipo…</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.prefix})</option>)}
        </select>
      )}
      {action === 'sprint' && (
        <select aria-label="Sprint" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">Sem sprint</option>
          {sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      {action === 'add_tag' && (
        <select aria-label="Tag" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">{tags.length ? 'Tag…' : 'Projeto sem tags'}</option>
          {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}
      {isDate && (
        <>
          <select aria-label="Como mudar a data" value={dateMode} onChange={(e) => setDateMode(e.target.value as 'set' | 'shift')}>
            <option value="set">Definir a mesma data</option>
            <option value="shift">Adiar/antecipar dias</option>
          </select>
          {dateMode === 'set' ? (
            <input type="date" aria-label={action === 'due_date' ? 'Novo prazo (vazio limpa)' : 'Novo início (vazio limpa)'} value={value} onChange={(e) => setValue(e.target.value)} />
          ) : (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, color: 'var(--text-2)' }}>
              <input type="number" aria-label="Dias (negativo antecipa)" value={shiftDays} onChange={(e) => setShiftDays(e.target.value)} style={{ width: 72 }} step={1} />
              dias
            </label>
          )}
        </>
      )}

      <Btn variant={action === 'archive' ? 'danger' : 'primary'} size="sm" onClick={() => apply()} disabled={applying || count === 0}>
        {applying ? 'Aplicando…' : `Aplicar em ${count}`}
      </Btn>
      <button type="button" onClick={onClear} aria-label="Limpar seleção" title="Limpar seleção" className="icon-act" style={{ marginLeft: 'auto' }}>
        <X size={16} />
      </button>
      <ConfirmModal
        isOpen={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        onConfirm={() => { setConfirmArchive(false); apply(true) }}
        title="Arquivar tasks"
        message={`Arquivar ${count} task(s)? Elas saem das visões do projeto; chamados vinculados voltam ao atendimento.`}
        confirmText="Arquivar"
        variant="danger"
      />
    </div>
  )
}
