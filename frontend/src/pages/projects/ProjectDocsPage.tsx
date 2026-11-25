import { useEffect, useState, useRef, useTransition } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Download, Check, Copy, RefreshCw } from 'lucide-react'
import {
  listAttachments, uploadAttachment, ProjectAttachment
} from '@/services/projectsService'
import { Btn, EmptyState, Loading, SortHeader } from '@/components/ui'
import { useTableSort } from '@/hooks/useTableSort'
import { useAuthStore } from '@/store/auth'
import { visuallyHidden } from '@/components/charts/ChartTooltip'
import { useProjectRole } from '@/components/projects/projectRole'
import '@/components/projects/insights/projects.css'
import { toast } from '@/store/toastStore'
import { apiErrorMessage } from '@/services/api'
import { FilterSearchInput } from '@/components/filters/FilterSearchInput'
import { FilterButton } from '@/components/filters/FilterButton'
import { FilterDropdown } from '@/components/filters/FilterDropdown'
import { FilterField } from '@/components/filters/FilterField'
import { FilterSelect, matchesFilter } from '@/components/filters/FilterSelect'
import { useFilterPanel } from '@/components/filters/useFilterPanel'

/** Categoria do arquivo para o filtro "Tipo de arquivo". */
function fileKind(doc: { fileName: string; mimeType: string }) {
  const ext = doc.fileName.split('.').pop()?.toLowerCase() || ''
  if (ext === 'pdf' || doc.mimeType.includes('pdf')) return 'pdf'
  if (['xls', 'xlsx', 'csv'].includes(ext) || doc.mimeType.includes('spreadsheet')) return 'sheets'
  if (['doc', 'docx', 'txt', 'md'].includes(ext) || doc.mimeType.includes('word')) return 'docs'
  if (doc.mimeType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'media'
  return 'other'
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

/** Extensão em texto: é o "tipo" mostrado na tabela. */
const fileExt = (doc: ProjectAttachment) => (doc.fileName.includes('.') ? doc.fileName.split('.').pop()! : 'arquivo').toUpperCase()

const ORIGIN_LABEL: Record<ProjectAttachment['entityType'], string> = {
  document: 'Documento do projeto',
  task: 'Anexo da task',
  comment: 'Comentário da task',
}

function formatDateTime(iso: string) {
  if (!iso) return 'Data desconhecida'
  const d = new Date(iso)
  return `${d.toLocaleDateString('pt-BR')}, ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

/** De onde o arquivo veio; com task, o código leva direto a ela. */
function Origin({ doc, projectId }: { doc: ProjectAttachment; projectId: string }) {
  const label = ORIGIN_LABEL[doc.entityType] ?? 'Arquivo'
  if (!doc.task) return <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
  const code = doc.task.key || 'Task'
  return (
    <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }} title={`${label}: ${code} ${doc.task.title}`}>
      <Link to={`/projetos/${projectId}/tasks?task=${doc.task.id}`} style={{ color: 'var(--accent-fg)', textDecoration: 'none', flexShrink: 0 }}>
        {code}
      </Link>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
        {doc.entityType === 'comment' ? 'comentário · ' : ''}{doc.task.title}
      </span>
    </span>
  )
}

type FilesProps = { docs: ProjectAttachment[]; projectId: string; copiedId: string | null; onCopy: (d: ProjectAttachment) => void }

type FileSortKey = 'name' | 'kind' | 'size' | 'origin' | 'uploader' | 'date'

function FilesTable({ docs, projectId, copiedId, onCopy }: FilesProps) {
  const { apply, header } = useTableSort<FileSortKey>()
  const rows = apply(docs, {
    name: (d) => d.fileName,
    kind: fileExt,
    size: (d) => d.fileSize,
    origin: (d) => d.task?.key ?? ORIGIN_LABEL[d.entityType],
    uploader: (d) => d.uploader?.name,
    date: (d) => new Date(d.createdAt),
  })
  return (
    <div className="prj-scroll">
      <table className="table prj" style={{ minWidth: 920, tableLayout: 'fixed' }}>
        <caption style={visuallyHidden}>Arquivos do projeto</caption>
        <colgroup>
          <col style={{ width: '30%' }} />
          <col style={{ width: 90 }} />
          <col style={{ width: 110 }} />
          <col style={{ width: '22%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: 160 }} />
          <col style={{ width: 92 }} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col"><SortHeader label="Nome" {...header('name')} /></th>
            <th scope="col"><SortHeader label="Tipo" {...header('kind')} /></th>
            <th scope="col" className="num"><SortHeader label="Tamanho" {...header('size')} /></th>
            <th scope="col"><SortHeader label="Origem" {...header('origin')} /></th>
            <th scope="col"><SortHeader label="Enviado por" {...header('uploader')} /></th>
            <th scope="col"><SortHeader label="Enviado em" {...header('date')} /></th>
            <th scope="col"><span style={visuallyHidden}>Ações</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((doc) => {
            const copied = copiedId === doc.id
            return (
              <tr key={doc.id}>
                <td title={doc.fileName} style={{ color: 'var(--text-1)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.fileName}</td>
                <td>{fileExt(doc)}</td>
                <td className="num">{formatBytes(doc.fileSize)}</td>
                <td><div style={{ display: 'flex', minWidth: 0 }}><Origin doc={doc} projectId={projectId} /></div></td>
                <td>{doc.uploader?.name ?? 'Não informado'}</td>
                <td style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}><time dateTime={doc.createdAt}>{formatDateTime(doc.createdAt)}</time></td>
                <td className="num">
                  <button type="button" className="icon-act" onClick={() => onCopy(doc)} title={copied ? 'Link copiado' : 'Copiar link'} aria-label={`Copiar link de ${doc.fileName}`}>
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                  {doc.url && <a className="icon-act" href={doc.url} target="_blank" rel="noreferrer" title="Baixar" aria-label={`Baixar ${doc.fileName}`}><Download size={16} aria-hidden /></a>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function ProjectDocsPage() {
  const { canEdit } = useProjectRole() // visualizador não envia arquivos
  const { projectId } = useParams<{ projectId: string }>()
  const [attachments, setAttachments] = useState<ProjectAttachment[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [search, setSearch] = useState('')
  // Padrão do sistema: busca fora; tipo, origem e período no painel de filtros.
  const filters = useFilterPanel(`project-docs:${projectId}`, { kind: 'all', origin: 'all', dateFrom: '', dateTo: '' })
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const me = useAuthStore((st) => st.user)
  const [, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadFiles = async () => {
    if (!projectId) return
    try {
      setLoading(true)
      setLoadError(null)
      const data = await listAttachments(projectId)
      setAttachments(data)
    } catch (err) {
      // Sem isto a falha parecia "nenhum documento anexado".
      setLoadError(apiErrorMessage(err, 'Não foi possível carregar os arquivos do projeto.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadFiles()
  }, [projectId])

  const handleUploadFile = async (file: File) => {
    if (!projectId) return
    try {
      setUploading(true)
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          const dataUri = reader.result as string
          const newDoc = await uploadAttachment(projectId, {
            entityType: 'document',
            entityId: projectId,
            fileName: file.name,
            dataUri,
          })
          setAttachments(prev => [{ ...newDoc, uploader: newDoc.uploader ?? (me ? { id: me.id, name: me.name } : null), task: null }, ...prev])
        } catch (err) {
          toast.error(apiErrorMessage(err, `Não foi possível enviar "${file.name}".`))
        } finally {
          setUploading(false)
        }
      }
      reader.readAsDataURL(file)
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Não foi possível ler o arquivo.'))
      setUploading(false)
    }
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files[0]) {
      handleUploadFile(files[0])
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const files = e.dataTransfer.files
    if (files && files[0]) {
      handleUploadFile(files[0])
    }
  }

  const copyLink = (attachment: ProjectAttachment) => {
    if (!attachment.url) return
    navigator.clipboard.writeText(attachment.url)
    setCopiedId(attachment.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  // Filtragem de documentos
  const filteredDocs = attachments.filter(doc => {
    if (!doc.fileName.toLowerCase().includes(search.trim().toLowerCase())) return false
    const f = filters.values
    if (!matchesFilter(f.kind, fileKind(doc))) return false
    if (!matchesFilter(f.origin, doc.entityType)) return false
    const day = doc.createdAt.slice(0, 10)
    if ((f.dateFrom && day < f.dateFrom) || (f.dateTo && day > f.dateTo)) return false
    return true
  })

  const totalSize = attachments.reduce((sum, a) => sum + (a.fileSize || 0), 0)

  const dropProps = canEdit ? {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true) },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false) },
    onDrop: handleDrop,
  } : {}

  return (
    // A página inteira recebe o arquivo arrastado.
    <div className="prj-body" style={{ gap: 12, minHeight: '100%', outline: isDragging ? '2px dashed var(--accent)' : undefined, outlineOffset: -8 }} {...dropProps}>
      <input type="file" ref={fileInputRef} onChange={handleFileInputChange} style={{ display: 'none' }} />
      <div className="prj-tools" style={{ justifyContent: 'space-between' }}>
        <div className="prj-tools" style={{ flex: '1 1 480px' }}>
            <FilterSearchInput value={search} onChange={(v) => startTransition(() => setSearch(v))} placeholder="Buscar por nome do arquivo…" width={240} />
            <div style={{ position: 'relative' }}>
              <FilterButton {...filters.buttonProps} />
              <FilterDropdown {...filters.dropdownProps} dateLabel="Data de envio">
                <FilterField label="Tipo de arquivo">
                  <FilterSelect value={filters.values.kind} onChange={(v) => filters.set('kind', v)}>
                    <option value="all">Todos</option>
                    <option value="pdf">PDF</option>
                    <option value="sheets">Planilhas</option>
                    <option value="docs">Textos</option>
                    <option value="media">Imagens</option>
                    <option value="other">Outros</option>
                  </FilterSelect>
                </FilterField>
                <FilterField label="Origem">
                  <FilterSelect value={filters.values.origin} onChange={(v) => filters.set('origin', v)}>
                    <option value="all">Todas</option>
                    <option value="task">Anexo de task</option>
                    <option value="comment">Anexo de comentário</option>
                    <option value="document">Documento do projeto</option>
                  </FilterSelect>
                </FilterField>
              </FilterDropdown>
            </div>
            <span style={{ fontSize: 13, color: 'var(--text-3)' }} role="status">
              {filteredDocs.length === attachments.length ? `${attachments.length} arquivo(s)` : `${filteredDocs.length} de ${attachments.length} arquivo(s)`}
              {' · '}{formatBytes(totalSize)}
            </span>
            <button type="button" className="icon-act" onClick={loadFiles} title="Atualizar lista" aria-label="Atualizar lista"><RefreshCw size={16} /></button>
        </div>
        {canEdit && (
          <div className="prj-tools">
            <span style={{ fontSize: 13, color: 'var(--text-3)' }}>Arraste um arquivo para esta página ou</span>
            <Btn variant="primary" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}
              title="Formatos aceitos: PDF, DOCX, XLSX, PPTX, TXT, CSV, imagens e ZIP">
              {uploading ? 'Enviando…' : 'Enviar arquivo'}
            </Btn>
          </div>
        )}
      </div>

      {loading ? (
        <Loading label="Carregando arquivos…" />
      ) : loadError ? (
        <div className="prj-empty"><EmptyState
          title="Não foi possível carregar os arquivos"
          desc={loadError}
          action={<Btn variant="secondary" onClick={loadFiles}>Tentar novamente</Btn>}
        /></div>
      ) : filteredDocs.length === 0 ? (
        <div className="prj-empty"><EmptyState
          title={attachments.length === 0 ? 'Nenhum documento anexado ainda' : 'Nenhum documento encontrado'}
          desc={attachments.length === 0
            ? 'Especificações, manuais e anexos das tasks aparecem aqui.'
            : 'Nenhum arquivo corresponde aos filtros e termos de busca aplicados.'}
          action={attachments.length === 0 ? undefined : <Btn variant="secondary" onClick={() => { setSearch(''); filters.clear() }}>Limpar filtros</Btn>}
        /></div>
      ) : (
        <FilesTable docs={filteredDocs} projectId={projectId!} copiedId={copiedId} onCopy={copyLink} />
      )}
    </div>
  )
}
