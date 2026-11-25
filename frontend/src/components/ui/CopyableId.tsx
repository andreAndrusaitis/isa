import React, { useState, useRef, useEffect } from 'react'
import { Copy, Check } from 'lucide-react'
import { toast } from '@/store/toastStore'

/**
 * Copia um texto limpo para a área de transferência.
 * Garante que apenas a string do ID (sem prefixos ou quebras) seja enviada,
 * compatível diretamente com payloads de API e Webhooks.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  const value = String(text ?? '').trim()
  if (!value) return false

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // Fallback caso a API do clipboard rejeite
  }

  try {
    if (typeof document !== 'undefined' && typeof document.execCommand === 'function' && document.queryCommandSupported?.('copy')) {
      const textarea = document.createElement('textarea')
      textarea.value = value
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'fixed'
      textarea.style.left = '-9999px'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(textarea)
      if (ok) return true
    }
  } catch {
    // ignore
  }

  return false
}

export interface CopyableIdProps {
  /** O identificador único a ser exibido e copiado */
  id: string
  /** Se verdadeiro, renderiza apenas o botão com ícone (útil para tags, badges e chips) */
  iconOnly?: boolean
  /** Tamanho visual do componente */
  size?: 'xs' | 'sm' | 'md'
  /** Rótulo ou prefixo opcional antes do ID */
  prefix?: string
  /** Se deve exibir o rótulo de texto no botão ("Copiar") no estado inativo */
  showLabel?: boolean
  /** Texto personalizado para o botão inativo */
  copyLabel?: string
  /** Texto personalizado para o aviso inline */
  copiedLabel?: string
  /** Mensagem exibida no toast (defina como null/vazio para desativar) */
  toastMessage?: string | null
  /** Tooltip a exibir no hover */
  tooltip?: string
  /** Estilos customizados para o container */
  style?: React.CSSProperties
  /** Estilos customizados para a tag do código/ID */
  codeStyle?: React.CSSProperties
  /** Callback opcional chamado após copiar com sucesso */
  onCopied?: () => void
}

/**
 * Componente unificado para exibição e cópia de IDs (Categorias, Filas, Empresas, etc.).
 * Mostra o ID em fonte monoespaçada, botão de cópia com 1 clique e feedback visual "Copiado!".
 */
export function CopyableId({
  id,
  iconOnly = false,
  size = 'xs',
  prefix,
  showLabel = false,
  copyLabel = 'Copiar',
  copiedLabel = 'Copiado!',
  toastMessage = 'ID copiado!',
  tooltip,
  style,
  codeStyle,
  onCopied,
}: CopyableIdProps) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()

    const ok = await copyToClipboard(id)
    if (ok) {
      setCopied(true)
      if (toastMessage) {
        toast.success(toastMessage)
      }
      onCopied?.()

      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        setCopied(false)
      }, 2000)
    } else {
      toast.error('Não foi possível copiar o ID.')
    }
  }

  const iconSize = size === 'xs' ? 11 : size === 'sm' ? 13 : 14
  const fontSize = size === 'xs' ? 12 : 12.5
  const btnPadding = size === 'xs' ? '2px 5px' : size === 'sm' ? '3px 7px' : '4px 9px'

  const effectiveTooltip = copied
    ? copiedLabel
    : (tooltip || `Copiar ID: ${id}`)

  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={handleCopy}
        title={effectiveTooltip}
        data-tooltip={effectiveTooltip}
        aria-label={effectiveTooltip}
        style={{
          background: copied ? 'color-mix(in srgb, var(--success) 15%, transparent)' : 'none',
          border: 'none',
          padding: size === 'xs' ? 2 : 3,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: copied ? 'var(--ok-500)' : 'var(--text-3)',
          borderRadius: 'var(--radius-md)',
          lineHeight: 1,
          transition: 'color 0.15s, background-color 0.15s',
          ...style,
        }}
      >
        {copied ? <Check size={iconSize} /> : <Copy size={iconSize} />}
      </button>
    )
  }

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        maxWidth: '100%',
        ...style,
      }}
    >
      {prefix && (
        <span
          style={{
            fontSize,
            color: 'var(--text-3)',
            fontWeight: 500,
            whiteSpace: 'nowrap',
          }}
        >
          {prefix}
        </span>
      )}
      <code
        style={{
          fontFamily: 'monospace, monospace',
          fontSize,
          color: 'var(--text-2)',
          padding: 0,
          userSelect: 'all',
          overflowWrap: 'anywhere',
          wordBreak: 'break-all',
          lineHeight: 1.4,
          ...codeStyle,
        }}
      >
        {id}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        title={effectiveTooltip}
        data-tooltip={effectiveTooltip}
        aria-label={effectiveTooltip}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          background: 'none',
          border: 0,
          color: copied ? 'var(--ok-500)' : 'var(--text-2)',
          borderRadius: 'var(--radius-md)',
          padding: btnPadding,
          fontSize: size === 'xs' ? 10 : 11,
          fontWeight: 600,
          cursor: 'pointer',
          lineHeight: 1,
          transition: 'all 0.15s ease',
          flexShrink: 0,
        }}
      >
        {copied ? (
          <>
            <Check size={iconSize} style={{ color: 'var(--ok-500)' }} />
            <span style={{ color: 'var(--ok-500)' }}>{copiedLabel}</span>
          </>
        ) : (
          <>
            <Copy size={iconSize} />
            {showLabel && <span>{copyLabel}</span>}
          </>
        )}
      </button>
    </div>
  )
}
