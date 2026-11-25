import type { Dossier, DossierProject, DossierTask } from './collect'

/** Todo texto vindo do usuário passa por aqui: o arquivo nunca executa conteúdo do banco. */
export function escapeHtml(v: unknown): string {
  if (v == null) return ''
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const TZ = 'America/Sao_Paulo'
const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString('pt-BR', { timeZone: TZ }) : '—')
const fmtDateTime = (d: Date | null) => (d ? d.toLocaleString('pt-BR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }) : '—')
const e = escapeHtml

const CATEGORY_LABEL: Record<string, string> = {
  backlog: 'Backlog', open: 'A fazer', in_progress: 'Em andamento', in_review: 'Em revisão', done: 'Concluído', cancelled: 'Cancelado',
}
const ACTIVITY_LABEL: Record<string, string> = {
  created: 'criou', status_changed: 'mudou o status', priority_changed: 'mudou a prioridade', assignee_changed: 'mudou o responsável',
  assignees_changed: 'mudou os responsáveis', due_date_changed: 'mudou o prazo', title_changed: 'mudou o título',
  description_changed: 'mudou a descrição', moved_list: 'moveu de lista', commented: 'comentou', checklist_changed: 'mudou o checklist',
  archived: 'arquivou', restored: 'restaurou', milestone_changed: 'mudou o marco', watcher_added: 'passou a seguir',
  watcher_removed: 'deixou de seguir', relation_added: 'relacionou', relation_removed: 'removeu relação',
  approval_requested: 'pediu aprovação', approval_decided: 'decidiu aprovação', task_type_changed: 'mudou o tipo',
  story_points_changed: 'mudou os pontos', sprint_changed: 'mudou a sprint',
}

/** Barras de entregas por semana (SVG puro, sem biblioteca). */
function weeklySvg(weekly: DossierProject['weekly']): string {
  const max = Math.max(1, ...weekly.map((w) => w.completed))
  const W = 640, H = 140, bw = W / Math.max(1, weekly.length)
  const bars = weekly.map((w, i) => {
    const h = Math.round((w.completed / max) * (H - 24))
    return `<rect x="${(i * bw + 2).toFixed(1)}" y="${H - 16 - h}" width="${(bw - 4).toFixed(1)}" height="${h}" class="bar"><title>${e(w.week)}: ${w.completed}</title></rect>`
  }).join('')
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Entregas por semana" class="chart">${bars}<text x="0" y="${H - 2}" class="axis">${e(weekly[0]?.week ?? '')}</text><text x="${W}" y="${H - 2}" text-anchor="end" class="axis">${e(weekly.at(-1)?.week ?? '')}</text></svg>`
}

/** Burndown: restante real × ideal. */
function burndownSvg(b: DossierProject['burndown']): string {
  if (!b || b.days.length < 2) return ''
  const W = 640, H = 160, max = Math.max(1, b.total)
  const x = (i: number) => (i / (b.days.length - 1)) * W
  const y = (v: number) => H - 10 - (v / max) * (H - 20)
  const ideal = b.days.map((d, i) => `${x(i).toFixed(1)},${y(d.ideal).toFixed(1)}`).join(' ')
  const real = b.days.filter((d) => d.remaining != null).map((d, i) => `${x(i).toFixed(1)},${y(d.remaining!).toFixed(1)}`).join(' ')
  return `<h4>Burndown — ${e(b.sprint.name)} (${e(b.unit)})</h4><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Burndown da sprint" class="chart"><polyline points="${ideal}" class="ideal"/><polyline points="${real}" class="real"/></svg>`
}

function taskBlock(t: DossierTask, d: Dossier): string {
  const acts = d.activities.filter((a) => a.taskKey === t.key && a.projectId === t.projectId)
  const coms = d.comments.filter((c) => c.taskKey === t.key && c.projectId === t.projectId)
  const search = [t.key, t.title, t.status, t.assignees.join(' '), t.tags.join(' ')].join(' ').toLowerCase()
  return `<details class="task" data-search="${e(search)}">
<summary><span class="key">${e(t.key)}</span> ${e(t.title)} <span class="muted">${e(t.status)}${t.isMilestone ? ', marco' : ''}</span>${t.overdue ? ' <span class="late">Atrasada</span>' : ''}</summary>
<dl class="meta">
<dt>Tipo</dt><dd>${e(t.type ?? '—')}</dd><dt>Responsáveis</dt><dd>${e(t.assignees.join(', ') || '—')}</dd>
<dt>Prioridade</dt><dd>${e(t.priority)}</dd><dt>Sprint</dt><dd>${e(t.sprint ?? '—')}</dd>
<dt>Criada</dt><dd>${fmtDate(t.createdAt)}</dd><dt>Prazo</dt><dd>${fmtDate(t.dueDate)}</dd>
<dt>Concluída</dt><dd>${fmtDate(t.completedAt)}</dd><dt>Horas ativas</dt><dd>${t.activeHours}</dd>
${t.parentKey ? `<dt>Task pai</dt><dd>${e(t.parentKey)}</dd>` : ''}
${t.blockedBy.length ? `<dt>Depende de</dt><dd>${e(t.blockedBy.join(', '))}</dd>` : ''}
${t.tags.length ? `<dt>Tags</dt><dd>${e(t.tags.join(', '))}</dd>` : ''}
${t.tickets.length ? `<dt>Chamados</dt><dd>${e(t.tickets.join(', '))}</dd>` : ''}
${t.customFields.map((f) => `<dt>${e(f.name)}</dt><dd>${e(f.value)}</dd>`).join('')}
</dl>
${t.description ? `<p class="desc">${e(t.description)}</p>` : ''}
${t.checklist.length ? `<ul class="check">${t.checklist.map((c) => `<li>${c.done ? '☑' : '☐'} ${e(c.text)}</li>`).join('')}</ul>` : ''}
${acts.length ? `<h5>Histórico</h5><ol class="log">${acts.map((a) => `<li><time>${fmtDateTime(a.at)}</time> <b>${e(a.actor)}</b> ${e(ACTIVITY_LABEL[a.type] ?? a.type)}${a.from || a.to ? `: ${e(a.from ?? '—')} → ${e(a.to ?? '—')}` : ''}</li>`).join('')}</ol>` : ''}
${coms.length ? `<h5>Comentários</h5>${coms.map((c) => `<blockquote><time>${fmtDateTime(c.at)}</time> <b>${e(c.author)}</b><p>${e(c.body)}</p></blockquote>`).join('')}` : ''}
</details>`
}

function projectSection(p: DossierProject, d: Dossier): string {
  const tasks = d.tasks.filter((t) => t.projectId === p.id)
  const delivered = tasks.filter((t) => t.completedAt && (!d.period.from || t.completedAt >= d.period.from) && (!d.period.to || t.completedAt <= d.period.to))
  const late = tasks.filter((t) => t.overdue)
  const blocked = tasks.filter((t) => t.openBlockers > 0 && !['done', 'cancelled'].includes(t.statusCategory))
  const unassigned = tasks.filter((t) => t.assignees.length === 0 && !['done', 'cancelled'].includes(t.statusCategory))
  const milestones = tasks.filter((t) => t.isMilestone)
  const sprints = d.sprints.filter((s) => s.projectId === p.id)
  const tickets = d.tickets.filter((k) => k.projectId === p.id)
  const list = (ts: DossierTask[]) => (ts.length ? `<ul>${ts.map((t) => `<li><span class="key">${e(t.key)}</span> ${e(t.title)}${t.dueDate ? ` — prazo ${fmtDate(t.dueDate)}` : ''}</li>`).join('')}</ul>` : '<p class="muted">Nenhuma.</p>')
  return `<section class="project" id="p-${e(p.id)}">
<h2>${e(p.name)}${p.archived ? ' <span class="muted">(arquivado)</span>' : ''}</h2>
<p class="muted">Dono: ${e(p.owner)} · Início ${fmtDate(p.startDate)} · Meta ${fmtDate(p.targetDate)}</p>
${p.description ? `<p>${e(p.description)}</p>` : ''}
<div class="kpis">
<div><span>Tasks</span><b>${p.totals.total}</b></div><div><span>Concluído</span><b>${p.totals.pctDone}%</b></div>
<div><span>Em aberto</span><b>${p.totals.open}</b></div><div><span>Atrasadas</span><b>${p.totals.overdue}</b></div>
<div><span>Entregas no período</span><b>${p.totals.deliveredInPeriod}</b></div>
</div>
<h3>Entregas por semana</h3>${weeklySvg(p.weekly)}
${burndownSvg(p.burndown)}
<h3>Marcos</h3>${list(milestones)}
${sprints.length ? `<h3>Sprints</h3><table><thead><tr><th>Sprint</th><th>Status</th><th>Início</th><th>Fim</th><th>Concluídas</th></tr></thead><tbody>${sprints.map((s) => `<tr><td>${e(s.name)}</td><td>${e(s.status)}</td><td>${fmtDate(s.startDate)}</td><td>${fmtDate(s.endDate)}</td><td>${s.done}/${s.total}</td></tr>`).join('')}</tbody></table>` : ''}
<h3>Entregas no período</h3>${list(delivered)}
<h3>Atrasos e riscos</h3><h4>Atrasadas</h4>${list(late)}<h4>Bloqueadas por dependência aberta</h4>${list(blocked)}<h4>Sem responsável</h4>${list(unassigned)}
<h3>Equipe e carga</h3><table><thead><tr><th>Pessoa</th><th>Em aberto</th><th>Horas ativas</th></tr></thead><tbody>${p.workload.map((w) => `<tr><td>${e(w.name)}</td><td>${w.open}</td><td>${w.activeHours}</td></tr>`).join('')}</tbody></table>
${tickets.length ? `<h3>Chamados vinculados</h3><table><thead><tr><th>Chamado</th><th>Título</th><th>Status</th><th>Empresa</th><th>Task</th></tr></thead><tbody>${tickets.map((k) => `<tr><td>${e(k.number)}</td><td>${e(k.title)}</td><td>${e(k.status)}</td><td>${e(k.org ?? '—')}</td><td>${e(k.taskKey)}</td></tr>`).join('')}</tbody></table>` : ''}
<h3>Tasks (${tasks.length})</h3>${tasks.map((t) => taskBlock(t, d)).join('')}
</section>`
}

const CSS = `:root{--ink:#0b2332;--text:#4f616b;--line:#d4dde3;--bg:#fff;--accent:#0f73ac;--late:#a83a25}
@media (prefers-color-scheme:dark){:root{--ink:#ecf4f8;--text:#a4aaae;--line:#2b3a44;--bg:#0f1f2a;--accent:#6fabcd;--late:#ec9c88}}
*{box-sizing:border-box}body{margin:0;font:14px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg)}
main{max-width:980px;margin:0 auto;padding:40px 20px}h1{font-size:32px;font-weight:500;letter-spacing:-.025em;line-height:1.15;margin:0 0 8px}
h2{font-size:24px;font-weight:500;margin:56px 0 8px;border-top:1px solid var(--ink);padding-top:18px}h3{font-size:18px;font-weight:500;margin:34px 0 8px}h4{font-size:14px;font-weight:600;margin:18px 0 4px}h5{font-size:13px;font-weight:600;margin:16px 0 4px}
a{color:var(--accent)}.muted{color:var(--text)}.kpis{display:flex;flex-wrap:wrap;margin:22px 0;border-block:1px solid var(--line)}
.kpis div{flex:1 1 130px;padding:12px 18px 14px 0}.kpis div+div{padding-left:18px;border-left:1px solid var(--line)}.kpis b{display:block;font-size:30px;font-weight:400;letter-spacing:-.03em;line-height:1.2;font-variant-numeric:tabular-nums}.kpis span{color:var(--text);font-size:13px}
table{width:100%;border-collapse:collapse;margin:8px 0}th{font-weight:400;color:var(--text);border-bottom:1px solid var(--ink)}th,td{text-align:left;padding:9px 16px 9px 0;vertical-align:top}td{border-bottom:1px solid var(--line)}
.chart{width:100%;height:auto;max-height:180px}.bar{fill:var(--accent)}.axis{fill:var(--text);font-size:10px}.ideal{fill:none;stroke:var(--text);stroke-dasharray:4}.real{fill:none;stroke:var(--accent);stroke-width:2}
.task{border-top:1px solid var(--line);padding:10px 0}.task[open]{padding-bottom:22px}.task summary{cursor:pointer}
.key{color:var(--text);font-variant-numeric:tabular-nums;margin-right:6px}.late{color:var(--late);font-weight:600;margin-left:6px}
.meta{display:grid;grid-template-columns:160px 1fr;margin:14px 0}.meta dt,.meta dd{margin:0;padding:7px 0;border-top:1px solid var(--line)}.meta dt{color:var(--text)}
.log{padding-left:18px}.log time,blockquote time{color:var(--text);font-size:12.5px}blockquote{margin:0;padding:10px 0;border-top:1px solid var(--line)}blockquote p{margin:4px 0 0}
.desc{white-space:pre-wrap}nav ul{columns:2;padding-left:18px}#q{width:100%;padding:10px 0;border:0;border-bottom:1px solid var(--text);background:none;color:var(--ink);font:inherit;margin:24px 0 0}
@media (max-width:640px){nav ul{columns:1}.meta{grid-template-columns:110px 1fr}table{display:block;overflow-x:auto}}
@media print{#q,nav{display:none}.project{break-before:page}details{display:block}details>*{display:block}body{background:#fff;color:#000}}`

// Busca: mostra só as tasks cujo texto contém o termo; na impressão abre todos os detalhes.
const SCRIPT = `document.getElementById('q').addEventListener('input',function(ev){var q=ev.target.value.toLowerCase();document.querySelectorAll('.task').forEach(function(t){t.style.display=!q||t.dataset.search.indexOf(q)>=0?'':'none'})});window.addEventListener('beforeprint',function(){document.querySelectorAll('details').forEach(function(d){d.open=true})});`

export function renderDossierHtml(d: Dossier): string {
  const period = d.period.from || d.period.to ? `${fmtDate(d.period.from)} a ${fmtDate(d.period.to)}` : 'todo o histórico'
  const totals = d.projects.reduce((a, p) => ({ total: a.total + p.totals.total, done: a.done + p.totals.done, overdue: a.overdue + p.totals.overdue, delivered: a.delivered + p.totals.deliveredInPeriod }), { total: 0, done: 0, overdue: 0, delivered: 0 })
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dossiê de projetos</title><style>${CSS}</style></head><body><main>
<header><h1>Dossiê de projetos</h1><p class="muted">Gerado por ${e(d.generatedBy)} em ${fmtDateTime(d.generatedAt)} · Período das entregas: ${e(period)} · ${d.projects.length} projeto(s)</p></header>
<section><h2>Resumo do portfólio</h2>
<div class="kpis"><div><span>Tasks</span><b>${totals.total}</b></div><div><span>Concluído</span><b>${totals.total ? Math.round((totals.done / totals.total) * 100) : 0}%</b></div><div><span>Atrasadas</span><b>${totals.overdue}</b></div><div><span>Entregas no período</span><b>${totals.delivered}</b></div></div>
<table><thead><tr><th>Projeto</th><th>Tasks</th><th>Concluído</th><th>Atrasadas</th><th>Entregas no período</th></tr></thead><tbody>
${d.projects.map((p) => `<tr><td><a href="#p-${e(p.id)}">${e(p.name)}</a></td><td>${p.totals.total}</td><td>${p.totals.pctDone}%</td><td>${p.totals.overdue}</td><td>${p.totals.deliveredInPeriod}</td></tr>`).join('')}
</tbody></table></section>
<nav aria-label="Índice"><h3>Índice</h3><ul>${d.projects.map((p) => `<li><a href="#p-${e(p.id)}">${e(p.name)}</a></li>`).join('')}</ul></nav>
<input id="q" type="search" placeholder="Buscar task por chave, título, status, responsável ou tag…" aria-label="Buscar task">
${d.projects.map((p) => projectSection(p, d)).join('')}
<p class="muted">Categorias de status: ${Object.values(CATEGORY_LABEL).join(' · ')}</p>
</main><script>${SCRIPT}</script></body></html>`
}
