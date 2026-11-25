import { useEffect, useRef, useState } from 'react'
import { Btn, Inp, Loading, Logo, PageHeader } from '@/components/ui'
import { DEFAULT_SEEDS, applySeeds, contrast, deriveTheme, isHexColor, parseSeeds, storeSeeds, type BrandSeeds } from '@/lib/brandTheme'
import { systemConfigService } from '@/services/systemConfigService'
import { apiErrorMessage } from '@/services/api'
import { toast } from '@/store/toastStore'
import { SettingRow } from './SettingRow'

const PRESETS: { name: string; seeds: BrandSeeds }[] = [
  { name: 'Gelo', seeds: DEFAULT_SEEDS },
  { name: 'Fiorde', seeds: { primary: '#35536b', accent: '#7fb4d6', sidebar: '#14212b' } },
  { name: 'Aurora', seeds: { primary: '#0b7a75', accent: '#5eead4', sidebar: '#08211f' } },
  { name: 'Floresta', seeds: { primary: '#2f6b3f', accent: '#86c98f', sidebar: '#11231a' } },
  { name: 'Crepúsculo', seeds: { primary: '#4f46c8', accent: '#a5b4fc', sidebar: '#15132e' } },
  { name: 'Brasa', seeds: { primary: '#b4410e', accent: '#fdba74', sidebar: '#26140d' } },
  { name: 'Vinho', seeds: { primary: '#8b1538', accent: '#f2a3b5', sidebar: '#230a13' } },
  { name: 'Grafite', seeds: { primary: '#3f4a54', accent: '#a9b6c2', sidebar: '#16191c' } },
]

const FIELDS: { key: keyof BrandSeeds; label: string; help: string }[] = [
  { key: 'primary', label: 'Principal', help: 'Botões, links e seleção. Também dá o tom dos fundos.' },
  { key: 'accent', label: 'Destaque', help: 'Partes da logo, login e detalhes.' },
  { key: 'sidebar', label: 'Menu e login', help: 'Fundo do menu lateral, da tela de login e do topo dos e-mails. Pode ser claro.' },
]

const same = (a: BrandSeeds, b: BrandSeeds) => a.primary === b.primary && a.accent === b.accent && a.sidebar === b.sidebar

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <input
        type="color"
        value={value}
        aria-label={`Escolher a cor ${label}`}
        onChange={e => onChange(e.target.value)}
        style={{ width: 44, height: 40, padding: 0, border: 0, background: 'none', cursor: 'pointer', flexShrink: 0 }}
      />
      <Inp
        value={text}
        maxLength={7}
        aria-label={`Código da cor ${label}`}
        style={{ width: 140 }}
        onChange={e => {
          setText(e.target.value)
          const v = e.target.value.trim()
          const full = v.startsWith('#') ? v : `#${v}`
          if (isHexColor(full)) onChange(full.toLowerCase())
        }}
        onBlur={() => setText(value)}
      />
    </div>
  )
}

const SAMPLE = [['ISA-1042', 'VPN cai ao trocar de rede'], ['ISA-1039', 'Acesso ao CRM para a equipe nova']]

function Preview({ seeds, mode }: { seeds: BrandSeeds; mode: 'light' | 'dark' }) {
  // Os tokens da prévia valem só dentro deste bloco.
  return (
    <div className="adm-preview" style={deriveTheme(seeds)[mode] as React.CSSProperties}>
      <div className="adm-preview-side">
        <Logo size={22} variant="sidebar" />
        <span className="on">Meus chamados</span><span>Projetos</span><span>Documentos</span>
      </div>
      <div className="adm-preview-main">
        <div className="adm-preview-top"><b>Meus chamados</b><span>Nova solicitação</span></div>
        <div className="adm-preview-card">
          {SAMPLE.map(([id, title]) => <div key={id} className="adm-preview-row"><span>{id}</span><span>{title}</span></div>)}
        </div>
      </div>
    </div>
  )
}

