import { useEffect, useMemo, useRef, useState } from 'react'
import { EmptyState, Btn, Loading } from '@/components/ui'
import { getProjectTimeline } from '@/services/projectsService'
import { ProjectTimeline, TimelineTask } from '@/types/projects'
import { taskLabel } from '@/components/projects/taskKey'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { GanttTooltip } from './GanttTooltip'
import '../projects.css'

const DAY_MS = 86_400_000
const ROW_HEIGHT = 40
const BAR_HEIGHT = 14
const LABEL_WIDTH = 240
const LABEL_WIDTH_PHONE = 140

// Zoom: px por dia. Sem isto, uma task com início antigo esticava o eixo por anos
// (26 px/dia → dezenas de milhares de px) e o Gantt saía da página.
export type GanttZoom = 'day' | 'week' | 'month'
const DAY_WIDTH: Record<GanttZoom, number> = { day: 26, week: 8, month: 2.5 }
const ZOOM_LABEL: Record<GanttZoom, string> = { day: 'Dias', week: 'Semanas', month: 'Meses' }
export const autoZoom = (days: number): GanttZoom => (days <= 60 ? 'day' : days <= 240 ? 'week' : 'month')

/**
 * Janela do eixo: uma data fora da curva (início em 2001, prazo em 2099) não pode
 * esticar o Gantt por décadas. Começa no máximo 180 dias antes do primeiro prazo e
 * termina no máximo 365 dias depois do último início; o que passar fica cortado.
 */
export function timelineWindow(ranges: Array<{ start: Date; end: Date }>) {
  const t = (f: (r: { start: Date; end: Date }) => Date) => ranges.map((r) => f(r).getTime())
  const lo = Math.max(Math.min(...t((r) => r.start)), Math.min(...t((r) => r.end)) - 180 * DAY_MS)
  const hi = Math.max(lo + DAY_MS, Math.min(Math.max(...t((r) => r.end)), Math.max(...t((r) => r.start)) + 365 * DAY_MS))
  const clipped = ranges.some((r) => r.start.getTime() < lo || r.end.getTime() > hi)
  return { min: new Date(lo), max: new Date(hi), clipped }
}

/** Marcas do eixo: dia (ou semana se o período for longo), segunda-feira, ou dia 1 de cada mês. */
export function axisTicks(min: Date, days: number, zoom: GanttZoom) {
  const ticks: Array<{ day: number; label: string }> = []
  for (let day = 0; day <= days; day++) {
    const date = new Date(min.getTime() + day * DAY_MS)
    const keep = zoom === 'month' ? date.getDate() === 1
      : zoom === 'week' ? date.getDay() === 1
      : days > 40 ? day % 7 === 0 : true
    if (!keep) continue
    // Dias: só o número (dd/mm a cada 26px se sobrepunha); o mês aparece na 1ª coluna e no dia 1.
    const month = date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
    const label = zoom === 'month'
      ? date.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('. de ', '/').replace(' de ', '/').replace('.', '')
      : zoom === 'day' && days <= 40
        ? (day === 0 || date.getDate() === 1 ? `${date.getDate()} ${month}` : String(date.getDate()))
        : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    ticks.push({ day, label })
  }
  return ticks
}

/**
 * Gantt em SVG puro — mesmo componente serve Gantt e Timeline:
 * Gantt mostra todas as tasks com setas de dependência; Timeline é a visão
 * executiva, só com pontos de controle e épicos (EPIC-).
 */
function taskRange(task: TimelineTask): { start: Date; end: Date } | null {
  const start = task.startDate ? new Date(task.startDate) : task.dueDate ? new Date(task.dueDate) : null
  const end = task.dueDate ? new Date(task.dueDate) : start
  if (!start || !end) return null
  return { start, end: end < start ? start : end }
}

