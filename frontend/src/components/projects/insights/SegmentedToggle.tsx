/** Escolha única em blocos retos (período, lente do relatório). */
export function SegmentedToggle<T extends string | number>({ options, value, onChange, ariaLabel }: {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
  ariaLabel: string
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="subtabs">
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}
