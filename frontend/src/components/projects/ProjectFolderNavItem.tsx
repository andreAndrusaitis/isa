import { ChevronRight, Star } from 'lucide-react'
import { ColorDot, NavItem } from '@/components/ui'
import './projects.css'

const SUB_ITEMS = [
  { path: 'overview', label: 'Visão geral' },
  { path: 'tasks', label: 'Tasks' },
  { path: 'docs', label: 'Arquivos' },
  { path: 'time', label: 'Tempo' },
  { path: 'automations', label: 'Automações' },
  { path: 'members', label: 'Membros' },
  // Configurar Status ("add QA entre Backlog e X") vive aqui — direto na
  // árvore, sem precisar abrir o menu "Mais" do header do projeto.
  { path: 'settings', label: 'Configurações' },
]

/**
 * Item de projeto no menu que abre como pasta: clicar na seta
 * expande e revela as views principais como sub-itens indentados, em vez de
 * navegar direto. Clicar no nome do projeto vai para a Visão geral sem abrir
 * a pasta — abrir é só pela seta.
 */
export function ProjectFolderNavItem({
  id, name, color, expanded, active, isFavorite, currentPath, onToggle, onNavigate, depth = 0,
}: {
  id: string
  name: string
  color?: string | null
  expanded: boolean
  active: boolean
  isFavorite: boolean
  currentPath: string
  onToggle: () => void
  onNavigate: (path: string) => void
  /** Nível dentro das pastas da sidebar (recuo). */
  depth?: number
}) {
  return (
    <div>
      <div className="tree-row" data-nav-active={active ? '1' : undefined}>
        {/* Seta: só abre/fecha a pasta. Nome: entra na Visão geral, sem abrir a pasta. */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Recolher' : 'Expandir'} ${name}`}
          style={{ minHeight: 36, padding: `0 4px 0 ${12 + depth * 14}px` }}
        >
          <ChevronRight size={14} style={{ transform: expanded ? 'rotate(90deg)' : 'none' }} />
        </button>
        <button type="button" onClick={() => onNavigate('overview')} style={{ flex: 1, minWidth: 0, minHeight: 36, padding: '0 12px 0 4px' }}>
          {color && <ColorDot color={color} size={8} />}
          <span className="pj-cut">{name}</span>
          {isFavorite && <Star size={13} aria-label="Favorito" />}
        </button>
      </div>

      {expanded && (
        <div style={{ paddingLeft: depth * 14 }}>
          {SUB_ITEMS.map((item) => (
            <NavItem
              key={item.path}
              label={item.label}
              indent
              active={currentPath === `/projetos/${id}/${item.path}`}
              onClick={() => onNavigate(item.path)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
