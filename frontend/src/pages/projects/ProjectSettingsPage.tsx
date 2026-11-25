import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Btn, ConfirmModal, Sel, Inp, Txta, EmptyState, Loading } from '@/components/ui'
import { getProject, updateProject, archiveProject, listSprintOwners, globalSprintApi } from '@/services/projectsService'
import { Project, ProjectPrivacy, SprintOwner } from '@/types/projects'
import { StatusManager } from '@/components/projects/StatusManager'
import { TaskTypeManager } from '@/components/projects/TaskTypeManager'
import { SprintManager, projectSprintApi } from '@/components/projects/SprintManager'
import { TagManager } from '@/components/projects/TagManager'
import { ProjectBackupSection } from '@/components/projects/ProjectBackupSection'
import { useProjectRole } from '@/components/projects/projectRole'
import { ProjectColorPicker, emitProjectUpdated } from '@/components/projects/ProjectColorPicker'
import '@/components/projects/insights/projects.css'
import { toast } from '@/store/toastStore'
import { apiErrorMessage } from '@/services/api'

/**
 * Disparado em `window` depois de arquivar um projeto (detail: { projectId }),
 * para quem mantém a lista de projetos (ProjetosPage, barra lateral) recarregar.
 */
export const PROJECTS_CHANGED_EVENT = 'projects:changed'

/** Data salva como meio-dia UTC (mesmo padrão das tasks): o dia não muda em nenhum fuso do Brasil. */
const toApiDate = (day: string) => (day ? `${day}T12:00:00.000Z` : null)
const toInputDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '')

