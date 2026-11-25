/** Saúde (administrador): busca de ajustes, o que falta ligar, o que funciona e o que mudou. */
import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Btn, EmptyState, Loading, Meter, PageHeader } from '@/components/ui'
import { homesService, type SystemHealth } from '@/services/homesService'
import { SETTING_GROUPS, searchSettings } from '@/access/settings'
import type { AuthUser } from '@/store/auth'
import { ago } from './clock'
import './home.css'

const VERB: Record<string, string> = {
  CREATE: 'criou', UPDATE: 'alterou', DELETE: 'excluiu', RESET: 'restaurou o padrão de', SET: 'definiu', ENABLE: 'ligou', DISABLE: 'desligou', REGENERATE: 'gerou de novo', REORDER: 'reordenou', RESTORE: 'recuperou', PURGE: 'apagou de vez',
}
const THING: Record<string, string> = {
  USER: 'usuário', ORG: 'empresa', ORGANIZATION: 'empresa', QUEUE: 'fila', QUEUE_MEMBERS: 'pessoas da fila', CATEGORY: 'categoria', SUBCATEGORY: 'subcategoria', SLA_CONFIG: 'plano', PACKAGE: 'pacote', PLAN_PACKAGES: 'pacotes do plano', PLAN_CATEGORIES: 'categorias do plano', ROUTING_RULE: 'regra de roteamento', ROUTING_RULES: 'regras de roteamento', ESCALATION_RULE: 'regra de escalonamento', MACRO: 'resposta pronta', BUSINESS_HOURS: 'expediente', SYSTEM_SETTING: 'configuração', AI_AGENT_CONFIG: 'agente de IA', AI_AGENT_MODE: 'modo do agente', AI_EXAMPLE: 'exemplo da IA', WEBHOOK_ENDPOINT: 'integração', WEBHOOK_SECRET: 'segredo da integração', API_KEY: 'chave de API', AUTHORIZED_DOMAIN: 'domínio liberado', SURVEY_TEMPLATE: 'pesquisa', TRASH_CONFIG: 'lixeira', ORG_CATEGORY: 'categoria da empresa',
}
const KEY_LABEL: Record<string, string> = { appearance: 'Aparência', sso_microsoft: 'Login Microsoft', ai_provider: 'Provedor de IA' }

/** "alterou plano Silver"; ação sem tradução vira texto simples. */
export function changePhrase(action: string, target: string | null): string {
  const [verb, ...rest] = action.split('_')
  const thing = THING[rest.join('_')] ?? rest.join(' ').toLowerCase()
  const name = target ? KEY_LABEL[target] ?? target : ''
  return `${VERB[verb] ?? verb.toLowerCase()} ${thing}${name ? ` ${name}` : ''}`.trim()
}

export function HealthPage({ user, onGo }: { user: Pick<AuthUser, 'name'>; onGo: (view: string) => void }) {
  const [data, setData] = useState<SystemHealth | null>(null)
  const [error, setError] = useState(false)
  const [query, setQuery] = useState('')
  const load = () => homesService.getHealth().then(d => { setData(d); setError(false) }).catch(() => setError(true))
  useEffect(() => { void load() }, [])
  const found = useMemo(() => searchSettings(query), [query])

  if (error) return <EmptyState title="Não foi possível carregar a saúde do sistema" desc="Verifique a conexão e tente de novo." action={<Btn onClick={() => void load()}>Tentar de novo</Btn>} />
  if (!data) return <Loading label="Verificando o sistema…" />
  const open = data.checks.filter(c => c.state !== 'ok')
  const ready = data.checks.filter(c => c.state === 'ok')
  const firstTodo = open.findIndex(c => c.state === 'todo')
  const s = data.signals

  return (
    <div className="hm">
      <PageHeader title={`Olá, ${user.name.split(' ')[0]}`} subtitle={open.length ? `${open.length} ${open.length === 1 ? 'item pede' : 'itens pedem'} sua atenção` : 'Tudo ligado e em uso'} />
      <div className="hm-body">
        <div className="hm-search">
          <Search size={18} aria-hidden />
          <input type="search" aria-label="Buscar ajuste" placeholder="O que você quer configurar? Ex.: feriado, prazo do plano, cor" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && found[0]) onGo(found[0].view) }} />
        </div>
        {query.trim().length > 1 && (
          <div className="hm-found" role="list" aria-label="Ajustes encontrados">
            {found.length === 0 && <p className="hm-note">Nada com “{query}”. Tente outra palavra ou veja os grupos abaixo.</p>}
            {found.map(f => (
              <button key={f.view} type="button" role="listitem" onClick={() => onGo(f.view)}><f.icon size={17} aria-hidden /><span>{f.label}</span><small>{f.group}</small></button>
            ))}
          </div>
        )}

        <div className="hm-cols">
          <section aria-labelledby="falta">
            <h2 id="falta">{open.length ? 'Falta para ficar pronto' : 'Tudo pronto'}<small>{ready.length} de {data.checks.length}</small></h2>
            <Meter value={ready.length} max={data.checks.length} label={`${ready.length} de ${data.checks.length} prontos`} />
            {open.map((c, i) => (
              <article key={c.id} className="hm-card hm-check" data-state={c.state}>
                <div><b>{c.label}</b><p className="hm-note">{c.detail}</p></div>
                <Btn size="sm" variant={i === firstTodo ? 'primary' : 'secondary'} onClick={() => onGo(c.view)}>{c.state === 'todo' ? 'Configurar' : 'Revisar'}</Btn>
              </article>
            ))}
            {ready.length > 0 && (
              <div className="hm-card hm-ready">
                {ready.map(c => <button key={c.id} type="button" onClick={() => onGo(c.view)}><b>{c.label}</b><span>{c.detail}</span></button>)}
              </div>
            )}
          </section>

          <section aria-labelledby="agora">
            <h2 id="agora">Nas últimas 24 horas</h2>
            <dl className="hm-card hm-signals">
              <div><dt>Último e-mail enviado</dt><dd>{s.lastEmailAt ? ago(s.lastEmailAt) : 'nenhum'}</dd></div>
              <div data-alert={s.emailFailures > 0 || undefined}><dt>Falhas de envio</dt><dd>{s.emailFailures}</dd></div>
              <div data-alert={s.inboundFailures > 0 || undefined}><dt>E-mails recebidos com erro</dt><dd>{s.inboundFailures}</dd></div>
              <div data-alert={s.loginFailures >= 10 || undefined}><dt>Logins recusados</dt><dd>{s.loginFailures}</dd></div>
            </dl>
            <h2>Mudou nos últimos 7 dias</h2>
            <div className="hm-card hm-changes">
              {data.changes.length === 0 && <p className="hm-note">Nenhuma configuração mudou.</p>}
              {data.changes.map(c => <p key={c.id}><b>{c.who}</b> {changePhrase(c.action, c.target)}<small>{ago(c.at)}</small></p>)}
              <Btn size="sm" variant="ghost" onClick={() => onGo('admin_audit')}>Ver auditoria</Btn>
            </div>
          </section>
        </div>

        <h2 className="hm-h">Configurar</h2>
        <div className="hm-groups">
          {SETTING_GROUPS.map(g => (
            <section key={g.label} className="hm-card">
              <b>{g.label}</b>
              <p className="hm-note">{g.hint}</p>
              <div>{g.items.map(i => <button key={i.view} type="button" onClick={() => onGo(i.view)}>{i.label}</button>)}</div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
