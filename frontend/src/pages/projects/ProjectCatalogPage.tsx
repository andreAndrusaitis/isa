import { useMemo, useState } from 'react'
import { useAuthStore } from '@/store/auth'
import { useNavigate } from 'react-router-dom'
import { PageHeader, Btn, EmptyState, Loading } from '@/components/ui'
import { projectAccentStyle } from '@/components/projects/ProjectColorPicker'
import { ImportProjectModal } from '@/components/projects/ImportProjectModal'
import { ExportDossierModal } from '@/components/projects/ExportDossierModal'
import { Project, PRIVACY_LABEL } from '@/types/projects'
import { ProgressBar, fmtDate } from '@/components/projects/drill/drillUi'
import { FilterSearchInput } from '@/components/filters/FilterSearchInput'
import { FilterButton } from '@/components/filters/FilterButton'
import { FilterDropdown } from '@/components/filters/FilterDropdown'
import { FilterField } from '@/components/filters/FilterField'
import { FilterSelect, matchesFilter } from '@/components/filters/FilterSelect'
import { useFilterPanel } from '@/components/filters/useFilterPanel'

/** Situação do projeto para o filtro do catálogo. */
const situation = (p: Project) => ((p.totalTasks ?? 0) === 0 ? 'empty' : (p.overdueTasks ?? 0) > 0 ? 'overdue' : (p.openTasks ?? 0) === 0 ? 'done' : 'on_track')

const SITUATION_LABEL = { empty: 'Sem tasks', done: 'Tudo concluído', on_track: 'Em dia' }

/**
 * `loading`/`error`/`onRetry` são opcionais: sem eles o catálogo se comporta
 * como antes. Com eles, "Nenhum projeto ainda" só aparece quando a lista
 * carregou de fato vazia (não enquanto carrega, nem quando a API falhou).
 */
