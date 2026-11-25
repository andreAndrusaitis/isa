import { useState, useEffect } from 'react'
import { adminService } from '@/services/adminService'
import { PageHeader, AlertModal, Toggle, Loading } from '@/components/ui'
import './configuracoes.css'

const TYPE_INFO: Record<string, { label: string; description: string; lockedOn: boolean }> = {
  incident: { label: 'Incidente', description: 'Todo chamado nasce como Incidente. Não pode ser desabilitado.', lockedOn: true },
  request: { label: 'Requisição', description: 'Pedidos padrão (acesso, instalação, informação).', lockedOn: false },
  problem: { label: 'Problema', description: 'Causa raiz por trás de incidentes recorrentes.', lockedOn: false },
  change: { label: 'Mudança', description: 'Alteração planejada em sistema/infraestrutura.', lockedOn: false },
}

export function TicketTypesPanel() {
  const [configs, setConfigs] = useState<{ type: string; enabled: boolean }[]>([])
  const [loading, setLoading] = useState(true)
  const [alert, setAlert] = useState<{ title: string; message: string } | null>(null)

  const load = () => {
    setLoading(true)
    adminService.getTicketTypeConfigs()
      .then(setConfigs)
      .catch(err => console.error('[TicketTypesPanel] Erro ao carregar tipos:', err))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const toggle = async (type: string, current: boolean) => {
    try {
      const updated = await adminService.updateTicketTypeConfig(type, !current)
      setConfigs(cs => cs.map(c => c.type === type ? updated : c))
    } catch (err: any) {
      setAlert({ title: 'Erro', message: err?.response?.data?.error || 'Não foi possível alterar o tipo.' })
    }
  }

  if (loading) {
    return <Loading />
  }

  return (
    <div className="cfg-page">
      <PageHeader title="Tipos de chamado" subtitle="Habilite ou desabilite tipos de chamado globalmente" />
      <div className="cfg-body">
        <div className="cfg-settings">
          {configs.map(config => {
            const info = TYPE_INFO[config.type] ?? { label: config.type, description: '', lockedOn: false }
            return (
              <div key={config.type} className="setting">
                <div className="cfg-strong">{info.label}</div>
                <div style={{ display: 'flex', gap: 20 }}>
                  <Toggle value={config.enabled} onChange={() => toggle(config.type, config.enabled)} disabled={info.lockedOn} label={info.label} />
                  <span style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.4 }}>{info.description}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {alert && <AlertModal isOpen onClose={() => setAlert(null)} title={alert.title} message={alert.message} />}
    </div>
  )
}
