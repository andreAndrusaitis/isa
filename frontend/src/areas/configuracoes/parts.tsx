import { CopyableId } from '@/components/ui'
import './configuracoes.css'

/** Amostra da cor gravada: clicar abre o seletor do navegador. */
export function ColorSwatch({ value, onChange, label = 'Cor' }: { value: string; onChange: (v: string) => void; label?: string }) {
  return <input type="color" className="cfg-swatch" aria-label={label} value={/^#[0-9A-Fa-f]{6}$/.test(value) ? value : '#0f73ac'} onChange={e => onChange(e.target.value)} />
}

export function IdRow({ label, id }: { label: string; id: string }) {
  return <div className="cfg-row" style={{ borderTop: 0, padding: 0 }}><span>{label}</span><CopyableId id={id} size="xs" showLabel copyLabel="Copiar" /></div>
}

type Day = { label: string; value: number; full?: string }

export function DayPicker({ days, value, onToggle, disabled }: { days: Day[]; value: number[]; onToggle: (day: number) => void; disabled?: boolean }) {
  return (
    <div className="cfg-days">
      {days.map(d => {
        const on = value.includes(d.value)
        return <button key={d.value} type="button" disabled={disabled} aria-pressed={on} title={d.full && `${d.full}: ${on ? 'Ativo' : 'Não considerado'}`} onClick={() => onToggle(d.value)}>{d.label}</button>
      })}
    </div>
  )
}
