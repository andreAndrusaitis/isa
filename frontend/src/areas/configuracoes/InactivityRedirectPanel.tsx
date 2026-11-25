import { apiErrorMessage } from '@/services/api'
import { toast } from '@/store/toastStore'
import { useState, useEffect } from 'react'
import { adminService } from '@/services/adminService'
import { Btn, Inp, Sel, Toggle, PageHeader, PriorityBadge, AlertModal, SortHeader, Pagination, Loading } from '@/components/ui'
import { useTableSort, PRIORITY_RANK } from '@/hooks/useTableSort'
import { DayPicker } from './parts'

const DAYS = [
  { label: 'Dom', value: 0 },
  { label: 'Seg', value: 1 },
  { label: 'Ter', value: 2 },
  { label: 'Qua', value: 3 },
  { label: 'Qui', value: 4 },
  { label: 'Sex', value: 5 },
  { label: 'Sáb', value: 6 },
]

const TIMEZONES = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Belem',
  'America/Fortaleza',
  'America/Recife',
  'America/Noronha',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Berlin',
  'UTC',
]

export function InactivityRedirectPanel() {
  const [config, setConfig] = useState<any>(null)
  const [queues, setQueues] = useState<any[]>([])
  const [logs, setLogs] = useState<any[]>([])
  const colSort = useTableSort<string>()
  const [logsTotal, setLogsTotal] = useState(0)
  const [logPage, setLogPage] = useState(1)
  const [logPageSize, setLogPageSize] = useState(25)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [triggering, setTriggering] = useState(false)
  const [alert, setAlert] = useState<{ title: string; message: string } | null>(null)

  const loadLogs = async (p = logPage, limit = logPageSize) => {
    try {
      const logData = await adminService.getInactivityLogs({ page: p, limit })
      setLogs(logData.items ?? [])
      setLogsTotal(logData.total ?? 0)
    } catch (err) {
      console.error('[InactivityRedirectPanel] Erro ao carregar logs:', err)
    }
  }

  const handlePageChange = (newPage: number) => {
    setLogPage(newPage)
    loadLogs(newPage, logPageSize)
  }

  const handlePageSizeChange = (newSize: number) => {
    setLogPageSize(newSize)
    setLogPage(1)
    loadLogs(1, newSize)
  }

  const loadData = async () => {
    setLoading(true)
    try {
      const [cfg, qData, logData] = await Promise.all([
        adminService.getInactivityConfig(),
        adminService.getQueues(),
        adminService.getInactivityLogs({ page: logPage, limit: logPageSize }),
      ])
      // Normalize working_days: Prisma binary engine may return Int[] as object {"0":1,...}
      if (cfg && cfg.working_days && !Array.isArray(cfg.working_days)) {
        cfg.working_days = Object.values(cfg.working_days)
      }
      setConfig(cfg)
      setQueues(qData)
      setLogs(logData.items ?? [])
      setLogsTotal(logData.total ?? 0)
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível carregar as configurações de redirecionamento.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const toggleDay = (day: number) => {
    const days: number[] = config.working_days ?? []
    const next = days.includes(day) ? days.filter((d: number) => d !== day) : [...days, day].sort()
    setConfig({ ...config, working_days: next })
  }

  const save = async () => {
    if ((config.working_days ?? []).length === 0) {
      return setAlert({ title: 'Configuração inválida', message: 'Selecione pelo menos 1 dia útil.' })
    }
    const [sh, sm] = config.business_hours_start.split(':').map(Number)
    const [eh, em] = config.business_hours_end.split(':').map(Number)
    if (sh * 60 + sm >= eh * 60 + em) {
      return setAlert({ title: 'Configuração inválida', message: 'Horário de início deve ser anterior ao horário de fim.' })
    }
    setSaving(true)
    try {
      const updated = await adminService.updateInactivityConfig(config)
      setConfig(updated)
      setAlert({ title: 'Salvo', message: 'Configurações de redirecionamento atualizadas com sucesso.' })
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível salvar as configurações de redirecionamento.'))
    } finally {
      setSaving(false)
    }
  }

  const trigger = async () => {
    setTriggering(true)
    try {
      const result = await adminService.triggerInactivityJob()
      const s = result?.stats
      const msg = s
        ? `Verificados: ${s.checked} chamados — Redirecionados: ${s.redirected} — Dentro do prazo: ${s.skipped}`
        : 'Job executado. Verifique os logs abaixo.'
      setAlert({ title: 'Job executado', message: msg })
      await loadData()
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível executar o redirecionamento por inatividade.'))
    } finally {
      setTriggering(false)
    }
  }

  if (loading || !config) {
    return (
      <Loading />
    )
  }

  return (
    <div className="cfg-page">
      <PageHeader
        title="Inatividade"
        subtitle="Atribui a um analista da fila (por sorteio) os chamados abertos sem analista em que ninguém da equipe atuou. Pendentes não entram."
      />

      <div className="cfg-body">
        <div className="cfg-settings">
          <div className="setting">
            <div>Status do job<small>Executa a cada 15 minutos dentro do horário comercial.</small></div>
            <div className="cfg-inline">
              <Toggle value={config.enabled} onChange={enabled => setConfig({ ...config, enabled })} label="Status do job" />
              <span style={{ fontSize: 14 }}>{config.enabled ? 'Ativo' : 'Desativado'}</span>
            </div>
          </div>
          <div className="setting">
            <div>Horas úteis sem atendimento<small>Contadas desde a abertura.</small></div>
            <div>
              <Inp
                type="number"
                min={1}
                max={168}
                aria-label="Horas úteis sem atendimento"
                value={config.inactivity_hours}
                onChange={e => setConfig({ ...config, inactivity_hours: parseInt(e.target.value) || 24 })}
                style={{ width: 120 }}
              />
            </div>
          </div>
          <div className="setting">
            <div>Subir prioridade para<small>Nunca rebaixa.</small></div>
            <Sel aria-label="Subir prioridade para" value={config.target_priority} onChange={e => setConfig({ ...config, target_priority: e.target.value })}>
              <option value="low">Baixa</option>
              <option value="medium">Média</option>
              <option value="high">Alta</option>
            </Sel>
          </div>
          <div className="setting">
            <div>Fila VIP (evidência)<small>Opcional.</small></div>
            <Sel aria-label="Fila VIP" value={config.vip_queue_id ?? ''} onChange={e => setConfig({ ...config, vip_queue_id: e.target.value || null })}>
              <option value="">Manter na fila original</option>
              {queues.map((q: any) => <option key={q.id} value={q.id}>{q.name}</option>)}
            </Sel>
          </div>
          <div className="setting">
            <div>Horário comercial<small>Início, fim e dias úteis em que o prazo corre.</small></div>
            <div>
              <div className="cfg-inline" style={{ flexWrap: 'nowrap', marginBottom: 14 }}>
                <Inp type="time" aria-label="Início" value={config.business_hours_start} onChange={e => setConfig({ ...config, business_hours_start: e.target.value })} />
                <span style={{ fontSize: 14, color: 'var(--text-3)' }}>às</span>
                <Inp type="time" aria-label="Fim" value={config.business_hours_end} onChange={e => setConfig({ ...config, business_hours_end: e.target.value })} />
              </div>
              <DayPicker days={DAYS} value={config.working_days ?? []} onToggle={toggleDay} />
            </div>
          </div>
          <div className="setting">
            <div>Fuso horário</div>
            <Sel aria-label="Fuso horário" value={config.timezone} onChange={e => setConfig({ ...config, timezone: e.target.value })}>
              {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </Sel>
          </div>
        </div>
        <div className="cfg-save">
          <div>
            <Btn onClick={save} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Btn>
            <Btn variant="ghost" onClick={trigger} disabled={triggering}>{triggering ? 'Executando...' : 'Disparar agora'}</Btn>
          </div>
        </div>

        <section className="cfg-section">
          <div className="cfg-section-head">
            <div>
              <h2>Histórico de redirecionamentos</h2>
              <p className="cfg-sub">{logsTotal} registro(s) total</p>
            </div>
            <div className="cfg-inline">
              <Pagination
                variant="toolbar"
                page={logPage}
                pageSize={logPageSize}
                total={logsTotal}
                onPageChange={handlePageChange}
                onPageSizeChange={handlePageSizeChange}
                label="registros"
              />
              <Btn variant="ghost" size="xs" onClick={loadData}>Atualizar</Btn>
            </div>
          </div>

          {logs.length === 0 ? (
            <div className="cfg-empty">Nenhum redirecionamento registrado ainda.</div>
          ) : (
            <div className="cfg-scroll">
              <table className="table">
                <thead>
                  <tr>
                    {['Chamado', 'Agente anterior', 'Novo agente', 'Prioridade', 'Fila original', 'Data'].map(h => (
                      <th key={h}><SortHeader label={h} {...colSort.header(h)} /></th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {colSort.apply(logs, {
                    'Chamado': (log: any) => log.ticket?.id,
                    'Agente anterior': (log: any) => log.previous_assigned_to?.name,
                    'Novo agente': (log: any) => log.new_assigned_to?.name,
                    'Prioridade': (log: any) => PRIORITY_RANK[log.new_priority],
                    'Fila original': (log: any) => log.original_queue,
                    'Data': (log: any) => new Date(log.created_at),
                  }).map((log: any) => (
                    <tr key={log.id}>
                      <td>{log.ticket?.id}</td>
                      <td>{log.previous_assigned_to?.name ?? '—'}</td>
                      <td className="cfg-strong">{log.new_assigned_to?.name ?? '—'}</td>
                      <td><PriorityBadge priority={log.new_priority} /></td>
                      <td>{log.original_queue}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{new Date(log.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {alert && (
        <AlertModal isOpen onClose={() => setAlert(null)} title={alert.title} message={alert.message} />
      )}
    </div>
  )
}
