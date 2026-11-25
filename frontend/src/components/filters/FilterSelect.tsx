import { Children, Fragment, isValidElement, type ReactElement, type ReactNode } from 'react'
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/SearchableSelect'

type OptionProps = { value?: string | number; disabled?: boolean; children?: ReactNode }

function collectOptions(children: ReactNode): SearchableSelectOption[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement(child)) return []
    const el = child as ReactElement<OptionProps>
    if (el.type === Fragment) return collectOptions(el.props.children)
    if (el.type !== 'option') return []
    const label = Children.toArray(el.props.children).join('')
    return [{ value: String(el.props.value ?? label), label, disabled: el.props.disabled }]
  })
}

/** Filtro multivalorado ("a,b"; 'all'/'' = sem filtro) casa com o valor `v`? */
export const matchesFilter = (filter: string, v: unknown) =>
  !filter || filter === 'all' || filter.split(',').includes(String(v ?? ''))

/**
 * Substituto do <select> nos filtros: mesmas <option> como filhos, com busca por texto e
 * seleção múltipla (valor CSV). `single` para escolhas que não somam, como "Ordenar por".
 */
export function FilterSelect({ value, onChange, children, searchPlaceholder = 'Pesquisar...', single = false, exclusive }: {
  value: string
  onChange: (value: string) => void
  children: ReactNode
  searchPlaceholder?: string
  single?: boolean
  exclusive?: string[]
}) {
  return (
    <SearchableSelect
      compact
      multiple={!single}
      exclusive={exclusive}
      value={value}
      onChange={onChange}
      options={collectOptions(children)}
      searchPlaceholder={searchPlaceholder}
    />
  )
}
