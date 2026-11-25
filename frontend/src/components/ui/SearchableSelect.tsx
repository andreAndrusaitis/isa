import React, { useState, useRef, useEffect, useLayoutEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import { Search, ChevronDown, Check, X } from 'lucide-react'

export interface SearchableSelectOption {
  value: string
  label: string
  sublabel?: string
  disabled?: boolean
}

export interface SearchableSelectProps {
  value: string
  onChange: (value: string) => void
  options: SearchableSelectOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  compact?: boolean
  disabled?: boolean
  id?: string
  name?: string
  'aria-label'?: string
  style?: React.CSSProperties
  className?: string
  /** Seleção múltipla: `value`/`onChange` usam CSV ("a,b") e o painel fica aberto ao marcar. */
  multiple?: boolean
  /** No modo múltiplo, opções que substituem a seleção (ex.: "Todos"). Padrão: 'all' e ''. */
  exclusive?: string[]
}

/**
 * Marca/desmarca `v` num valor CSV de multisseleção. Opção exclusiva (ex.: "Todos")
 * substitui tudo; desmarcar a última volta para `fallback`.
 */
export function toggleCsv(value: string, v: string, exclusive: string[], fallback: string): string {
  if (exclusive.includes(v)) return v
  const current = value.split(',').filter((x) => x && !exclusive.includes(x))
  const next = current.includes(v) ? current.filter((x) => x !== v) : [...current, v]
  return next.length ? next.join(',') : fallback
}

function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Selecione...',
  searchPlaceholder = 'Pesquisar...',
  emptyText = 'Nenhum resultado encontrado',
  compact = false,
  disabled = false,
  id,
  name,
  'aria-label': ariaLabel,
  style,
  className,
  multiple = false,
  exclusive = ['all', ''],
}: SearchableSelectProps) {
  const generatedId = useId()
  const componentId = id || generatedId
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState<number>(0)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const [panelPos, setPanelPos] = useState<{
    top: number
    left: number
    width: number
    maxHeight: number
  } | null>(null)

  // Current selected option(s)
  const selectedValues = multiple && value ? value.split(',') : [value]
  const isSelected = (v: string) => selectedValues.includes(v)
  const selectedOptions = options.filter((o) => isSelected(o.value))
  const selectedOption = selectedOptions[0]
  const selectedLabel = selectedOptions.map((o) => o.label).join(', ')

  const toggleValue = (v: string) =>
    onChange(toggleCsv(value, v, exclusive, exclusive.find((e) => options.some((o) => o.value === e)) ?? ''))

  // Filtered options based on query
  const filteredOptions = React.useMemo(() => {
    if (!query.trim()) return options
    const norm = normalizeText(query)
    return options.filter((o) => {
      const matchLabel = normalizeText(o.label).includes(norm)
      const matchSub = o.sublabel ? normalizeText(o.sublabel).includes(norm) : false
      return matchLabel || matchSub
    })
  }, [options, query])

  // Reset highlight index when filtered list changes
  useEffect(() => {
    setHighlightedIndex(0)
  }, [filteredOptions])

  // Reposition panel to follow trigger button
  const reposition = () => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const MARGIN = 6
    const minWidth = Math.max(rect.width, 220)
    const availableWidth = window.innerWidth - 2 * MARGIN
    const width = Math.min(minWidth, availableWidth)

    const spaceBelow = window.innerHeight - rect.bottom - MARGIN
    const spaceAbove = rect.top - MARGIN
    const openUp = spaceBelow < 200 && spaceAbove > spaceBelow
    const maxHeight = Math.min(280, Math.max(160, openUp ? spaceAbove : spaceBelow))

    let left = rect.left
    if (left + width > window.innerWidth - MARGIN) {
      left = window.innerWidth - width - MARGIN
    }
    if (left < MARGIN) {
      left = MARGIN
    }

    const top = openUp ? rect.top - MARGIN - maxHeight : rect.bottom + MARGIN

    setPanelPos({ top, left, width, maxHeight })
  }

  useLayoutEffect(() => {
    if (!isOpen) return
    reposition()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [isOpen])

  // Focus search input when open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 20)
    } else {
      setQuery('')
    }
  }, [isOpen])

  // Click outside listener
  useEffect(() => {
    if (!isOpen) return
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // Keyboard navigation on list
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setIsOpen(true)
      }
      return
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      setIsOpen(false)
      triggerRef.current?.focus()
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex((prev) => {
        const next = prev + 1 >= filteredOptions.length ? 0 : prev + 1
        ensureVisible(next)
        return next
      })
      return
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex((prev) => {
        const next = prev - 1 < 0 ? Math.max(0, filteredOptions.length - 1) : prev - 1
        ensureVisible(next)
        return next
      })
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      const chosen = filteredOptions[highlightedIndex]
      if (chosen) selectOption(chosen)
    }
  }

  const ensureVisible = (index: number) => {
    if (!listRef.current) return
    const itemEl = listRef.current.children[index] as HTMLElement | undefined
    if (itemEl) {
      itemEl.scrollIntoView({ block: 'nearest' })
    }
  }

  const selectOption = (opt: SearchableSelectOption) => {
    if (opt.disabled) return
    if (multiple) return toggleValue(opt.value)
    onChange(opt.value)
    setIsOpen(false)
    triggerRef.current?.focus()
  }

  const triggerStyle: React.CSSProperties = {
    width: '100%',
    minHeight: compact ? 32 : 40,
    padding: compact ? '0 8px' : '9px 12px',
    fontSize: compact ? 13 : 14,
    lineHeight: 1.4,
    border: 0,
    borderBottom: '1px solid var(--field-line)',
    borderRadius: 0,
    background: 'var(--bg-input)',
    color: selectedOption ? 'var(--text-1)' : 'var(--text-3)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'var(--font)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    textAlign: 'left',
    boxSizing: 'border-box',
    opacity: disabled ? 0.6 : 1,
    ...style,
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={componentId}
        name={name}
        aria-label={ariaLabel || selectedLabel || placeholder}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        className={className}
        style={triggerStyle}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {selectedLabel || placeholder}
        </span>
        <ChevronDown
          size={compact ? 12 : 15}
          color="var(--text-3)"
          style={{
            flexShrink: 0,
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s ease',
          }}
        />
      </button>

      {isOpen &&
        panelPos &&
        createPortal(
          <div
            ref={panelRef}
            data-floating-panel
            style={{
              position: 'fixed',
              top: panelPos.top,
              left: panelPos.left,
              width: panelPos.width,
              maxHeight: panelPos.maxHeight,
              zIndex: 100001,
              background: 'var(--bg-card)',
              border: '1px solid var(--border-strong)',
              boxShadow: 'var(--pop-shadow)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              fontFamily: 'var(--font)',
            }}
            onKeyDown={handleKeyDown}
          >
            {/* Search Input Header */}
            <div
              style={{
                padding: compact ? '7px 10px' : '9px 12px',
                borderBottom: '1px solid var(--rule)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flexShrink: 0,
              }}
            >
              <Search size={compact ? 12 : 14} color="var(--text-3)" style={{ flexShrink: 0 }} />
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                style={{
                  flex: 1,
                  background: 'none',
                  border: 'none',
                  outline: 'none',
                  fontSize: compact ? 13 : 14,
                  color: 'var(--text-1)',
                  fontFamily: 'var(--font)',
                  minWidth: 0,
                }}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('')
                    searchInputRef.current?.focus()
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    color: 'var(--text-3)',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <X size={compact ? 11 : 13} />
                </button>
              )}
            </div>

            {/* Options List */}
            <div
              ref={listRef}
              role="listbox"
              aria-label={placeholder}
              aria-multiselectable={multiple || undefined}
              style={{
                flex: 1,
                overflowY: 'auto',
              }}
            >
              {filteredOptions.length === 0 ? (
                <div
                  style={{
                    padding: '12px',
                    fontSize: 13,
                    color: 'var(--text-3)',
                  }}
                >
                  {emptyText}
                </div>
              ) : (
                filteredOptions.map((opt, idx) => {
                  const selected = isSelected(opt.value)
                  const isHighlighted = idx === highlightedIndex

                  return (
                    <div
                      key={opt.value}
                      role="option"
                      aria-selected={selected}
                      onClick={() => selectOption(opt)}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                      style={{
                        padding: compact ? '7px 10px' : '9px 12px',
                        fontSize: compact ? 13 : 14,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        cursor: opt.disabled ? 'not-allowed' : 'pointer',
                        opacity: opt.disabled ? 0.4 : 1,
                        background: selected
                          ? 'var(--accent-soft)'
                          : isHighlighted
                          ? 'var(--tint)'
                          : 'transparent',
                        color: 'var(--text-1)',
                        fontWeight: selected ? 600 : 400,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          overflow: 'hidden',
                          minWidth: 0,
                          flex: 1,
                        }}
                      >
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {opt.label}
                        </span>
                        {opt.sublabel && (
                          <span
                            style={{
                              fontSize: 12,
                              color: 'var(--text-3)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {opt.sublabel}
                          </span>
                        )}
                      </div>
                      {selected && (
                        <Check
                          size={compact ? 12 : 14}
                          color="var(--accent-fg)"
                          style={{ flexShrink: 0 }}
                        />
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
