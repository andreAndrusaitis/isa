import { useEffect, useState } from 'react'
import { adminService } from '@/services/adminService'

// ticket.queue guarda o id da fila. Este hook devolve o nome para exibição;
// id sem fila cadastrada (legado) volta como está.
export function useQueueName() {
  const [names, setNames] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    adminService.getQueues(true)
      .then((qs: { id: string; name: string }[]) => setNames(new Map(qs.map(q => [q.id, q.name]))))
      .catch(() => {})
  }, [])
  return (id: string | null | undefined) => (id ? names.get(id) ?? id : '')
}
