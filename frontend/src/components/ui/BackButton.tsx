import { ArrowLeft } from 'lucide-react'
import { Btn } from './Button'

export function BackButton({ onClick, label = 'Voltar' }: { onClick: () => void; label?: string }) {
  return (
    <Btn variant="secondary" size="sm" onClick={onClick} icon={<ArrowLeft size={14} />}>
      {label}
    </Btn>
  )
}
