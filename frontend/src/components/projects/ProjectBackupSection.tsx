import { useState } from 'react'
import { Btn } from '@/components/ui'
import { exportProjectBackup } from '@/services/projectsService'
import { toast } from '@/store/toastStore'
import { apiErrorMessage } from '@/services/api'

/** Baixa o projeto inteiro em JSON (reimportável em Projetos › Importar). */
export function ProjectBackupSection({ projectId, projectName }: { projectId: string; projectName?: string }) {
  const [exporting, setExporting] = useState(false)

  async function handleExport() {
    setExporting(true)
    try {
      const backup = await exportProjectBackup(projectId)
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const slug = (projectName ?? 'projeto').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
      const a = document.createElement('a')
      a.href = url
      a.download = `backup-${slug || 'projeto'}-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Backup gerado.')
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível exportar o backup.'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--text-2)', lineHeight: 1.5, maxWidth: 520 }}>
        Arquivo JSON com status, tipos, listas, sprints, tags, membros e todas as tasks (IDs, checklist e comentários).
        Anexos e documentos não entram. Para restaurar, use <strong>Importar</strong> na lista de projetos.
      </p>
      <Btn variant="secondary" size="sm" onClick={handleExport} disabled={exporting}>
        {exporting ? 'Gerando…' : 'Exportar backup (JSON)'}
      </Btn>
    </div>
  )
}