export function AppearancePanel() {
  const [saved, setSaved] = useState<BrandSeeds | null>(null)
  const [seeds, setSeeds] = useState<BrandSeeds>(DEFAULT_SEEDS)
  const [busy, setBusy] = useState(false)
  const savedRef = useRef<BrandSeeds | null>(null)

  useEffect(() => {
    systemConfigService.getPublic()
      .then(c => parseSeeds(c.appearance) ?? DEFAULT_SEEDS)
      .then(s => { savedRef.current = s; setSaved(s); setSeeds(s) })
      .catch(err => toast.error(apiErrorMessage(err, 'Não foi possível carregar as cores.')))
    // Sair sem salvar devolve as cores em vigor.
    return () => { if (savedRef.current) applySeeds(savedRef.current) }
  }, [])

  useEffect(() => { if (saved) applySeeds(seeds) }, [seeds, saved])

  const finish = (next: BrandSeeds, message: string) => {
    savedRef.current = next
    setSaved(next); setSeeds(next); storeSeeds(next)
    toast.success(message)
  }
  const run = async (action: () => Promise<BrandSeeds>, message: string) => {
    setBusy(true)
    try { finish(parseSeeds(await action()) ?? DEFAULT_SEEDS, message) }
    catch (err) { toast.error(apiErrorMessage(err, 'Não foi possível salvar as cores.')) }
    finally { setBusy(false) }
  }

  if (!saved) return <Loading />
  const dirty = !same(seeds, saved)
  const lowContrast = contrast(seeds.primary, '#ffffff') < 3

  return (
    <div className="adm">
      <PageHeader title="Aparência" subtitle="As cores da sua organização em todo o sistema, do login aos e-mails" />
      <div className="adm-body">
        <section className="adm-section">
          <div className="adm-previews">
            <Preview seeds={seeds} mode="light" />
            <Preview seeds={seeds} mode="dark" />
          </div>
          <p className="adm-note" style={{ paddingTop: 12 }}>A tela inteira já mostra as cores escolhidas. Elas só valem para as outras pessoas depois de salvar.</p>
        </section>
        <section className="adm-section">
          <div className="setting" style={{ borderTop: 0 }}>
            <div>Paletas prontas<small>Um ponto de partida. Ajuste cada cor abaixo.</small></div>
            <div className="adm-palettes">
              {PRESETS.map(p => (
                <button key={p.name} type="button" aria-pressed={same(p.seeds, seeds)} onClick={() => setSeeds(p.seeds)}>
                  <span><i style={{ background: p.seeds.sidebar }} /><i style={{ background: p.seeds.primary }} /><i style={{ background: p.seeds.accent }} /></span>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
          {FIELDS.map(f => (
            <SettingRow key={f.key} label={f.label} help={f.help}>
              <ColorField label={f.label} value={seeds[f.key]} onChange={v => setSeeds(s => ({ ...s, [f.key]: v }))} />
              {f.key === 'primary' && lowContrast && <p role="status" className="adm-note">Essa cor principal é clara. Textos e links usam um tom mais escuro dela para continuarem legíveis.</p>}
            </SettingRow>
          ))}
          <div className="adm-save">
            <Btn onClick={() => run(() => systemConfigService.saveAppearance(seeds), 'Cores salvas para toda a organização.')} disabled={busy || !dirty}>{busy ? 'Salvando...' : 'Salvar'}</Btn>
            {dirty && <Btn variant="secondary" onClick={() => setSeeds(saved)} disabled={busy}>Descartar</Btn>}
            <Btn variant="ghost" disabled={busy || same(saved, DEFAULT_SEEDS)} onClick={() => run(() => systemConfigService.resetAppearance(), 'Paleta Gelo restaurada.')}>Voltar ao padrão Gelo</Btn>
          </div>
        </section>
      </div>
    </div>
  )
}
