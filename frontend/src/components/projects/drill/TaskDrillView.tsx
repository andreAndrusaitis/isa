import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { CheckSquare, Square } from 'lucide-react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { Figures, PriorityDot, StatCard } from '@/components/ui'
import { BarList } from '@/components/charts/BarList'
import { ActivityLine, DayDivider, buildFeed, timeOf } from '@/components/projects/TaskTimeline'
import { taskLabel } from '@/components/projects/taskKey'
import { getTaskDrill, type TaskDrill } from '@/services/drillService'
import { fmtMinutes } from '@/utils/duration'
import { Section } from '@/components/projects/insights/Section'
import { useDrill } from './drillContext'
import { DrillError, DrillLink, DrillLoading, Empty, ProgressBar, fmtDate, useDrillData } from './drillUi'

const PRIORITY_LABEL: Record<string, string> = { critical: 'Crítica', high: 'Alta', normal: 'Normal', low: 'Baixa', none: 'Sem prioridade' }

export function TaskDrillView({ projectId, taskId }: { projectId: string; taskId: string }) {
  const { data, failed, retry } = useDrillData(() => getTaskDrill(projectId, taskId), [projectId, taskId])
  if (failed) return <DrillError onRetry={retry} />
  if (!data) return <DrillLoading />
  return <Body task={data} />
}

