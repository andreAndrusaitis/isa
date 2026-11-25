import { useState } from 'react'
import { PageHeader } from '@/components/ui'
import { EmailLogsPanel } from './EmailLogsPanel'
import { InboundEmailsPanel } from './InboundEmailsPanel'
import { EmailSettingsPanel } from './EmailSettingsPanel'
import { EmailBlocksPanel } from './EmailBlocksPanel'
import './admin.css'

type Tab = 'sent' | 'inbound' | 'blocks' | 'settings'

const TABS: [Tab, string][] = [['sent', 'Envios'], ['inbound', 'Recebidos'], ['blocks', 'Bloqueios'], ['settings', 'Configuração']]

/** Admin → E-mail: o que o sistema enviou, o que chegou na caixa de atendimento, remetentes bloqueados e a configuração. */
export function EmailAdminPanel({ onOpenTicket }: { onOpenTicket?: (ticketId: string) => void }) {
  const [tab, setTab] = useState<Tab>('sent')

  // Setas trocam de aba (padrão de tablist).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const i = TABS.findIndex(([t]) => t === tab)
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0]
    setTab(next)
    document.getElementById(`email-tab-${next}`)?.focus()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <PageHeader title="E-mail" subtitle="Envios do sistema, e-mails recebidos na caixa de atendimento, remetentes bloqueados e configuração" />
      <div role="tablist" aria-label="Seções de e-mail" onKeyDown={onKeyDown} className="subtabs" style={{ padding: '0 var(--page-gutter)', marginLeft: -14, flexShrink: 0 }}>
        {TABS.map(([t, label]) => (
          <button key={t} id={`email-tab-${t}`} role="tab" type="button" aria-selected={tab === t} aria-controls={`email-panel-${t}`}
            tabIndex={tab === t ? 0 : -1} onClick={() => setTab(t)}>{label}</button>
        ))}
      </div>
      <div role="tabpanel" id={`email-panel-${tab}`} aria-labelledby={`email-tab-${tab}`} className="adm">
        {tab === 'sent' && <EmailLogsPanel showHeader={false} onOpenTicket={onOpenTicket} />}
        {tab === 'inbound' && <InboundEmailsPanel onOpenTicket={onOpenTicket} />}
        {tab === 'blocks' && <EmailBlocksPanel />}
        {tab === 'settings' && <EmailSettingsPanel />}
      </div>
    </div>
  )
}
