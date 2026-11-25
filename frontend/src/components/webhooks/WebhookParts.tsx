/**
 * Peças da tela de webhooks compartilhadas entre o admin (chamados) e o módulo
 * Projetos — as duas telas têm de parecer e se comportar igual.
 */
import { useState, type ReactNode } from 'react'
import { Btn, Modal } from '@/components/ui'
import { apiBaseUrl, exampleCurl, jsonSchemaFrom, type ApiExampleSpec } from './apiExamples'
import './webhooks.css'

export function CopyBtn({ text, onCopied }: { text: string; onCopied: () => void }) {
  return <Btn variant='secondary' size='xs' onClick={() => { navigator.clipboard.writeText(text).then(onCopied) }}>Copiar</Btn>
}

export function SecretBox({ value }: { value: string }) {
  return <div className="wh-secret">{value}</div>
}

export function CodeBlock({ children }: { children: string }) {
  return <pre className="wh-code">{children}</pre>
}

export function DocTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="table">
        <thead><tr>{head.map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

export function DocSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="wh-sec"><h4>{title}</h4>{children}</section>
}

export function FilterChip({ label, active, onClick }: { label: string, active: boolean, onClick: () => void }) {
  return <label className="wh-option"><input type="checkbox" checked={active} onChange={onClick} />{label}</label>
}

/** Cabeçalho de um grupo de escolhas, com o marcar/desmarcar tudo. */
export function GroupHead({ title, all, onToggle }: { title: string; all: boolean; onToggle: () => void }) {
  return (
    <div className="wh-group">
      <span>{title}</span>
      <Btn variant="ghost" size="xs" type="button" onClick={onToggle} style={{ marginRight: -10 }}>{all ? 'Desmarcar grupo' : 'Selecionar grupo'}</Btn>
    </div>
  )
}

/** Uma escolha por linha: marcador, nome, código e explicação. */
export function CheckRow({ checked, onToggle, label, code, description, action, type = 'checkbox', name }: {
  checked: boolean; onToggle: () => void; label: string; code?: string; description?: string; action?: ReactNode; type?: 'checkbox' | 'radio'; name?: string
}) {
  return (
    <div className="wh-check">
      <label>
        <input type={type} name={name} checked={checked} onChange={onToggle} />
        <span style={{ minWidth: 0 }}>{label}{code && <code>{code}</code>}{description && <small>{description}</small>}</span>
      </label>
      {action}
    </div>
  )
}

export interface WebhookEventItem { event: string; group: string; label: string; description: string }

/** Checklist de eventos de gatilho por grupo, com "Ver payload" em cada um. */
export function EventChecklist({ groups, selected, onToggle, onToggleGroup, onExample, loadingExample }: {
  groups: Record<string, WebhookEventItem[]>
  selected: string[]
  onToggle: (event: string) => void
  onToggleGroup: (group: string) => void
  onExample: (event: string) => void
  loadingExample: string | null
}) {
  return (
    <div>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-3)' }}>
        Escolha <b>quando</b> este sistema deve ser avisado (eventos de gatilho). Você pode marcar grupos inteiros ou eventos específicos.
      </p>
      {Object.entries(groups).map(([group, list]) => (
        <section key={group} aria-label={group}>
          <GroupHead title={group} all={list.every(e => selected.includes(e.event))} onToggle={() => onToggleGroup(group)} />
          {list.map(ev => (
            <CheckRow key={ev.event} checked={selected.includes(ev.event)} onToggle={() => onToggle(ev.event)} label={ev.label} code={ev.event} description={ev.description}
              action={<Btn variant='ghost' size='xs' type="button" disabled={loadingExample === ev.event} onClick={() => onExample(ev.event)}>{loadingExample === ev.event ? 'Gerando…' : 'Ver payload'}</Btn>} />
          ))}
        </section>
      ))}
    </div>
  )
}

/** "Últimas N entregas: X ok, Y com falha". */
export function DeliveryHealth({ summary }: { summary?: { total: number; success: number; failed: number; pending: number } | null }) {
  if (!summary || summary.total === 0) return <span style={{ color: 'var(--text-3)' }}>Nenhuma entrega ainda</span>
  return (
    <span>
      Últimas {summary.total} entregas: {summary.success} ok{summary.failed > 0 && <span style={{ color: 'var(--danger)' }}>, {summary.failed} com falha</span>}{summary.pending > 0 ? `, ${summary.pending} pendente(s)` : ''}
    </span>
  )
}

