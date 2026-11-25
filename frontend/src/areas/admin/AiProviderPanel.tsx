import { useEffect, useState } from 'react'
import { Btn, Card, ConfirmModal, Inp, Loading, PageHeader, PwdInp, Sel, Toggle } from '@/components/ui'
import { systemConfigService, type AiInput, type AiSettings, type TestResult } from '@/services/systemConfigService'
import { apiErrorMessage } from '@/services/api'
import { toast } from '@/store/toastStore'
import { SettingRow } from './SettingRow'

type NumKey = 'timeoutMs' | 'maxConcurrency' | 'assistantRateLimit' | 'assistantRateWindowMin' | 'assistantMaxConversationTokens' | 'assistantDailyTokenAlert'
const NUMBERS: { key: NumKey; label: string; min: number; max: number; help?: string }[] = [
  { key: 'assistantRateLimit', label: 'Mensagens por pessoa', min: 1, max: 1000 },
  { key: 'assistantRateWindowMin', label: 'A cada (minutos)', min: 1, max: 1440 },
  { key: 'assistantMaxConversationTokens', label: 'Tokens por conversa', min: 1000, max: 2_000_000 },
  { key: 'assistantDailyTokenAlert', label: 'Alerta diário de tokens', min: 0, max: 1_000_000_000, help: '0 desliga o alerta.' },
  { key: 'timeoutMs', label: 'Tempo limite (ms)', min: 1000, max: 120_000 },
  { key: 'maxConcurrency', label: 'Chamadas simultâneas', min: 1, max: 50 },
]

