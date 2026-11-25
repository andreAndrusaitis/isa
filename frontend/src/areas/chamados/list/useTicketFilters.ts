/**
 * Estado dos filtros da lista de chamados da equipe, por perfil. Antes cada
 * página (AgentPage, SupervisorPage) tinha a sua cópia; as diferenças de hoje
 * estão no PROFILES abaixo. A chave dos filtros salvos ('agent' | 'supervisor')
 * e o formato do que é salvo NÃO podem mudar: as pessoas perderiam os filtros.
 */
import { useState } from 'react'
import { getSavedFilters, saveFilter, deleteFilter, countActiveFilters, type SavedFilter } from '@/utils/filterStorage'
import { ASSIGNEE_NONE } from '@/components/filters/TicketOwnerFilters'

export type TicketFilterProfile = 'agent' | 'mgmt'

interface Profile {
  storageKey: string
  defaults: { fStatus: string; sortBy: string }
  /** Campos extras do perfil (fila e "SLA vencido" só na gestão). */
  queueAndOverdue: boolean
  /** Converte filtros salvos antigos ("Sem analista" → "Sem responsável"). */
  legacyUnassigned: boolean
}

export const PROFILES: Record<TicketFilterProfile, Profile> = {
  agent: { storageKey: 'agent', defaults: { fStatus: 'active', sortBy: 'urgency' }, queueAndOverdue: false, legacyUnassigned: false },
  mgmt: { storageKey: 'supervisor', defaults: { fStatus: 'all', sortBy: 'sla' }, queueAndOverdue: true, legacyUnassigned: true },
}

export function useTicketFilters(profile: TicketFilterProfile) {
  const p = PROFILES[profile]
  const [search, setSearch] = useState('')
  const [fStatus, setFStatus] = useState(p.defaults.fStatus)
  const [fPriority, setFPriority] = useState('all')
  const [fType, setFType] = useState('all')
  const [fCategory, setFCategory] = useState('all')
  const [fOrg, setFOrg] = useState('all')
  const [fQueue, setFQueue] = useState('all')
  const [fAgent, setFAgent] = useState('all')
  const [fOverdue, setFOverdue] = useState(false)
  const [sortBy, setSortBy] = useState(p.defaults.sortBy)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() => getSavedFilters(p.storageKey))
  const [activeSavedFilter, setActiveSavedFilter] = useState<SavedFilter | null>(null)

  // O que conta como "filtro ativo" e o que é salvo: o mesmo conjunto de campos de hoje.
  const current: Record<string, string | boolean> = p.queueAndOverdue
    ? { fStatus, fPriority, fType, fCategory, fOrg, fQueue, fAgent, sortBy, dateFrom, dateTo, fOverdue }
    : { fStatus, fPriority, fType, fCategory, fOrg, fAgent, sortBy, dateFrom, dateTo }
  const defaults: Record<string, string | boolean> = p.queueAndOverdue
    ? { fStatus: p.defaults.fStatus, fPriority: 'all', fType: 'all', fCategory: 'all', fOrg: 'all', fQueue: 'all', fAgent: 'all', sortBy: p.defaults.sortBy, dateFrom: '', dateTo: '', fOverdue: false }
    : { fStatus: p.defaults.fStatus, fPriority: 'all', fType: 'all', fCategory: 'all', fOrg: 'all', fAgent: 'all', sortBy: p.defaults.sortBy, dateFrom: '', dateTo: '' }
  const activeFilterCount = countActiveFilters(current, defaults)

  const handleClear = () => {
    setFStatus(p.defaults.fStatus); setFPriority('all'); setFType('all'); setFCategory('all'); setFOrg('all')
    if (p.queueAndOverdue) setFQueue('all')
    setFAgent('all'); setSortBy(p.defaults.sortBy); setDateFrom(''); setDateTo('')
    if (p.queueAndOverdue) setFOverdue(false)
    setActiveSavedFilter(null)
  }

  const handleSelectSaved = (sf: SavedFilter) => {
    const f = sf.filters
    if (f.fStatus !== undefined) setFStatus(f.fStatus as string)
    if (f.fPriority !== undefined) setFPriority(f.fPriority as string)
    if (f.fType !== undefined) setFType(f.fType as string)
    if (f.fCategory !== undefined) setFCategory(f.fCategory as string)
    if (f.fOrg !== undefined) setFOrg(f.fOrg as string)
    if (p.queueAndOverdue && f.fQueue !== undefined) setFQueue(f.fQueue as string)
    if (p.legacyUnassigned) {
      // Filtros salvos antigos: checkbox "Sem analista" vira a opção "Sem responsável"
      const agents = [f.fAgent, f.fUnassigned ? ASSIGNEE_NONE : ''].filter(v => v && v !== 'all')
      setFAgent(agents.length ? agents.join(',') : 'all')
    } else {
      setFAgent((f.fAgent as string) ?? 'all')
    }
    if (f.sortBy !== undefined) setSortBy(f.sortBy as string)
    if (f.dateFrom !== undefined) setDateFrom(f.dateFrom as string)
    if (f.dateTo !== undefined) setDateTo(f.dateTo as string)
    if (p.queueAndOverdue && f.fOverdue !== undefined) setFOverdue(f.fOverdue as boolean)
    setActiveSavedFilter(sf)
  }

  const handleSaveFilter = (name: string) => {
    const sf: SavedFilter = { id: crypto.randomUUID(), name, filters: current }
    saveFilter(p.storageKey, sf)
    setSavedFilters(getSavedFilters(p.storageKey))
  }

  const handleDeleteSaved = (id: string) => {
    deleteFilter(p.storageKey, id)
    setSavedFilters(getSavedFilters(p.storageKey))
    if (activeSavedFilter?.id === id) setActiveSavedFilter(null)
  }

  return {
    profile,
    search, setSearch, fStatus, setFStatus, fPriority, setFPriority, fType, setFType, fCategory, setFCategory,
    fOrg, setFOrg, fQueue, setFQueue, fAgent, setFAgent, fOverdue, setFOverdue, sortBy, setSortBy,
    dateFrom, setDateFrom, dateTo, setDateTo, filterOpen, setFilterOpen,
    savedFilters, activeSavedFilter, setActiveSavedFilter, activeFilterCount,
    handleClear, handleSelectSaved, handleSaveFilter, handleDeleteSaved,
  }
}

export type TicketFilters = ReturnType<typeof useTicketFilters>