/** Exemplo de payload + Esquema JSON de um evento, em abas. */
export function PayloadExampleModal({ event, payload, schema, onClose, onCopied, sender = 'o ISA' }: {
  event: string
  payload: unknown
  schema: unknown
  onClose: () => void
  onCopied: (message: string) => void
  sender?: string
}) {
  const [tab, setTab] = useState<'json' | 'schema'>('json')
  const json = JSON.stringify(tab === 'json' ? payload : schema, null, 2)
  return (
    <Modal isOpen onClose={onClose} title={`Payload do evento — ${event}`} width={560}
      footer={<Btn onClick={onClose}>Fechar</Btn>}>
      <div className="subtabs" style={{ marginLeft: -14, marginBottom: 14 }}>
        <button type='button' aria-pressed={tab === 'json'} onClick={() => setTab('json')}>Exemplo de payload</button>
        <button type='button' aria-pressed={tab === 'schema'} onClick={() => setTab('schema')}>Esquema JSON (Power Automate)</button>
      </div>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-3)' }}>
        {tab === 'json' ? <>
          É exatamente isto que {sender} envia no corpo (JSON) da requisição quando este evento acontece.
          No <b>Power Automate</b>, você também pode usar este exemplo clicando em <i>"Usar conteúdo de exemplo para gerar o esquema"</i>.
        </> : <>
          Esquema JSON pronto do evento. No <b>Power Automate</b>, cole-o diretamente no campo <b>"Solicitar Esquema JSON do Corpo"</b> (Request Body JSON Schema) para estruturar os dados.
        </>}
      </p>
      <CodeBlock>{json}</CodeBlock>
      <div style={{ marginTop: 10 }}>
        <CopyBtn text={json} onCopied={() => onCopied(tab === 'json' ? 'JSON de exemplo copiado.' : 'Esquema JSON copiado.')} />
      </div>
    </Modal>
  )
}

// ── Exemplos de chamada da API externa (Power Automate, Esquema JSON, curl) ──


type ExampleTab = 'curl' | 'pa' | 'schema'

export function ApiExample({ spec, apiKey, onCopied }: { spec: ApiExampleSpec; apiKey: string; onCopied: (what: string) => void }) {
  const [tab, setTab] = useState<ExampleTab>('pa')
  const schema = JSON.stringify(jsonSchemaFrom(spec.response), null, 2)
  const curl = exampleCurl(spec, apiKey)
  const body = spec.body ? JSON.stringify(spec.body, null, 2) : ''
  const tabs: { id: ExampleTab; label: string }[] = [
    { id: 'pa', label: 'Power Automate' },
    { id: 'schema', label: 'Esquema JSON' },
    { id: 'curl', label: 'curl' },
  ]
  const kv = (label: string, value: string, copy = true) => (
    <div className="wh-kv">
      <span>{label}</span>
      <code>{value}</code>
      {copy ? <CopyBtn text={value} onCopied={() => onCopied(label || value)} /> : <span />}
    </div>
  )
  return (
    <div className="wh-more" style={{ borderTop: 0 }}>
      <div role='tablist' className="subtabs" style={{ marginLeft: -14, marginBottom: 12 }}>
        {tabs.map(t => <button key={t.id} type='button' role='tab' aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>

      {tab === 'pa' && (
        <div role='tabpanel' className="wh-steps">
          <div><b>1.</b> Adicione a ação <b>HTTP</b> (conector premium) e preencha:</div>
          <div>
            {kv('Método', spec.method, false)}
            {kv('URI', `${apiBaseUrl()}${spec.path}`)}
            {kv('Cabeçalhos', `Authorization: Bearer ${apiKey}`)}
            {spec.body && kv('', 'Content-Type: application/json')}
          </div>
          {spec.body && (
            <div>
              <div className="wh-copyline">
                <span>Corpo: troque os valores fixos pelo conteúdo dinâmico do seu fluxo.</span>
                <CopyBtn text={body} onCopied={() => onCopied('Corpo')} />
              </div>
              <CodeBlock>{body}</CodeBlock>
            </div>
          )}
          <div>
            <b>2.</b> Adicione <b>Analisar JSON</b> (Parse JSON): em <i>Conteúdo</i> use <code>{"@{body('HTTP')}"}</code> e em <i>Esquema</i> cole o da aba <b>Esquema JSON</b>.
            Os campos da resposta passam a aparecer como conteúdo dinâmico nas próximas ações.
          </div>
          {spec.body && (
            <div><b>3.</b> Em novas tentativas, reenvie o mesmo <code>external_request_id</code>: a API devolve o resultado original (<code>duplicate: true</code>) em vez de duplicar.</div>
          )}
          {spec.note && <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{spec.note}</div>}
        </div>
      )}

      {tab === 'schema' && (
        <div role='tabpanel'>
          <div className="wh-copyline">
            <span>Esquema da resposta: cole no <b>Analisar JSON</b> do Power Automate.</span>
            <CopyBtn text={schema} onCopied={() => onCopied('Esquema JSON')} />
          </div>
          <CodeBlock>{schema}</CodeBlock>
        </div>
      )}

      {tab === 'curl' && (
        <div role='tabpanel'>
          <div className="wh-copyline"><span /><CopyBtn text={curl} onCopied={() => onCopied('curl')} /></div>
          <CodeBlock>{curl}</CodeBlock>
        </div>
      )}
    </div>
  )
}