export default function ProjectCatalogPage({ projects, onOpenCreate, onImported, loading = false, error = null, onRetry }: {
  projects: Project[]
  onOpenCreate: () => void
  onImported?: () => void
  loading?: boolean
  error?: string | null
  onRetry?: () => void
}) {
  // Dossiê é relatório: só com a liberação Relatórios de projetos.
  const canExport = useAuthStore(s => !!s.user?.capabilities?.includes('projects.reports'))
  const navigate = useNavigate()
  const [importOpen, setImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [search, setSearch] = useState('')
  const filters = useFilterPanel('projects-catalog', { privacy: 'all', situation: 'all' })
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return projects.filter((p) =>
      (!q || p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q)) &&
      matchesFilter(filters.values.privacy, p.privacy) && matchesFilter(filters.values.situation, situation(p)))
  }, [projects, search, filters.values])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <PageHeader
        title="Projetos"
        subtitle="Projetos que você participa e os da sua equipe"
        actions={(
          <div style={{ display: 'flex', gap: 8 }}>
            {projects.length > 0 && canExport && <Btn variant="ghost" size="sm" onClick={() => setExportOpen(true)}>Exportar dossiê</Btn>}
            <Btn variant="secondary" size="sm" onClick={() => setImportOpen(true)}>Importar</Btn>
            <Btn variant="primary" size="sm" onClick={onOpenCreate}>Novo projeto</Btn>
          </div>
        )}
      />
      <ImportProjectModal isOpen={importOpen} onClose={() => setImportOpen(false)} onImported={onImported} />
      <ExportDossierModal isOpen={exportOpen} onClose={() => setExportOpen(false)} projects={projects} />
      <div style={{ flex: 1, overflow: 'auto', padding: '0 var(--page-gutter) 48px' }}>
        {projects.length > 0 && (
          <div className="prj-tools" style={{ marginBottom: 12 }}>
            <FilterSearchInput value={search} onChange={setSearch} placeholder="Buscar projeto…" width="min(260px, 100%)" />
            <div style={{ position: 'relative' }}>
              <FilterButton {...filters.buttonProps} />
              <FilterDropdown {...filters.dropdownProps}>
                <FilterField label="Visibilidade">
                  <FilterSelect value={filters.values.privacy} onChange={(v) => filters.set('privacy', v)}>
                    <option value="all">Todas</option>
                    {Object.entries(PRIVACY_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </FilterSelect>
                </FilterField>
                <FilterField label="Situação">
                  <FilterSelect value={filters.values.situation} onChange={(v) => filters.set('situation', v)}>
                    <option value="all">Todas</option>
                    <option value="overdue">Com tasks atrasadas</option>
                    <option value="on_track">Em dia</option>
                    <option value="done">Tudo concluído</option>
                    <option value="empty">Sem tasks</option>
                  </FilterSelect>
                </FilterField>
              </FilterDropdown>
            </div>
            <span role="status" style={{ fontSize: 13, color: 'var(--text-3)' }}>
              {visible.length === projects.length ? `${projects.length} projeto(s)` : `${visible.length} de ${projects.length} projeto(s)`}
            </span>
          </div>
        )}
        {projects.length > 0 && visible.length === 0 && (
          <EmptyState title="Nenhum projeto encontrado" desc="Ajuste a busca ou os filtros."
            action={<Btn variant="secondary" size="sm" onClick={() => { setSearch(''); filters.clear() }}>Limpar filtros</Btn>} />
        )}
        {projects.length === 0 && loading ? (
          <Loading label="Carregando projetos…" />
        ) : projects.length === 0 && error ? (
          <EmptyState
            title="Não foi possível carregar os projetos"
            desc={error}
            action={onRetry ? <Btn variant="secondary" size="sm" onClick={onRetry}>Tentar novamente</Btn> : undefined}
          />
        ) : projects.length === 0 ? (
          <EmptyState
            title="Nenhum projeto ainda"
            desc="Crie o primeiro projeto para começar a organizar tarefas, prazos e equipes."
            action={<Btn variant="primary" size="sm" onClick={onOpenCreate}>Criar primeiro projeto</Btn>}
          />
        ) : (
          <div className="prj-scroll">
            <table className="table prj" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th scope="col">Projeto</th>
                  <th scope="col">Situação</th>
                  <th scope="col" style={{ width: '20%' }}>Progresso</th>
                  <th scope="col" className="num">Em aberto</th>
                  <th scope="col">Prazo</th>
                  <th scope="col" className="num">Pessoas</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((project) => {
                  const openProject = () => navigate(`/projetos/${project.id}/overview`)
                  const state = situation(project)
                  const notes = [
                    project.privacy !== 'organization' && PRIVACY_LABEL[project.privacy],
                    project.description,
                  ].filter(Boolean).join(' · ')
                  return (
                    <tr
                      key={project.id}
                      role="link"
                      tabIndex={0}
                      aria-label={`Abrir projeto ${project.name}`}
                      onClick={openProject}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProject() } }}
                      style={projectAccentStyle(project.color)}
                    >
                      <td style={{ minWidth: 220, overflowWrap: 'anywhere' }}>
                        <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-1)' }}>{project.name}</span>
                        {project.teamOnly && <span title="Você vê este projeto porque alguém da sua equipe participa (somente leitura)" style={{ color: 'var(--text-3)' }}> (equipe, somente leitura)</span>}
                        {notes && <div className="prj-clip">{notes}</div>}
                      </td>
                      <td className={state === 'overdue' ? 'late' : undefined} style={{ whiteSpace: 'nowrap' }}>
                        {state === 'overdue' ? `${project.overdueTasks} atrasada${project.overdueTasks === 1 ? '' : 's'}` : SITUATION_LABEL[state]}
                      </td>
                      <td><ProgressBar value={project.progress ?? 0} /></td>
                      <td className="num">{project.openTasks ?? 0}</td>
                      <td className={state !== 'done' && project.targetDate && new Date(project.targetDate) < new Date() ? 'late' : undefined} style={{ whiteSpace: 'nowrap' }}>
                        {fmtDate(project.targetDate)}
                      </td>
                      <td className="num">{project.memberCount ?? 0}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
