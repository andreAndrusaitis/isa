import { Btn } from './Button'

interface AccessDeniedViewProps {
  areaName?: string
  /** Explicação vinda do backend (o motivo real). Substitui o texto genérico. */
  message?: string
  onBack?: () => void
}

export function AccessDeniedView({ areaName, message, onBack }: AccessDeniedViewProps) {
  return (
    <div style={{ flex: 1, padding: '12vh var(--page-gutter) 40px', background: 'var(--bg-app)' }}>
      <div role="alert" style={{ maxWidth: 560, marginBottom: 24 }}>
        <h2 style={{ fontSize: 32, fontWeight: 500, letterSpacing: '-0.025em', lineHeight: 1.15, color: 'var(--text-1)', marginBottom: 12 }}>
          Acesso negado
        </h2>
        {message ? (
          <p style={{ fontSize: 15, color: 'var(--text-2)', lineHeight: 1.5 }}>{message}</p>
        ) : (
          <>
            <p style={{ fontSize: 15, color: 'var(--text-2)', lineHeight: 1.5 }}>
              Você não possui permissão para acessar a área{' '}
              {areaName ? <strong>{areaName}</strong> : 'solicitada'}.
            </p>
            <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 1.5, marginTop: 6 }}>
              Caso necessite de acesso a esta funcionalidade, solicite a um administrador do sistema para
              habilitá-la em seu cadastro.
            </p>
          </>
        )}
      </div>

      {onBack && <Btn variant="secondary" onClick={onBack}>Voltar</Btn>}
    </div>
  )
}
