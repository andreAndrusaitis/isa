import { Fragment, useState, useEffect, useRef } from 'react'
import { surveyService, SurveyDashboardStats, SurveyQuestionStat } from '@/services/surveyService'
import { adminService } from '@/services/adminService'
import { ticketService } from '@/services/ticketService'
import {
  Card,
  Figures,
  Meter,
  StatCard,
  PageHeader,
  AlertModal,
  Btn,
  Modal,
  StatusBadge,
  PriorityBadge,
  SearchableSelect,
  Loading,
} from '@/components/ui'
import { CHART_COLORS } from '@/components/charts/chartUtils'
import { TipRow, visuallyHidden } from '@/components/charts/ChartTooltip'
import { SortHeader } from '@/components/ui/SortHeader'
import { TruncatedText } from '@/components/ui/TruncatedText'
import { useTableSort } from '@/hooks/useTableSort'
import { useQueueName } from '@/hooks/useQueueName'
import { FilterButton } from '@/components/filters/FilterButton'
import { FilterDropdown } from '@/components/filters/FilterDropdown'
import { FilterField } from '@/components/filters/FilterField'
import { getSavedFilters, saveFilter, deleteFilter, countActiveFilters, type SavedFilter } from '@/utils/filterStorage'
import { csvCell, escapeHtml } from '@/utils/exportSafety'
import './gestao.css'

// 'YYYY-MM' → 'ago/25' (toLocaleDateString devolve "ago. de 25", verboso demais
// para caber 12 rótulos no eixo)
const monthLabel = (month: string) => {
  const [y, m] = month.split('-')
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  return `${nomes[Number(m) - 1]}/${y.slice(2)}`
}

// --- Formatação pt-BR ------------------------------------------------------
const nf = new Intl.NumberFormat('pt-BR')
const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

const fmtCount = (n: number) => nf.format(n)
const fmtPct = (n: number) => `${nf.format(Math.round(n))}%`
// Decimal só quando há fração real — 11 de 12 rótulos com ",0" é ruído.
const fmtScore = (n: number | null) =>
  n === null ? '—' : Number.isInteger(n) ? nf.format(n) : nf1.format(n)
const fmtNps = (n: number) => (n < 0 ? `−${nf.format(Math.abs(n))}` : `+${nf.format(n)}`)

// Abaixo disso uma resposta isolada move o índice mais de 10 pontos.
const AMOSTRA_MINIMA = 10

