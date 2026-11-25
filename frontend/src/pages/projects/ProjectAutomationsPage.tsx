import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Btn, Sel, EmptyState, Inp, Loading } from '@/components/ui'
import { Automation, AutomationTrigger, listAutomations, createAutomation, setAutomationActive } from '@/services/automationsService'
import { listMembers } from '@/services/projectsService'
import { ProjectMemberWithUser } from '@/types/projects'
import { Section } from '@/components/projects/insights/Section'
import { visuallyHidden } from '@/components/charts/ChartTooltip'
import { useProjectRole } from '@/components/projects/projectRole'
import { toast } from '@/store/toastStore'
import { apiErrorMessage } from '@/services/api'

const TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  task_created: 'Task criada',
  status_changed: 'Status alterado',
  assignee_changed: 'Responsável alterado',
  due_date_reached: 'Prazo atingido',
  task_overdue: 'Task atrasada',
  task_completed: 'Task concluída',
  subtasks_completed: 'Subtasks concluídas',
  priority_changed: 'Prioridade alterada',
  approval_decided: 'Aprovação decidida',
  comment_created: 'Comentário criado',
}

function describeAutomation(automation: Automation, memberName: (userId: string) => string | undefined): string {
  const triggerText = TRIGGER_LABELS[automation.trigger]
  const actionTexts = automation.actions.map((a) => {
    switch (a.type) {
      case 'change_status': return 'alterar status'
      case 'change_assignee': return 'alterar responsável'
      case 'change_priority': return `alterar prioridade para ${a.priority}`
      case 'add_tag': return 'adicionar tag'
      case 'send_notification': {
        const who = a.userId ? memberName(a.userId) : undefined
        return `enviar notificação${who ? ` para ${who}` : ''} ("${a.message}")`
      }
      case 'request_approval': return 'solicitar aprovação'
      case 'move_list': return 'mover de lista'
      case 'add_comment': return `adicionar comentário ("${a.body}")`
    }
  })
  return `Quando "${triggerText}", então ${actionTexts.join(' e ')}.`
}

export default function ProjectAutomationsPage() {
  const { canConfigure } = useProjectRole()
  const { projectId } = useParams<{ projectId: string }>()
  const [automations, setAutomations] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [members, setMembers] = useState<ProjectMemberWithUser[]>([])
  const [name, setName] = useState('')
  const [trigger, setTrigger] = useState<AutomationTrigger>('status_changed')
  // Destinatário da notificação: sem ele a regra roda e não avisa ninguém.
  const [recipientId, setRecipientId] = useState('')
  const [message, setMessage] = useState('')
  const [creating, setCreating] = useState(false)

  function load() {
    if (!projectId) return
    setLoading(true)
    setLoadError(null)
    listAutomations(projectId)
      .then(setAutomations)
      .catch((err) => setLoadError(apiErrorMessage(err, 'Não foi possível carregar as automações.')))
      .finally(() => setLoading(false))
  }

  useEffect(load, [projectId])

  useEffect(() => {
    if (!projectId) return
    listMembers(projectId).then(setMembers).catch(() => setMembers([]))
  }, [projectId])

  const memberName = (userId: string) => members.find((m) => m.userId === userId)?.user.name
  const canSave = !!name.trim() && !!message.trim() && !!recipientId && !creating

  async function handleCreate() {
    if (!projectId || !canSave) return
    setCreating(true)
    try {
      const automation = await createAutomation(projectId, {
        name: name.trim(),
        trigger,
        actions: [{ type: 'send_notification', userId: recipientId, message: message.trim() }],
      })
      setAutomations((prev) => [automation, ...prev])
      setName('')
      setMessage('')
      setRecipientId('')
      toast.success('Automação criada.')
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível criar a automação.'))
    } finally {
      setCreating(false)
    }
  }

  async function handleToggle(automation: Automation) {
    if (!projectId) return
    try {
      const updated = await setAutomationActive(projectId, automation.id, !automation.isActive)
      setAutomations((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
    } catch (err) {
      toast.error(apiErrorMessage(err, automation.isActive ? 'Não foi possível desativar a automação.' : 'Não foi possível ativar a automação.'))
    }
  }

  if (loading) return <Loading label="Carregando regras…" />

  if (loadError) {
    return (
      <EmptyState
        title="Não foi possível carregar"
        desc={loadError}
        action={<Btn variant="secondary" size="sm" onClick={load}>Tentar novamente</Btn>}
      />
    )
  }

  return (
    <div className="prj-body">
      <div>
        {automations.length === 0 ? (
          <p className="prj-note"><strong style={{ fontWeight: 500, color: 'var(--text-1)' }}>Nenhuma regra cadastrada</strong><br />
            Uma regra aciona uma ação sozinha quando um status ou uma tarefa muda.</p>
        ) : (
          <div className="prj-scroll">
            <table className="table prj">
              <thead><tr><th scope="col">Regra</th><th scope="col">O que faz</th><th scope="col">Situação</th>{canConfigure && <th scope="col"><span style={visuallyHidden}>Ação</span></th>}</tr></thead>
              <tbody>
                {automations.map((automation) => (
                  <tr key={automation.id}>
                    <td style={{ color: 'var(--text-1)', overflowWrap: 'anywhere' }}>{automation.name}</td>
                    <td>{describeAutomation(automation, memberName)}</td>
                    <td>{automation.isActive ? 'Ativa' : <span style={{ color: 'var(--text-3)' }}>Desativada</span>}</td>
                    {canConfigure && <td className="num"><Btn variant="ghost" size="xs" onClick={() => handleToggle(automation)}>{automation.isActive ? 'Desativar' : 'Ativar'}</Btn></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Só dono/gerente do projeto cria regra. */}
      {canConfigure && <Section title="Nova regra de automação">
        <div className="setting">
          <span>Nome da regra</span>
          <Inp aria-label="Nome da regra" placeholder="Ex: Notificar equipe ao concluir tarefa" value={name} onChange={(e: any) => setName(e.target.value)} />
        </div>
        <div className="setting">
          <span>Quando<small>O que precisa acontecer na tarefa</small></span>
          <Sel aria-label="Quando acontecer este gatilho" value={trigger} onChange={(e: any) => setTrigger(e.target.value as AutomationTrigger)}>
            {Object.entries(TRIGGER_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Sel>
        </div>
        <div className="setting">
          <span>Notificar quem<small>Obrigatório. Recebe o aviso no sistema</small></span>
          <Sel value={recipientId} onChange={(e: any) => setRecipientId(e.target.value)} aria-label="Notificar quem">
            <option value="">Selecione um membro…</option>
            {members.map((m) => <option key={m.userId} value={m.userId}>{m.user.name}</option>)}
          </Sel>
        </div>
        <div className="setting">
          <span>Mensagem</span>
          <Inp aria-label="Mensagem da notificação" placeholder="Ex: A tarefa foi concluída e está pronta para revisão." value={message} onChange={(e: any) => setMessage(e.target.value)} />
        </div>
        <div className="setting">
          <span />
          <div>
            <Btn variant="primary" size="sm" onClick={handleCreate} disabled={!canSave}>
              {creating ? 'Criando…' : 'Criar automação'}
            </Btn>
          </div>
        </div>
      </Section>}
    </div>
  )
}
