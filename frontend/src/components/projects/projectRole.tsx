import { createContext, useContext } from 'react'

export type ProjectRole = 'owner' | 'manager' | 'member' | 'viewer' | null | undefined

const ProjectRoleContext = createContext<ProjectRole>(undefined)
export const ProjectRoleProvider = ProjectRoleContext.Provider

/**
 * Papel no projeto (vem do GET /projects/:id) para esconder/desabilitar o que o
 * backend recusaria. Enquanto não carregou (ou fora do shell), não restringe:
 * quem decide de verdade é o backend; aqui é só para não oferecer becos sem saída.
 */
export function useProjectRole() {
  const role = useContext(ProjectRoleContext)
  const known = role != null
  return {
    role,
    canEdit: !known || role !== 'viewer',
    canConfigure: !known || role === 'owner' || role === 'manager',
    isOwner: !known || role === 'owner',
  }
}