export function SurveyDashboardPanel() {
  const queueName = useQueueName()
  const [stats, setStats] = useState<SurveyDashboardStats | null>(null)
  const answeredSort = useTableSort<string>()
  const unansweredSort = useTableSort<string>()
  const [loading, setLoading] = useState(false)

  // Date filters
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [orgs, setOrgs] = useState<any[]>([])
  const [selectedOrg, setSelectedOrg] = useState('')

  const [filterOpen, setFilterOpen] = useState(false)
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(() => getSavedFilters('survey-dashboard'))
  const [activeSavedFilter, setActiveSavedFilter] = useState<SavedFilter | null>(null)
  const activeFilterCount = countActiveFilters({ startDate, endDate, org: selectedOrg }, { startDate: '', endDate: '', org: '' })

  function handleSelectSaved(filter: SavedFilter) {
    const f = filter.filters
    if (typeof f.startDate === 'string') setStartDate(f.startDate)
    if (typeof f.endDate === 'string') setEndDate(f.endDate)
    if (typeof f.org === 'string') setSelectedOrg(f.org)
    setActiveSavedFilter(filter)
  }
  function handleSaveFilter(name: string) {
    const filter: SavedFilter = { id: crypto.randomUUID(), name, filters: { startDate, endDate, org: selectedOrg } }
    saveFilter('survey-dashboard', filter)
    setSavedFilters(getSavedFilters('survey-dashboard'))
  }
  function handleDeleteSaved(id: string) {
    deleteFilter('survey-dashboard', id)
    setSavedFilters(getSavedFilters('survey-dashboard'))
    if (activeSavedFilter?.id === id) setActiveSavedFilter(null)
  }

  const [activeTab, setActiveTab] = useState<'overview' | 'answered' | 'unanswered'>('overview')
  const [resending, setResending] = useState<Record<string, boolean>>({})
  const [searchTerm, setSearchTerm] = useState('')

  // Details Modal States
  const [selectedTicketDetails, setSelectedTicketDetails] = useState<any>(null)
  const [selectedAnswers, setSelectedAnswers] = useState<any[] | null>(null)
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false)
  const [detailsLoading, setDetailsLoading] = useState(false)

  const [alert, setAlert] = useState<{
    isOpen: boolean
    title: string
    message: string
    variant: 'danger' | 'warning' | 'primary'
  }>({ isOpen: false, title: '', message: '', variant: 'warning' })

  const handleResend = async (ticketId: string) => {
    setResending(prev => ({ ...prev, [ticketId]: true }))
    try {
      await surveyService.resendSurveyEmail(ticketId)
      setAlert({
        isOpen: true,
        title: 'Sucesso',
        message: 'E-mail de convite para pesquisa reenviado com sucesso!',
        variant: 'primary'
      })
      loadData(startDate, endDate, selectedOrg)
    } catch (err: any) {
      const errMsg = err.response?.data?.error || 'Falha ao reenviar e-mail de pesquisa.'
      setAlert({
        isOpen: true,
        title: 'Erro',
        message: errMsg,
        variant: 'danger'
      })
    } finally {
      setResending(prev => ({ ...prev, [ticketId]: false }))
    }
  }

  const loadData = async (start?: string, end?: string, orgId?: string) => {
    setLoading(true)
    try {
      const filters: any = {}
      if (start) filters.startDate = start
      if (end) filters.endDate = end
      if (orgId) filters.orgId = orgId

      const data = await surveyService.getDashboardStats(filters)
      setStats(data)
    } catch {
      setAlert({ isOpen: true, title: 'Erro', message: 'Não foi possível carregar os dados de pesquisa.', variant: 'danger' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    adminService.getOrganizations()
      .then(setOrgs)
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadData(startDate, endDate, selectedOrg)
  }, [startDate, endDate, selectedOrg])

  const handleClearFilters = () => {
    setStartDate('')
    setEndDate('')
    setSelectedOrg('')
    setActiveSavedFilter(null)
  }

  const handleOpenDetails = async (ticketId: string, answers?: any[]) => {
    setIsDetailsModalOpen(true)
    setDetailsLoading(true)
    setSelectedAnswers(answers || null)
    setSelectedTicketDetails(null)
    try {
      const ticket = await ticketService.getTicket(ticketId)
      setSelectedTicketDetails(ticket)
    } catch {
      setAlert({
        isOpen: true,
        title: 'Erro',
        message: 'Não foi possível carregar os detalhes do chamado.',
        variant: 'danger'
      })
      setIsDetailsModalOpen(false)
    } finally {
      setDetailsLoading(false)
    }
  }

  const handleExportExcel = () => {
    if (!stats || !stats.responsesList || stats.responsesList.length === 0) {
      setAlert({ isOpen: true, title: 'Exportar', message: 'Nenhuma resposta disponível para exportação.', variant: 'warning' })
      return
    }

    const fixedHeaders = ['ID do chamado', 'Título', 'Cliente', 'Empresa', 'Data']
    const questionHeaders = stats.questions.map(q => q.enunciado)
    const headers = [...fixedHeaders, ...questionHeaders]

    const csvRows = [headers.map(h => csvCell(h)).join(';')]

    stats.responsesList.forEach(item => {
      const fixedCols = [
        csvCell(item.ticketId),
        csvCell(item.ticketTitle),
        csvCell(item.clientName),
        csvCell(item.companyName),
        csvCell(new Date(item.date).toLocaleString('pt-BR'))
      ]
      const questionCols = stats.questions.map(q => {
        const answer = item.answers.find(a => a.questionId === q.questionId)
        return csvCell(answer?.display ?? '—')
      })
      csvRows.push([...fixedCols, ...questionCols].join(';'))
    })

    const csvContent = '﻿' + csvRows.join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `pesquisa_satisfacao_relatorio_${Date.now()}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleExportPDF = () => {
    if (!stats) return

    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      setAlert({ isOpen: true, title: 'Pop-up bloqueado', message: 'Por favor, permita pop-ups para gerar o relatório em PDF.', variant: 'warning' })
      return
    }

    const companyFilterText = selectedOrg ? selectedOrg.split(',').map(id => orgs.find(o => o.id === id)?.name || 'Empresa específica').join(', ') : 'Todas as empresas'
    const periodText = (startDate || endDate) ? `${startDate ? new Date(startDate).toLocaleDateString('pt-BR') : 'início'} até ${endDate ? new Date(endDate).toLocaleDateString('pt-BR') : 'fim'}` : 'Todo o período'

    const questionHeaders = stats.questions.map(q =>
      `<th>${escapeHtml(q.enunciado)}</th>`
    ).join('')

    const rowsHtml = stats.responsesList.map(item => {
      const questionCells = stats.questions.map(q => {
        const answer = item.answers.find(a => a.questionId === q.questionId)
        return `<td style="max-width: 200px; word-break: break-word;">${escapeHtml(answer?.display ?? '—')}</td>`
      }).join('')
      return `
        <tr>
          <td>${escapeHtml(item.ticketId)}</td>
          <td>${escapeHtml(item.ticketTitle)}</td>
          <td>${escapeHtml(item.clientName)}</td>
          <td>${escapeHtml(item.companyName)}</td>
          <td>${new Date(item.date).toLocaleDateString('pt-BR')}</td>
          ${questionCells}
        </tr>
      `
    }).join('')

    const colspanTotal = 5 + stats.questions.length

    printWindow.document.write(`
      <html>
        <head>
          <title>Relatório de pesquisa de satisfação</title>
          <style>
            body { font-family: 'Schibsted Grotesk', 'Segoe UI', sans-serif; color: #0b2332; padding: 24px; line-height: 1.5; }
            h1 { font-size: 26px; margin: 0 0 4px; font-weight: 500; }
            h2 { font-size: 17px; margin: 28px 0 0; font-weight: 500; }
            .subtitle { font-size: 14px; color: #4f616b; }
            .kpi-container { display: grid; grid-template-columns: repeat(3, 1fr); border-top: 1px solid #0b2332; border-bottom: 1px solid #d4dde3; margin-bottom: 30px; }
            .kpi-card { padding: 12px 16px 14px 0; }
            .kpi-val { font-size: 28px; line-height: 1.2; }
            .kpi-lbl { font-size: 13px; color: #4f616b; }
            table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
            th { border-bottom: 1px solid #0b2332; padding: 8px 10px 8px 0; text-align: left; font-weight: 400; color: #4f616b; }
            td { border-bottom: 1px solid #d4dde3; padding: 8px 10px 8px 0; vertical-align: top; }
            @media print {
              body { padding: 0; }
              button { display: none; }
            }
          </style>
        </head>
        <body>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 12px; margin-bottom: 20px;">
            <div>
              <h1>Relatório de pesquisa de satisfação</h1>
              <div class="subtitle">Gerado automaticamente pelo sistema ISA</div>
            </div>
            <div style="text-align: right; font-size: 12px; color: #4f616b;">
              <strong>Data de geração:</strong> ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR')}<br>
              <strong>Filtros aplicados:</strong> ${escapeHtml(companyFilterText)} | ${escapeHtml(periodText)}
            </div>
          </div>

          <div class="kpi-container">
            <div class="kpi-card">
              <div class="kpi-lbl">Pesquisas enviadas</div>
              <div class="kpi-val">${stats.sent}</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-lbl">Pesquisas respondidas</div>
              <div class="kpi-val">${stats.responses}</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-lbl">Taxa de resposta</div>
              <div class="kpi-val">${stats.responseRate}%</div>
            </div>
          </div>

          <h2>Listagem completa de respostas</h2>
          <table>
            <thead>
              <tr>
                <th>Chamado</th>
                <th>Título</th>
                <th>Cliente</th>
                <th>Empresa</th>
                <th>Data</th>
                ${questionHeaders}
              </tr>
            </thead>
            <tbody>
              ${rowsHtml || `<tr><td colspan="${colspanTotal}" style="text-align: center; padding: 20px; color: #4f616b;">Nenhuma resposta registrada para os filtros selecionados.</td></tr>`}
            </tbody>
          </table>

          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 300);
            }
          </script>
        </body>
      </html>
    `)
    printWindow.document.close()
  }

  const filteredResponses = stats?.responsesList.filter(item => {
    const term = searchTerm.toLowerCase().trim()
    if (!term) return true
    return (
      item.ticketId.toLowerCase().includes(term) ||
      (item.ticketTitle || '').toLowerCase().includes(term) ||
      (item.clientName || '').toLowerCase().includes(term) ||
      (item.companyName || '').toLowerCase().includes(term)
    )
  }) || []

  const filteredUnanswered = stats?.unansweredList.filter(item => {
    const term = searchTerm.toLowerCase().trim()
    if (!term) return true
    return (
      item.ticketId.toLowerCase().includes(term) ||
      (item.ticketTitle || '').toLowerCase().includes(term) ||
      (item.clientName || '').toLowerCase().includes(term) ||
      (item.clientEmail || '').toLowerCase().includes(term) ||
      (item.companyName || '').toLowerCase().includes(term)
    )
  }) || []

  const TABS = [
    ['overview', 'Visão geral'],
    ['answered', `Pesquisas respondidas (${stats?.responsesList?.length || 0})`],
    ['unanswered', `Pesquisas pendentes (${stats?.unansweredList?.length || 0})`],
  ] as const
  const dateTime = (d: string) => `${new Date(d).toLocaleDateString('pt-BR')} ${new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`

  return (
    <div style={{ flex: 1, overflow: 'auto', background: 'var(--bg-app)' }}>
      <PageHeader
        title="Pesquisa de satisfação"
        subtitle={loading ? 'Atualizando...' : 'Resultados das pesquisas e comentários dos clientes'}
        actions={<>
          {stats && <>
            <Btn variant="ghost" size="sm" onClick={handleExportExcel}>Exportar Excel (CSV)</Btn>
            <Btn variant="ghost" size="sm" onClick={handleExportPDF}>Gerar PDF</Btn>
          </>}
          <div style={{ position: 'relative' }}>
            <FilterButton
              activeCount={activeFilterCount}
              activeSavedFilter={activeSavedFilter}
              onOpen={() => setFilterOpen((v) => !v)}
              onClearSaved={() => { setActiveSavedFilter(null); handleClearFilters() }}
              isOpen={filterOpen}
            />
            <FilterDropdown
              isOpen={filterOpen}
              onClose={() => setFilterOpen(false)}
              savedFilters={savedFilters}
              onSelectSaved={handleSelectSaved}
              onSaveNew={handleSaveFilter}
              onDeleteSaved={handleDeleteSaved}
              onApply={() => {}}
              onClear={handleClearFilters}
              dateFrom={startDate}
              dateTo={endDate}
              onDateFromChange={setStartDate}
              onDateToChange={setEndDate}
              showDateFilter={true}
            >
              <FilterField label="Empresa">
                <SearchableSelect
                  compact
                  multiple
                  value={selectedOrg}
                  onChange={v => setSelectedOrg(v)}
                  placeholder="Todas as empresas"
                  searchPlaceholder="Buscar empresa..."
                  options={[
                    { value: '', label: 'Todas as empresas' },
                    ...orgs.map(org => ({ value: org.id, label: org.name })),
                  ]}
                />
              </FilterField>
            </FilterDropdown>
          </div>
        </>}
      />

      {stats && (
        <div style={{ padding: '0 var(--page-gutter) 56px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px 24px', marginBottom: 20 }}>
            <div className="subtabs">
              {TABS.map(([key, label]) => <button key={key} type="button" aria-pressed={activeTab === key} onClick={() => setActiveTab(key)}>{label}</button>)}
            </div>
            {activeTab !== 'overview' && (
              <div style={{ display: 'flex', gap: 8, flex: '1 1 260px', maxWidth: 420 }}>
                <input
                  type="text"
                  placeholder="Pesquisar por número de chamado, assunto, cliente ou empresa..."
                  aria-label="Pesquisar"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  maxLength={100}
                  style={{ flex: 1, minWidth: 0, minHeight: 36, padding: '4px 10px', border: '0 solid var(--field-line)', fontSize: 14, fontFamily: 'var(--font)', background: 'var(--bg-input)', color: 'var(--text-1)' }}
                />
                {searchTerm && <Btn variant="ghost" size="sm" onClick={() => setSearchTerm('')}>Limpar</Btn>}
              </div>
            )}
          </div>

          {activeTab === 'overview' && (
            <>
              <Figures>
                <StatCard label="Taxa de resposta" value={`${stats.responseRate}%`} sub="Respondidas / enviadas" />
                <StatCard label="Pesquisas respondidas" value={fmtCount(stats.responses)} sub="Respostas recebidas" />
                <StatCard label="Pesquisas enviadas" value={fmtCount(stats.sent)} sub="Convites enviados" />
              </Figures>

              <Card className="sect">
                <h3>Respostas por pergunta</h3>
                <div className="sect-body">
                  {stats.questions.length === 0 && <Vazio>Nenhuma pergunta cadastrada.</Vazio>}
                  {stats.questions.map((q: SurveyQuestionStat) => <QuestionCard key={q.questionId} q={q} />)}
                </div>
              </Card>

              {stats.monthlyTrend?.length > 0 && <TrendChart data={stats.monthlyTrend} />}
            </>
          )}

          {activeTab === 'answered' && (!filteredResponses || filteredResponses.length === 0 ? (
            <p className="empty-line">{searchTerm ? 'Nenhum resultado encontrado para a pesquisa.' : 'Nenhuma pesquisa respondida encontrada.'}</p>
          ) : (
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    {['Chamado', 'Título', 'Cliente', 'Empresa', 'Respondido em'].map(h => <th key={h}><SortHeader label={h} {...answeredSort.header(h)} /></th>)}
                    {stats.questions.map(q => (
                      <th key={q.questionId} style={{ minWidth: 150, maxWidth: 240 }}><SortHeader label={q.enunciado} {...answeredSort.header(`q:${q.questionId}`)} /></th>
                    ))}
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {answeredSort.apply(filteredResponses, {
                    'Chamado': item => item.ticketId,
                    'Título': item => item.ticketTitle,
                    'Cliente': item => item.clientName,
                    'Empresa': item => item.companyName,
                    'Respondido em': item => new Date(item.date),
                    ...Object.fromEntries(stats.questions.map(q => [`q:${q.questionId}`, (item: typeof filteredResponses[number]) => {
                      const display = item.answers.find(a => a.questionId === q.questionId)?.display
                      const n = Number(display) // notas numéricas ordenam como número
                      return display && !isNaN(n) ? n : display
                    }])),
                  }).map((item) => (
                    <tr key={item.ticketId}>
                      <td className="id">{item.ticketId}</td>
                      <td style={{ maxWidth: 220, overflow: 'hidden' }}><TruncatedText text={item.ticketTitle} style={{ display: 'block' }} /></td>
                      <td>{item.clientName}</td>
                      <td>{item.companyName}</td>
                      <td className="num">{dateTime(item.date)}</td>
                      {stats.questions.map(q => <td key={q.questionId}>{item.answers.find(a => a.questionId === q.questionId)?.display ?? '—'}</td>)}
                      <td style={{ width: 1 }}><Btn size="xs" variant="ghost" onClick={() => handleOpenDetails(item.ticketId, item.answers)}>Detalhes</Btn></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {activeTab === 'unanswered' && (!filteredUnanswered || filteredUnanswered.length === 0 ? (
            <p className="empty-line">{searchTerm ? 'Nenhum resultado encontrado para a pesquisa.' : 'Nenhuma pesquisa pendente registrada.'}</p>
          ) : (
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    {['Chamado', 'Título', 'Cliente', 'Empresa', 'Enviada em', 'Tentativas', 'Status'].map(h => <th key={h}><SortHeader label={h} {...unansweredSort.header(h)} /></th>)}
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {unansweredSort.apply(filteredUnanswered, {
                    'Chamado': item => item.ticketId,
                    'Título': item => item.ticketTitle,
                    'Cliente': item => item.clientName,
                    'Empresa': item => item.companyName,
                    'Enviada em': item => new Date(item.sentAt),
                    'Tentativas': item => item.dispatchesCount,
                    'Status': item => item.status,
                  }).map((item) => (
                    <tr key={item.ticketId}>
                      <td className="id">{item.ticketId}</td>
                      <td style={{ maxWidth: 220, overflow: 'hidden' }}><TruncatedText text={item.ticketTitle} style={{ display: 'block' }} /></td>
                      <td>{item.clientName}<br /><small>{item.clientEmail}</small></td>
                      <td>{item.companyName}</td>
                      <td className="num">{dateTime(item.sentAt)}</td>
                      <td className="num">{item.dispatchesCount}</td>
                      <td className={item.status === 'expirada' ? 'urgent' : undefined}>{item.status}</td>
                      <td style={{ width: 1, whiteSpace: 'nowrap' }}>
                        <Btn size="xs" variant="ghost" onClick={() => handleOpenDetails(item.ticketId)}>Detalhes</Btn>
                        <Btn size="xs" variant="secondary" disabled={resending[item.ticketId]} onClick={() => handleResend(item.ticketId)}>
                          {resending[item.ticketId] ? 'Enviando...' : 'Reenviar e-mail'}
                        </Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      <AlertModal
        isOpen={alert.isOpen}
        onClose={() => setAlert({ ...alert, isOpen: false })}
        title={alert.title}
        message={alert.message}
        variant={alert.variant}
      />

      {/* Details Modal */}
      <Modal
        isOpen={isDetailsModalOpen}
        onClose={() => setIsDetailsModalOpen(false)}
        title={`Detalhes do chamado #${selectedTicketDetails?.id || ''}`}
        width={700}
      >
        {detailsLoading ? (
          <Loading size="compact" label="Carregando detalhes do chamado…" />
        ) : selectedTicketDetails ? (
          <>
            <dl className="pairs">
              <dt>Título</dt><dd>{selectedTicketDetails.title}</dd>
              <dt>Fila</dt><dd>{queueName(selectedTicketDetails.queue) || '—'}</dd>
              <dt>Status</dt><dd><StatusBadge status={selectedTicketDetails.status} /></dd>
              <dt>Prioridade</dt><dd><PriorityBadge priority={selectedTicketDetails.priority} /></dd>
              <dt>Cliente</dt><dd>{selectedTicketDetails.user?.name || '—'} ({selectedTicketDetails.user?.email || '—'})</dd>
              <dt>Empresa</dt><dd>{selectedTicketDetails.org?.name || '—'}</dd>
              <dt>Criado em</dt><dd>{new Date(selectedTicketDetails.createdAt).toLocaleString('pt-BR')}</dd>
              <dt>Resolvido em</dt><dd>{selectedTicketDetails.resolved_at ? new Date(selectedTicketDetails.resolved_at).toLocaleString('pt-BR') : '—'}</dd>
              <dt>Descrição</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{selectedTicketDetails.description}</dd>
            </dl>

            {selectedAnswers && selectedAnswers.length > 0 && (
              <Card className="sect" style={{ marginTop: 24 }}>
                <h3>Respostas da pesquisa</h3>
                <dl className="pairs sect-body">
                  {selectedAnswers.map((ans, idx) => <Fragment key={idx}><dt>{ans.enunciado}</dt><dd>{ans.display}</dd></Fragment>)}
                </dl>
              </Card>
            )}
          </>
        ) : null}
      </Modal>
    </div>
  )
}

const SENT = 'color-mix(in srgb, var(--accent) 30%, var(--bg-card))', ANSWERED = 'var(--accent)', INDEX = 'var(--text-1)'

type TrendPoint = SurveyDashboardStats['monthlyTrend'][number]

/**
 * Gráfico combinado dos 12 meses: barras de volume (enviadas/respondidas) no
 * eixo esquerdo + linha do índice de satisfação (0..100) no eixo direito.
 * SVG inline — o projeto não usa lib de gráfico e não vale adicionar uma.
 */
function TrendChart({ data }: { data: TrendPoint[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  // Geometria (viewBox fixo; o SVG escala com o container)
  const W = 960, H = 220
  const ML = 44, MR = 44, MT = 16, MB = 40
  const plotW = W - ML - MR
  const plotH = H - MT - MB

  const maxVol = Math.max(1, ...data.map(d => d.sent))
  // Topo "redondo" para o eixo de volume não terminar num número quebrado
  const volTop = Math.ceil(maxVol / 4) * 4 || 4

  const bandW = plotW / data.length
  const yVol = (v: number) => MT + plotH - (v / volTop) * plotH
  const yScore = (v: number) => MT + plotH - (v / 100) * plotH
  const xCenter = (i: number) => ML + bandW * i + bandW / 2

  const scored = data.map((d, i) => ({ d, i })).filter(p => p.d.satisfactionScore !== null)
  const totalSent = data.reduce((s, d) => s + d.sent, 0)
  const totalResponses = data.reduce((s, d) => s + d.responses, 0)
  const temAmostraPequena = scored.some(p => p.d.responses < AMOSTRA_MINIMA)
  const pontoUnico = scored.length === 1
  const semDados = totalSent === 0 && totalResponses === 0

  const barW = Math.min(18, bandW * 0.28)
  const gridLines = [0, 0.25, 0.5, 0.75, 1]

  // O viewBox é escalável: coordenada do SVG não é pixel de tela. O tooltip é
  // um div HTML, então precisa do fator de conversão para se posicionar.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setScale(el.getBoundingClientRect().width / W))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const px = (vbX: number) => vbX * scale
  const py = (vbY: number) => vbY * scale

  // Tooltip: prefere a direita, vira quando estouraria a borda.
  const TT_W = 210, GAP = 12
  let ttLeft = 0, ttTop = 0
  if (hover !== null) {
    const d = data[hover]
    const anchorVbY = d.satisfactionScore !== null
      ? yScore(d.satisfactionScore)
      : yVol(Math.max(d.sent, d.responses))
    const ax = px(xCenter(hover))
    const ay = py(anchorVbY)
    const flip = ax + GAP + TT_W > px(W) - 4
    ttLeft = flip ? ax - GAP - TT_W : ax + GAP
    const ttH = tooltipRef.current?.offsetHeight ?? 96
    ttTop = Math.max(0, Math.min(ay - ttH / 2, py(H) - ttH))
  }

  return (
    <Card className="sect">
      <div className="sect-top">
        <div>
          <h3 className="sect-title">Evolução nos últimos 12 meses</h3>
          <p>Volume de pesquisas e índice de satisfação por mês</p>
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', fontSize: 13, color: 'var(--text-2)' }}>
          <LegendItem color={SENT} label="Enviadas" />
          <LegendItem color={ANSWERED} label="Respondidas" />
          <LegendItem color={INDEX} label="Índice de satisfação" line />
          {temAmostraPequena && <span>Vazado: amostra pequena (n&lt;{AMOSTRA_MINIMA})</span>}
        </div>
      </div>

      {/* Leitura rápida do período: média, melhor e pior mês com nota */}
      {scored.length > 0 && (
        <>
          <p style={{ display: 'flex', gap: '4px 28px', flexWrap: 'wrap', margin: '14px 0 4px', fontSize: 14, color: 'var(--text-2)' }}>
            <TrendKpi
              label={pontoUnico ? `Índice de ${monthLabel(scored[0].d.month)}` : 'Índice médio (12m)'}
              value={fmtScore(
                Math.round((scored.reduce((s, p) => s + p.d.satisfactionScore!, 0) / scored.length) * 10) / 10
              )}
            />
            {/* Com um mês só, melhor e pior são o mesmo — os dois lado a lado parecem bug */}
            {scored.length >= 2 && (
              <>
                <TrendKpi
                  label="Melhor mês"
                  value={(() => {
                    const best = scored.reduce((a, b) => (b.d.satisfactionScore! > a.d.satisfactionScore! ? b : a))
                    return `${monthLabel(best.d.month)} · ${fmtScore(best.d.satisfactionScore)}${best.d.responses < AMOSTRA_MINIMA ? '*' : ''}`
                  })()}
                />
                <TrendKpi
                  label="Pior mês"
                  value={(() => {
                    const worst = scored.reduce((a, b) => (b.d.satisfactionScore! < a.d.satisfactionScore! ? b : a))
                    return `${monthLabel(worst.d.month)} · ${fmtScore(worst.d.satisfactionScore)}${worst.d.responses < AMOSTRA_MINIMA ? '*' : ''}`
                  })()}
                />
              </>
            )}
            <TrendKpi label="Meses com resposta" value={`${fmtCount(scored.length)} de 12`} />
          </p>
          {temAmostraPequena && (
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>
              * baseado em menos de {AMOSTRA_MINIMA} respostas
            </div>
          )}
        </>
      )}

      <div style={{ marginTop: 12, width: '100%', overflowX: 'auto' }}>
        {/* position:relative envolve só o SVG — assim o tooltip acompanha o
            scroll horizontal sem precisar descontar scrollLeft */}
        <div
          style={{ position: 'relative', minWidth: 560, outlineOffset: 2 }}
          tabIndex={semDados ? -1 : 0}
          role="group"
          aria-label="Gráfico de evolução mensal. Use as setas esquerda e direita para percorrer os meses."
          onKeyDown={e => {
            if (semDados) return
            if (e.key === 'ArrowRight') { setHover(h => Math.min(data.length - 1, (h ?? -1) + 1)); e.preventDefault() }
            if (e.key === 'ArrowLeft') { setHover(h => Math.max(0, (h ?? data.length) - 1)); e.preventDefault() }
            if (e.key === 'Home') { setHover(0); e.preventDefault() }
            if (e.key === 'End') { setHover(data.length - 1); e.preventDefault() }
            if (e.key === 'Escape') setHover(null)
          }}
          onBlur={() => setHover(null)}
        >
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            style={{ width: '100%', minWidth: 560, display: 'block', opacity: semDados ? 0.35 : 1 }}
            aria-hidden="true"
          >
            {/* Grid + eixos */}
            {gridLines.map(g => {
              const y = MT + plotH - g * plotH
              return (
                <g key={g}>
                  <line x1={ML} y1={y} x2={W - MR} y2={y} stroke="var(--border)" strokeWidth={1} />
                  <text x={ML - 8} y={y + 4} textAnchor="end" fontSize={10} fill="var(--text-3)">
                    {fmtCount(Math.round(g * volTop))}
                  </text>
                  <text x={W - MR + 8} y={y + 4} textAnchor="start" fontSize={10} fill="var(--text-3)">
                    {Math.round(g * 100)}
                  </text>
                </g>
              )
            })}

            {/* Crosshair atrás das barras — a faixa sozinha some no tema escuro */}
            {hover !== null && (
              <line
                x1={xCenter(hover)} y1={MT} x2={xCenter(hover)} y2={MT + plotH}
                stroke="var(--text-3)" strokeWidth={1} strokeDasharray="3 3"
                opacity={0.55} pointerEvents="none"
              />
            )}

            {data.map((d, i) => {
              const cx = xCenter(i)
              const isHover = hover === i
              const semEnvio = d.sent === 0 && d.responses === 0
              const viradaAno = d.month.endsWith('-01')
              return (
                <g key={d.month}>
                  {/* Faixa de hover — cobre a coluna inteira do mês */}
                  <rect
                    x={ML + bandW * i}
                    y={MT}
                    width={bandW}
                    height={plotH}
                    fill={isHover ? 'var(--bg-elevated)' : 'transparent'}
                    opacity={0.5}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                  />
                  {d.sent > 0 && (
                    <rect
                      x={cx - barW - 2}
                      y={yVol(d.sent)}
                      width={barW}
                      height={Math.max(0, MT + plotH - yVol(d.sent))}
                      fill={SENT}
                      pointerEvents="none"
                    />
                  )}
                  {d.responses > 0 ? (
                    <rect
                      x={cx + 2}
                      y={yVol(d.responses)}
                      width={barW}
                      height={Math.max(0, MT + plotH - yVol(d.responses))}
                      fill={ANSWERED}
                      pointerEvents="none"
                    />
                  ) : d.sent > 0 ? (
                    // Enviou e ninguém respondeu: o zero precisa aparecer como
                    // zero, diferente de um mês sem operação nenhuma.
                    <rect
                      x={cx + 2} y={MT + plotH - 2} width={barW} height={2}
                      fill={ANSWERED} pointerEvents="none"
                    />
                  ) : null}
                  <text
                    x={cx} y={H - MB + 16} textAnchor="middle" fontSize={10}
                    fill={viradaAno ? 'var(--text-2)' : 'var(--text-3)'}
                    fontWeight={viradaAno ? 600 : 400}
                    opacity={semEnvio ? 0.45 : 1}
                  >
                    {monthLabel(d.month)}
                  </text>
                </g>
              )
            })}

            {/* Linha do índice de satisfação — só liga meses com nota */}
            {scored.length > 1 && (
              <polyline
                points={scored.map(p => `${xCenter(p.i)},${yScore(p.d.satisfactionScore!)}`).join(' ')}
                fill="none"
                stroke={INDEX}
                strokeWidth={1.75}
                pointerEvents="none"
              />
            )}
            {scored.map(p => (
              <g key={p.d.month}>
                <rect
                  x={xCenter(p.i) - 4}
                  y={yScore(p.d.satisfactionScore!) - 4}
                  width={8}
                  height={8}
                  // Vazado = estimativa provisória (amostra pequena)
                  fill={p.d.responses < AMOSTRA_MINIMA ? 'var(--bg-card)' : INDEX}
                  stroke={INDEX}
                  strokeWidth={1.75}
                  pointerEvents="none"
                />
                {pontoUnico && (
                  <text
                    x={xCenter(p.i) + 12}
                    y={yScore(p.d.satisfactionScore!) + 4}
                    fontSize={12}
                    fontWeight={600}
                    fill="var(--text-1)"
                    pointerEvents="none"
                  >
                    {fmtScore(p.d.satisfactionScore)}
                  </text>
                )}
              </g>
            ))}

            {/* Eixos */}
            <line x1={ML} y1={MT} x2={ML} y2={MT + plotH} stroke="var(--border-strong)" strokeWidth={1} />
            <line x1={W - MR} y1={MT} x2={W - MR} y2={MT + plotH} stroke="var(--border-strong)" strokeWidth={1} />
          </svg>

          {semDados && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 4, textAlign: 'center'
            }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)' }}>Sem dados no período</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                Nenhuma pesquisa foi enviada nos últimos 12 meses.
              </div>
            </div>
          )}

          {!semDados && totalResponses === 0 && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
              justifyContent: 'center', pointerEvents: 'none'
            }}>
              <div style={{
                fontSize: 12, color: 'var(--text-3)', background: 'var(--bg-card)',
                padding: '4px 10px'
              }}>
                {fmtCount(totalSent)} pesquisas enviadas, nenhuma respondida ainda.
              </div>
            </div>
          )}

          {hover !== null && (
            <div ref={tooltipRef} style={{ ...tooltipStyle, left: ttLeft, top: ttTop }}>
              <div style={tooltipHeaderStyle}>{monthLabel(data[hover].month)}</div>
              <TipRow color={SENT} label="Enviadas" value={fmtCount(data[hover].sent)} />
              <TipRow color={ANSWERED} label="Respondidas" value={fmtCount(data[hover].responses)} />
              <TipRow color="transparent" label="Taxa de resposta" value={fmtPct(data[hover].responseRate)} />
              <TipRow color={INDEX} label="Índice" value={fmtScore(data[hover].satisfactionScore)} />
              {data[hover].satisfactionScore !== null && data[hover].responses < AMOSTRA_MINIMA && (
                <div style={{
                  marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--border)',
                  fontSize: 12, color: 'var(--warning)'
                }}>
                  Apenas {fmtCount(data[hover].responses)}{' '}
                  {data[hover].responses === 1 ? 'resposta' : 'respostas'} — índice pouco confiável
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {pontoUnico && (
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>
          Dados disponíveis apenas em {monthLabel(scored[0].d.month)}. A tendência aparece quando houver
          ao menos dois meses com resposta.
        </div>
      )}

      {/* Fonte acessível: o SVG é aria-hidden, o leitor de tela lê a tabela */}
      <div style={visuallyHidden}><table>
        <caption>Evolução mensal da pesquisa de satisfação</caption>
        <thead>
          <tr>
            <th>Mês</th><th>Enviadas</th><th>Respondidas</th><th>Taxa de resposta</th><th>Índice</th>
          </tr>
        </thead>
        <tbody>
          {data.map(d => (
            <tr key={d.month}>
              <td>{monthLabel(d.month)}</td>
              <td>{fmtCount(d.sent)}</td>
              <td>{fmtCount(d.responses)}</td>
              <td>{fmtPct(d.responseRate)}</td>
              <td>{fmtScore(d.satisfactionScore)}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <div aria-live="polite" style={visuallyHidden}>
        {hover !== null &&
          `${monthLabel(data[hover].month)}: ${fmtCount(data[hover].sent)} enviadas, ${fmtCount(data[hover].responses)} respondidas, taxa ${fmtPct(data[hover].responseRate)}, índice ${fmtScore(data[hover].satisfactionScore)}`}
      </div>
    </Card>
  )
}

function TrendKpi({ label, value }: { label: string; value: string }) {
  return <span>{label} <b style={{ fontWeight: 600, color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>{value}</b></span>
}

function LegendItem({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
      <span style={{ width: line ? 14 : 10, height: line ? 2 : 10, background: color, flexShrink: 0 }} />
      {label}
    </span>
  )
}

const tooltipStyle: React.CSSProperties = {
  position: 'absolute',
  width: 210,
  pointerEvents: 'none',
  zIndex: 20,
  background: 'var(--bg-card)',
  border: '1px solid var(--border-strong)',
  boxShadow: 'var(--pop-shadow)',
  padding: '10px 12px',
  fontSize: 12,
  lineHeight: 1.45,
  color: 'var(--text-2)',
  transition: 'left 90ms ease-out, top 90ms ease-out'
}

const tooltipHeaderStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-1)',
  marginBottom: 8,
  paddingBottom: 6,
  borderBottom: '1px solid var(--border)'
}

function QuestionCard({ q }: { q: SurveyQuestionStat }) {
  const comments = q.comments ?? []
  const livre = q.tipo === 'texto_livre'

  // A forma do gráfico sai do tipo da pergunta; tipos legados mapeiam nos modernos equivalentes.
  const tipo = q.tipo === 'escala_1_5' ? 'escala' : q.tipo === 'unica_escolha' ? 'escolha_unica' : q.tipo

  return (
    <section className="survey-q">
      <div>
        <h3>{q.enunciado}</h3>
        <p>
          {livre
            ? `Texto livre · ${fmtCount(comments.length)} ${comments.length === 1 ? 'comentário' : 'comentários'}`
            : q.distribution !== null && `n = ${fmtCount(q.answeredCount ?? 0)} ${q.answeredCount === 1 ? 'respondente' : 'respondentes'}`}
          {!livre && !q.ativa && ' · Desativada'}
        </p>
      </div>
      <div style={{ minWidth: 0 }}>
        {livre ? (
          comments.length === 0 ? <Vazio>Nenhum comentário registrado.</Vazio> : (
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              {comments.map((comment, index) => (
                <div key={index} className="quote">
                  {comment.text}
                  <small>
                    Chamado {comment.ticketId} · {new Date(comment.date).toLocaleDateString('pt-BR')}{' '}
                    {new Date(comment.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </small>
                </div>
              ))}
            </div>
          )
        ) : q.distribution === null ? <Vazio>Sem dados de distribuição.</Vazio>
          : q.distribution.every(d => d.count === 0) ? <Vazio>Sem respostas neste período.</Vazio>
          : <>
              {tipo === 'nps' ? <NpsChart q={q} /> : tipo === 'escolha_unica' ? <UnicaChart q={q} /> : <Barras q={q} multipla={tipo === 'escolha_multipla'} />}
              <QuestionSparkline q={q} />
            </>}
      </div>
    </section>
  )
}

const Vazio = ({ children }: { children: string }) => <p className="empty-line" style={{ paddingTop: 0 }}>{children}</p>

type Parte = { label: string; count: number; cor: string }

/** Barra única de 100% com a legenda embaixo. */
function Empilhada({ partes }: { partes: Parte[] }) {
  const total = partes.reduce((s, p) => s + p.count, 0)
  if (total === 0) return null
  const txt = (p: Parte) => `${p.label}: ${fmtCount(p.count)} (${fmtPct((p.count / total) * 100)})`
  return (
    <>
      <div className="chart-stack">
        {partes.filter(p => p.count > 0).map(p => <span key={p.label} title={txt(p)} style={{ flex: p.count, background: p.cor }} />)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 22px', marginTop: 10, fontSize: 13.5, color: 'var(--text-2)' }}>
        {partes.map(p => <LegendItem key={p.label} color={p.cor} label={txt(p)} />)}
      </div>
    </>
  )
}

/** NPS: detratores, neutros e promotores na mesma barra. Neutros em cinza: não entram na fórmula. */
function NpsChart({ q }: { q: SurveyQuestionStat }) {
  const b = q.npsBuckets ?? { detratores: 0, neutros: 0, promotores: 0 }
  return (
    <>
      <p className="chart-total" style={{ marginTop: 0 }}><b>{fmtNps(q.npsScore ?? 0)}</b><span>NPS = %Promotores − %Detratores</span></p>
      <Empilhada partes={[
        { label: 'Detratores (0-6)', count: b.detratores, cor: 'var(--danger)' },
        { label: 'Neutros (7-8)', count: b.neutros, cor: 'var(--border-strong)' },
        { label: 'Promotores (9-10)', count: b.promotores, cor: 'var(--accent)' },
      ]} />
    </>
  )
}

/** Escolha única, na ordem declarada das opções: ordenar por tamanho mudaria o gráfico a cada período. */
function UnicaChart({ q }: { q: SurveyQuestionStat }) {
  return <Empilhada partes={q.distribution!.map((d, i) => ({ label: d.rotulo, count: d.count, cor: CHART_COLORS[i % CHART_COLORS.length] }))} />
}

/**
 * Escala, estrelas, emoji e múltipla escolha: uma barra por opção. A nota vai da maior para
 * a menor (reordenar por frequência destrói a leitura ordinal); múltipla vai por contagem e
 * usa o % próprio, porque a soma passa de 100%.
 */
function Barras({ q, multipla }: { q: SurveyQuestionStat; multipla: boolean }) {
  const numerica = q.distribution!.every(d => Number.isFinite(Number(d.valor)))
  const dist = multipla
    ? [...q.distribution!].sort((a, b) => b.count - a.count)
    : numerica ? [...q.distribution!].sort((a, b) => Number(b.valor) - Number(a.valor)) : q.distribution!
  const maxCount = Math.max(...dist.map(d => d.count), 1)
  return (
    <>
      {!multipla && q.average !== null && <p className="chart-total" style={{ marginTop: 0 }}><b>{nf1.format(q.average)}</b><span>{q.scaleMax ? `média de ${fmtCount(q.scaleMax)}` : 'média'}</span></p>}
      <div className="chart-rows">
        {dist.map(d => (
          <div key={d.valor} className="chart-row">
            <span>{d.emoji && `${d.emoji} `}{d.rotulo}</span>
            <Meter value={multipla ? Math.min(100, d.pct) : d.count} max={multipla ? 100 : maxCount} />
            <span className="chart-share" style={{ minWidth: 76 }}>{fmtCount(d.count)} ({fmtPct(d.pct)})</span>
          </div>
        ))}
      </div>
      {multipla && <p className="chart-empty" style={{ padding: '10px 0 0' }}>Cada respondente pode marcar mais de uma opção; a soma ultrapassa 100%.</p>}
    </>
  )
}

/** Mini-série do índice desta pergunta nos 12 meses. */
function QuestionSparkline({ q }: { q: SurveyQuestionStat }) {
  // Um backend mais antigo não envia monthlyScores — a série é opcional, não
  // pode derrubar a pergunta inteira.
  const serie = q.monthlyScores ?? []
  const pts = serie.map((m, i) => ({ m, i })).filter(p => p.m.score !== null)
  if (pts.length < 2) return null

  const W = 320, H = 36, pad = 4
  const x = (i: number) => pad + (i / Math.max(1, serie.length - 1)) * (W - pad * 2)
  const y = (v: number) => H - pad - (v / 100) * (H - pad * 2)
  const delta = Math.round((pts[pts.length - 1].m.score! - pts[0].m.score!) * 10) / 10

  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 16px', marginTop: 14 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: 160, height: 18, flexShrink: 0 }} aria-hidden="true">
        <polyline points={pts.map(p => `${x(p.i)},${y(p.m.score!)}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth={3} />
      </svg>
      <span style={{ fontSize: 13, color: 'var(--text-3)' }}>
        {delta >= 0 ? 'Subiu' : 'Caiu'} {fmtScore(Math.abs(delta))} de {monthLabel(pts[0].m.month)} a {monthLabel(pts[pts.length - 1].m.month)}
      </span>
    </div>
  )
}
