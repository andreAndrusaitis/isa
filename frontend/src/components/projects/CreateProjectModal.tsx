import { useState } from 'react'
import { Modal, Btn, Field, Inp, Txta, Sel } from '@/components/ui'
import { createProject } from '@/services/projectsService'
import { Project, ProjectPrivacy } from '@/types/projects'
import { ProjectColorPicker } from './ProjectColorPicker'

export function CreateProjectModal({ isOpen, onClose, onCreated }: { isOpen: boolean; onClose: () => void; onCreated: (project: Project) => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [privacy, setPrivacy] = useState<ProjectPrivacy>('organization')
  const [color, setColor] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    if (!name.trim() || submitting) return
    setSubmitting(true)
    try {
      const project = await createProject({ name: name.trim(), description: description.trim() || undefined, privacy, ...(color ? { color } : {}) })
      onCreated(project)
      setName('')
      setDescription('')
      setPrivacy('organization')
      setColor(null)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Novo projeto"
      width={520}
      footer={<Btn variant="primary" size="sm" onClick={handleSubmit} disabled={!name.trim() || submitting}>Criar projeto</Btn>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Field label="Nome do projeto">
          <Inp id="project-name" aria-label="Nome do projeto" value={name} onChange={(e: any) => setName(e.target.value)} placeholder="Ex: Migração ERP" />
        </Field>
        <Field label="Descrição (opcional)">
          <Txta id="project-description" aria-label="Descrição" style={{ minHeight: 72 }} value={description} onChange={(e: any) => setDescription(e.target.value)} />
        </Field>
        <Field label="Privacidade">
          <Sel id="project-privacy" aria-label="Privacidade" value={privacy} onChange={(e: any) => setPrivacy(e.target.value as ProjectPrivacy)}>
            <option value="organization">Organização — todos da empresa veem</option>
            <option value="restricted">Restrito — apenas convidados</option>
            <option value="private">Privado — apenas membros explícitos</option>
          </Sel>
        </Field>
        <Field label="Cor">
          <ProjectColorPicker value={color} onChange={setColor} />
        </Field>
      </div>
    </Modal>
  )
}
