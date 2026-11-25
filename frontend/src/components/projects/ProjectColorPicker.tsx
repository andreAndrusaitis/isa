import type { CSSProperties } from 'react'
import { Pipette } from 'lucide-react'
import type { Project } from '@/types/projects'
import './projects.css'

/** Paleta oferecida em projeto, status, tag e tipo. Outra cor qualquer (e as já gravadas) continua valendo. */
export const PROJECT_COLORS = [
  { value: '#0f73ac', label: 'Azul' },
  { value: '#3a7f6b', label: 'Pinho' },
  { value: '#a8761b', label: 'Ocre' },
  { value: '#b3402a', label: 'Barro' },
  { value: '#5a6d9c', label: 'Ardósia' },
  { value: '#6b7f8a', label: 'Cinza' },
  { value: '#2f9fb3', label: 'Lago' },
  { value: '#7a5c86', label: 'Ameixa' },
]

/** Avisa sidebar e shell que o projeto mudou (cor/nome) sem precisar recarregar a página. */
export const PROJECT_UPDATED_EVENT = 'project:updated'
export function emitProjectUpdated(project: Project) {
  window.dispatchEvent(new CustomEvent<Project>(PROJECT_UPDATED_EVENT, { detail: project }))
}

/** Cor da pastinha na sidebar escura: clareada para não sumir no fundo. */
export function projectFolderColor(color: string | null | undefined): string | undefined {
  return color ? `color-mix(in srgb, ${color} 70%, white)` : undefined
}

/**
 * Sobrescreve os tokens de destaque dentro do projeto: tudo que usa
 * var(--accent)/var(--accent-light) (abas, botões primários, seleção) segue a cor dele.
 */
export function projectAccentStyle(color: string | null | undefined): CSSProperties | undefined {
  if (!color) return undefined
  return {
    '--accent': color,
    '--accent-light': `color-mix(in srgb, ${color} 80%, white)`,
  } as CSSProperties
}

/** `noDefault`: cor obrigatória, sem a opção "Padrão". */
export function ProjectColorPicker({ value, onChange, label = 'Cor do projeto', noDefault = false }: {
  value: string | null
  onChange: (color: string | null) => void
  label?: string
  noDefault?: boolean
}) {
  const current = value?.toLowerCase()
  const isCustom = !!current && !PROJECT_COLORS.some(c => c.value === current)
  return (
    <div role="radiogroup" aria-label={label} className="sw">
      {!noDefault && <Swatch label="Padrão" selected={!value} onClick={() => onChange(null)} />}
      {PROJECT_COLORS.map(c => (
        <Swatch key={c.value} label={c.label} color={c.value} selected={current === c.value} onClick={() => onChange(c.value)} />
      ))}
      <label title="Outra cor" data-on={isCustom} style={isCustom ? { background: value! } : undefined}>
        {!isCustom && <Pipette size={14} aria-hidden />}
        <input type="color" aria-label="Outra cor" value={value ?? PROJECT_COLORS[0].value} onChange={e => onChange(e.target.value)} />
      </label>
    </div>
  )
}

function Swatch({ label, color, selected, onClick }: { label: string; color?: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={selected} aria-label={label} title={label} onClick={onClick}
      className={color ? undefined : 'sw-none'} data-on={selected} style={color ? { background: color } : undefined} />
  )
}
