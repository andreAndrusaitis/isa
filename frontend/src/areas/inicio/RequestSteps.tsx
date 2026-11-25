import './home.css'

const STAGE: Record<string, number> = { open: 0, in_progress: 1, pending: 1, resolved: 2, closed: 2 }
const LABELS = ['Recebido', 'Em atendimento', 'Resolvido']

/** As três etapas que o cliente acompanha. */
export function RequestSteps({ status }: { status: string }) {
  const at = STAGE[status] ?? 0
  return (
    <ol className="hm-steps" aria-label={`Etapa: ${LABELS[at]}`}>
      {LABELS.map((l, i) => <li key={l} data-on={i <= at || undefined} aria-current={i === at ? 'step' : undefined}>{l}</li>)}
    </ol>
  )
}
