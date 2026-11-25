import { toast } from '@/store/toastStore'
import { useState, useEffect } from 'react'
import { adminService } from '@/services/adminService'
import { ColorDot, Btn, Field, Inp, Txta, Toggle, PageHeader, Modal, ConfirmModal, AlertModal, CopyableId, SearchableSelect, Loading } from '@/components/ui'
import { Edit, Trash2, X } from 'lucide-react'
import { ColorSwatch, IdRow } from './parts'

type QueueAgent = { id: string; name: string; email: string; avatar?: string | null; active?: boolean }
const MAX_NAMES = 3

export function QueuesPanel() {
  const [queues, setQueues] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editQueue, setEditQueue] = useState<any|null>(null)
  const [form, setForm] = useState<Record<string,any>>({})
  const [confirmDelete, setConfirmDelete] = useState<{ isOpen: boolean, id: string } | null>(null)
  const [alertInfo, setAlertInfo] = useState<{ isOpen: boolean, title: string, message: string, variant?: 'danger' | 'primary' | 'warning' } | null>(null)

  // Vínculo analista ↔ fila vive em User.queues (mesmo campo do cadastro de usuários)
  const [agentsByQueue, setAgentsByQueue] = useState<Record<string, QueueAgent[]>>({})
  const [candidates, setCandidates] = useState<QueueAgent[]>([])
  const [members, setMembers] = useState<string[]>([])

  const loadAgents = async (queueId: string) => {
    const agents: QueueAgent[] = await adminService.getQueueAgents(queueId)
    setAgentsByQueue(prev => ({ ...prev, [queueId]: agents }))
  }

  useEffect(() => {
    adminService.getQueues(true).then(q => {
      setQueues(q); setLoading(false)
      // 1 request por fila; trocar por endpoint agregado se houver centenas de filas
      q.forEach((queue: any) => loadAgents(queue.id).catch(err => console.error('[QueuesPanel] Erro ao carregar analistas:', err)))
    }).catch(err => {
      console.error('[QueuesPanel] Erro ao carregar filas:', err); setLoading(false)
    })
    adminService.getUsers({ role: 'agent' })
      .then((users: QueueAgent[]) => setCandidates(users.filter(u => u.active !== false)))
      .catch(err => console.error('[QueuesPanel] Erro ao carregar analistas:', err))
  }, [])

  const openNew  = () => { setEditQueue(null); setForm({ name:'', description:'', color:'#0f73ac', active:true }); setMembers([]); setShowModal(true) }
  const openEdit = (q:any) => { setEditQueue(q); setForm({ ...q }); setMembers((agentsByQueue[q.id] || []).map(a => a.id)); setShowModal(true) }

  const agentById = new Map<string, QueueAgent>([
    ...candidates.map(a => [a.id, a] as const),
    ...(editQueue ? agentsByQueue[editQueue.id] || [] : []).map(a => [a.id, a] as const),
  ])
  const memberOptions = candidates
    .filter(a => !members.includes(a.id))
    .map(a => ({ value: a.id, label: a.name, sublabel: a.email }))

  const saveMembers = async (queueId: string) => {
    const before = (agentsByQueue[queueId] || []).map(a => a.id)
    const added = members.filter(id => !before.includes(id))
    const removed = before.filter(id => !members.includes(id))
    if (!added.length && !removed.length) return
    if (added.length) await adminService.addQueueAgents(queueId, added)
    for (const userId of removed) await adminService.removeQueueAgent(queueId, userId)
    await loadAgents(queueId)
  }

  const saveQueue = async () => {
    const name         = (form.name || '').trim()
    const color        = (form.color || '').trim()

    if (!name) { setAlertInfo({ isOpen: true, title: 'Validação', message: 'O nome da fila é obrigatório.', variant: 'warning' }); return }
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) { setAlertInfo({ isOpen: true, title: 'Validação', message: 'Cor inválida. Use formato hex #RRGGBB (ex: #0f73ac).', variant: 'warning' }); return }

    try {
      if (editQueue) {
        const updated = await adminService.updateQueue(editQueue.id, form)
        setQueues(queues.map(q => q.id === editQueue.id ? updated : q))
        await saveMembers(editQueue.id)
      } else {
        const created = await adminService.createQueue(form)
        setQueues([...queues, created])
        await saveMembers(created.id)
      }
      setShowModal(false)
      toast.success(editQueue ? 'Fila atualizada.' : 'Fila criada.')
    } catch (err) {
      console.error('[QueuesPanel] Erro ao salvar fila:', err)
      setAlertInfo({ isOpen: true, title: 'Erro', message: 'Erro ao salvar fila.', variant: 'danger' })
    }
  }

  const deleteQueue = (id: string) => {
    setConfirmDelete({ isOpen: true, id })
  }

  const performDeleteQueue = async (id: string) => {
    try {
      await adminService.deleteQueue(id)
      setQueues(queues.filter(q => q.id !== id))
      setAgentsByQueue(({ [id]: _, ...rest }) => rest)
      setConfirmDelete(null)
      setAlertInfo({ isOpen: true, title: 'Sucesso', message: 'Fila excluída com sucesso.', variant: 'primary' })
    } catch (err) {
      console.error('[QueuesPanel] Erro ao excluir fila:', err)
      setAlertInfo({ isOpen: true, title: 'Erro', message: 'Erro ao excluir fila. Verifique se existem chamados vinculados a esta fila.', variant: 'danger' })
    }
  }

  if (loading) return <Loading label="Carregando filas…" />

  return (
    <div className="cfg-page">
      <PageHeader title='Filas' subtitle={`${queues.length} filas cadastradas no sistema`} actions={<Btn size='sm' onClick={openNew}>Nova fila</Btn>}/>
      <div className="cfg-body">
        <div className="cfg-scroll">
          <table className="table">
            <thead>
              <tr><th>Fila</th><th>Descrição</th><th>Analistas</th><th>ID</th><th aria-label="Ações" /></tr>
            </thead>
            <tbody>
              {queues.map(q => (
                <tr key={q.id}>
                  <td>
                    <span style={{display:'inline-flex',alignItems:'center',gap:10}}>
                      <ColorDot color={q.color} size={10} />
                      <span className="cfg-strong">{q.name}</span>
                    </span>
                    {!q.active && <span className="cfg-off"> (inativa)</span>}
                  </td>
                  <td title={q.description || undefined}>{q.description ? <div className="cfg-clamp">{q.description}</div> : <span className="cfg-off">Sem descrição</span>}</td>
                  <td style={{color:'var(--text-2)'}}><QueueAgents agents={agentsByQueue[q.id]} /></td>
                  <td><CopyableId id={q.id} size="xs" /></td>
                  <td>
                    <div className="cfg-actions">
                      <button type="button" className="icon-act" aria-label={`Editar ${q.name}`} title="Editar" onClick={()=>openEdit(q)}><Edit size={15}/></button>
                      <button type="button" className="icon-act danger" aria-label={`Excluir ${q.name}`} title="Excluir" onClick={()=>deleteQueue(q.id)}><Trash2 size={15}/></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <Modal isOpen={showModal} onClose={()=>setShowModal(false)} title={editQueue?'Editar fila':'Nova fila'} width={520}
          footer={<><Btn variant='secondary' onClick={()=>setShowModal(false)}>Cancelar</Btn><Btn onClick={saveQueue}>Salvar</Btn></>}>
          <div className="cfg-form">
            {editQueue?.id && <IdRow label="ID da fila" id={editQueue.id} />}
            <Field label='Nome da fila' required>
              <Inp value={form.name||''} onChange={e=>setForm({...form,name:e.target.value})} placeholder='Ex: Suporte N2, Financeiro...' maxLength={100} showCount />
            </Field>
            <Field label='Descrição'>
              <Txta value={form.description||''} onChange={(e: any)=>setForm({...form,description:e.target.value})} placeholder='Opcional...' maxLength={500} showCount />
            </Field>
            <Field label='Cor (Hex)' required>
              <div style={{display:'flex',gap:8}}>
                <ColorSwatch value={form.color||''} onChange={color => setForm({...form, color})} />
                <Inp value={form.color||'#0f73ac'} onChange={e=>setForm({...form,color:e.target.value})} maxLength={20} style={{flex:1}}/>
              </div>
            </Field>
            <div className="cfg-row">
              Fila ativa
              <Toggle value={form.active!==false} onChange={v=>setForm({...form,active:v})} label="Fila ativa" />
            </div>
            <Field label={`Analistas que atendem esta fila (${members.length})`}>
              <SearchableSelect
                value=''
                onChange={id => id && setMembers(prev => prev.includes(id) ? prev : [...prev, id])}
                options={memberOptions}
                placeholder={memberOptions.length ? 'Adicionar analista...' : 'Nenhum outro analista ativo disponível'}
                searchPlaceholder='Buscar por nome ou e-mail...'
                aria-label='Adicionar analista à fila'
              />
              {members.length === 0 ? (
                <span className="cfg-sub">Nenhum analista vinculado. Analistas sem esta fila não veem os chamados dela.</span>
              ) : (
                <ul className="cfg-lines">
                  {members.map(id => {
                    const a = agentById.get(id)
                    const name = a?.name || 'Analista'
                    return (
                      <li key={id} title={a?.email} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,fontSize:14}}>
                        <span style={{overflowWrap:'anywhere'}}>{name}{a?.active === false && <span className="cfg-off"> (inativo)</span>}</span>
                        <button type='button' className="icon-act danger" onClick={() => setMembers(prev => prev.filter(m => m !== id))} aria-label={`Remover ${name} da fila`} title='Remover da fila'><X size={14} aria-hidden /></button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Field>
          </div>
        </Modal>
      )}
      {confirmDelete && (
        <ConfirmModal
          isOpen={confirmDelete.isOpen}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => performDeleteQueue(confirmDelete.id)}
          title="Excluir fila"
          message="Deseja realmente excluir esta fila permanentemente? Esta ação não pode ser desfeita e pode afetar chamados vinculados."
          confirmText="Excluir"
          variant="danger"
        />
      )}
      {alertInfo && (
        <AlertModal
          isOpen={alertInfo.isOpen}
          onClose={() => setAlertInfo(null)}
          title={alertInfo.title}
          message={alertInfo.message}
          variant={alertInfo.variant}
        />
      )}
    </div>
  )
}

function QueueAgents({ agents }: { agents?: QueueAgent[] }) {
  if (!agents) return null
  if (!agents.length) return <span className="cfg-off">Nenhum analista vinculado</span>
  const names = agents.map(a => a.name)
  return (
    <span title={names.join(', ')}>
      {names.slice(0, MAX_NAMES).join(', ')}{names.length > MAX_NAMES && ` e mais ${names.length - MAX_NAMES}`}
    </span>
  )
}
