import { useEffect, useId, useState, type ReactNode } from 'react'
import { Btn, Inp, Modal, Sel, Toggle } from '@/components/ui'
import { aiService, type AiAgentSetting, type AiAgentStatus } from '@/services/aiService'
import { apiErrorMessage } from '@/services/api'
import { toast } from '@/store/toastStore'
import { IntakeChecklistPanel } from './IntakeChecklistPanel'
import { ResolutionBasePanel } from './ResolutionBasePanel'

/** O que pertence a cada agente além das configurações (seções próprias na folha). */
const SECTIONS: Record<string, { title: string; render: () => ReactNode }> = {
  intake: { title: 'Checklist de abertura', render: () => <IntakeChecklistPanel embedded /> },
  guidance: { title: 'Base de resoluções', render: () => <ResolutionBasePanel /> },
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function SettingInput({ f, value, onChange, id }: { f: AiAgentSetting; value: unknown; onChange: (v: unknown) => void; id: string }) {
  if (f.kind === 'bool') {
    return (
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Toggle value={value === true} onChange={onChange} label={f.label} />
        <span>{f.label}</span>
      </div>
    )
  }
  if (f.kind === 'rigor' || (f.kind === 'int' && f.max! - f.min! <= 10)) {
    const options = f.kind === 'rigor'
      ? f.options ?? []
      : Array.from({ length: f.max! - f.min! + 1 }, (_, i) => ({ value: String(f.min! + i), label: String(f.min! + i) }))
    return (
      <Sel id={id} value={String(value ?? '')} onChange={e => onChange(f.kind === 'int' ? Number(e.target.value) : e.target.value)} style={{ width: 260, maxWidth: '100%' }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Sel>
    )
  }
  if (f.kind === 'int') {
    return (
      <Inp id={id} type="number" min={f.min} max={f.max} value={Number(value ?? f.min)} style={{ width: 110 }}
        onChange={e => onChange(Math.min(f.max!, Math.max(f.min!, Math.round(Number(e.target.value) || f.min!))))} />
    )
  }
  const list = Array.isArray(value) ? (value as string[]) : []
  return (
    <div role="group" aria-labelledby={`${id}-label`} style={{ display: 'flex', gap: '4px 20px', flexWrap: 'wrap' }}>
      {(f.options ?? []).map(o => (
        <label key={o.value} style={{ display: 'inline-flex', gap: 8, alignItems: 'center', minHeight: 28, cursor: 'pointer' }}>
          <input type="checkbox" checked={list.includes(o.value)}
            onChange={e => onChange(e.target.checked ? [...list, o.value] : list.filter(v => v !== o.value))} />
          {o.label}
        </label>
      ))}
    </div>
  )
}

/**
 * Configurações de um agente no Motor IA: formulário montado a partir das declarações
 * do backend (agents/registry.ts) + o que pertence ao agente (checklist, base de resoluções).
 * Abre numa folha. Agente novo com
 * `settings` ganha a tela sem código aqui.
 */
export function AiAgentConfig({ agent, onSaved }: { agent: AiAgentStatus; onSaved?: (config: Record<string, unknown>) => void }) {
  const uid = useId()
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState<Record<string, unknown>>(agent.config ?? {})
  const [draft, setDraft] = useState<Record<string, unknown>>(agent.config ?? {})
  const [saving, setSaving] = useState(false)
  useEffect(() => { setSaved(agent.config ?? {}); setDraft(agent.config ?? {}) }, [agent.config])

  const settings = agent.settings ?? []
  const section = SECTIONS[agent.key]
  if (!settings.length && !section) return null

  const changes = Object.fromEntries(Object.entries(draft).filter(([k, v]) => !same(v, saved[k])))
  const dirty = Object.keys(changes).length > 0
  const save = async () => {
    setSaving(true)
    try {
      const config = await aiService.setAgentConfig(agent.key, changes)
      setSaved(config)
      setDraft(config)
      onSaved?.(config)
      toast.success('Configurações salvas. Valem a partir do próximo chamado.')
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível salvar as configurações.'))
    } finally {
      setSaving(false)
    }
  }

  const close = () => { setDraft(saved); setOpen(false) }

  return (
    <>
      <Btn variant="ghost" size="xs" aria-haspopup="dialog" onClick={() => setOpen(true)}>Configurações{section ? ` e ${section.title.toLowerCase()}` : ''}</Btn>
      <Modal isOpen={open} onClose={close} title={`Configurações — ${agent.name}`} width={section ? 860 : 560}>
        <div style={{ fontSize: 14 }}>
          {settings.length > 0 && (
            <div>
              {settings.map(f => {
                const id = `${uid}-${f.key}`
                return (
                  <div key={f.key} style={{ display: 'grid', gap: 6, padding: '14px 0', borderTop: '1px solid var(--border)' }}>
                    {f.kind !== 'bool' && <label id={`${id}-label`} htmlFor={f.kind === 'multi' ? undefined : id} style={{ color: 'var(--text-2)' }}>{f.label}</label>}
                    <SettingInput f={f} id={id} value={draft[f.key]} onChange={v => setDraft(d => ({ ...d, [f.key]: v }))} />
                    {f.help && <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{f.help}</span>}
                  </div>
                )
              })}
              <div style={{ display: 'flex', gap: 8, padding: '16px 0 28px', borderTop: '1px solid var(--border)' }}>
                <Btn size="sm" disabled={!dirty || saving} onClick={save}>{saving ? 'Salvando…' : 'Salvar configurações'}</Btn>
                {dirty && <Btn size="sm" variant="ghost" disabled={saving} onClick={() => setDraft(saved)}>Descartar</Btn>}
              </div>
            </div>
          )}
          {section && (
            <section aria-label={section.title} style={{ borderTop: '1px solid var(--rule)', paddingTop: 16 }}>
              <h4 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 500 }}>{section.title}</h4>
              {section.render()}
            </section>
          )}
        </div>
      </Modal>
    </>
  )
}
