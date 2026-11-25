export function Toggle({ value, onChange, size = 18, disabled = false, label }: { value: boolean; onChange: (v: boolean) => void; size?: number; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      onClick={() => onChange(!value)}
      disabled={disabled}
      aria-disabled={disabled}
      style={{ width: size * 2, height: size, borderRadius: 99, border: `1px solid ${value ? 'var(--accent)' : 'var(--text-3)'}`, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1, background: value ? 'var(--accent)' : 'transparent', padding: 2, display: 'flex', alignItems: 'center', justifyContent: value ? 'flex-end' : 'flex-start', transition: 'background 0.2s' }}>
      <div style={{ borderRadius: '50%', width: size - 6, height: size - 6, background: value ? 'var(--on-accent)' : 'var(--text-3)' }} />
    </button>
  )
}