export default function ProjectSettingsPage() {
  const { canConfigure, isOwner } = useProjectRole()
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [privacy, setPrivacy] = useState<ProjectPrivacy>('organization')
  const [color, setColor] = useState<string | null>(null)
  const [startDate, setStartDate] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sprintSource, setSprintSource] = useState<string | null>(null)
  const [sprintOwners, setSprintOwners] = useState<SprintOwner[]>([])
  const [sprintSourceError, setSprintSourceError] = useState<string | null>(null)
  // Memo: o SprintManager recarrega quando a api muda (troca de origem).
  const sprintApi = useMemo(
    () => (sprintSource ? globalSprintApi(sprintSource) : projectId ? projectSprintApi(projectId) : null),
    [projectId, sprintSource],
  )

  useEffect(() => { listSprintOwners().then(setSprintOwners).catch(() => setSprintOwners([])) }, [])

  useEffect(() => {
    if (!projectId) return
    setLoadError(null)
    getProject(projectId).then(p => {
      setProject(p)
      setName(p.name)
      setDescription(p.description ?? '')
      setPrivacy(p.privacy)
      setColor(p.color ?? null)
      setStartDate(toInputDate(p.startDate))
      setTargetDate(toInputDate(p.targetDate))
      setSprintSource(p.sprintSourceId ?? null)
    }).catch(err => setLoadError(apiErrorMessage(err, 'Não foi possível carregar as configurações do projeto.')))
  }, [projectId, reloadKey])

  async function handleSave() {
    if (!projectId || saving) return
    if (startDate && targetDate && targetDate < startDate) {
      toast.error('A data alvo não pode ser antes da data de início.')
      return
    }
    setSaving(true)
    try {
      const updated = await updateProject(projectId, {
        name, description: description || null, privacy, color,
        startDate: toApiDate(startDate), targetDate: toApiDate(targetDate),
      })
      emitProjectUpdated(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível salvar as alterações do projeto.'))
    } finally {
      setSaving(false)
    }
  }

  async function handleSprintSource(ownerId: string | null) {
    if (!projectId) return
    setSprintSourceError(null)
    try {
      await updateProject(projectId, { sprintSourceId: ownerId })
      setSprintSource(ownerId)
    } catch (err: any) {
      setSprintSourceError(err?.response?.data?.error ?? 'Não foi possível trocar a origem dos sprints.')
    }
  }

  async function handleArchive() {
    if (!projectId) return
    try {
      await archiveProject(projectId)
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível arquivar o projeto.'))
      return
    }
    window.dispatchEvent(new CustomEvent(PROJECTS_CHANGED_EVENT, { detail: { projectId } }))
    toast.success('Projeto arquivado.')
    navigate('/projetos')
  }

  if (loadError) {
    return (
      <EmptyState
        title="Não foi possível carregar"
        desc={loadError}
        action={<Btn variant="secondary" size="sm" onClick={() => setReloadKey(k => k + 1)}>Tentar novamente</Btn>}
      />
    )
  }

  if (!project) return <Loading label="Carregando configurações do projeto…" />

  return (
    <div className="prj-body" style={{ gap: 0, maxWidth: 1080 }}>
      {!canConfigure && (
        <div role="note" className="notice" style={{ marginBottom: 20 }}>
          Somente leitura: só o dono e os gerentes do projeto alteram estas configurações.
        </div>
      )}
      <fieldset disabled={!canConfigure} className="prj-fields">
        {/* Dados gerais: só o dono altera */}
        <fieldset disabled={!isOwner} className="prj-fields">
          <div className="setting">
            <span>Nome do projeto</span>
            <Inp aria-label="Nome do projeto" value={name} onChange={(e: any) => setName(e.target.value)} placeholder="Ex: Refatoração do Portal" />
          </div>
          <div className="setting">
            <span>Descrição</span>
            <Txta aria-label="Descrição" style={{ minHeight: 80 }} value={description} onChange={(e: any) => setDescription(e.target.value)} placeholder="Descreva o propósito e os objetivos deste projeto…" />
          </div>
          <div className="setting">
            <span>Visibilidade<small>Quem encontra e abre o projeto</small></span>
            <Sel aria-label="Visibilidade" value={privacy} onChange={(e: any) => setPrivacy(e.target.value as ProjectPrivacy)}>
              <option value="organization">Organização (visível a todos da empresa)</option>
              <option value="restricted">Restrito (apenas membros autorizados)</option>
              <option value="private">Privado (apenas convidados diretos)</option>
            </Sel>
          </div>
          <div className="setting">
            <span>Período<small>Início e data alvo</small></span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
              <Inp type="date" aria-label="Data de início" value={startDate} onChange={(e: any) => setStartDate(e.target.value)} />
              <Inp type="date" aria-label="Data alvo" value={targetDate} min={startDate || undefined} onChange={(e: any) => setTargetDate(e.target.value)} />
            </div>
          </div>
          <div className="setting">
            <span>Cor<small>Marca o projeto na navegação e os destaques aqui dentro</small></span>
            <ProjectColorPicker value={color} onChange={setColor} />
          </div>
          <div className="setting">
            <span />
            <div className="prj-tools">
              {isOwner && <Btn variant="primary" onClick={handleSave} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</Btn>}
              {saved && <span role="status" style={{ fontSize: 14, color: 'var(--text-2)' }}>Salvo com sucesso!</span>}
            </div>
          </div>
        </fieldset>

        <div className="setting prj-group">
          <span><b>Status do fluxo</b><small>As etapas do quadro. Arraste para reordenar; o botão + entre dois status insere uma etapa.</small></span>
          {projectId && <StatusManager projectId={projectId} readOnly={!canConfigure} />}
        </div>

        <div className="setting prj-group">
          <span><b>Tipos de tarefa</b><small>Classificam as tarefas (Story, Bug, Task, Epic…).</small></span>
          {projectId && <TaskTypeManager projectId={projectId} />}
        </div>

        <div className="setting prj-group">
          <span><b>Sprints</b><small>Ciclos de trabalho com início e fim. Só um sprint fica ativo por vez.</small></span>
          <div className="prj-control">
            <Sel aria-label="Origem dos sprints" value={sprintSource ?? ''} disabled={!isOwner} onChange={(e: any) => handleSprintSource(e.target.value || null)}>
              <option value="">Sprints próprios deste projeto</option>
              {sprintOwners.map(o => <option key={o.id} value={o.id}>Sprint global de {o.name}</option>)}
            </Sel>
            {sprintSourceError && <div role="alert" style={{ fontSize: 13, color: 'var(--danger)' }}>{sprintSourceError}</div>}
            {sprintSource && (
              <p className="prj-note">
                Os sprints vêm do calendário do Gerente e são geridos em Projetos › Sprints. Os sprints próprios ficam guardados e voltam se você trocar de novo.
              </p>
            )}
            {sprintApi && <SprintManager api={sprintApi} readOnly={!!sprintSource} />}
          </div>
        </div>

        <div className="setting prj-group">
          <span><b>Tags do projeto</b><small>Marcadores próprios (ex.: Urgente, Frontend, Cliente VIP).</small></span>
          {projectId && <TagManager projectId={projectId} />}
        </div>

        {/* Dono e gerentes do projeto */}
        {canConfigure && projectId && (
          <div className="setting prj-group">
            <span><b>Backup do projeto</b></span>
            <ProjectBackupSection projectId={projectId} projectName={project.name} />
          </div>
        )}

        {isOwner && (
          <div className="setting prj-group">
            <span><b>Arquivar</b><small>Desativa o projeto para todos os participantes e oculta as tarefas das visões ativas.</small></span>
            <div><Btn variant="danger" size="sm" onClick={() => setArchiveOpen(true)}>Arquivar projeto</Btn></div>
          </div>
        )}
      </fieldset>

      <ConfirmModal
        isOpen={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        onConfirm={handleArchive}
        title="Arquivar projeto"
        message="Isso arquiva o projeto para todos os membros. Esta ação pode ser revertida apenas por um admin diretamente no banco. Continuar?"
        confirmText="Confirmar"
        variant="danger"
      />
    </div>
  )
}
