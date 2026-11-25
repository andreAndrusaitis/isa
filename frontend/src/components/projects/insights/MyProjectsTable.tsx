import { useNavigate } from 'react-router-dom'
import { Btn, Loading } from '@/components/ui'
import { Section } from './Section'
import { visuallyHidden } from '@/components/charts/ChartTooltip'
import type { MyProjectReportRow } from '@/services/projectsService'
import { useDrill } from '@/components/projects/drill/drillContext'
import { ClickableRow, DrillLink } from '@/components/projects/drill/drillUi'

const hours = (h: number) => `${h.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`
/** Tabela "Meus projetos" do BI: os projetos de que sou dono ou gerente. */
export function MyProjectsTable({ rows, days, error }: { rows: MyProjectReportRow[] | null; days: number; error?: boolean }) {
  const navigate = useNavigate()
  const { open } = useDrill()
  return (
    <Section
      title="Meus projetos"
      sub={`Projetos de que você é dono ou gerente. Atrasada = prazo vencido até ontem; ciclo médio das concluídas nos últimos ${days} dias, em horas úteis.`}
    >
      {error ? (
        <p className="prj-note">Não foi possível carregar os seus projetos. Use "Atualizar" para tentar de novo.</p>
      ) : !rows ? (
        <Loading size="compact" />
      ) : rows.length === 0 ? (
        <p className="prj-note">Você ainda não é dono nem gerente de nenhum projeto ativo.</p>
      ) : (
        <div className="prj-scroll">
          <table aria-label="Meus projetos" className="table prj">
            <thead>
              <tr>
                <th>Projeto</th>
                <th className="num">Abertas</th>
                <th className="num">Concluídas</th>
                <th className="num">Atrasadas</th>
                <th className="num">Ciclo médio</th>
                <th className="num">Membros</th>
                <th><span style={visuallyHidden}>Ação</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const details = () => open({ kind: 'project', projectId: p.id, title: p.name })
                return (
                  <ClickableRow key={p.id} onOpen={details}>
                    <td style={{ minWidth: 180 }}><DrillLink onClick={details}>{p.name}</DrillLink></td>
                    <td className="num">{p.openTasks}</td>
                    <td className="num">{p.doneTasks}</td>
                    <td className={p.overdueTasks > 0 ? 'num late' : 'num'}>{p.overdueTasks}</td>
                    <td className="num" title={p.avgCycleHours == null ? 'Nenhuma concluída no período passou por andamento' : undefined}>
                      {p.avgCycleHours == null ? '—' : hours(p.avgCycleHours)}
                    </td>
                    <td className="num">{p.membersCount}</td>
                    <td className="num"><Btn variant="ghost" size="xs" onClick={() => navigate(`/projetos/${p.id}/overview`)}>Visão geral</Btn></td>
                  </ClickableRow>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}
