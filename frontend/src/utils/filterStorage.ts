export interface SavedFilter {
  id: string
  name: string
  filters: Record<string, string | boolean>
}

export function getSavedFilters(pageKey: string): SavedFilter[] {
  try {
    const raw = localStorage.getItem(`sd-saved-filters-${pageKey}`)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveFilter(pageKey: string, filter: SavedFilter): void {
  const existing = getSavedFilters(pageKey)
  const updated = [...existing.filter((f) => f.id !== filter.id), filter]
  localStorage.setItem(`sd-saved-filters-${pageKey}`, JSON.stringify(updated))
}

export function deleteFilter(pageKey: string, id: string): void {
  const existing = getSavedFilters(pageKey)
  localStorage.setItem(`sd-saved-filters-${pageKey}`, JSON.stringify(existing.filter((f) => f.id !== id)))
}

export function countActiveFilters(
  current: Record<string, string | boolean>,
  defaults: Record<string, string | boolean>
): number {
  return Object.keys(defaults).filter((k) => current[k] !== defaults[k]).length
}
