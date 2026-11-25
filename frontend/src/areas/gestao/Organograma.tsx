import { useEffect, useState, type ReactNode } from 'react'
import { adminService } from '@/services/adminService'
import { useAuthStore } from '@/store/auth'
import { hasAreaPermission } from '@/utils/permissions'
import { Btn, Card, PageHeader, EmptyState, Loading } from '@/components/ui'
import { toast } from '@/store/toastStore'
import './gestao.css'

const roleLabel: Record<string, string> = { admin: 'Administrador', manager: 'Gerente', supervisor: 'Ticket Manager', agent: 'Analista', user: 'Usuário final' }

type U = any
const mgrId = (u: U): string | null => u.managerId || u.manager_id || null

export function Organograma() {
  const me = useAuthStore((s) => s.user)
  const [users, setUsers] = useState<U[]>([])
  const [loading, setLoading] = useState(true)
  const [moving, setMoving] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    // includeManagerChain: traz o próprio usuário e os gerentes acima dele, que
    // normalmente ficam fora do escopo — assim supervisor/analista veem o gerente
    // padrão acima de si no organograma.
    adminService.getUsers({ includeManagerChain: true })
      .then((u) => { setUsers(u); setLoading(false) })
      .catch(() => { toast.error('Erro ao carregar o organograma'); setLoading(false) })
  }
  useEffect(load, [])

  if (!me) return null

  const isAdmin = me.role === 'admin' || hasAreaPermission(me, 'organograma')
  const childrenOf = (id: string) => users.filter((u) => mgrId(u) === id)

  // Registro completo do usuário logado (vem da lista, com manager_id resolvido).
  const meFull = users.find((u) => u.id === me.id) || me
  const myManagerId = mgrId(meFull)

  // Raízes do organograma:
  // - admin: todas as árvores de gerentes;
  // - gerente: a própria árvore;
  // - supervisor/analista: o gerente acima dele (se houver), para que a hierarquia
  //   mostre o gerente padrão no topo; sem gerente vinculado, cai para si mesmo.
  const managerRoots: U[] = (() => {
    if (isAdmin) return users.filter((u) => u.role === 'manager')
    if (me.role === 'manager') return [{ id: me.id, name: me.name, role: 'manager' }]
    const mgr = myManagerId ? users.find((u) => u.id === myManagerId) : null
    if (mgr) return [mgr]
    return [{ id: me.id, name: me.name, role: me.role }]
  })()

  // Admin: supervisores/analistas sem gerente vinculado (órfãos).
  const orphans = isAdmin
    ? users.filter((u) => (u.role === 'supervisor' || u.role === 'agent') && !mgrId(u))
    : []

  const moveAnalyst = async (analyst: U, newManagerId: string) => {
    if (newManagerId === (mgrId(analyst) || '')) return
    setMoving(analyst.id)
    try {
      await adminService.updateUser(analyst.id, { manager_id: newManagerId })
      toast.success(`${analyst.name} movido(a) com sucesso`)
      load()
    } catch (e: any) {
      toast.error('Erro ao mover: ' + (e?.response?.data?.error || e.message))
    } finally {
      setMoving(null)
    }
  }

  const details = (u: U) => `${roleLabel[u.role] || u.role} · ${(u.queues || []).length} fila(s)`

  // supervisors/rootId definem os destinos do "mover" para os analistas deste gerente.
  const analystRow = (a: U, supervisors: U[], rootId: string) => (
    <li key={a.id}>
      <div>
        <span>{a.name}</span>
        <small>{details(a)}</small>
        <label className="org-move" title="Mover para outro responsável">
          <select aria-label={`Responsável de ${a.name}`} value={mgrId(a) || rootId} disabled={moving === a.id} onChange={(e) => moveAnalyst(a, e.target.value)}>
            <option value={rootId}>Direto no gerente</option>
            {supervisors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </div>
    </li>
  )

  const team = (manager: U): ReactNode => {
    const reports = childrenOf(manager.id)
    const supervisors = reports.filter((u) => u.role === 'supervisor')
    const directAnalysts = reports.filter((u) => u.role === 'agent')
    if (!supervisors.length && !directAnalysts.length) return <p className="empty-line">Sem equipe vinculada.</p>
    return (
      <ul className="org-tree">
        {supervisors.map((sup) => {
          const analysts = childrenOf(sup.id).filter((u) => u.role === 'agent')
          return (
            <li key={sup.id}>
              <div><span style={{ fontWeight: 600 }}>{sup.name}</span><small>{details(sup)}</small><span className="org-move" style={{ color: 'var(--text-3)', fontSize: 13 }}>{analysts.length ? `${analysts.length} analista(s)` : 'Sem analistas'}</span></div>
              {analysts.length > 0 && <ul>{analysts.map((a) => analystRow(a, supervisors, manager.id))}</ul>}
            </li>
          )
        })}
        {directAnalysts.map((a) => analystRow(a, supervisors, manager.id))}
      </ul>
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 48 }}>
      <PageHeader title="Organograma" subtitle={isAdmin ? 'Todas as equipes e suas hierarquias' : 'Sua equipe e a quem cada analista responde'} actions={<Btn size="sm" variant="secondary" onClick={load}>Atualizar</Btn>} />

      {loading ? (
        <Loading label="Carregando organograma…" />
      ) : managerRoots.length === 0 && orphans.length === 0 ? (
        <EmptyState title="Sem equipe vinculada" desc="Vincule supervisores e analistas (campo Responsável ao criar/editar usuário) para vê-los aqui." />
      ) : (
        <div style={{ padding: '0 var(--page-gutter)' }}>
          {managerRoots.map((m, i) => (
            <Card key={m.id} className="sect" style={i === 0 ? { marginTop: 4 } : undefined}>
              <h3>{m.name}<small>{roleLabel[m.role] || m.role}</small></h3>
              {team(m)}
            </Card>
          ))}

          {orphans.length > 0 && (
            <Card className="sect">
              <h3>Sem gerente vinculado<small>{orphans.length}</small></h3>
              <ul className="org-tree">
                {orphans.map((u) => <li key={u.id}><div><span>{u.name}</span><small>{details(u)}</small></div></li>)}
              </ul>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
