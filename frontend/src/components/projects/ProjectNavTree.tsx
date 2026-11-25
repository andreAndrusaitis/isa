import { ReactNode, useState } from 'react'
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, DragEndEvent, DragStartEvent, pointerWithin } from '@dnd-kit/core'
import { ChevronRight, FolderPlus, Pencil, Trash2, FolderInput } from 'lucide-react'
import { Project, ProjectNavFolder } from '@/types/projects'
import { NavItem } from '@/components/ui'
import './projects.css'

export type MoveTarget = { kind: 'project' | 'folder'; id: string; name: string }

/** Ids das pastas abaixo de `id` (inclusive): destinos proibidos ao mover essa pasta. */
export function descendantIds(folders: ProjectNavFolder[], id: string): Set<string> {
  const out = new Set([id])
  for (let grew = true; grew; ) {
    grew = false
    for (const f of folders) if (f.parentId && out.has(f.parentId) && !out.has(f.id)) { out.add(f.id); grew = true }
  }
  return out
}

/**
 * Árvore compartilhada da sidebar: pastas aninham pastas e projetos; projeto
 * nunca recebe nada (só pasta é alvo de soltura). Arrastar é atalho — quem
 * organiza também tem "Mover para…" (alternativa sem arrastar, WCAG 2.5.7).
 */