function Body({ task }: { task: TaskDrill }) {
  const { open } = useDrill()
  const person = (p: { id: string; name: string }) => () => open({ kind: 'person', userId: p.id, projectId: task.projectId, title: `${p.name} em ${task.project.name}` })
  const goTask = (t: { id: string; seq: number; key?: string | null; title: string }) => () => open({ kind: 'task', projectId: task.projectId, taskId: t.id, title: `${taskLabel(t)} ${t.title}` })
  const html = useMemo(() => (task.description ? DOMPurify.sanitize(marked.parse(task.description, { async: false, breaks: true }) as string) : ''), [task.description])
  const feed = useMemo(() => buildFeed(task.comments, task.timeline).slice(-40), [task.comments, task.timeline])
  const doneItems = task.checklist.filter((c) => c.done).length
  const time = task.time

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <dl className="prj-facts">
        <div><dt>Projeto</dt><dd><DrillLink onClick={() => open({ kind: 'project', projectId: task.projectId, title: task.project.name })}>{task.project.name}</DrillLink></dd></div>
        <div><dt>Status</dt><dd>{task.status.name}</dd></div>
        <div><dt>Prioridade</dt><dd style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><PriorityDot priority={task.priority} />{PRIORITY_LABEL[task.priority] ?? task.priority}</dd></div>
        {task.taskType && <div><dt>Tipo</dt><dd>{task.taskType.name}</dd></div>}
        {task.sprint && <div><dt>Sprint</dt><dd>{task.sprint.name}</dd></div>}
        {task.list && <div><dt>Lista</dt><dd>{task.list.name}</dd></div>}
        <div><dt>Responsáveis</dt><dd style={{ display: 'flex', flexWrap: 'wrap', gap: '0 12px' }}>{task.assignees.length === 0 ? '—' : task.assignees.map((a) => <DrillLink key={a.id} onClick={person(a)}>{a.name}</DrillLink>)}</dd></div>
        <div><dt>Início</dt><dd>{fmtDate(task.startDate)}</dd></div>
        <div><dt>Prazo</dt><dd>{fmtDate(task.dueDate)}</dd></div>
        {task.storyPoints != null && <div><dt>Pontos</dt><dd>{task.storyPoints}</dd></div>}
        {task.tags.length > 0 && <div><dt>Tags</dt><dd>{task.tags.map((t) => t.name).join(', ')}</dd></div>}
        {task.isMilestone && <div><dt>Ponto de controle</dt><dd>Sim</dd></div>}
        {task.archivedAt && <div><dt>Arquivada</dt><dd>Sim</dd></div>}
        {task.parent && <div><dt>Task pai</dt><dd><DrillLink onClick={goTask(task.parent)}>{taskLabel(task.parent)} {task.parent.title}</DrillLink></dd></div>}
        <div><dt>Criada por</dt><dd>{task.creator.name} em {fmtDate(task.createdAt)}</dd></div>
      </dl>

      {time && (
        <Figures>
          <StatCard label="Horas em andamento" value={fmtMinutes(time.activeMinutes)} sub={time.running ? 'Contando agora' : undefined} />
          <StatCard label="Ciclo" value={time.cycleMinutes == null ? '—' : fmtMinutes(time.cycleMinutes)} sub="Do início à conclusão" />
          <StatCard label="Começou" value={fmtDate(time.startedAt)} />
          <StatCard label="Concluiu" value={fmtDate(time.completedAt)} />
        </Figures>
      )}

      {html && (
        <Section small title="Descrição">
          <div className="task-description" style={{ fontSize: 14, color: 'var(--text-1)', lineHeight: 1.5, overflowWrap: 'anywhere', maxHeight: 220, overflowY: 'auto' }} dangerouslySetInnerHTML={{ __html: html }} />
        </Section>
      )}

      {time && time.byStatus.some((s) => s.minutes > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: 28 }}>
          <Section small title="Tempo por status">
            <BarList ariaLabel="Tempo por status" format={(m) => fmtMinutes(m)} labelWidth={120}
              items={time.byStatus.filter((s) => s.minutes > 0).map((s) => ({ id: s.statusId, label: s.name, value: s.minutes, color: 'var(--accent)' }))} />
          </Section>
          {time.byPerson.length > 0 && (
            <Section small title="Tempo por pessoa">
              <BarList ariaLabel="Tempo por pessoa" format={(m) => fmtMinutes(m)} labelWidth={120}
                items={time.byPerson.map((p) => ({ id: p.userId ?? 'none', label: p.name, value: p.minutes, color: 'var(--accent)' }))}
                onSelect={(it) => { if (it.id !== 'none') person({ id: it.id, name: it.label })() }} />
            </Section>
          )}
        </div>
      )}

      {task.checklist.length > 0 && (
        <Section small title={`Checklist (${doneItems} de ${task.checklist.length})`}>
          <ProgressBar value={Math.round((doneItems / task.checklist.length) * 100)} label="Progresso do checklist" />
          <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {task.checklist.map((c) => (
              <li key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 14, color: c.done ? 'var(--text-3)' : 'var(--text-1)' }}>
                {c.done ? <CheckSquare size={14} style={{ flexShrink: 0, marginTop: 2 }} aria-label="Feito" /> : <Square size={14} style={{ flexShrink: 0, marginTop: 2 }} aria-label="Pendente" />}
                <span style={{ overflowWrap: 'anywhere' }}>{c.text}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {task.subtasks.length > 0 && (
        <Section small title={`Subtasks (${task.subtasks.length})`}>
          <TaskRefs items={task.subtasks} onOpen={goTask} right={(t) => t.status.name} />
        </Section>
      )}
      {task.blockedBy.length > 0 && <Section small title="Depende de"><TaskRefs items={task.blockedBy} onOpen={goTask} /></Section>}
      {task.blocks.length > 0 && <Section small title="Bloqueia"><TaskRefs items={task.blocks} onOpen={goTask} /></Section>}

      {task.tickets.length > 0 && (
        <Section small title={`Chamados vinculados (${task.tickets.length})`}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
            {task.tickets.map((t) => <li key={t.id}><Link to={`/c/${t.id}`} style={{ color: 'var(--accent-fg)' }}>{t.displayNumber}</Link> <span style={{ color: 'var(--text-2)' }}>{t.title}</span></li>)}
          </ul>
        </Section>
      )}

      <Section small title={`Histórico e comentários (${task.commentsCount} comentário(s))`}>
        {feed.length === 0 ? <Empty>Nada registrado ainda.</Empty> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {feed.map((item) => {
              if (item.kind === 'day') return <DayDivider key={item.key} label={item.label} />
              if (item.kind === 'event') return <ActivityLine key={item.key} event={item.event} />
              const c = item.comment
              return (
                <div key={item.key} style={{ padding: '10px 0', borderTop: '1px solid var(--border)', fontSize: 14, color: 'var(--text-1)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 2, color: 'var(--text-3)', fontSize: 13 }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-2)' }}>{c.author.name} comentou</span>
                    <span>{timeOf(c.createdAt)}</span>
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{c.body}</div>
                </div>
              )
            })}
          </div>
        )}
      </Section>
    </div>
  )
}

function TaskRefs<T extends { id: string; seq: number; key?: string | null; title: string }>({ items, onOpen, right }: { items: T[]; onOpen: (t: T) => () => void; right?: (t: T) => string }) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
      {items.map((t) => (
        <li key={t.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <DrillLink onClick={onOpen(t)}><span style={{ color: 'var(--text-3)', marginRight: 6 }}>{taskLabel(t)}</span>{t.title}</DrillLink>
          {right && <span style={{ color: 'var(--text-3)', flexShrink: 0 }}>{right(t)}</span>}
        </li>
      ))}
    </ul>
  )
}
