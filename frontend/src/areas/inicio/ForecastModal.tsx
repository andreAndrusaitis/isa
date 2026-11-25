import { useEffect, useState } from 'react'
import { Btn, Field, Inp, Modal } from '@/components/ui'
import { ticketService } from '@/services/ticketService'
import { apiErrorMessage } from '@/services/api'
import { toast } from '@/store/toastStore'
import type { Ticket } from '@/types'
import { untilPhrase } from './clock'

const pad = (n: number) => String(n).padStart(2, '0')
const toLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
/** Atalhos: daqui a 2 h, amanhã 9h e o próximo dia útil às 17h. */
export function forecastShortcuts(now = new Date()): { label: string; at: Date }[] {
  const plus = new Date(now.getTime() + 2 * 3_600_000); plus.setMinutes(0, 0, 0); plus.setHours(plus.getHours() + (now.getMinutes() ? 1 : 0))
  const day = (n: number, h: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n, h)
  let n = 1
  while ([0, 6].includes(day(n, 9).getDay())) n++
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  return [plus, day(n, 9), day(n, 17)].map(at => ({ at, label: cap(untilPhrase(at.toISOString(), now)) }))
}

/** Nova previsão para o cliente. Não mexe no prazo do plano. */
export function ForecastModal({ ticket, onClose, onSaved }: {
  ticket: { id: string; number?: string; title: string } | null
  onClose: () => void
  onSaved: (updated: Ticket) => void
}) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { setValue('') }, [ticket?.id])
  const valid = !!value && new Date(value).getTime() > Date.now()

  async function save() {
    if (!ticket || !valid) return
    setSaving(true)
    try {
      const updated = await ticketService.updateTicket(ticket.id, { client_forecast_at: new Date(value).toISOString() } as any)
      toast.success('Previsão informada ao cliente.')
      onSaved(updated)
      onClose()
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível salvar a previsão.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={!!ticket} onClose={onClose} title="Nova previsão para o cliente" width={440}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancelar</Btn><Btn disabled={!valid || saving} onClick={save}>{saving ? 'Salvando…' : 'Informar previsão'}</Btn></>}>
      <p className="hm-note">{ticket?.number && <b>{ticket.number} </b>}{ticket?.title}. O cliente vê esta data no pedido; o prazo do plano continua contando para a equipe.</p>
      <div className="hm-chips" style={{ margin: '14px 0 18px' }}>
        {forecastShortcuts().map(s => (
          <button key={s.label} type="button" className="hm-chip" aria-pressed={value === toLocal(s.at)} onClick={() => setValue(toLocal(s.at))}>{s.label}</button>
        ))}
      </div>
      <Field label="Outra data e hora"><Inp type="datetime-local" aria-label="Data e hora da previsão" value={value} min={toLocal(new Date())} onChange={e => setValue(e.target.value)} /></Field>
    </Modal>
  )
}
