/** Minha semana: tarefas e chamados da pessoa no mesmo calendário, e o que está travado por outra. */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Btn, EmptyState, Loading, Meter, PageHeader } from '@/components/ui'
import api from '@/services/api'
import { getMyArea } from '@/services/projectsService'
import { ticketService } from '@/services/ticketService'
import { useAuthStore } from '@/store/auth'
import { taskLabel } from '@/components/projects/taskKey'
import { useTaskDrawer } from '@/components/projects/taskDrawerContext'
import type { MyArea, ProjectStatus, Task } from '@/types/projects'
import type { Ticket } from '@/types'
import '@/areas/inicio/home.css'

export interface WeekTask extends Task {
  project: { id: string; name: string }
  status?: ProjectStatus
  dependents?: { dependsOn: { id: string; title: string; key: string | null; seq: number; projectId: string; assignee: { id: string; name: string } | null; status: { category: string } } }[]
}
const pad = (n: number) => String(n).padStart(2, '0')
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const DAYS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta']

/** Segunda a sexta da semana (no fim de semana, a próxima). */
export function weekDays(today: Date): Date[] {
  const shift = today.getDay() === 0 ? 1 : today.getDay() === 6 ? 2 : 1 - today.getDay()
  return DAYS.map((_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + shift + i))
}

type Item = { id: string; kind: 'task' | 'ticket'; title: string; note: string; late: boolean; open: () => void }

export default function MyWeekPage() {
  const user = useAuthStore(s => s.user)!
  const navigate = useNavigate()
  const [tasks, setTasks] = useState<WeekTask[] | null>(null)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [projects, setProjects] = useState<MyArea['recentProjects']>([])
  const [error, setError] = useState(false)
  const load = useCallback(async () => {
    try {
      const [t, k, area] = await Promise.all([
        api.get('/my-tasks').then(r => r.data.data as WeekTask[]),
        // Chamados é módulo à parte; sem ele, a semana tem só tarefas.
        user.role !== 'admin' && user.modules?.tickets !== false
          ? ticketService.getTicketsPage({ page: 1, pageSize: 100, mine: true, status: 'open,in_progress', sort: 'sla', dir: 'asc' }).then(r => r.data).catch(() => [])
          : [],
        getMyArea().catch(() => null),
      ])
      setTasks(t); setTickets(k); setProjects(area?.recentProjects ?? []); setError(false)
    } catch { setError(true) }
  }, [user.role, user.modules?.tickets])
  useEffect(() => { void load() }, [load])
  const { openTask } = useTaskDrawer(() => { void load() })

  if (error && !tasks) return <EmptyState title="Não foi possível carregar a semana" desc="Verifique a conexão e tente de novo." action={<Btn onClick={() => void load()}>Tentar de novo</Btn>} />
  if (!tasks) return <Loading label="Carregando a semana…" />

  const today = new Date()
  const todayKey = dayKey(today)
  const days = weekDays(today)
  const open = tasks.filter(t => !['done', 'cancelled'].includes(t.status?.category ?? ''))
  const taskItem = (t: WeekTask): Item => ({ id: t.id, kind: 'task', title: t.title, note: `${taskLabel(t)} · ${t.project.name}`, late: t.dueDate!.slice(0, 10) < todayKey, open: () => openTask(t.projectId, t.id) })
  const ticketItem = (t: Ticket): Item => ({ id: t.id, kind: 'ticket', title: t.title, note: t.displayNumber, late: new Date(t.slaDeadline) < today, open: () => navigate(`/chamados?ticket=${encodeURIComponent(t.id)}`) })
  const items = [
    ...open.filter(t => t.dueDate).map(t => ({ key: t.dueDate!.slice(0, 10), item: taskItem(t) })),
    ...tickets.map(t => ({ key: dayKey(new Date(t.slaDeadline)), item: ticketItem(t) })),
  ]
  const firstKey = dayKey(days[0])
  // Antes da semana: o que passou e continua aberto.
  const behind = items.filter(x => x.key < firstKey)
  const noDate = open.filter(t => !t.dueDate).length
  const blocked = open.flatMap(t => (t.dependents ?? [])
    .filter(d => !['done', 'cancelled'].includes(d.dependsOn.status.category) && d.dependsOn.assignee?.id !== user.id)
    .map(d => ({ task: t, on: d.dependsOn })))
  const fmt = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  const chip = (i: Item) => (
    <button key={`${i.kind}-${i.id}`} type="button" className="hm-item" data-kind={i.kind} data-late={i.late || undefined} onClick={i.open}>
      {i.title}<small>{i.kind === 'ticket' ? `Chamado ${i.note}` : i.note}{i.late && ' · atrasado'}</small>
    </button>
  )

  return (
    <div className="hm" data-plain style={{ minHeight: '100%' }}>
      <PageHeader title="Minha semana" subtitle={`${fmt(days[0])} a ${fmt(days[4])}`} actions={<Btn variant="secondary" onClick={() => navigate('/projetos/my-tasks')}>Todas as minhas tarefas{noDate ? ` (${noDate} sem data)` : ''}</Btn>} />
      <div className="hm-body">
        {behind.length > 0 && (
          <section aria-labelledby="ficou">
            <h2 id="ficou">Ficou de antes<small>{behind.length}</small></h2>
            <div className="hm-week">{behind.slice(0, 10).map(x => chip(x.item))}</div>
            {behind.length > 10 && <p className="hm-note" style={{ marginTop: 10 }}>E mais {behind.length - 10}.</p>}
          </section>
        )}
        <div className="hm-week">
          {days.map((d, i) => {
            const key = dayKey(d)
            const list = items.filter(x => x.key === key)
            return (
              <section key={key} className="hm-day" data-today={key === todayKey || undefined}>
                <h3>{DAYS[i]}<small>{key === todayKey ? 'hoje' : fmt(d)}</small></h3>
                {list.length === 0 && <p className="hm-note">Livre</p>}
                {list.map(x => chip(x.item))}
              </section>
            )
          })}
        </div>
        <div className="hm-cols">
          <section aria-labelledby="travado">
            <h2 id="travado">Travado por outra pessoa<small>{blocked.length}</small></h2>
            {blocked.length === 0
              ? <div className="hm-card"><p className="hm-note">Nada seu espera outra tarefa.</p></div>
              : blocked.map(b => (
                <article key={`${b.task.id}-${b.on.id}`} className="hm-card hm-check">
                  <div><b>{b.task.title}</b><p className="hm-note">Espera “{b.on.title}”{b.on.assignee ? `, com ${b.on.assignee.name.split(' ')[0]}` : ', sem responsável'}.</p></div>
                  <Btn size="sm" variant="secondary" onClick={() => openTask(b.on.projectId, b.on.id)}>Ver</Btn>
                </article>
              ))}
          </section>
          <section aria-labelledby="projs">
            <h2 id="projs">Projetos</h2>
            {projects.length === 0 && <div className="hm-card"><p className="hm-note">Você ainda não participa de nenhum projeto.</p></div>}
            {projects.map(p => (
              <article key={p.id} className="hm-card">
                <header style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                  <button type="button" className="hm-title" onClick={() => navigate(`/projetos/${p.id}/overview`)}>{p.name}</button>
                  <span className="hm-when">{p.progress}%{p.overdueTasks > 0 && ` · ${p.overdueTasks} em atraso`}</span>
                </header>
                <Meter value={p.progress} label={`${p.name}: ${p.progress}% concluído`} />
              </article>
            ))}
          </section>
        </div>
      </div>
    </div>
  )
}