export function ProjectNavTree({
  folders, projects, canOrganize, openFolderIds, onToggleFolder, renderProject,
  onMove, onCreateFolder, onRenameFolder, onDeleteFolder, onMoveRequest,
}: {
  folders: ProjectNavFolder[]
  projects: Project[]
  canOrganize: boolean
  openFolderIds: Set<string>
  onToggleFolder: (id: string) => void
  renderProject: (p: Project, depth: number) => ReactNode
  onMove: (target: MoveTarget, folderId: string | null) => void
  onCreateFolder: (parentId: string | null) => void
  onRenameFolder: (f: ProjectNavFolder) => void
  onDeleteFolder: (f: ProjectNavFolder) => void
  onMoveRequest: (target: MoveTarget) => void
}) {
  const [dragging, setDragging] = useState<MoveTarget | null>(null)
  // distance: clique simples continua abrindo pasta/projeto; só arrasta depois de 6px.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const folderIds = new Set(folders.map(f => f.id))
  // Projeto numa pasta que o usuário não enxerga fica na raiz.
  const parentOf = (p: Project) => (p.navFolderId && folderIds.has(p.navFolderId) ? p.navFolderId : null)

  function onDragStart(e: DragStartEvent) { setDragging(e.active.data.current as MoveTarget) }
  function onDragEnd(e: DragEndEvent) {
    setDragging(null)
    const target = e.active.data.current as MoveTarget
    const over = e.over?.id as string | undefined
    if (!over) return
    const folderId = over === 'root' ? null : over.replace('drop:', '')
    if (target.kind === 'folder' && folderId && descendantIds(folders, target.id).has(folderId)) return
    const current = target.kind === 'project' ? projects.find(p => p.id === target.id)?.navFolderId ?? null : folders.find(f => f.id === target.id)?.parentId ?? null
    if (current !== folderId) onMove(target, folderId)
  }

  function level(parentId: string | null, depth: number): ReactNode {
    return (
      <>
        {folders.filter(f => f.parentId === parentId).map(f => (
          <FolderNode
            key={f.id} folder={f} depth={depth} open={openFolderIds.has(f.id)} canOrganize={canOrganize}
            onToggle={() => onToggleFolder(f.id)}
            onCreate={() => onCreateFolder(f.id)} onRename={() => onRenameFolder(f)} onDelete={() => onDeleteFolder(f)}
            onMoveRequest={() => onMoveRequest({ kind: 'folder', id: f.id, name: f.name })}
          >
            {level(f.id, depth + 1)}
          </FolderNode>
        ))}
        {projects.filter(p => parentOf(p) === parentId).map(p => (
          <Draggable key={p.id} target={{ kind: 'project', id: p.id, name: p.name }} enabled={canOrganize} onMoveRequest={onMoveRequest}>
            {renderProject(p, depth)}
          </Draggable>
        ))}
      </>
    )
  }

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      {level(null, 0)}
      {/* Embaixo da árvore: no topo, aparecer ao começar o arrasto empurraria as pastas para baixo do ponteiro. */}
      {dragging && <RootDropZone />}
      {canOrganize && <NavItem icon={FolderPlus} label="Nova pasta" active={false} onClick={() => onCreateFolder(null)} />}
      <DragOverlay dropAnimation={null}>
        {dragging && (
          <div className="pj-pop" style={{ display: 'inline-block', padding: '7px 12px', color: 'var(--text-1)', fontSize: 14, cursor: 'grabbing' }}>{dragging.name}</div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

function RootDropZone() {
  const { setNodeRef, isOver } = useDroppable({ id: 'root' })
  return (
    <div
      ref={setNodeRef}
      style={{ margin: '4px 0', padding: '8px 12px', fontSize: 13, border: '1px dashed var(--sidebar-border)', color: 'var(--sidebar-muted)', background: isOver ? 'var(--active-overlay)' : 'transparent' }}
    >
      Soltar aqui para tirar da pasta
    </div>
  )
}

function Draggable({ target, enabled, children, onMoveRequest }: { target: MoveTarget; enabled: boolean; children: ReactNode; onMoveRequest: (t: MoveTarget) => void }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: `${target.kind}:${target.id}`, data: target, disabled: !enabled })
  return (
    <div
      ref={setNodeRef}
      className="tree-host"
      {...(enabled ? listeners : {})}
      {...(enabled ? { 'aria-roledescription': attributes['aria-roledescription'] } : {})}
      style={isDragging ? { opacity: 0.4 } : undefined}
    >
      {children}
      {enabled && (
        <div className="tree-acts" style={{ bottom: 'auto', height: 36 }}>
          <button type="button" aria-label={`Mover ${target.name} para outra pasta`} title="Mover para…" onClick={() => onMoveRequest(target)}><FolderInput size={14} /></button>
        </div>
      )}
    </div>
  )
}

function FolderNode({ folder, depth, open, canOrganize, onToggle, onCreate, onRename, onDelete, onMoveRequest, children }: {
  folder: ProjectNavFolder; depth: number; open: boolean; canOrganize: boolean
  onToggle: () => void; onCreate: () => void; onRename: () => void; onDelete: () => void; onMoveRequest: () => void
  children: ReactNode
}) {
  const drag = useDraggable({ id: `folder:${folder.id}`, data: { kind: 'folder', id: folder.id, name: folder.name }, disabled: !canOrganize })
  const drop = useDroppable({ id: `drop:${folder.id}`, disabled: !canOrganize })
  return (
    <div style={{ opacity: drag.isDragging ? 0.4 : 1 }}>
      <div
        ref={(el) => { drag.setNodeRef(el); drop.setNodeRef(el) }}
        {...(canOrganize ? drag.listeners : {})}
        className="tree-row"
        data-over={drop.isOver}
      >
        <button type="button" onClick={onToggle} aria-expanded={open} style={{ flex: 1, minWidth: 0, minHeight: 36, padding: `0 12px 0 ${12 + depth * 14}px` }}>
          <ChevronRight size={14} style={{ transform: open ? 'rotate(90deg)' : 'none' }} />
          <span className="pj-cut">{folder.name}</span>
        </button>
        {canOrganize && (
          <div className="tree-acts">
            <button type="button" onClick={onCreate} aria-label={`Nova subpasta em ${folder.name}`} title="Nova subpasta"><FolderPlus size={14} /></button>
            <button type="button" onClick={onRename} aria-label={`Renomear ${folder.name}`} title="Renomear"><Pencil size={13} /></button>
            <button type="button" onClick={onMoveRequest} aria-label={`Mover ${folder.name} para outra pasta`} title="Mover para…"><FolderInput size={14} /></button>
            <button type="button" onClick={onDelete} aria-label={`Excluir ${folder.name}`} title="Excluir pasta"><Trash2 size={13} /></button>
          </div>
        )}
      </div>
      {open && children}
    </div>
  )
}
