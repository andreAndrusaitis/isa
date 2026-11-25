import { useState, useEffect, useMemo } from 'react'
import { adminService } from '@/services/adminService'
import { useAuthStore } from '@/store/auth'
import { Btn, Field, Figures, Inp, Sel, PageHeader, AlertModal, StatCard, Loading } from '@/components/ui'
import { DayPicker } from './parts'

// Dias da semana (ISO: 1=Segunda … 7=Domingo)
const DAYS = [
  { label: 'Seg', full: 'Segunda-feira', value: 1 },
  { label: 'Ter', full: 'Terça-feira', value: 2 },
  { label: 'Qua', full: 'Quarta-feira', value: 3 },
  { label: 'Qui', full: 'Quinta-feira', value: 4 },
  { label: 'Sex', full: 'Sexta-feira', value: 5 },
  { label: 'Sáb', full: 'Sábado', value: 6 },
  { label: 'Dom', full: 'Domingo', value: 7 },
]

const TIMEZONE_OPTIONS = [
  { value: 'America/Sao_Paulo', label: 'America/Sao_Paulo (Horário de Brasília - UTC-3)' },
  { value: 'America/Manaus', label: 'America/Manaus (Amazonas - UTC-4)' },
  { value: 'America/Belem', label: 'America/Belem (Pará - UTC-3)' },
  { value: 'America/Fortaleza', label: 'America/Fortaleza (Nordeste - UTC-3)' },
  { value: 'America/Recife', label: 'America/Recife (Pernambuco - UTC-3)' },
  { value: 'America/Noronha', label: 'America/Noronha (Fernando de Noronha - UTC-2)' },
  { value: 'UTC', label: 'UTC (Tempo Universal Coordenado)' },
]

const HOLIDAY_NAMES: Record<string, string> = {
  '01-01': 'Confraternização Universal (Ano Novo)',
  '04-21': 'Tiradentes',
  '05-01': 'Dia do Trabalhador',
  '09-07': 'Independência do Brasil',
  '10-12': 'Nossa Senhora Aparecida',
  '11-02': 'Finados',
  '11-15': 'Proclamação da República',
  '11-20': 'Dia da Consciência Negra',
  '12-25': 'Natal',
}

function getHolidayLabel(dateStr: string): string {
  const mmdd = dateStr.slice(5)
  if (HOLIDAY_NAMES[mmdd]) return HOLIDAY_NAMES[mmdd]
  const [, mStr, dStr] = dateStr.split('-')
  const month = parseInt(mStr, 10)
  const day = parseInt(dStr, 10)
  if (month === 2 || (month === 3 && day <= 10)) return 'Carnaval'
  if (month === 3 || month === 4) return 'Sexta-feira Santa / Páscoa'
  if (month === 5 || month === 6) return 'Corpus Christi'
  return 'Feriado Nacional'
}

