import { useState } from 'react'
import { EmptyState, Btn, ConfirmModal, PageHeader, Inp, Loading } from '@/components/ui'
import { Section } from '@/components/projects/insights/Section'
import { visuallyHidden } from '@/components/charts/ChartTooltip'
import { useMcpTokens } from '@/hooks/useMcpTokens'
import type { McpToken, McpTokenCreated } from '@/services/mcpTokens'

function fmtDate(value?: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Btn
      variant="secondary" size="xs"
      onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })}
    >
      {copied ? 'Copiado' : 'Copiar'}
    </Btn>
  )
}

// Sem VITE_API_URL (CI, testes) a API é relativa: usa a origem da página.
const MCP_URL = (import.meta.env.VITE_API_URL ?? window.location.origin).replace(/\/api\/?$/, '') + '/mcp'

function buildSetupPrompt(token: string) {
  return `Configure um servidor MCP remoto chamado "isa-projetos" usando o protocolo Streamable HTTP:

- URL: ${MCP_URL}
- Header de autenticação: Authorization: Bearer ${token}

Ferramentas disponíveis: list_projects, get_project, list_tasks, get_task, create_task, update_task.

Adicione essa configuração no arquivo de MCP servers da ferramenta que estou usando (ex: claude_desktop_config.json do Claude Desktop, ou .mcp.json do Claude Code) como um servidor do tipo "http"/"streamable-http" com a URL e o header acima. Depois, confirme que a conexão foi estabelecida e liste as tools disponíveis.`
}

export default function ProjectMcpTokensPage() {
  const { tokens, loading, error, create, revoke, reload } = useMcpTokens()
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [createdToken, setCreatedToken] = useState<McpTokenCreated | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState<McpToken | null>(null)
  const [revokeError, setRevokeError] = useState<string | null>(null)

  async function handleCreate() {
    if (!name.trim()) { setFormError('Dê um nome ao token.'); return }
    setCreating(true)
    setFormError(null)
    setCreatedToken(null)
    try {
      const created = await create(name.trim())
      setCreatedToken(created)
      setName('')
    } catch {
      setFormError('Não foi possível gerar o token.')
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke() {
    if (!confirmRevoke) return
    setRevokeError(null)
    try {
      await revoke(confirmRevoke.id)
    } catch {
      setRevokeError('Não foi possível revogar este token. Tente novamente.')
    }
  }

  if (loading) return <Loading />

  if (error) {
    return (
      <EmptyState
        title="Não foi possível carregar"
        desc={error}
        action={<Btn variant="secondary" size="sm" onClick={reload}>Tentar novamente</Btn>}
      />
    )
  }

  return (
    <div>
      <PageHeader title="MCP" subtitle="Ligue Claude Code, Claude Desktop, Cursor ou outra ferramenta de IA aos seus projetos" />
      <div className="prj-body" style={{ gap: 36 }}>
        <p className="notice">
          MCP (Model Context Protocol) deixa uma IA ler e criar projetos e tarefas aqui, com as mesmas permissões que você já tem.
          Gere um token, copie o prompt pronto e cole na sua IA: ela mesma configura a conexão. Endpoint: <code>{MCP_URL}</code>
        </p>

        {createdToken && (
          <Section title="Guarde este token agora" sub="Ele não será mostrado novamente. Cole-o na configuração MCP da sua ferramenta.">
            <pre className="prj-code">{createdToken.token}</pre>
            <div style={{ display: 'flex', gap: 8, margin: '10px 0 24px' }}>
              <CopyBtn text={createdToken.token} />
              <Btn variant="ghost" size="xs" onClick={() => setCreatedToken(null)}>Já guardei</Btn>
            </div>
            <p className="prj-note" style={{ marginBottom: 8 }}>Prompt pronto: cole direto na sua IA (Claude Code, Claude Desktop, Cursor...) para ela configurar o MCP sozinha.</p>
            <pre className="prj-code">{buildSetupPrompt(createdToken.token)}</pre>
            <div style={{ marginTop: 10 }}><CopyBtn text={buildSetupPrompt(createdToken.token)} /></div>
          </Section>
        )}

        <Section title="Tokens">
          {revokeError && <p role="alert" style={{ margin: '0 0 10px', fontSize: 14, color: 'var(--danger)' }}>{revokeError}</p>}
          {tokens.length === 0 ? (
            <p className="prj-note"><strong style={{ fontWeight: 500, color: 'var(--text-1)' }}>Nenhum token gerado</strong><br />Gere um token para conectar uma ferramenta MCP à sua conta.</p>
          ) : (
            <div className="prj-scroll">
              <table className="table prj" style={{ minWidth: 640 }}>
                <thead><tr><th scope="col">Nome</th><th scope="col">Começa com</th><th scope="col">Criado em</th><th scope="col">Último uso</th><th scope="col"><span style={visuallyHidden}>Ação</span></th></tr></thead>
                <tbody>
                  {tokens.map((token) => (
                    <tr key={token.id}>
                      <td style={{ color: 'var(--text-1)', overflowWrap: 'anywhere' }}>{token.name}</td>
                      <td><code>{token.tokenPrefix}…</code></td>
                      <td>{fmtDate(token.createdAt)}</td>
                      <td>{fmtDate(token.lastUsedAt)}</td>
                      <td className="num">{token.active ? <Btn variant="ghost" size="xs" onClick={() => setConfirmRevoke(token)}>Revogar</Btn> : <span style={{ color: 'var(--text-3)' }}>Revogado</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="setting" style={{ marginTop: 20 }}>
            <span>Novo token<small>Um nome para reconhecer onde ele está sendo usado</small></span>
            <div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Inp aria-label="Nome" value={name} onChange={(e: any) => setName(e.target.value)} placeholder="Ex: Claude Desktop — notebook" style={{ flex: '1 1 220px', width: 'auto' }} />
                <Btn variant="primary" onClick={handleCreate} disabled={creating}>{creating ? 'Gerando…' : 'Gerar token'}</Btn>
              </div>
              {formError && <div role="alert" style={{ fontSize: 13, color: 'var(--danger)', marginTop: 8 }}>{formError}</div>}
            </div>
          </div>
        </Section>
      </div>

      <ConfirmModal
        isOpen={!!confirmRevoke}
        onClose={() => setConfirmRevoke(null)}
        onConfirm={handleRevoke}
        title="Revogar token"
        message={`Revogar "${confirmRevoke?.name}"? Qualquer ferramenta conectada com este token perderá o acesso imediatamente. Esta ação não pode ser desfeita.`}
        confirmText="Revogar"
        variant="danger"
      />
    </div>
  )
}
