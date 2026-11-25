import { useNavigate } from 'react-router-dom'
import { Btn } from '@/components/ui'

export default function ProjectsAccessDenied() {
  const navigate = useNavigate()

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center',
      height: '100vh', gap: 16, padding: '0 max(24px, 12vw)',
    }}>
      <h1 style={{ fontSize: 28, fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--text-1)', margin: 0 }}>
        Você não tem acesso ao módulo de Projetos
      </h1>
      <p style={{ color: 'var(--text-2)', maxWidth: 420, margin: 0 }}>
        Fale com um administrador ou gerente se acredita que deveria ter acesso a esta área.
      </p>
      <Btn variant="primary" onClick={() => navigate('/')}>
        Ir para a Área de Chamados
      </Btn>
    </div>
  )
}
