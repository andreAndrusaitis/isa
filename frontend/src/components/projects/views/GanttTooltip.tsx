import { useLayoutEffect, useRef, useState } from 'react'
import { ColorDot, Meter } from '@/components/ui'
import { TimelineTask } from '@/types/projects'
import { taskLabel } from '@/components/projects/taskKey'
import { relativeDay, daysFromToday } from '@/components/projects/relativeDay'
import { prefersReducedMotion } from '@/lib/motion'
import '../projects.css'

const OFFSET = 14
const fmt = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
/** "· Hoje", "· em 3 dias"… — só quando acrescenta algo (longe, o relativo já é a própria data). */
const hint = (d: Date) => { const r = relativeDay(d.toISOString()); return r === fmt(d) ? null : `· ${r}` }

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => <><dt>{label}</dt><dd>{children}</dd></>

/**
 * Tooltip da barra do Gantt: segue o cursor com leve atraso, vira para o outro
 * lado perto da borda da tela e mostra datas reais + relativas, duração,
 * progresso e responsável. `pointerEvents: none` — nunca rouba o hover da barra.
 */
export function GanttTooltip({ task, range, x, y }: { task: TimelineTask; range: { start: Date; end: Date }; x: number; y: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 280, h: 180 })
  const [shown, setShown] = useState(false)
  const reduced = prefersReducedMotion()

  useLayoutEffect(() => {
    if (ref.current) setSize({ w: ref.current.offsetWidth, h: ref.current.offsetHeight })
  }, [task.id])
  useLayoutEffect(() => { const id = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(id) }, [])

  const left = x + OFFSET + size.w > window.innerWidth - 8 ? x - OFFSET - size.w : x + OFFSET
  const top = y + OFFSET + size.h > window.innerHeight - 8 ? y - OFFSET - size.h : y + OFFSET

  const done = task.status.category === 'done'
  const overdueDays = !done && task.dueDate ? -daysFromToday(task.dueDate) : 0
  const duration = Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000) + 1

  return (
    <div
      ref={ref}
      role="tooltip"
      className="pj-pop gt-tip"
      style={{
        transform: `translate(${Math.max(8, left)}px, ${Math.max(8, top)}px)`,
        opacity: shown ? 1 : 0,
        transition: reduced ? 'none' : 'transform 110ms cubic-bezier(.2,.8,.2,1), opacity 140ms ease-out',
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {task.title}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 8px', marginTop: 4, color: 'var(--text-2)' }}>
        {taskLabel(task)} <ColorDot color={task.status.color} /> {task.status.name}{task.isMilestone && ' · Marco'}
      </div>
      <dl>
        {task.isMilestone ? (
          <Row label="Data">{fmt(range.end)} <span>{hint(range.end)}</span></Row>
        ) : (
          <>
            <Row label="Início">{fmt(range.start)} <span>{hint(range.start)}</span></Row>
            <Row label="Prazo">
              {fmt(range.end)}{' '}
              {overdueDays > 0
                ? <b style={{ fontWeight: 600, color: 'var(--danger)' }}>· {overdueDays === 1 ? 'atrasada 1 dia' : `atrasada ${overdueDays} dias`}</b>
                : <span>{hint(range.end)}</span>}
            </Row>
            <Row label="Duração">{duration === 1 ? '1 dia' : `${duration} dias`}</Row>
            <Row label="Progresso">{task.progress}%</Row>
          </>
        )}
        <Row label="Responsável">{task.assignee ? task.assignee.name : <span>Sem responsável</span>}</Row>
      </dl>
      {!task.isMilestone && <div style={{ marginTop: 10 }}><Meter value={task.progress} /></div>}
    </div>
  )
}