export function TimelineView({
  projectId, mode, onOpenTask,
}: {
  projectId: string
  mode: 'gantt' | 'timeline'
  onOpenTask: (id: string) => void
}) {
  const [data, setData] = useState<ProjectTimeline | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [zoomChoice, setZoomChoice] = useState<GanttZoom | 'auto'>('auto')
  const scrollRef = useRef<HTMLDivElement>(null)
  // Linha em foco (hover na barra ou no nome); `at` = onde mostrar o tooltip (só na barra).
  const [hover, setHover] = useState<{ id: string; at?: { x: number; y: number } } | null>(null)
  // Espaço livre ao lado dos nomes: período curto estica até a margem da página.
  const [room, setRoom] = useState(0)
  const labelWidth = useMediaQuery('(max-width: 640px)') ? LABEL_WIDTH_PHONE : LABEL_WIDTH

  function load() {
    setLoading(true)
    setError(null)
    getProjectTimeline(projectId)
      .then(setData)
      .catch(() => setError('Não foi possível carregar a linha do tempo.'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [projectId])

  // Timeline é a visão executiva: pontos de controle e épicos, sem subtasks nem
  // setas. Concluídas ficam ocultas por padrão nas duas (senão o passado domina a tela).
  const doneCount = useMemo(() => (data ? data.tasks.filter((t) => t.status.category === 'done').length : 0), [data])
  const tasks = useMemo(() => {
    if (!data) return []
    const scoped = mode === 'timeline'
      ? data.tasks.filter((t) => t.isMilestone || (t.key ?? '').startsWith('EPIC-'))
      : data.tasks
    return showDone ? scoped : scoped.filter((t) => t.status.category !== 'done')
  }, [data, mode, showDone])

  const scale = useMemo(() => {
    const ranges = tasks.map(taskRange).filter(Boolean) as Array<{ start: Date; end: Date }>
    if (ranges.length === 0) return null

    const { min, max, clipped } = timelineWindow(ranges)
    min.setHours(0, 0, 0, 0)
    max.setHours(23, 59, 59, 999)

    const days = Math.max(1, Math.ceil((max.getTime() - min.getTime()) / DAY_MS))
    const zoom = zoomChoice === 'auto' ? autoZoom(days) : zoomChoice
    return { min, max, days, zoom, clipped, width: Math.max(days * DAY_WIDTH[zoom], 600, room) }
  }, [tasks, zoomChoice, room])

  const ready = !!scale
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setRoom(el.clientWidth - labelWidth - 2 * parseFloat(getComputedStyle(el).paddingRight || '0') - 1)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [ready, labelWidth])

  // Abre já no dia de hoje (projetos longos começavam meses atrás).
  useEffect(() => {
    if (!scale || !scrollRef.current) return
    const today = new Date()
    if (today < scale.min || today > scale.max) return
    const x = ((today.getTime() - scale.min.getTime()) / (scale.days * DAY_MS)) * scale.width
    scrollRef.current.scrollLeft = Math.max(0, x - 160)
  }, [scale])

  const toolbar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px 20px', flexWrap: 'wrap', padding: '14px var(--page-gutter)', fontSize: 13.5, color: 'var(--text-2)' }}>
      <div role="group" aria-label="Zoom da linha do tempo" className="subtabs">
        {(['auto', 'day', 'week', 'month'] as const).map((z) => (
          <button key={z} type="button" aria-pressed={zoomChoice === z} onClick={() => setZoomChoice(z)}
            title={z === 'auto' ? `Ajusta ao período (agora: ${scale ? ZOOM_LABEL[scale.zoom] : '—'})` : undefined}>
            {z === 'auto' ? 'Auto' : ZOOM_LABEL[z]}
          </button>
        ))}
      </div>
      {doneCount > 0 && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          Mostrar concluídas ({doneCount})
        </label>
      )}
      <span style={{ marginLeft: 'auto', color: 'var(--text-3)' }}>
        {scale?.clipped
          ? `Período de ${scale.min.toLocaleDateString('pt-BR')} a ${scale.max.toLocaleDateString('pt-BR')}: barras com datas fora dele aparecem cortadas.`
          : mode === 'timeline' ? 'Pontos de controle e épicos' : 'Todas as tasks com data'}
      </span>
    </div>
  )

  if (loading) return <Loading />

  if (error) {
    return (
      <EmptyState
        title="Não foi possível carregar"
        desc={error}
        action={<Btn variant="secondary" size="sm" onClick={load}>Tentar novamente</Btn>}
      />
    )
  }

  if (!scale || tasks.length === 0) {
    return (
      <div>
        {toolbar}
        <EmptyState
          title={mode === 'timeline' ? 'Nenhum ponto de controle ou épico com data' : 'Nenhuma task com datas'}
          desc={mode === 'timeline'
            ? 'Marque tasks como ponto de controle ou use o tipo Epic, com prazo, para montar a linha do tempo executiva.'
            : 'Defina data de início ou prazo nas tasks para vê-las aqui.'}
        />
      </div>
    )
  }

  const xFor = (date: Date) => ((date.getTime() - scale.min.getTime()) / (scale.days * DAY_MS)) * scale.width
  const rowY = (index: number) => index * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2
  const height = tasks.length * ROW_HEIGHT

  const indexById = new Map(tasks.map((t, i) => [t.id, i]))
  const hoverTask = hover ? tasks.find((t) => t.id === hover.id) : undefined
  const hoverRange = hoverTask ? taskRange(hoverTask) : null
  const hoverIndex = hover ? indexById.get(hover.id) : undefined

  /** Barra/marco: hover mostra o tooltip, as outras esmaecem; clique ou Enter abre a task. */
  const barProps = (task: TimelineTask, label: string) => ({
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    style: { cursor: 'pointer', outline: 'none', opacity: hover && hover.id !== task.id ? 0.5 : 1, transition: 'opacity 0.15s' },
    onMouseMove: (e: React.MouseEvent) => setHover({ id: task.id, at: { x: e.clientX, y: e.clientY } }),
    onMouseLeave: () => setHover(null),
    onFocus: (e: React.FocusEvent<SVGGElement>) => {
      const r = e.currentTarget.getBoundingClientRect()
      setHover({ id: task.id, at: { x: r.left + r.width / 2, y: r.bottom } })
    },
    onBlur: () => setHover(null),
    onClick: () => onOpenTask(task.id),
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenTask(task.id) } },
  })

  // O rótulo com o mês é mais largo que a coluna do dia: o seguinte cede o lugar.
  const dense = scale.zoom === 'day' && scale.width / scale.days < 44
  const ticks = axisTicks(scale.min, scale.days, scale.zoom)
    .map((t, i, all) => ({ x: (t.day / scale.days) * scale.width, label: dense && all[i - 1]?.label.includes(' ') ? '' : t.label }))

  const today = new Date()
  const todayX = today >= scale.min && today <= scale.max ? xFor(today) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
      <div style={{ flexShrink: 0 }}>{toolbar}</div>
      {/* Sem padding à esquerda: o recuo fica dentro da coluna fixa, senão o eixo vaza por baixo dela. */}
      <div ref={scrollRef} style={{ padding: '0 var(--page-gutter) 16px 0', overflow: 'auto', flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', minWidth: labelWidth + scale.width }}>
        {/* Nomes fixos à esquerda: rolar o período não esconde de qual task é cada barra. */}
        <div className="gt-names" style={{ width: labelWidth }}>
          {tasks.map((task) => (
            <button
              key={task.id}
              onClick={() => onOpenTask(task.id)}
              title={task.title}
              onMouseEnter={() => setHover({ id: task.id })}
              onMouseLeave={() => setHover(null)}
              className="gt-name"
              data-on={hover?.id === task.id}
              style={{ height: ROW_HEIGHT, paddingLeft: task.parentId ? 16 : 0 }}
            >
              <span className="pj-cut" style={{ flex: 1 }}>{task.title}</span>
              <span style={{ flexShrink: 0, fontSize: 12.5, color: 'var(--text-3)' }}>{taskLabel(task)}</span>
            </button>
          ))}
        </div>

        <svg width={scale.width} height={height + 28} style={{ flexShrink: 0 }} aria-label="Linha do tempo do projeto">
          {scale.zoom === 'day' && Array.from({ length: scale.days }, (_, d) => d).filter((d) => [0, 6].includes(new Date(scale.min.getTime() + d * DAY_MS).getDay())).map((d) => (
            <rect key={`we-${d}`} x={(d / scale.days) * scale.width} y={22} width={scale.width / scale.days} height={height + 6} fill="var(--tint)" />
          ))}
          {ticks.map((tick) => (
            <g key={tick.x}>
              <line x1={tick.x} y1={22} x2={tick.x} y2={height + 28} stroke="var(--border)" strokeWidth={1} />
              <text x={tick.x + 4} y={14} fontSize={12} fill="var(--text-3)">{tick.label}</text>
            </g>
          ))}

          <line x1={0} y1={27.5} x2={scale.width} y2={27.5} stroke="var(--rule)" strokeWidth={1} />

          {todayX !== null && (
            <g style={{ pointerEvents: 'none' }}>
              <line x1={todayX} y1={22} x2={todayX} y2={height + 28} stroke="var(--text-1)" strokeWidth={1} />
              <text x={todayX} y={14} fontSize={12} fontWeight={600} fill="var(--text-1)" stroke="var(--bg-app)" strokeWidth={6} paintOrder="stroke" textAnchor="middle">Hoje</text>
            </g>
          )}

          {hoverRange && hoverIndex !== undefined && (
            <g style={{ pointerEvents: 'none' }}>
              {[hoverRange.start, hoverRange.end].map((d, i) => {
                if (i === 1 && hoverRange.start.getTime() === hoverRange.end.getTime()) return null
                const gx = Math.min(scale.width, Math.max(0, xFor(d)))
                const label = d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '')
                return (
                  <g key={i}>
                    <line x1={gx} y1={22} x2={gx} y2={height + 28} stroke="var(--accent)" strokeWidth={1} />
                    <text x={Math.min(scale.width - 24, Math.max(24, gx))} y={14} fontSize={12} fontWeight={600} fill="var(--accent-fg)" stroke="var(--bg-app)" strokeWidth={6} paintOrder="stroke" textAnchor="middle">{label}</text>
                  </g>
                )
              })}
            </g>
          )}

          <g transform="translate(0, 28)">
            {mode === 'gantt' && data!.dependencies.map((dep) => {
              const fromIndex = indexById.get(dep.dependsOnId)
              const toIndex = indexById.get(dep.taskId)
              if (fromIndex === undefined || toIndex === undefined) return null
              const fromTask = taskRange(tasks[fromIndex])
              const toTask = taskRange(tasks[toIndex])
              if (!fromTask || !toTask) return null

              const x1 = xFor(fromTask.end)
              const y1 = rowY(fromIndex) + BAR_HEIGHT / 2
              const x2 = xFor(toTask.start)
              const y2 = rowY(toIndex) + BAR_HEIGHT / 2

              return (
                <path
                  key={dep.id}
                  d={`M ${x1} ${y1} L ${x1 + 8} ${y1} L ${x1 + 8} ${y2} L ${x2} ${y2}`}
                  fill="none"
                  stroke="var(--text-3)"
                  strokeWidth={1}
                  markerEnd="url(#arrow)"
                />
              )
            })}

            <defs>
              <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="var(--text-3)" />
              </marker>
            </defs>

            {tasks.map((task, index) => {
              const range = taskRange(task)
              if (!range) return null
              const cutStart = range.start < scale.min
              const cutEnd = range.end > scale.max
              const x = Math.max(0, xFor(range.start))
              const width = Math.max(12, Math.min(scale.width, xFor(range.end)) - x)
              const y = rowY(index)
              const realDates = `${range.start.toLocaleDateString('pt-BR')} → ${range.end.toLocaleDateString('pt-BR')}`

              if (task.isMilestone) {
                const cx = x + width / 2
                const cy = y + BAR_HEIGHT / 2
                const r = BAR_HEIGHT / 2
                return (
                  <g key={task.id} {...barProps(task, `${taskLabel(task)} ${task.title} — ponto de controle em ${range.end.toLocaleDateString('pt-BR')}`)}>
                    <polygon
                      points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`}
                      fill="var(--text-1)"
                    />
                  </g>
                )
              }

              return (
                <g key={task.id} {...barProps(task, `${taskLabel(task)} ${task.title} — ${task.progress}% · ${realDates}`)}>
                  {/* Área de hover da linha inteira da barra (barras finas são difíceis de mirar). */}
                  <rect x={x - 4} y={y - 4} width={width + 8} height={BAR_HEIGHT + 8} fill="transparent" />
                  <rect x={x} y={y} width={width} height={BAR_HEIGHT} fill="color-mix(in srgb, var(--accent) 30%, var(--bg-app))" />
                  <rect x={x} y={y} width={(width * task.progress) / 100} height={BAR_HEIGHT} fill="var(--accent)" />
                  {/* Seta na borda: a barra continua fora da janela. */}
                  {cutStart && <path d={`M ${x + 9} ${y + 4} L ${x + 3} ${y + BAR_HEIGHT / 2} L ${x + 9} ${y + BAR_HEIGHT - 4}`} fill="none" stroke="var(--text-1)" strokeWidth={1.5} />}
                  {cutEnd && <path d={`M ${x + width - 9} ${y + 4} L ${x + width - 3} ${y + BAR_HEIGHT / 2} L ${x + width - 9} ${y + BAR_HEIGHT - 4}`} fill="none" stroke="var(--text-1)" strokeWidth={1.5} />}
                </g>
              )
            })}
          </g>
        </svg>
      </div>
      </div>
      {hoverTask && hoverRange && hover?.at && <GanttTooltip task={hoverTask} range={hoverRange} x={hover.at.x} y={hover.at.y} />}
    </div>
  )
}
