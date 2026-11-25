import { useEffect, useState } from 'react'
import { getSavedFilters, saveFilter, deleteFilter, countActiveFilters, type SavedFilter } from '@/utils/filterStorage'

/**
 * Estado do painel de filtros padrão do sistema (FilterButton + FilterDropdown):
 * valores, contagem de ativos e filtros salvos por página. `pageKey` muda (ex.:
 * outro projeto) → recarrega os salvos e volta aos padrões.
 * Datas do painel usam as chaves `dateFrom`/`dateTo` em `defaults`.
 */
export function useFilterPanel<T extends Record<string, string>>(pageKey: string, defaults: T) {
  const [values, setValues] = useState<T>(defaults)
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState<SavedFilter[]>(() => getSavedFilters(pageKey))
  const [activeSaved, setActiveSaved] = useState<SavedFilter | null>(null)

  useEffect(() => {
    setSaved(getSavedFilters(pageKey))
    setValues(defaults)
    setActiveSaved(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- defaults é literal da página; só a chave importa
  }, [pageKey])

  const set = (key: keyof T, value: string) => setValues((prev) => ({ ...prev, [key]: value }))
  const clear = () => { setValues(defaults); setActiveSaved(null) }

  return {
    values,
    set,
    clear,
    activeCount: countActiveFilters(values, defaults),
    buttonProps: {
      activeCount: countActiveFilters(values, defaults),
      activeSavedFilter: activeSaved,
      onOpen: () => setOpen((v) => !v),
      onClearSaved: clear,
      isOpen: open,
    },
    dropdownProps: {
      isOpen: open,
      onClose: () => setOpen(false),
      savedFilters: saved,
      onSelectSaved: (sf: SavedFilter) => { setValues({ ...defaults, ...(sf.filters as Partial<T>) }); setActiveSaved(sf) },
      onSaveNew: (name: string) => { saveFilter(pageKey, { id: crypto.randomUUID(), name, filters: values }); setSaved(getSavedFilters(pageKey)) },
      onDeleteSaved: (id: string) => { deleteFilter(pageKey, id); setSaved(getSavedFilters(pageKey)); if (activeSaved?.id === id) setActiveSaved(null) },
      onApply: () => setOpen(false),
      onClear: clear,
      dateFrom: values.dateFrom ?? '',
      dateTo: values.dateTo ?? '',
      onDateFromChange: (v: string) => set('dateFrom' as keyof T, v),
      onDateToChange: (v: string) => set('dateTo' as keyof T, v),
      showDateFilter: 'dateFrom' in defaults,
    },
  }
}
