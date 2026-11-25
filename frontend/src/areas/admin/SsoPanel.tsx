import { useEffect, useState } from 'react'
import { Btn, Card, ConfirmModal, Inp, Loading, PageHeader, PwdInp, Sel, Toggle, Txta } from '@/components/ui'
import { systemConfigService, type SsoInput, type SsoSettings, type TestResult } from '@/services/systemConfigService'
import { usePublicConfig } from '@/store/publicConfig'
import { apiErrorMessage } from '@/services/api'
import { toast } from '@/store/toastStore'
import { SettingRow } from './SettingRow'

export function SsoPanel() {
  const [info, setInfo] = useState<SsoSettings | null>(null)
  const [form, setForm] = useState({ enabled: false, clientId: '', tenants: '', authMethod: 'secret' as SsoInput['authMethod'], clientSecret: '', certificate: '', privateKey: '' })
  const [busy, setBusy] = useState(false)
  const [test, setTest] = useState<TestResult | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const set = (patch: Partial<typeof form>) => { setTest(null); setForm(f => ({ ...f, ...patch })) }

  const apply = (s: SsoSettings) => {
    setInfo(s)
    setForm({ enabled: s.enabled, clientId: s.clientId, tenants: s.tenants.join('\n'), authMethod: s.authMethod, clientSecret: '', certificate: '', privateKey: '' })
  }
  useEffect(() => {
    systemConfigService.getSso().then(apply).catch(err => toast.error(apiErrorMessage(err, 'Não foi possível carregar o login Microsoft.')))
  }, [])

  const save = async () => {
    setBusy(true)
    try {
      const input: SsoInput = { enabled: form.enabled, clientId: form.clientId.trim(), tenants: form.tenants.split(/[\s,;]+/).filter(Boolean), authMethod: form.authMethod }
      if (form.authMethod === 'secret' && form.clientSecret) input.clientSecret = form.clientSecret
      if (form.authMethod === 'certificate') {
        if (form.certificate) input.certificate = form.certificate
        if (form.privateKey) input.privateKey = form.privateKey
      }
      apply(await systemConfigService.saveSso(input))
      void usePublicConfig.getState().load()
      toast.success('Login Microsoft salvo.')
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível salvar o login Microsoft.'))
    } finally { setBusy(false) }
  }

  const runTest = async () => {
    setBusy(true)
    try { setTest(await systemConfigService.testSso()) }
    catch (err) { setTest({ ok: false, message: apiErrorMessage(err, 'O teste não pôde ser feito.') }) }
    finally { setBusy(false) }
  }

  const reset = async () => {
    setConfirmReset(false)
    setBusy(true)
    try { apply(await systemConfigService.resetSso()); void usePublicConfig.getState().load(); toast.success('Configuração apagada.') }
    catch (err) { toast.error(apiErrorMessage(err, 'Não foi possível apagar a configuração.')) }
    finally { setBusy(false) }
  }

  if (!info) return <Loading />
  const expires = info.certificateExpiresAt ? new Date(info.certificateExpiresAt) : null
  const daysLeft = expires ? Math.ceil((expires.getTime() - Date.now()) / 86_400_000) : null

  return (
    <div className="adm">
      <PageHeader title="Login Microsoft" subtitle="Entrada com conta corporativa pelo Microsoft Entra ID"
        actions={<Btn variant="secondary" onClick={runTest} disabled={busy || !info.active}>Testar</Btn>} />
      <div className="adm-body">
        {(test || info.source === 'env') && (
          <div className="notice" role="status">
            {info.source === 'env' && <div>Em uso: as variáveis de ambiente do servidor. Ao salvar aqui, esta tela passa a valer.</div>}
            {test && <div style={test.ok ? undefined : { color: 'var(--danger)' }}>{test.message}</div>}
          </div>
        )}
        <Card className="adm-section">
          <h2 className="adm-h">Aplicativo</h2>
          <SettingRow label="Entrar com Microsoft" help="O botão só aparece no login quando está ligado e completo.">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Toggle value={form.enabled} onChange={v => set({ enabled: v })} label="Ligar o login Microsoft" />
              <span>{info.active ? 'Ativo' : 'Desligado'}</span>
            </div>
          </SettingRow>
          <SettingRow label="ID do aplicativo (client id)" htmlFor="sso-client">
            <Inp id="sso-client" value={form.clientId} onChange={e => set({ clientId: e.target.value })} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autoComplete="off" spellCheck={false} />
          </SettingRow>
          <SettingRow label="Tenants aceitos (um por linha)" htmlFor="sso-tenants"
            help="Com um tenant, só contas dele entram. Com vários, só as deles. Vazio aceita qualquer conta corporativa Microsoft, e quem decide é a lista de domínios de cada empresa.">
            <Txta id="sso-tenants" rows={3} value={form.tenants} onChange={e => set({ tenants: e.target.value })} placeholder="ID do diretório da sua organização" spellCheck={false} />
          </SettingRow>
          <SettingRow label="URI de redirecionamento" help="No portal do Azure, em Registros de aplicativo, cadastre este endereço como URI de redirecionamento do tipo Web.">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <code className="adm-mono" style={{ flex: 1, minWidth: 0 }}>{info.callbackUrl}</code>
              <Btn variant="ghost" size="sm" aria-label="Copiar endereço" onClick={() => navigator.clipboard.writeText(info.callbackUrl).then(() => toast.success('Endereço copiado.'))}>Copiar</Btn>
            </div>
          </SettingRow>
        </Card>

        <Card className="adm-section">
          <h2 className="adm-h">Credencial do aplicativo</h2>
          <SettingRow label="Tipo" htmlFor="sso-method">
            <Sel id="sso-method" value={form.authMethod} onChange={e => set({ authMethod: e.target.value as SsoInput['authMethod'] })}>
              <option value="secret">Segredo do cliente</option>
              <option value="certificate">Certificado</option>
            </Sel>
          </SettingRow>
          {form.authMethod === 'secret' ? (
            <SettingRow label="Segredo" htmlFor="sso-secret" help="Use o valor do segredo, não o ID dele. Fica cifrado no banco e não volta a ser exibido.">
              <PwdInp id="sso-secret" value={form.clientSecret} onChange={e => set({ clientSecret: e.target.value })} placeholder={info.hasClientSecret ? 'Salvo. Digite para trocar' : 'Valor do segredo'} autoComplete="new-password" />
            </SettingRow>
          ) : (
            <>
              {info.hasCertificate && expires && (
                <SettingRow label="Validade">
                  <span style={daysLeft! < 0 ? { color: 'var(--danger)' } : daysLeft! < 30 ? { color: 'var(--warning)' } : undefined}>
                    {daysLeft! < 0 ? 'Certificado vencido' : `Vence em ${daysLeft} dia(s)`}, {expires.toLocaleDateString('pt-BR')}
                  </span>
                </SettingRow>
              )}
              <SettingRow label="Certificado (PEM)" htmlFor="sso-cert"><Txta id="sso-cert" rows={4} value={form.certificate} onChange={e => set({ certificate: e.target.value })} placeholder={info.hasCertificate ? 'Salvo. Cole outro para trocar' : '-----BEGIN CERTIFICATE-----'} spellCheck={false} autoComplete="off" /></SettingRow>
              <SettingRow label="Chave privada (PEM, PKCS#8)" htmlFor="sso-key"><Txta id="sso-key" rows={4} value={form.privateKey} onChange={e => set({ privateKey: e.target.value })} placeholder={info.hasCertificate ? 'Salva. Cole outra para trocar' : '-----BEGIN PRIVATE KEY-----'} spellCheck={false} autoComplete="off" /></SettingRow>
            </>
          )}
          <div className="adm-save">
            <Btn onClick={save} disabled={busy}>{busy ? 'Aguarde...' : 'Salvar'}</Btn>
            {info.source === 'admin' && <Btn variant="ghost" disabled={busy} onClick={() => setConfirmReset(true)}>Apagar configuração</Btn>}
          </div>
        </Card>
      </div>
      <ConfirmModal isOpen={confirmReset} onClose={() => setConfirmReset(false)} onConfirm={reset} title="Apagar o login Microsoft?" message="O aplicativo, os tenants e a credencial salvos aqui serão apagados. Quem entra só pela Microsoft perde o acesso até uma nova configuração." confirmText="Apagar" variant="danger" />
    </div>
  )
}
