import { useEffect, useState } from 'react'
import { adminService } from '@/services/adminService'
import { Btn, Card, EmptyState, Loading } from '@/components/ui'
import { SettingRow } from './SettingRow'

// Só leitura: a configuração vem das variáveis de ambiente do backend (MAIL_GRAPH_*,
// MAIL_INBOUND_*, ACS). Nenhum segredo chega aqui — só IDs públicos e a validade do certificado.

const fmtDate = (d: string) => new Date(d).toLocaleDateString('pt-BR')
const fmtDateTime = (d: string) => new Date(d).toLocaleString('pt-BR')

function certStatus(validTo: string): { label: string; color?: string } {
  const days = Math.floor((new Date(validTo).getTime() - Date.now()) / 86_400_000)
  if (days < 0) return { label: 'Vencido', color: 'var(--danger)' }
  if (days <= 90) return { label: `Vence em ${days} dias`, color: 'var(--warning)' }
  return { label: `Válido (${days} dias)` }
}

const PROVIDER: Record<string, { label: string; color?: string; desc: string }> = {
  graph: { label: 'Caixa de atendimento', desc: 'Os e-mails saem pela caixa do M365. Se ela falhar, o ACS entrega como reserva.' },
  acs: { label: 'ACS (reserva)', color: 'var(--warning)', desc: 'A caixa de atendimento não está configurada: os e-mails saem pelo remetente genérico do Azure, sem permitir resposta.' },
  none: { label: 'Nenhum', color: 'var(--danger)', desc: 'Nenhum provedor configurado: os e-mails não são enviados.' },
}

export function EmailSettingsPanel() {
  const [s, setS] = useState<any>(null)
  const [error, setError] = useState('')
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<any>(null)

  useEffect(() => {
    adminService.getEmailSettings().then(setS).catch(() => setError('Não foi possível carregar a configuração de e-mail.'))
  }, [])

  const runTest = async () => {
    setTesting(true)
    setTest(null)
    try { setTest(await adminService.testEmailConnection()) }
    catch { setTest({ ok: false, error: 'Falha ao chamar o teste.' }) }
    finally { setTesting(false) }
  }

  if (error) return <EmptyState title="Erro" desc={error} />
  if (!s) return <Loading label="Carregando configuração…" />

  const provider = PROVIDER[s.provider] ?? PROVIDER.none
  const cert = s.graph.certificate
  const cs = cert ? certStatus(cert.validTo) : null
  const stuck = s.inbound.enabled && !s.inbound.running

  return (
    <div className="adm-body" style={{ paddingTop: 20 }}>
      <Card className="adm-section" role="region" aria-labelledby="email-cfg-send">
        <h2 id="email-cfg-send" className="adm-h">Envio</h2>
        <SettingRow label="Provedor" help={provider.desc}><span style={{ color: provider.color }}>{provider.label}</span></SettingRow>
        <SettingRow label="Caixa de atendimento">{s.mailbox ?? '—'}</SettingRow>
        <SettingRow label="Remetente de reserva (ACS)">{s.acs.configured ? s.acs.sender : 'Não configurado'}</SettingRow>
        <SettingRow label="Últimas 24h">
          {Object.keys(s.last24h).length === 0 ? 'Nenhum envio'
            : `${s.last24h.SUCCESS ?? 0} enviados · ${s.last24h.FAILED ?? 0} falhas${s.last24h.SKIPPED_ACS_NOT_CONFIGURED ? ` · ${s.last24h.SKIPPED_ACS_NOT_CONFIGURED} não enviados` : ''}`}
        </SettingRow>
      </Card>

      <Card className="adm-section" role="region" aria-labelledby="email-cfg-inbound">
        <h2 id="email-cfg-inbound" className="adm-h">Recebimento (leitura da caixa)</h2>
        <SettingRow label="Leitura" help="Quando ligada, a caixa é lida a cada minuto: e-mail novo vira chamado e a resposta do cliente entra no próprio chamado. Só um sistema deve ler a caixa.">
          <span style={stuck ? { color: 'var(--danger)' } : undefined}>{s.inbound.running ? 'Ligada' : stuck ? 'Ligada, mas parada' : 'Desligada'}</span>
          {stuck && <span className="adm-error">A leitura está marcada como ligada, mas não iniciou: falta a caixa configurada ou a data de corte (MAIL_INBOUND_SINCE).</span>}
        </SettingRow>
        <SettingRow label="E-mails lidos a partir de">{s.inbound.since ? fmtDateTime(s.inbound.since) : 'Sem data de corte'}</SettingRow>
        <SettingRow label="Categoria dos chamados por e-mail">{s.inbound.categoryConfigured ? 'Configurada' : 'Sem categoria (a triagem define)'}</SettingRow>
      </Card>

      <Card className="adm-section" role="region" aria-labelledby="email-cfg-cert">
        <h2 id="email-cfg-cert" className="adm-h">Aplicativo e certificado</h2>
        <SettingRow label="Tenant">{s.graph.tenantId ?? '—'}</SettingRow>
        <SettingRow label="Aplicativo (Client ID)">{s.graph.clientId ?? '—'}</SettingRow>
        {cert && cs ? <>
          <SettingRow label="Certificado">{cert.subject}</SettingRow>
          <SettingRow label="Validade"><span><span style={{ color: cs.color }}>{cs.label}</span>, {fmtDate(cert.validTo)}</span></SettingRow>
          <SettingRow label="Thumbprint"><span className="adm-mono">{cert.thumbprint}</span></SettingRow>
        </> : <SettingRow label="Certificado" help="Não configurado neste ambiente (MAIL_GRAPH_CERT / MAIL_GRAPH_PRIVATE_KEY).">Sem certificado</SettingRow>}
        <SettingRow label="Testar conexão" help="Autentica com o certificado e lê só os totais da Caixa de Entrada (nenhuma mensagem é aberta, movida ou enviada).">
          <Btn variant="secondary" size="sm" onClick={runTest} disabled={testing || !s.graph.configured}>{testing ? 'Testando...' : 'Testar conexão'}</Btn>
          <div aria-live="polite">
            {test && (test.ok
              ? <>Conectado. Caixa de Entrada: {test.inbox.total} itens, {test.inbox.unread} não lidos · {test.ms} ms</>
              : <span style={{ color: 'var(--danger)' }}>Falhou. {test.error}</span>)}
          </div>
        </SettingRow>
      </Card>

      <Card className="adm-section" role="region" aria-labelledby="email-cfg-orgs">
        <h2 id="email-cfg-orgs" className="adm-h">Empresas com resposta por e-mail ({s.replyEnabledOrgs.length})</h2>
        <SettingRow label="Liberadas" help="Para estas empresas, o e-mail do chamado convida a responder e o analista vai em cópia. Para as demais, o e-mail pede para não responder e traz o link do chamado. Ative em Cadastros, Empresas.">
          {s.replyEnabledOrgs.length === 0 ? 'Nenhuma empresa liberada.'
            : s.replyEnabledOrgs.map((o: any) => <span key={o.id} style={o.active ? undefined : { color: 'var(--text-3)' }}>{o.name}{!o.active && ' (inativa)'}</span>)}
        </SettingRow>
      </Card>
    </div>
  )
}
