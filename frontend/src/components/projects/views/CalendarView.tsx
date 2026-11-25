import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, useDroppable,
} from '@dnd-kit/core'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Btn, ColorDot } from '@/components/ui'
import { Task, ProjectStatus } from '@/types/projects'
import { taskLabel } from '@/components/projects/taskKey'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import '../projects.css'

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function buildGrid(month: Date): Array<{ date: Date; inMonth: boolean }> {
  const first = startOfMonth(month)
  const gridStart = new Date(first)
  gridStart.setDate(first.getDate() - first.getDay()) // recua até domingo

  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + i)
    return { date, inMonth: date.getMonth() === month.getMonth() }
  })
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function DraggableTask({ task, status, onOpen }: { task: Task; status?: ProjectStatus; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      className="cal-item"
      style={{ transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.4 : undefined }}
      title={task.title}
    >
      <ColorDot color={status?.color ?? 'var(--border-strong)'} />
      <span className="pj-cut">{taskLabel(task)} {task.title}</span>
    </div>
  )
}

function DayCell({
  date, inMonth, tasks, statusById, onOpenTask,
}: {
  date: Date
  inMonth: boolean
  tasks: Task[]
  statusById: Map<string, ProjectStatus>
  onOpenTask: (id: string) => void
}) {
  const dayKey = date.toISOString().slice(0, 10)
  const { setNodeRef, isOver } = useDroppable({ id: `day:${dayKey}` })
  const isToday = sameDay(date, new Date())

  return (
    <div ref={setNodeRef} className="cal-day" data-out={!inMonth} data-today={isToday} data-over={isOver}>
      <span className="cal-num">{date.getDate()}</span>
      {tasks.slice(0, 3).map((task) => (
        <DraggableTask key={task.id} task={task} status={statusById.get(task.statusId)} onOpen={() => onOpenTask(task.id)} />
      ))}
      {tasks.length > 3 && <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>+{tasks.length - 3} mais</div>}
    </div>
  )
}

/** Celular: grade de 7 colunas não cabe texto — agenda do mês, agrupada por dia. */
function MonthAgenda({ month, tasksByDay, statusById, onOpenTask }: {
  month: Date
  tasksByDay: Map<string, Task[]>
  statusById: Map<string, ProjectStatus>
  onOpenTask: (id: string) => void
}) {
  const days = [...tasksByDay.entries()]
    .filter(([key]) => key.slice(0, 7) === `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`)
    .sort(([a], [b]) => a.localeCompare(b))
  const todayKey = new Date().toLocaleDateString('en-CA')
  if (days.length === 0) return <div style={{ padding: '8px var(--page-gutter)', fontSize: 14, color: 'var(--text-3)' }}>Nenhuma task com prazo neste mês.</div>
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '0 var(--page-gutter) 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {days.map(([key, list]) => {
        const date = new Date(`${key}T12:00:00Z`)
        return (
          <section key={key} aria-label={date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}>
            <div style={{ fontSize: 14, fontWeight: 500, color: key === todayKey ? 'var(--accent-fg)' : 'var(--text-1)', paddingBottom: 6, borderBottom: '1px solid var(--rule)' }}>
              {date.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' })}{key === todayKey ? ' · hoje' : ''}
            </div>
            {list.map((task) => (
              <button key={task.id} type="button" onClick={() => onOpenTask(task.id)} className="tk-line" style={{ minHeight: 44 }}>
                <ColorDot color={statusById.get(task.statusId)?.color ?? 'var(--border-strong)'} size={8} />
                <span style={{ color: 'var(--text-3)', fontSize: 13, flexShrink: 0 }}>{taskLabel(task)}</span>
                <span className="tk-text pj-cut">{task.title}</span>
              </button>
            ))}
          </section>
        )
      })}
    </div>
  )
}

export function CalendarView({
  tasks, statusById, onOpenTask, onMoveTask,
}: {
  tasks: Task[]
  statusById: Map<string, ProjectStatus>
  onOpenTask: (id: string) => void
  onMoveTask: (taskId: string, dueDate: string) => void
}) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const phone = useMediaQuery('(max-width: 640px)')
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const grid = useMemo(() => buildGrid(month), [month])

  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const task of tasks) {
      if (!task.dueDate) continue
      const key = new Date(task.dueDate).toISOString().slice(0, 10)
      map.set(key, [...(map.get(key) ?? []), task])
    }
    return map
  }, [tasks])

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const dayKey = String(over.id).replace('day:', '')
    onMoveTask(active.id as string, new Date(`${dayKey}T12:00:00`).toISOString())
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div className="cal-head">
        <h2>{month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</h2>
        <Btn variant="ghost" size="sm" onClick={() => setMonth(startOfMonth(new Date()))}>Hoje</Btn>
        <button type="button" className="icon-act" aria-label="Mês anterior" onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}><ChevronLeft size={18} /></button>
        <button type="button" className="icon-act" aria-label="Próximo mês" onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}><ChevronRight size={18} /></button>
      </div>

      {phone ? <MonthAgenda month={month} tasksByDay={tasksByDay} statusById={statusById} onOpenTask={onOpenTask} /> : (
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="cal-grid" style={{ flex: 1, gridTemplateRows: 'auto', gridAutoRows: '1fr' }}>
          {WEEKDAYS.map((day) => <div key={day} className="cal-week">{day}</div>)}
          {grid.map(({ date, inMonth }) => (
            <DayCell
              key={date.toISOString()}
              date={date}
              inMonth={inMonth}
              tasks={tasksByDay.get(date.toISOString().slice(0, 10)) ?? []}
              statusById={statusById}
              onOpenTask={onOpenTask}
            />
          ))}
        </div>
      </DndContext>
      )}
    </div>
  )
}
