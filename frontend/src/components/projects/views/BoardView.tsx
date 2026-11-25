import { useMemo, useState } from 'react'
import {
  DndContext, DragEndEvent, DragStartEvent, DragOverlay, PointerSensor, KeyboardSensor,
  useSensor, useSensors, closestCorners, useDroppable,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Task, ProjectStatus, TaskPriority, ProjectMemberWithUser, Sprint } from '@/types/projects'
import { PRIORITY_STEP } from '@/components/projects/priority'
import { taskLabel } from '@/components/projects/taskKey'
import { relativeDay } from '@/components/projects/relativeDay'
import { Avatar, PriorityDot } from '@/components/ui'
import { AssigneeStack } from '../AssigneeStack'
import '../projects.css'

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  critical: 'Prioridade crítica',
  high: 'Prioridade alta',
  normal: 'Prioridade normal',
  low: 'Prioridade baixa',
  none: 'Sem prioridade',
}

/** Uma task no quadro: título e, embaixo, o registro (ID, prazo, tags, contagens) e quem responde. */
function TaskCard({
  task,
  dragging = false,
  assignee,
  assignees,
  isDone = false,
  density = 'comfortable',
}: {
  task: Task
  dragging?: boolean
  assignee?: ProjectMemberWithUser
  assignees?: Array<{ userId: string; user: { id: string; name: string; avatar: string | null } }>
  isDone?: boolean
  density?: 'comfortable' | 'compact'
}) {
  const isOverdue = useMemo(() => {
    if (!task.dueDate || isDone) return false
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return new Date(task.dueDate) < today
  }, [task.dueDate, isDone])

  const tags = task.tags ?? []
  const blocked = task.blockedBy?.length ?? 0

  return (
    <div
      data-testid="task-card"
      className="bd-item"
      data-done={isDone}
      data-drag={dragging}
      style={{ padding: density === 'compact' ? '8px 0' : '13px 0' }}
    >
      <div className="bd-title">{task.title}</div>
      <div className="bd-meta">
        {task.priority !== 'none' && (
          <span title={PRIORITY_LABEL[task.priority]}><PriorityDot priority={PRIORITY_STEP[task.priority]} /></span>
        )}
        <span title={task.taskType?.name}>{taskLabel(task)}</span>
        {task.dueDate && (
          <span style={isOverdue ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{relativeDay(task.dueDate)}</span>
        )}
        {task.isMilestone && <span title="Ponto de controle do projeto">Marco</span>}
        {task.storyPoints != null && <span title={`${task.storyPoints} story points`}>{task.storyPoints} pts</span>}
        {(task.subtasksCount ?? 0) > 0 && <span title="Subtarefas">{task.subtasksCount} subt.</span>}
        {(task.commentsCount ?? 0) > 0 && <span title="Comentários">{task.commentsCount} com.</span>}
        {blocked > 0 && <span title={`Bloqueada por ${blocked} tarefa(s)`} style={{ color: 'var(--danger)' }}>Bloqueada</span>}
        {tags.slice(0, 3).map(({ tag }) => <span key={tag.id} title="Tag">{tag.name}</span>)}
        {tags.length > 3 && <span>+{tags.length - 3}</span>}

        <span className="bd-who">
          {assignees && assignees.length > 0 ? (
            <AssigneeStack assignees={assignees} primaryId={task.assigneeId} />
          ) : assignee ? (
            <span title={`Atribuído a ${assignee.user.name}`} style={{ display: 'flex' }}>
              <Avatar name={assignee.user.name} src={assignee.user.avatar} size={22} rounded />
            </span>
          ) : null}
        </span>
      </div>
    </div>
  )
}

function SortableTaskCard({
  task,
  onOpen,
  assignee,
  isDone,
  density,
}: {
  task: Task
  onOpen: () => void
  assignee?: ProjectMemberWithUser
  isDone?: boolean
  density?: 'comfortable' | 'compact'
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition ?? 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)',
        opacity: isDragging ? 0 : 1,
      }}
    >
      <TaskCard task={task} assignee={assignee} assignees={task.multiAssignees} isDone={isDone} density={density} />
    </div>
  )
}

function BoardColumn({
  bucket,
  tasks,
  onOpenTask,
  isDropTarget,
  membersMap,
  doneStatusIds,
  density,
}: {
  bucket: GroupBucket
  tasks: Task[]
  onOpenTask: (id: string) => void
  isDropTarget: boolean
  membersMap?: Map<string, ProjectMemberWithUser>
  doneStatusIds: Set<string>
  density?: 'comfortable' | 'compact'
}) {
  const { setNodeRef } = useDroppable({ id: bucket.id })
  const overLimit = bucket.wipLimit != null && tasks.length > bucket.wipLimit

  return (
    <section ref={setNodeRef} className="bd-col" data-over={isDropTarget} aria-label={bucket.name}>
      <div className="bd-head">
        {bucket.name}
        <span style={overLimit ? { color: 'var(--warning)' } : undefined}>
          {bucket.wipLimit != null ? `${tasks.length} / ${bucket.wipLimit}` : tasks.length}
        </span>
      </div>

      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div style={{ minHeight: 60 }}>
          {tasks.map((task) => (
            <SortableTaskCard
              key={task.id}
              task={task}
              onOpen={() => onOpenTask(task.id)}
              assignee={task.assigneeId && membersMap ? membersMap.get(task.assigneeId) : undefined}
              isDone={doneStatusIds.has(task.statusId)}
              density={density}
            />
          ))}
          {tasks.length === 0 && <div className="bd-empty">Nenhuma tarefa</div>}
        </div>
      </SortableContext>
    </section>
  )
}

