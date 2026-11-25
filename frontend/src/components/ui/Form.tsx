import { CSSProperties, ReactNode, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

const inputBase: CSSProperties = {
  background: 'var(--bg-input)', border: '1px solid var(--field-line)', borderRadius: 0,
  padding: '10px 12px', color: 'var(--text-1)', fontSize: 14, outline: 'none',
  width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font)', lineHeight: 1.4,
  transition: 'border-color 0.12s, box-shadow 0.12s',
}
const focusStyle = { borderColor: 'var(--accent)', boxShadow: 'inset 0 -1px var(--accent)' }
const blurStyle  = { borderColor: 'var(--field-line)', boxShadow: 'none' }

export function Field({ label, required, children, style = {} }: { label?: ReactNode; required?: boolean; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      {label && (
        <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-2)' }}>
          {label}{required && <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span>}
        </label>
      )}
      {children}
    </div>
  )
}

export interface InpProps extends InputHTMLAttributes<HTMLInputElement> {
  showCount?: boolean
}

export function Inp({ showCount, onChange, style, ...props }: InpProps) {
  const [localVal, setLocalVal] = useState<string | null>(null)

  const currentLength = typeof props.value === 'string'
    ? props.value.length
    : typeof props.value === 'number'
    ? String(props.value).length
    : localVal !== null
    ? localVal.length
    : typeof props.defaultValue === 'string'
    ? props.defaultValue.length
    : 0

  const remaining = props.maxLength !== undefined ? Math.max(0, props.maxLength - currentLength) : null

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (props.value === undefined) {
      setLocalVal(e.target.value)
    }
    onChange?.(e)
  }

  const inputEl = (
    <input
      {...props}
      style={{ ...inputBase, ...style }}
      onChange={handleChange}
      onFocus={e => Object.assign(e.target.style, focusStyle)}
      onBlur={e => Object.assign(e.target.style, blurStyle)}
    />
  )

  if (showCount && props.maxLength !== undefined && remaining !== null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
        {inputEl}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 3 }}>
          <span style={{ fontSize: 12, color: remaining <= 10 ? 'var(--crit)' : 'var(--text-3)', transition: 'color 0.15s' }}>
            {remaining} {remaining === 1 ? 'caractere restante' : 'caracteres restantes'}
          </span>
        </div>
      </div>
    )
  }

  return inputEl
}

// Campo de senha com botão "Mostrar senha" próprio. O revelador nativo do
// Edge/Chrome é escondido via .pwd-input (globals.css) para não duplicar o ícone.
export function PwdInp({ style, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false)
  const label = visible ? 'Ocultar senha' : 'Mostrar senha'
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        className={['pwd-input', props.className].filter(Boolean).join(' ')}
        style={{ ...inputBase, paddingRight: 38, ...style }}
        onFocus={e => Object.assign(e.target.style, focusStyle)}
        onBlur={e => Object.assign(e.target.style, blurStyle)}
      />
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-pressed={visible}
        onClick={() => setVisible(v => !v)}
        onMouseDown={e => e.preventDefault()}
        style={{
          position: 'absolute', right: 1, top: 1, bottom: 1, width: 34,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          color: 'var(--text-3)', borderRadius: 'var(--radius-md)',
        }}
      >
        {visible ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  )
}

export interface TxtaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  showCount?: boolean
}

export function Txta({ showCount, onChange, style, ...props }: TxtaProps) {
  const [localVal, setLocalVal] = useState<string | null>(null)

  const currentLength = typeof props.value === 'string'
    ? props.value.length
    : typeof props.value === 'number'
    ? String(props.value).length
    : localVal !== null
    ? localVal.length
    : typeof props.defaultValue === 'string'
    ? props.defaultValue.length
    : 0

  const shouldShowCount = showCount !== undefined ? showCount : props.maxLength !== undefined
  const remaining = props.maxLength !== undefined ? Math.max(0, props.maxLength - currentLength) : null

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (props.value === undefined) {
      setLocalVal(e.target.value)
    }
    onChange?.(e)
  }

  const txtEl = (
    <textarea
      {...props}
      style={{ ...inputBase, resize: 'vertical', minHeight: 80, ...style }}
      onChange={handleChange}
      onFocus={e => Object.assign(e.target.style, focusStyle)}
      onBlur={e => Object.assign(e.target.style, blurStyle)}
    />
  )

  if (shouldShowCount && props.maxLength !== undefined && remaining !== null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
        {txtEl}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
          <span style={{ fontSize: 12, color: remaining <= 10 ? 'var(--crit)' : 'var(--text-3)', transition: 'color 0.15s' }}>
            {remaining} {remaining === 1 ? 'caractere restante' : 'caracteres restantes'}
          </span>
        </div>
      </div>
    )
  }

  return txtEl
}

export function Sel({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  // Desabilitado precisa parecer desabilitado (antes o seletor de papel do membro parecia editável).
  return <select {...props} style={{ ...inputBase, cursor: props.disabled ? 'not-allowed' : 'pointer', ...(props.disabled ? { opacity: 0.6, background: 'var(--bg-topbar)' } : {}), ...props.style }} onFocus={e => Object.assign(e.target.style, focusStyle)} onBlur={e => Object.assign(e.target.style, blurStyle)}>{children}</select>
}
