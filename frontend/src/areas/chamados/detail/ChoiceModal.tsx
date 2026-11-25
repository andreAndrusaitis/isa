/**
 * Janela de "escolher uma opção + motivo" do detalhe do chamado (prioridade,
 * tipo, fila). Antes eram três blocos iguais dentro do TicketDetail.
 */
import type { ReactNode } from 'react'
import { Modal, Btn, Field, Txta } from '@/components/ui'

export interface ChoiceOption {
  value: string
  label: string
  description?: string
  /** Elemento à direita da opção (ex.: degraus da prioridade). */
  trailing?: ReactNode
}

export function ChoiceModal({
  isOpen, onClose, title, intro, options, value, onChange, unchanged, onSave, note, onNote, notePlaceholder, extra,
}: {
  isOpen: boolean
  onClose: () => void
  title: string
  intro: string
  options: ChoiceOption[]
  value: string
  onChange: (value: string) => void
  /** Nada mudou: o botão Salvar fica desligado. */
  unchanged: boolean
  onSave: () => void | Promise<void>
  note: string
  onNote: (note: string) => void
  notePlaceholder: string
  /** Conteúdo entre as opções e o motivo (ex.: aviso de fila). */
  extra?: ReactNode
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancelar</Btn><Btn disabled={unchanged} onClick={onSave}>Salvar alteração</Btn></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{intro}</div>
        <div className="choices">
          {options.map(o => (
            <div key={o.value} className="choice" data-on={value === o.value || undefined} onClick={() => onChange(o.value)}>
              <div>{o.label}{o.description && <small>{o.description}</small>}</div>
              {o.trailing}
            </div>
          ))}
        </div>
        {extra}
        <Field label="Motivo da alteração (opcional)">
          <Txta value={note} onChange={e => onNote(e.target.value)} placeholder={notePlaceholder} rows={3} style={{ fontSize: 13 }} maxLength={1000} showCount />
        </Field>
      </div>
    </Modal>
  )
}
