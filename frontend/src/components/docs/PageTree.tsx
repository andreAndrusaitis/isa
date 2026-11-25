import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { ChevronRight, Copy, MoreHorizontal, Plus, Star, Trash2 } from 'lucide-react'
import { buildTree, pathTo, positionFor, subtreeIds, type TreeItem } from '@/lib/docs/tree'
import type { DocTreeNode } from '@/types/docs'

interface Props {
  nodes: DocTreeNode[]
  activeId?: string
  editable: boolean
  onCreate: (parentId: string | null) => void
  onMove: (id: string, parentId: string | null, position: number) => void
  onDuplicate: (id: string) => void
  onDelete: (node: DocTreeNode) => void
  onFavorite: (node: DocTreeNode) => void
}

/** Páginas do espaço, uma dentro da outra. Arrastar sobre uma página coloca dentro; entre duas, reordena. */
export function PageTree(props: Props) {
  const { nodes, activeId, editable, onMove } = props
  const tree = useMemo(() => buildTree(nodes), [nodes])
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [dragging, setDragging] = useState<DocTreeNode | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  useEffect(() => {
    if (!activeId) return
    const path = pathTo(nodes, activeId)
    if (path.length) setOpen(o => ({ ...o, ...Object.fromEntries(path.map(id => [id, true])) }))
  }, [activeId, nodes])

  const forbidden = useMemo(() => (dragging ? subtreeIds(nodes, dragging.id) : new Set<string>()), [dragging, nodes])

  const end = ({ active, over }: DragEndEvent) => {
    setDragging(null)
    if (!over) return
    const [kind, id] = String(over.id).split(':')
    const moving = String(active.id)
    const target = nodes.find(n => n.id === id)
    if (id !== 'end' && (!target || subtreeIds(nodes, moving).has(id))) return
    if (kind === 'into' && target) { onMove(moving, target.id, positionFor(nodes, target.id, null, moving)); setOpen(o => ({ ...o, [target.id]: true })) }
    else if (kind === 'before' && target) onMove(moving, target.parentId, positionFor(nodes, target.parentId, target.id, moving))
    else if (kind === 'root') onMove(moving, null, positionFor(nodes, null, null, moving))
  }

  return (
    <DndContext sensors={sensors} onDragStart={e => setDragging(nodes.find(n => n.id === e.active.id) ?? null)} onDragCancel={() => setDragging(null)} onDragEnd={end}>
      <div className="doc-tree">
        {tree.map(i => <Row key={i.id} item={i} depth={0} open={open} setOpen={setOpen} dragging={!!dragging} forbidden={forbidden} {...props} />)}
        {dragging && <RootDrop />}
        {editable && <button type="button" className="doc-tree-add" onClick={() => props.onCreate(null)}><Plus size={15} aria-hidden /> Nova página</button>}
      </div>
      <DragOverlay dropAnimation={null}>{dragging && <div className="doc-drag">{dragging.icon ?? '📄'} {dragging.title}</div>}</DragOverlay>
    </DndContext>
  )
}

function RootDrop() {
  const d = useDroppable({ id: 'root:end' })
  return <div ref={d.setNodeRef} className="doc-tree-root" data-over={d.isOver || undefined}>Soltar no nível principal</div>
}

function Row({ item, depth, open, setOpen, dragging, forbidden, ...p }: Props & { item: TreeItem; depth: number; open: Record<string, boolean>; setOpen: React.Dispatch<React.SetStateAction<Record<string, boolean>>>; dragging: boolean; forbidden: Set<string> }) {
  const navigate = useNavigate()
  const [menu, setMenu] = useState(false)
  const allowed = p.editable && !forbidden.has(item.id)
  const drag = useDraggable({ id: item.id, disabled: !p.editable })
  const into = useDroppable({ id: `into:${item.id}`, disabled: !allowed })
  const before = useDroppable({ id: `before:${item.id}`, disabled: !allowed })
  const isOpen = !!open[item.id]
  useEffect(() => {
    if (!menu) return
    const off = () => setMenu(false)
    document.addEventListener('click', off)
    return () => document.removeEventListener('click', off)
  }, [menu])
  return (
    <div>
      {dragging && <div ref={before.setNodeRef} className="doc-tree-gap" data-over={before.isOver || undefined} style={{ marginLeft: depth * 16 }} />}
      <div ref={into.setNodeRef} className="doc-tree-row" data-active={p.activeId === item.id || undefined} data-over={into.isOver || undefined} style={{ paddingLeft: depth * 16 }}>
        <button type="button" className="doc-tree-toggle" aria-label={isOpen ? 'Recolher' : 'Expandir'} aria-expanded={isOpen} style={{ visibility: item.children.length ? 'visible' : 'hidden' }} onClick={() => setOpen(o => ({ ...o, [item.id]: !isOpen }))}>
          <ChevronRight size={14} style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }} />
        </button>
        <button type="button" ref={drag.setNodeRef} {...drag.listeners} className="doc-tree-link" aria-current={p.activeId === item.id ? 'page' : undefined} onClick={() => navigate(`/documentos/p/${item.id}`)}>
          <span className="doc-icon">{item.icon ?? '📄'}</span><span className="t">{item.title}</span>
        </button>
        <span className="doc-tree-actions">
          <button type="button" aria-label={`Opções de ${item.title}`} aria-haspopup="menu" onClick={e => { e.stopPropagation(); setMenu(m => !m) }}><MoreHorizontal size={15} /></button>
          {p.editable && <button type="button" aria-label={`Nova página dentro de ${item.title}`} onClick={() => { setOpen(o => ({ ...o, [item.id]: true })); p.onCreate(item.id) }}><Plus size={15} /></button>}
        </span>
        {menu && (
          <div className="doc-pop" role="menu">
            <button type="button" role="menuitem" onClick={() => p.onFavorite(item)}><Star size={14} /> {item.favorite ? 'Tirar dos favoritos' : 'Favoritar'}</button>
            {p.editable && <button type="button" role="menuitem" onClick={() => p.onDuplicate(item.id)}><Copy size={14} /> Duplicar</button>}
            {p.editable && <button type="button" role="menuitem" className="danger" onClick={() => p.onDelete(item)}><Trash2 size={14} /> Mover para a lixeira</button>}
          </div>
        )}
      </div>
      {isOpen && item.children.map(ch => <Row key={ch.id} item={ch} depth={depth + 1} open={open} setOpen={setOpen} dragging={dragging} forbidden={forbidden} {...p} />)}
    </div>
  )
}
