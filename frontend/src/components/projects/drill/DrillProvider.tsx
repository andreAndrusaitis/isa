import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { Btn, Modal } from '@/components/ui'
import { DrillContext, drillKey, type DrillView } from './drillContext'
import { useTaskDrawer } from '../taskDrawerContext'
import { ProjectDrillView } from './ProjectDrillView'
import { PersonDrillView } from './PersonDrillView'
import { TaskDrillView } from './TaskDrillView'
import { ProjectListDrillView, TaskListDrillView } from './ListDrillViews'
import './drill.css'

const MAX_DEPTH = 12

/**
 * Modal de detalhe da área de Projetos. Um só modal com pilha de visões: de um
 * projeto vai a uma pessoa, dela a uma task, e "Voltar" refaz o caminho.
 */
export function DrillProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<DrillView[]>([])
  const trigger = useRef<HTMLElement | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const open = useCallback((view: DrillView) => {
    setStack((s) => {
      if (s.length === 0) trigger.current = document.activeElement as HTMLElement | null
      if (s.length && drillKey(s[s.length - 1]) === drillKey(view)) return s
      return [...s, view].slice(-MAX_DEPTH)
    })
  }, [])

  const close = useCallback(() => {
    setStack([])
    requestAnimationFrame(() => trigger.current?.focus?.()) // o foco volta para a linha que abriu
  }, [])

  // "Abrir task" põe o drawer por cima sem sair da tela; o modal some enquanto isso
  // e volta no mesmo ponto da pilha, com os dados recarregados, quando o drawer fecha.
  const [suspended, setSuspended] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const { openTask } = useTaskDrawer(() => { setSuspended(false); setRefresh((r) => r + 1) })

  useEffect(() => { setStack([]); setSuspended(false) }, [pathname])

  const current = stack[stack.length - 1]
  const depth = stack.length
  // A cada visão nova o foco vai para o conteúdo: o botão clicado saiu da tela.
  useEffect(() => { if (depth > 1) body.current?.focus() }, [depth, current])

  const value = useMemo(() => ({ open }), [open])
  const go = (to: string) => { setStack([]); navigate(to) }
  const openHere = (projectId: string, taskId: string) => { setSuspended(true); openTask(projectId, taskId) }

  return (
    <DrillContext.Provider value={value}>
      {children}
      {current && !suspended && (
        <Modal isOpen onClose={close} title={current.title} width={960} footer={<Footer view={current} go={go} openTask={openHere} onClose={close} />}>
          {depth > 1 && (
            <nav aria-label="Caminho" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2, margin: '0 0 12px', fontSize: 13 }}>
              <Btn variant="ghost" size="xs" onClick={() => setStack((s) => s.slice(0, -1))}>Voltar</Btn>
              {stack.slice(0, -1).map((v, i) => (
                <Fragment key={`${drillKey(v)}-${i}`}>
                  {i > 0 && <ChevronRight size={12} color="var(--text-3)" aria-hidden />}
                  <button type="button" className="isa-drill-crumb" title={v.title} onClick={() => setStack((s) => s.slice(0, i + 1))}>{v.title}</button>
                </Fragment>
              ))}
            </nav>
          )}
          <div ref={body} tabIndex={-1} key={`${drillKey(current)}-${depth}-${refresh}`} style={{ outline: 'none' }}>
            <ViewBody view={current} />
          </div>
        </Modal>
      )}
    </DrillContext.Provider>
  )
}

function ViewBody({ view }: { view: DrillView }) {
  switch (view.kind) {
    case 'project': return <ProjectDrillView projectId={view.projectId} />
    case 'person': return <PersonDrillView userId={view.userId} projectId={view.projectId} />
    case 'task': return <TaskDrillView projectId={view.projectId} taskId={view.taskId} />
    case 'tasks': return <TaskListDrillView query={view.query} subtitle={view.subtitle} />
    case 'projects': return <ProjectListDrillView items={view.items} subtitle={view.subtitle} />
  }
}

function Footer({ view, go, openTask, onClose }: {
  view: DrillView; go: (to: string) => void; openTask: (projectId: string, taskId: string) => void; onClose: () => void
}) {
  const link = (label: string, to: string, variant: 'primary' | 'secondary' = 'secondary') => (
    <Btn key={to} variant={variant} size="sm" onClick={() => go(to)}>{label}</Btn>
  )
  return (
    <>
      <Btn variant="ghost" size="sm" onClick={onClose}>Fechar</Btn>
      {view.kind === 'project' && [
        link('Tempo', `/projetos/${view.projectId}/time`),
        link('Tasks', `/projetos/${view.projectId}/tasks?view=list`),
        link('Visão geral', `/projetos/${view.projectId}/overview`, 'primary'),
      ]}
      {view.kind === 'task' && (
        <Btn variant="primary" size="sm" onClick={() => openTask(view.projectId, view.taskId)}>Abrir task</Btn>
      )}
      {view.kind === 'person' && view.projectId && link('Abrir projeto', `/projetos/${view.projectId}/overview`)}
    </>
  )
}