export function AiProviderPanel() {
  const [info, setInfo] = useState<AiSettings | null>(null)
  const [form, setForm] = useState<AiInput | null>(null)
  const [busy, setBusy] = useState(false)
  const [test, setTest] = useState<TestResult | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const set = (patch: Partial<AiInput>) => { setTest(null); setForm(f => (f ? { ...f, ...patch } : f)) }

  const apply = (s: AiSettings) => {
    const { source: _s, active: _a, hasApiKey: _h, ...value } = s
    setInfo(s)
    setForm({ ...value, apiKey: '' })
  }
  useEffect(() => {
    systemConfigService.getAi().then(apply).catch(err => toast.error(apiErrorMessage(err, 'Não foi possível carregar o provedor de IA.')))
  }, [])

  const payload = (): AiInput => {
    const { apiKey, ...rest } = form!
    return { ...rest, endpoint: rest.endpoint.trim(), chatModel: rest.chatModel.trim(), embeddingModel: rest.embeddingModel.trim(), ...(apiKey ? { apiKey } : {}) }
  }
  const run = async (action: () => Promise<void>, fallback: string) => {
    setBusy(true)
    try { await action() } catch (err) { toast.error(apiErrorMessage(err, fallback)) } finally { setBusy(false) }
  }
  const save = () => run(async () => { apply(await systemConfigService.saveAi(payload())); toast.success('Provedor de IA salvo.') }, 'Não foi possível salvar o provedor de IA.')
  const runTest = () => run(async () => setTest(await systemConfigService.testAi(payload())), 'O teste não pôde ser feito.')
  const reset = () => { setConfirmReset(false); void run(async () => { apply(await systemConfigService.resetAi()); toast.success('Configuração apagada.') }, 'Não foi possível apagar a configuração.') }

  if (!info || !form) return <Loading />

  const azure = form.kind === 'azure'
  return (
    <div className="adm">
      <PageHeader title="Provedor de IA" subtitle="Onde a Skadi e os agentes de triagem buscam o modelo"
        actions={<Btn variant="secondary" onClick={runTest} disabled={busy || !form.endpoint}>Testar</Btn>} />
      <div className="adm-body">
        {(test || info.source === 'env') && (
          <div className="notice" role="status">
            {info.source === 'env' && <div>Em uso: as variáveis de ambiente do servidor. Ao salvar aqui, esta tela passa a valer.</div>}
            {test && <div style={test.ok ? undefined : { color: 'var(--danger)' }}>{test.message}</div>}
          </div>
        )}
        <Card className="adm-section">
          <h2 className="adm-h">Conexão</h2>
          <SettingRow label="Usar a IA" help="Desligado, nenhum dado sai do sistema para a IA.">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Toggle value={form.enabled} onChange={v => set({ enabled: v })} label="Ligar a IA" />
              <span>{info.active ? 'Ativo' : 'Desligado'}</span>
            </div>
          </SettingRow>
          <SettingRow label="Provedor" htmlFor="ai-kind" help={azure ? undefined : 'Serve para OpenAI, Ollama, LM Studio, vLLM e outros com a mesma API. Inclua o /v1 no endereço.'}>
            <Sel id="ai-kind" value={form.kind} onChange={e => set({ kind: e.target.value as AiInput['kind'] })}>
              <option value="azure">Azure OpenAI / Foundry</option>
              <option value="openai">OpenAI ou compatível</option>
            </Sel>
          </SettingRow>
          <SettingRow label="Endereço" htmlFor="ai-endpoint">
            <Inp id="ai-endpoint" value={form.endpoint} onChange={e => set({ endpoint: e.target.value })} placeholder={azure ? 'https://seu-recurso.openai.azure.com' : 'https://api.openai.com/v1'} autoComplete="off" spellCheck={false} />
          </SettingRow>
          <SettingRow label="Chave da API" htmlFor="ai-key" help="Fica cifrada no banco. Ao mudar o endereço para outro servidor, é preciso digitá-la de novo.">
            <PwdInp id="ai-key" value={form.apiKey ?? ''} onChange={e => set({ apiKey: e.target.value })} placeholder={info.hasApiKey ? 'Salva. Digite para trocar' : 'Chave'} autoComplete="new-password" />
          </SettingRow>
          <SettingRow label={azure ? 'Implantação de conversa' : 'Modelo de conversa'} htmlFor="ai-chat"><Inp id="ai-chat" value={form.chatModel} onChange={e => set({ chatModel: e.target.value })} spellCheck={false} /></SettingRow>
          <SettingRow label={azure ? 'Implantação de embedding' : 'Modelo de embedding'} htmlFor="ai-embedding" help="Precisa gerar vetores de 1536 posições, o tamanho da base de conhecimento.">
            <Inp id="ai-embedding" value={form.embeddingModel} onChange={e => set({ embeddingModel: e.target.value })} spellCheck={false} />
          </SettingRow>
          {azure && <SettingRow label="Versão da API" htmlFor="ai-version"><Inp id="ai-version" value={form.apiVersion} onChange={e => set({ apiVersion: e.target.value })} spellCheck={false} /></SettingRow>}
        </Card>
        <Card className="adm-section">
          <h2 className="adm-h">Limites</h2>
          <p className="adm-note">Protegem o custo e evitam que uma pessoa ocupe a assistente. Os modos de cada agente ficam em Agentes de IA.</p>
          {NUMBERS.map(n => (
            <SettingRow key={n.key} label={n.label} htmlFor={`ai-${n.key}`} help={n.help}>
              <Inp id={`ai-${n.key}`} type="number" min={n.min} max={n.max} value={form[n.key]} style={{ width: 160 }} onChange={e => set({ [n.key]: Number(e.target.value) })} />
            </SettingRow>
          ))}
          <div className="adm-save">
            <Btn onClick={save} disabled={busy}>{busy ? 'Aguarde...' : 'Salvar'}</Btn>
            {info.source === 'admin' && <Btn variant="ghost" disabled={busy} onClick={() => setConfirmReset(true)}>Apagar configuração</Btn>}
          </div>
        </Card>
      </div>
      <ConfirmModal isOpen={confirmReset} onClose={() => setConfirmReset(false)} onConfirm={reset} title="Apagar o provedor de IA?" message="O endereço, a chave e os limites salvos aqui serão apagados. A IA para, a menos que o servidor tenha variáveis de ambiente." confirmText="Apagar" variant="danger" />
    </div>
  )
}
