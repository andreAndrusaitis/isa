import { apiErrorMessage } from '@/services/api'
import { toast } from '@/store/toastStore'
import { useState, useEffect } from 'react'
import { adminService } from '@/services/adminService'
import { Btn, Inp, PageHeader, AlertModal, ConfirmModal, Pagination, Toggle, CopyableId, Loading } from '@/components/ui'
import './configuracoes.css'

const fmt = (d?: string | null) => d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'

export function AutoClosePanel() {
  const [config, setConfig] = useState<any>(null)
  const [logs, setLogs] = useState<any[]>([])
  const [logsTotal, setLogsTotal] = useState(0)
  const [logPage, setLogPage] = useState(1)
  const [logPageSize, setLogPageSize] = useState(25)
  const [saving, setSaving] = useState(false)
  const [triggering, setTriggering] = useState(false)
  const [confirmRun, setConfirmRun] = useState(false)
  const [alert, setAlert] = useState<{ title: string; message: string } | null>(null)

  const loadLogs = async (p = logPage, limit = logPageSize) => {
    const data = await adminService.getAutoCloseLogs({ page: p, limit })
    setLogs(data.items ?? [])
    setLogsTotal(data.total ?? 0)
  }

  useEffect(() => {
    adminService.getAutoCloseConfig().then(setConfig)
    loadLogs(1)
  }, [])

  const save = async () => {
    const days = Number(config.inactive_days)
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      return setAlert({ title: 'Configuração inválida', message: 'Informe um número inteiro de dias entre 1 e 90.' })
    }
    setSaving(true)
    try {
      setConfig(await adminService.updateAutoCloseConfig({ enabled: config.enabled, inactive_days: days }))
      setAlert({ title: 'Salvo', message: 'Regra de fechamento automático atualizada.' })
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível salvar a regra de fechamento automático.'))
    } finally {
      setSaving(false)
    }
  }

  const trigger = async () => {
    setConfirmRun(false)
    setTriggering(true)
    try {
      const { stats } = await adminService.triggerAutoCloseJob()
      setAlert({ title: 'Job executado', message: `Elegíveis: ${stats.checked} — Fechados: ${stats.closed}` })
      setLogPage(1)
      await loadLogs(1)
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível executar o fechamento automático.'))
    } finally {
      setTriggering(false)
    }
  }

  if (!config) {
    return <Loading />
  }

  return (
    <div className="cfg-page">
      <PageHeader
        title="Fechamento automático"
        subtitle="Chamados Resolvidos sem resposta do cliente passam para Fechado"
      />

      <div className="cfg-body">
        <div className="cfg-settings">
          <div className="setting">
            <div>Regra de fechamento<small>Todo dia à 01:00, fecha chamados em Resolvido que não foram atualizados no período e não receberam mensagem do cliente.</small></div>
            <div className="cfg-inline">
              <Toggle value={config.enabled} onChange={v => setConfig({ ...config, enabled: v })} label="Ativar fechamento automático" />
              <span style={{ fontSize: 14 }}>{config.enabled ? 'Ativo' : 'Desativado'}</span>
            </div>
          </div>
          <div className="setting">
            <div>Dias sem resposta para fechar<small>Dias corridos, entre 1 e 90.</small></div>
            <div>
              <Inp
                type="number"
                min={1}
                max={90}
                aria-label="Dias sem resposta para fechar"
                value={config.inactive_days}
                onChange={e => setConfig({ ...config, inactive_days: e.target.value === '' ? '' : parseInt(e.target.value) })}
                style={{ width: 120 }}
              />
            </div>
          </div>
        </div>
        <div className="cfg-save">
          <div>
            <Btn onClick={save} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Btn>
            <Btn variant="ghost" onClick={() => setConfirmRun(true)} disabled={triggering || !config.enabled}>{triggering ? 'Executando...' : 'Executar agora'}</Btn>
          </div>
        </div>

        <section className="cfg-section">
          <div className="cfg-section-head">
            <div>
              <h2>Histórico de fechamentos automáticos</h2>
              <p className="cfg-sub">{logsTotal} registro(s) total</p>
            </div>
            <div className="cfg-inline">
              <Pagination
                variant="toolbar"
                page={logPage}
                pageSize={logPageSize}
                total={logsTotal}
                onPageChange={p => { setLogPage(p); loadLogs(p) }}
                onPageSizeChange={s => { setLogPageSize(s); setLogPage(1); loadLogs(1, s) }}
                label="registros"
              />
              <Btn variant="ghost" size="xs" onClick={() => loadLogs()}>Atualizar</Btn>
            </div>
          </div>

          {logs.length === 0 ? (
            <div className="cfg-empty">Nenhum chamado fechado automaticamente ainda.</div>
          ) : (
            <div className="cfg-scroll">
              <table className="table">
                <thead>
                  <tr>{['Chamado', 'Título', 'Empresa', 'Analista', 'Resolvido em', 'Fechado em', 'Regra'].map(h => <th key={h}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {logs.map((log: any) => (
                    <tr key={log.id}>
                      <td><CopyableId id={log.ticket_id} size="xs" /></td>
                      <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={log.ticket?.title}>{log.ticket?.title ?? '—'}</td>
                      <td>{log.ticket?.org?.name ?? '—'}</td>
                      <td>{log.ticket?.assigned_to?.name ?? '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmt(log.resolved_at)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmt(log.created_at)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{log.inactive_days} dia(s)</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <ConfirmModal
        isOpen={confirmRun}
        onClose={() => setConfirmRun(false)}
        onConfirm={trigger}
        title="Executar fechamento agora?"
        message={`Todos os chamados Resolvidos sem atualização há mais de ${config.inactive_days} dia(s) e sem resposta do cliente serão fechados. Essa ação não pode ser desfeita.`}
        confirmText="Executar"
        variant="warning"
      />
      {alert && <AlertModal isOpen onClose={() => setAlert(null)} title={alert.title} message={alert.message} />}
    </div>
  )
}
