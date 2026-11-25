import { BarList } from '@/components/charts/BarList'
import { getTaskListDrill, type DrillTaskQuery } from '@/services/drillService'
import { Section } from '@/components/projects/insights/Section'
import { useDrill, type DrillProjectItem } from './drillContext'
import { ClickableRow, DrillError, DrillLink, DrillLoading, DrillTaskTable, Empty, HealthPill, ProgressBar, useDrillData } from './drillUi'

/** As tasks por trás de um número: quantas, em que projetos, com quem, e a lista. */
export function TaskListDrillView({ query, subtitle }: { query: DrillTaskQuery; subtitle?: string }) {
  const { open } = useDrill()
  const { data, failed, retry } = useDrillData(() => getTaskListDrill(query), [JSON.stringify(query)])
  if (failed) return <DrillError onRetry={retry} />
  if (!data) return <DrillLoading />
  if (data.total === 0) return <Empty>Nenhuma task neste recorte.</Empty>

  const extra = query.type ? 'cycle' : query.kind === 'done' ? 'done' : 'hours'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div style={{ fontSize: 14, color: 'var(--text-2)' }}>
        {subtitle ? `${subtitle} ` : ''}<strong style={{ color: 'var(--text-1)' }}>{data.total}</strong> task(s){data.total > data.limit ? `, mostrando as ${data.limit} primeiras` : ''}.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 28 }}>
        {!query.projectId && data.byProject.length > 1 && (
          <Section small title="Por projeto">
            <BarList ariaLabel="Tasks por projeto" showShare labelWidth={130}
              items={data.byProject.slice(0, 8).map((p) => ({ id: p.projectId, label: p.name, value: p.count, color: 'var(--accent)' }))}
              onSelect={(it) => open({ kind: 'project', projectId: it.id, title: it.label })} />
          </Section>
        )}
        {!query.assigneeId && data.byAssignee.length > 0 && (
          <Section small title="Por responsável">
            <BarList ariaLabel="Tasks por responsável" showShare labelWidth={130}
              items={data.byAssignee.slice(0, 8).map((p) => ({
                id: p.userId ?? 'none', label: p.name, value: p.count, color: 'var(--accent)',
                selectable: p.canOpen,
                hint: p.canOpen || !p.userId ? undefined : 'Detalhe disponível só para quem está abaixo de você no organograma',
              }))}
              onSelect={(it) => open({ kind: 'person', userId: it.id, projectId: query.projectId, title: it.label })} />
          </Section>
        )}
      </div>
      <Section small title="Tasks">
        <DrillTaskTable rows={data.tasks} showProject={!query.projectId} extra={extra} ariaLabel="Tasks do recorte" />
      </Section>
    </div>
  )
}

/** Projetos por trás de um número do BI; os dados já estão na tela que abriu. */
export function ProjectListDrillView({ items, subtitle }: { items: DrillProjectItem[]; subtitle?: string }) {
  const { open } = useDrill()
  if (items.length === 0) return <Empty>Nenhum projeto neste recorte.</Empty>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {subtitle && <p className="prj-note">{subtitle}</p>}
      <div className="prj-scroll">
        <table aria-label="Projetos" className="table prj">
          <thead>
            <tr>
              <th>Projeto</th>
              <th>Progresso</th>
              <th>Saúde</th>
              <th className="num">Abertas</th>
              <th className="num">Atrasadas</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => {
              const go = () => open({ kind: 'project', projectId: p.id, title: p.name })
              return (
                <ClickableRow key={p.id} onOpen={go}>
                  <td style={{ minWidth: 180 }}>
                    <DrillLink onClick={go}>{p.name}</DrillLink>
                  </td>
                  <td style={{ minWidth: 130 }}><ProgressBar value={p.progress ?? 0} label={`Progresso de ${p.name}`} /></td>
                  <td>{p.health ? <HealthPill health={p.health} /> : '—'}</td>
                  <td className="num">{p.openTasks ?? 0}</td>
                  <td className={p.overdueTasks ? 'num late' : 'num'}>{p.overdueTasks ?? 0}</td>
                </ClickableRow>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
