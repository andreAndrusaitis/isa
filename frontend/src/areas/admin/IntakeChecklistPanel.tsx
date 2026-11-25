import { toast } from '@/store/toastStore'
import { useEffect, useState } from 'react'
import { Pencil } from 'lucide-react'
import { aiService, type IntakeChecklistInput, type IntakeChecklistItem } from '@/services/aiService'
import { adminService } from '@/services/adminService'
import { apiErrorMessage } from '@/services/api'
import { AlertModal, Btn, Field, Inp, Modal, PageHeader, Sel, Toggle, Txta, Loading } from '@/components/ui'
import type { Category } from '@/types'
import './admin.css'

const TYPES: { value: IntakeChecklistItem['type']; label: string }[] = [
  { value: 'incident', label: 'Incidente' },
  { value: 'request', label: 'Requisição' },
  { value: 'problem', label: 'Problema' },
  { value: 'change', label: 'Mudança' },
]
const EMPTY: IntakeChecklistInput = {
  type: 'incident', subcategory_id: null, key: '', label: '', criterion: '', question: '', kind: 'text', required: true, sort: 0, active: true,
}

// Itens do checklist que o agente intake confere em cada chamado novo, agrupados por tipo.
/** `embedded`: dentro da folha da Completude no Motor IA (sem cabeçalho de página). */
export function IntakeChecklistPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const [items, setItems] = useState<IntakeChecklistItem[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState<{ id: string | null; form: IntakeChecklistInput } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([aiService.getIntakeChecklist(), adminService.getCategories()])
      .then(([i, c]) => { setItems(i); setCategories(c) })
      .catch(err => setError(apiErrorMessage(err, 'Não foi possível carregar o checklist.')))
      .finally(() => setLoading(false))
  }, [])

  const subName = (id: string | null) =>
    id ? categories.flatMap(c => c.subcategories ?? []).find(s => s.id === id)?.name ?? 'Subcategoria' : null

  const save = async () => {
    if (!edit) return
    try {
      const saved = edit.id ? await aiService.updateIntakeItem(edit.id, edit.form) : await aiService.createIntakeItem(edit.form)
      setItems(list => edit.id ? list.map(i => i.id === saved.id ? { ...i, ...saved } : i) : [...list, saved])
      setEdit(null)
      toast.success(edit.id ? 'Item atualizado.' : 'Item criado.')
    } catch (err) {
      setError(apiErrorMessage(err, 'Não foi possível salvar o item.'))
    }
  }

  const toggleActive = async (i: IntakeChecklistItem) => {
    try {
      const saved = await aiService.updateIntakeItem(i.id, { active: !i.active })
      setItems(list => list.map(x => x.id === i.id ? { ...x, ...saved } : x))
    } catch (err) {
      setError(apiErrorMessage(err, 'Não foi possível alterar o item.'))
    }
  }

  const set = <K extends keyof IntakeChecklistInput>(k: K, v: IntakeChecklistInput[K]) =>
    setEdit(e => e && { ...e, form: { ...e.form, [k]: v } })

  if (loading) return <Loading />

  const openNew = () => setEdit({ id: null, form: { ...EMPTY } })
  const rules = (i: IntakeChecklistItem) => [
    i.required ? 'Vira pergunta' : 'Só na nota',
    i.kind === 'evidence' && 'imagem cumpre',
    i.subcategory_id && (i.subcategory?.name ?? subName(i.subcategory_id)),
  ].filter(Boolean).join(' · ')

  return (
    <div className={embedded ? undefined : 'adm'}>
      {embedded
        ? <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingBottom: 20 }}>
            <span className="adm-note">Informações mínimas conferidas em cada chamado novo, por tipo.</span>
            <Btn size="sm" variant="secondary" onClick={openNew}>Novo item</Btn>
          </div>
        : <PageHeader title="Checklist de abertura" subtitle="Informações mínimas conferidas em cada chamado novo, por tipo"
            actions={<Btn onClick={openNew}>Novo item</Btn>} />}
      <div className="adm-body" style={embedded ? { padding: 0 } : undefined}>
        {items.length === 0 && <p className="adm-note">Nenhum item cadastrado ainda.</p>}
        {TYPES.filter(t => items.some(i => i.type === t.value)).map(t => (
          <section key={t.value} aria-labelledby={`intake-${t.value}`}>
            <h3 id={`intake-${t.value}`} className="adm-h">{t.label}</h3>
            <div className="adm-scroll">
              <table className="table intake-table" aria-labelledby={`intake-${t.value}`}>
                <colgroup><col style={{ width: '22%' }} /><col /><col style={{ width: '18%' }} /><col style={{ width: 70 }} /><col style={{ width: 40 }} /></colgroup>
                <thead><tr><th scope="col">Item</th><th scope="col">Pergunta e critério</th><th scope="col">Regra</th><th scope="col">Ativo</th><th scope="col" aria-label="Editar" /></tr></thead>
                <tbody>
                  {items.filter(i => i.type === t.value).sort((a, b) => a.sort - b.sort).map(i => (
                    <tr key={i.id} style={i.active ? undefined : { color: 'var(--text-3)' }}>
                      <td><div style={{ fontWeight: 500 }}>{i.label}</div><div className="adm-sub adm-mono">{i.key}</div></td>
                      <td><div>{i.question}</div><div className="adm-sub">{i.criterion}</div></td>
                      <td className="adm-sub">{rules(i)}</td>
                      <td><Toggle value={i.active} onChange={() => toggleActive(i)} label={`Ativar ${i.label}`} /></td>
                      <td>
                        <button type="button" className="icon-act" style={{ margin: '-7px 0' }} aria-label={`Editar ${i.label}`} title="Editar"
                          onClick={() => setEdit({ id: i.id, form: { type: i.type, subcategory_id: i.subcategory_id, key: i.key, label: i.label, criterion: i.criterion, question: i.question, kind: i.kind, required: i.required, sort: i.sort, active: i.active } })}><Pencil size={15} aria-hidden /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>

      {edit && (
        <Modal isOpen onClose={() => setEdit(null)} title={edit.id ? 'Editar item' : 'Novo item'} width={560}
          footer={<><Btn variant="ghost" onClick={() => setEdit(null)}>Cancelar</Btn><Btn onClick={save}>Salvar</Btn></>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <Field label="Tipo" style={{ flex: 1 }}>
                <Sel aria-label="Tipo" value={edit.form.type} onChange={e => set('type', e.target.value as IntakeChecklistItem['type'])}>
                  {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Sel>
              </Field>
              <Field label="Só para a subcategoria" style={{ flex: 1 }}>
                <Sel aria-label="Só para a subcategoria" value={edit.form.subcategory_id ?? ''} onChange={e => set('subcategory_id', e.target.value || null)}>
                  <option value="">Todas (tipo inteiro)</option>
                  {categories.map(c => (
                    <optgroup key={c.id} label={c.name}>
                      {(c.subcategories ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </optgroup>
                  ))}
                </Sel>
              </Field>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <Field label="Chave" required style={{ flex: 1 }}>
                <Inp aria-label="Chave" value={edit.form.key} disabled={!!edit.id} placeholder="ex.: o_que_acontece" onChange={e => set('key', e.target.value)} />
              </Field>
              <Field label="Nome" required style={{ flex: 1 }}>
                <Inp aria-label="Nome" value={edit.form.label} onChange={e => set('label', e.target.value)} />
              </Field>
            </div>
            <Field label="Critério (o que a IA verifica)" required>
              <Txta aria-label="Critério (o que a IA verifica)" rows={3} value={edit.form.criterion} onChange={e => set('criterion', e.target.value)} />
            </Field>
            <Field label="Pergunta ao solicitante" required>
              <Inp aria-label="Pergunta ao solicitante" value={edit.form.question} onChange={e => set('question', e.target.value)} />
            </Field>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Toggle value={edit.form.required} onChange={v => set('required', v)} label="Obrigatório (vira pergunta)" />
                <span className="adm-note" aria-hidden>Obrigatório (vira pergunta)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Toggle value={edit.form.kind === 'evidence'} onChange={v => set('kind', v ? 'evidence' : 'text')} label="Imagem anexada cumpre" />
                <span className="adm-note" aria-hidden>Imagem anexada cumpre</span>
              </div>
              <Field label="Ordem" style={{ width: 90 }}>
                <Inp aria-label="Ordem" type="number" value={edit.form.sort} onChange={e => set('sort', Number(e.target.value) || 0)} />
              </Field>
            </div>
          </div>
        </Modal>
      )}
      {error && <AlertModal isOpen onClose={() => setError(null)} title="Erro" message={error} />}
    </div>
  )
}