export type BoardGroupBy = 'status' | 'assignee' | 'priority' | 'sprint'

interface GroupBucket {
  id: string
  name: string
  wipLimit?: number | null
}

const PRIORITY_BUCKET_ORDER: TaskPriority[] = ['critical', 'high', 'normal', 'low', 'none']
const PRIORITY_BUCKET_LABEL: Record<TaskPriority, string> = {
  critical: 'Crítica', high: 'Alta', normal: 'Normal', low: 'Baixa', none: 'Sem prioridade',
}

function buildBuckets(
  groupBy: BoardGroupBy,
  statuses: ProjectStatus[],
  members: ProjectMemberWithUser[] | undefined,
  sprints: Sprint[] | undefined,
): GroupBucket[] {
  if (groupBy === 'priority') {
    return PRIORITY_BUCKET_ORDER.map((p) => ({ id: p, name: PRIORITY_BUCKET_LABEL[p] }))
  }
  if (groupBy === 'assignee') {
    const buckets = (members ?? []).map((m) => ({ id: m.userId, name: m.user.name }))
    return [...buckets, { id: '__unassigned__', name: 'Sem responsável' }]
  }
  if (groupBy === 'sprint') {
    const buckets = (sprints ?? []).map((s) => ({ id: s.id, name: s.name }))
    return [...buckets, { id: '__no_sprint__', name: 'Sem sprint' }]
  }
  return statuses.map((s) => ({ id: s.id, name: s.name, wipLimit: s.wipLimit }))
}

function bucketIdForTask(groupBy: BoardGroupBy, task: Task): string {
  if (groupBy === 'priority') return task.priority
  if (groupBy === 'assignee') return task.assigneeId ?? '__unassigned__'
  if (groupBy === 'sprint') return task.sprintId ?? '__no_sprint__'
  return task.statusId
}

export function BoardView({
  statuses,
  tasks,
  onOpenTask,
  onMoveTask,
  members,
  sprints,
  groupBy = 'status',
  density = 'comfortable',
}: {
  statuses: ProjectStatus[]
  tasks: Task[]
  onOpenTask: (id: string) => void
  onMoveTask: (taskId: string, statusId: string) => void
  members?: ProjectMemberWithUser[]
  sprints?: Sprint[]
  groupBy?: BoardGroupBy
  density?: 'comfortable' | 'compact'
}) {
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [overStatusId, setOverStatusId] = useState<string | null>(null)

  const membersMap = useMemo(() => {
    if (!members) return undefined
    return new Map(members.map((m) => [m.userId, m]))
  }, [members])

  const doneStatusIds = useMemo(() => new Set(statuses.filter((s) => s.category === 'done').map((s) => s.id)), [statuses])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragStart(event: DragStartEvent) {
    const task = tasks.find((t) => t.id === event.active.id)
    setActiveTask(task ?? null)
  }

  function handleDragOver(event: { over: { id: string | number } | null }) {
    const overId = event.over?.id
    if (!overId) { setOverStatusId(null); return }
    const targetStatusId = statuses.some((s) => s.id === overId)
      ? String(overId)
      : tasks.find((t) => t.id === overId)?.statusId
    setOverStatusId(targetStatusId ?? null)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveTask(null)
    setOverStatusId(null)
    if (!over || groupBy !== 'status') return
    const taskId = active.id as string
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return
    const targetStatusId = statuses.some((s) => s.id === over.id)
      ? (over.id as string)
      : tasks.find((t) => t.id === over.id)?.statusId
    if (!targetStatusId || targetStatusId === task.statusId) return
    onMoveTask(taskId, targetStatusId)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => { setActiveTask(null); setOverStatusId(null) }}
    >
      <div className="bd">
        {buildBuckets(groupBy, statuses, members, sprints).map((bucket) => (
          <BoardColumn
            key={bucket.id}
            bucket={bucket}
            tasks={tasks.filter((t) => bucketIdForTask(groupBy, t) === bucket.id)}
            onOpenTask={onOpenTask}
            isDropTarget={overStatusId === bucket.id}
            membersMap={membersMap}
            doneStatusIds={doneStatusIds}
            density={density}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
        {activeTask && (
          <div style={{ width: 260 }}>
            <TaskCard
              task={activeTask}
              dragging
              assignee={activeTask.assigneeId && membersMap ? membersMap.get(activeTask.assigneeId) : undefined}
              assignees={activeTask.multiAssignees}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