function parseMinutes(timeStr: string): number {
  if (!timeStr) return 0
  const [h, m] = timeStr.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

export function BusinessHoursPanel() {
  const currentUser = useAuthStore(s => s.user)
  const isAdmin = currentUser?.role === 'admin'

  const [initialConfig, setInitialConfig] = useState<any>(null)
  const [config, setConfig] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [alert, setAlert] = useState<{ title: string; message: string } | null>(null)
  const [saveSuccessNotice, setSaveSuccessNotice] = useState(false)

  const loadData = async () => {
    setLoading(true)
    try {
      const data = await adminService.getBusinessHours()
      const normalized = {
        business_hours_start: data.business_hours_start || '08:00',
        business_hours_end: data.business_hours_end || '18:00',
        working_days: Array.isArray(data.working_days) ? data.working_days : [1, 2, 3, 4, 5],
        timezone: data.timezone || 'America/Sao_Paulo',
        holidays: Array.isArray(data.holidays) ? data.holidays : [],
      }
      setConfig(normalized)
      setInitialConfig(normalized)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Identificação de alterações pendentes
  const isDirty = useMemo(() => {
    if (!config || !initialConfig) return false
    return (
      config.business_hours_start !== initialConfig.business_hours_start ||
      config.business_hours_end !== initialConfig.business_hours_end ||
      config.timezone !== initialConfig.timezone ||
      JSON.stringify(config.working_days?.slice().sort()) !== JSON.stringify(initialConfig.working_days?.slice().sort())
    )
  }, [config, initialConfig])

  const startMinutes = useMemo(() => parseMinutes(config?.business_hours_start), [config?.business_hours_start])
  const endMinutes = useMemo(() => parseMinutes(config?.business_hours_end), [config?.business_hours_end])
  const dailyWorkMinutes = useMemo(() => Math.max(0, endMinutes - startMinutes), [startMinutes, endMinutes])
  const workingDays = useMemo(() => (config?.working_days ?? []) as number[], [config?.working_days])
  const weeklyWorkMinutes = useMemo(() => dailyWorkMinutes * workingDays.length, [dailyWorkMinutes, workingDays])

  const isValidHours = startMinutes < endMinutes
  const hasAtLeastOneDay = workingDays.length > 0

  // Status operacional em Tempo Real
  const operationalStatus = useMemo(() => {
    if (!config) return { isOpen: false, reason: 'Carregando...', localTime: '--:--', ymd: '', currentWeekday: 1 }
    try {
      const now = new Date()
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: config.timezone || 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
      })
      const parts = Object.fromEntries(formatter.formatToParts(now).map(p => [p.type, p.value]))
      const weekdaysMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
      const currentWeekday = weekdaysMap[parts.weekday] || 1
      const ymd = `${parts.year}-${parts.month}-${parts.day}`
      const currentMinutes = parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10)

      const isWorkDay = (config.working_days || []).includes(currentWeekday)
      const isHoliday = (config.holidays || []).includes(ymd)
      const isInWindow = currentMinutes >= startMinutes && currentMinutes < endMinutes

      const isOpen = isWorkDay && !isHoliday && isInWindow

      let reason = ''
      if (isOpen) {
        reason = `Fecha hoje às ${config.business_hours_end}`
      } else if (isHoliday) {
        reason = `Fechado por feriado nacional (${ymd})`
      } else if (!isWorkDay) {
        reason = 'Fechado (fora dos dias de atendimento)'
      } else if (currentMinutes < startMinutes) {
        reason = `Abre hoje às ${config.business_hours_start}`
      } else {
        reason = `Fechado (encerrou às ${config.business_hours_end})`
      }

      return {
        isOpen,
        reason,
        localTime: `${parts.hour}:${parts.minute}`,
        ymd,
        currentWeekday,
      }
    } catch {
      return { isOpen: false, reason: 'Informação indisponível', localTime: '--:--', ymd: '', currentWeekday: 1 }
    }
  }, [config, startMinutes, endMinutes])

  // Próximos feriados nacionais a partir da data de hoje
  const upcomingHolidays = useMemo<{ dateStr: string; formatted: string; label: string; weekdayName: string }[]>(() => {
    if (!config?.holidays?.length) return []
    const todayYmd = operationalStatus.ymd || new Date().toISOString().slice(0, 10)
    return (config.holidays as string[])
      .filter((h: string) => h >= todayYmd)
      .slice(0, 6)
      .map((dateStr: string) => {
        const [year, month, day] = dateStr.split('-')
        const formatted = `${day}/${month}/${year}`
        const label = getHolidayLabel(dateStr)
        const dateObj = new Date(`${dateStr}T12:00:00Z`)
        const weekdayName = dateObj.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' })
        return { dateStr, formatted, label, weekdayName }
      })
  }, [config?.holidays, operationalStatus.ymd])

  const toggleDay = (value: number) => {
    if (!isAdmin) return
    const current: number[] = config.working_days ?? []
    const next = current.includes(value)
      ? current.filter(d => d !== value)
      : [...current, value].sort((a, b) => a - b)
    setConfig({ ...config, working_days: next })
  }

  const setWorkingDaysPreset = (days: number[]) => {
    if (!isAdmin) return
    setConfig({ ...config, working_days: days })
  }

  const discardChanges = () => {
    setConfig(initialConfig)
  }

  const save = async () => {
    if (!isValidHours) {
      return setAlert({
        title: 'Horário inválido',
        message: 'O horário de início deve ser obrigatoriamente anterior ao horário de término.',
      })
    }
    if (!hasAtLeastOneDay) {
      return setAlert({
        title: 'Dias úteis obrigatórios',
        message: 'Selecione ao menos um dia da semana para o funcionamento comercial.',
      })
    }

    setSaving(true)
    try {
      const updated = await adminService.updateBusinessHours({
        business_hours_start: config.business_hours_start,
        business_hours_end: config.business_hours_end,
        working_days: config.working_days,
        timezone: config.timezone,
      })
      const merged = {
        ...updated,
        holidays: config.holidays,
      }
      setConfig(merged)
      setInitialConfig(merged)
      setSaveSuccessNotice(true)
      setTimeout(() => setSaveSuccessNotice(false), 4500)
    } catch (e: any) {
      setAlert({
        title: 'Erro ao salvar',
        message: e?.response?.data?.error || 'Não foi possível salvar a configuração de horário comercial.',
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading || !config) {
    return (
      <Loading label="Carregando parâmetros de horário comercial…" />
    )
  }

  return (
    <div className="cfg-page">
      <PageHeader
        title="Expediente"
        subtitle="Define a janela útil operacional usada pelo motor de cálculo de SLA e primeira resposta"
      />

      <div className="cfg-body">
        {saveSuccessNotice && (
          <div className="notice" role="status" style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 24 }}>
            <span>Horário comercial atualizado com sucesso! Novos chamados já utilizarão estes parâmetros.</span>
            <button type="button" className="cfg-link" onClick={() => setSaveSuccessNotice(false)}>Fechar</button>
          </div>
        )}
        {!isAdmin && (
          <div className="notice" style={{ marginBottom: 24 }}>Você está no modo de visualização. Apenas administradores do sistema podem modificar as regras de horário comercial.</div>
        )}

        <section className="cfg-section" style={{ marginTop: 0 }}>
          <div className="cfg-section-head"><h2>Régua visual semanal</h2></div>
          <div className="cfg-ruler">
            <div className="cfg-ruler-row">
              <span />
              <div className="cfg-ruler-hours"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span></div>
              <span />
            </div>
            {DAYS.map(d => {
              const open = workingDays.includes(d.value) && isValidHours
              const isToday = operationalStatus.currentWeekday === d.value
              return (
                <div key={d.value} className="cfg-ruler-row" data-off={!open || undefined} data-today={isToday || undefined}>
                  <span>{d.label}{isToday && ', hoje'}</span>
                  <div className="cfg-ruler-track">
                    {open && <span style={{ left: `${(startMinutes / 1440) * 100}%`, width: `${((endMinutes - startMinutes) / 1440) * 100}%` }} />}
                  </div>
                  <span>{open ? `${config.business_hours_start} às ${config.business_hours_end}` : 'Sem expediente'}</span>
                </div>
              )
            })}
          </div>
          <Figures style={{ marginTop: 32 }}>
            <StatCard label="Status operacional" value={operationalStatus.isOpen ? 'Aberto' : 'Fechado'} sub={`${operationalStatus.localTime} no fuso local. ${operationalStatus.reason}`} />
            <StatCard label="Janela diária" value={isValidHours ? formatDuration(dailyWorkMinutes) : 'Inválida'} sub={`${config.business_hours_start} às ${config.business_hours_end}`} />
            <StatCard label="Cobertura semanal" value={formatDuration(weeklyWorkMinutes)} sub={`${workingDays.length} dias de expediente por semana`} />
            <StatCard label="Feriados nacionais" value={config.holidays?.length || 0} sub="Pausam o SLA automaticamente" />
          </Figures>
        </section>

        <section className="cfg-section">
          <div className="cfg-section-head">
            <h2>Parâmetros de horário</h2>
            {isDirty && <span style={{ fontSize: 13, color: 'var(--warning)' }}>Alterações pendentes</span>}
          </div>
          <div className="cfg-settings">
            <div className="setting">
              <div>Expediente<small>Prazos de 1ª resposta e resolução só correm dentro desta janela, nos dias marcados. Noites, outros dias e feriados nacionais (inclusive os móveis) param o cronômetro.</small></div>
              <div>
                <div className="cfg-pair">
                  <Field label="Início do expediente" required>
                    <Inp type="time" disabled={!isAdmin} value={config.business_hours_start} onChange={e => setConfig({ ...config, business_hours_start: e.target.value })} />
                  </Field>
                  <Field label="Fim do expediente" required>
                    <Inp type="time" disabled={!isAdmin} value={config.business_hours_end} onChange={e => setConfig({ ...config, business_hours_end: e.target.value })} />
                  </Field>
                </div>
                {!isValidHours && <div className="cfg-error" style={{ marginTop: 8 }}>O horário de início deve ser anterior ao de término.</div>}
              </div>
            </div>

            <div className="setting">
              <div>Dias úteis de atendimento<small>{workingDays.length} {workingDays.length === 1 ? 'dia selecionado' : 'dias selecionados'}</small></div>
              <div>
                <DayPicker days={DAYS} value={workingDays} onToggle={toggleDay} disabled={!isAdmin} />
                {isAdmin && (
                  <div className="cfg-inline" style={{ marginTop: 8, gap: 18 }}>
                    <button type="button" className="cfg-link" onClick={() => setWorkingDaysPreset([1, 2, 3, 4, 5])}>Seg a Sex</button>
                    <button type="button" className="cfg-link" onClick={() => setWorkingDaysPreset([1, 2, 3, 4, 5, 6, 7])}>Todos</button>
                    <button type="button" className="cfg-link" onClick={() => setWorkingDaysPreset([])}>Limpar</button>
                  </div>
                )}
                {!hasAtLeastOneDay && <div className="cfg-error" style={{ marginTop: 8 }}>Selecione ao menos um dia de expediente.</div>}
              </div>
            </div>

            <div className="setting">
              <div>Fuso horário operacional<small>Fuso em que abertura e vencimento dos chamados são contados.</small></div>
              <Sel disabled={!isAdmin} aria-label="Fuso horário operacional" value={config.timezone} onChange={e => setConfig({ ...config, timezone: e.target.value })}>
                {TIMEZONE_OPTIONS.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
              </Sel>
            </div>
          </div>
          {isAdmin && (
            <div className="cfg-save">
              <div>
                <Btn onClick={save} disabled={saving || !isDirty}>{saving ? 'Salvando...' : 'Salvar alterações'}</Btn>
                {isDirty && <Btn variant="ghost" onClick={discardChanges} disabled={saving} title="Descartar todas as alterações não salvas">Descartar</Btn>}
              </div>
            </div>
          )}
        </section>

        <section className="cfg-section">
          <div className="cfg-settings">
            <div className="setting">
              <div>
                <h2>Próximos feriados nacionais</h2>
                <small>O cronômetro do SLA fica parado o dia inteiro.</small>
              </div>
              {upcomingHolidays.length === 0 ? (
                <div className="cfg-off">Nenhum feriado nacional futuro encontrado no catálogo.</div>
              ) : (
                <ul className="cfg-lines cfg-wide" style={{ borderTop: 0 }}>
                  {upcomingHolidays.map(h => (
                    <li key={h.dateStr} style={{ display: 'grid', gridTemplateColumns: '150px minmax(0, 1fr)', gap: 16, padding: '9px 0', fontSize: 14 }}>
                      <span style={{ color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>{h.weekdayName} {h.formatted}</span>
                      <span>{h.label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      </div>

      {alert && <AlertModal isOpen onClose={() => setAlert(null)} title={alert.title} message={alert.message} />}
    </div>
  )
}
