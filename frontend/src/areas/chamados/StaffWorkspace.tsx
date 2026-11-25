/**
 * Tela da equipe (analista, Ticket Manager, gerente): menu lateral, cabeçalho,
 * lista de chamados, chamado aberto e as telas das áreas. Antes eram duas
 * páginas (AgentPage e SupervisorPage) quase iguais; o que ainda difere entre
 * elas fica no perfil abaixo (`agent` só para o analista, `mgmt` para os demais):
 * - tela inicial: Meus chamados × Turno ou Carteira;
 * - não lidos nas linhas e no chamado (bolinha/sino): só o analista;
 * - carga inicial: o analista para na tela "Erro de conexão"; o painel segue com o que veio;
 * - clique no dashboard: o analista só troca de tela; o painel aplica os filtros e vai à lista;
 * - abrir chamado fora da lista: o painel vai para "Todos os chamados";
 * - cabeçalho: nome da fila + "N abertos" × título "Chamados";
 * - filtros de fila e SLA vencido (useTicketFilters) e "minhas filas mudaram" (useStaffRealtime).
 */
import { useState, useEffect, useRef, type ReactNode } from "react";
import { useStaffRealtime, useReopenedAlert } from '@/areas/chamados/list/useStaffRealtime'
import { useTicketFilters } from '@/areas/chamados/list/useTicketFilters'
import { TicketFilterBar } from '@/areas/chamados/list/TicketFilterBar'
import { TicketGridHeader, TicketGridRow } from '@/areas/chamados/list/TicketGrid'
import { AreaScreen, isAreaScreen, screenDenied, type ScreenContext } from '@/areas/AreaScreen'
import { useTicketInUrl } from '@/access/useTicketInUrl'
import { useAreaView } from "@/access/useAreaView";
import { useMyStats } from "@/hooks/useMyStats";
import { useTableSort } from "@/hooks/useTableSort";
import { useTicketPage, useTicketCounts, useDebounced, serverSort, dayStartIso, dayEndIso } from "@/hooks/useTicketPage";
import { useAuthStore } from "@/store/auth";
import { Btn, EmptyState, Loading, PageHeader, Figures, StatCard } from "@/components/ui";
import { MessageNotificationPopup } from "@/components/ui/MessageNotificationPopup";
import { BellNotificationPopup } from "@/components/ui/BellNotificationPopup";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { ScrollFadeIndicator } from "@/components/ui/ScrollFadeIndicator";
import { useStagger } from "@/lib/motion";
import { AppHeader } from "@/components/AppHeader";
import { adminService } from "@/services/adminService";
import { useStaticDataStore } from "@/store/staticData";
import { useNavStore } from "@/store/nav";
import { ticketService, type TicketPageQuery } from "@/services/ticketService";
import { useNotificationsStore } from "@/store/notifications";
import { notificationService, refreshUnreadNotifications } from "@/services/notificationService";
import { requestNotificationPermission } from "@/utils/browserNotification";
import { computeUnreadFromTickets, useUnreadCounts, getLastOpened } from "@/hooks/useUnreadCounts";
import { events } from "@/utils/events";
import { Ticket, User, Queue, Category, Organization } from "@/types";
import { TicketDetail } from "./TicketDetail";
import UserPortalPage from "@/areas/solicitacoes/UserPortalPage";
import { toast } from "@/store/toastStore";
import { apiErrorMessage } from "@/services/api";
import { CheckCircle2, Clock, Gauge, Inbox } from "lucide-react";
import { assigneeParams, ASSIGNEE_NONE } from "@/components/filters/TicketOwnerFilters";

// Coluna clicada → ordenação do servidor
const COL_SORT: Record<string, NonNullable<TicketPageQuery["sort"]>> = {
  "ID": "id", "Título / solicitante": "title", "Empresa": "org", "Categoria": "category", "Fila": "queue",
  "Prioridade": "priority", "SLA": "sla", "Status": "status", "Atribuído": "assignee",
};
const BACK_LABEL: Record<string, string> = { home_shift: "Turno", home_portfolio: "Carteira" };
// "Ordenar por" do filtro ("Urgência" só existe no filtro do analista)
const SORT_BY: Record<string, Pick<TicketPageQuery, "sort" | "dir">> = {
  urgency: { sort: "urgency", dir: "asc" },
  sla: { sort: "sla", dir: "asc" },
  priority: { sort: "priority", dir: "desc" },
  date: { sort: "date", dir: "desc" },
};

export default function StaffWorkspace() {
  const user = useAuthStore((s) => s.user)!;
  const accessToken = useAuthStore((s) => s.accessToken);
  const isAgent = user.role === "agent";
  const home = isAgent ? "queue_my" : user.role === "manager" ? "home_portfolio" : "home_shift";
  const staticData = useStaticDataStore();
  const { notifications, bellItems, bellPopups, dismissBellPopup, setBellItems, dismissNotification, markTicketRead, unreadByTicket, setUnreadBatch } = useNotificationsStore();
  const { markRead } = useUnreadCounts();
  const [sideView, setSideView] = useAreaView(home);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const selectedRef = useRef<Ticket | null>(null);
  // Chamado aberto a partir do Turno ou da Carteira: fechar volta para lá.
  const cameFrom = useRef<string | null>(null);
  const [taking, setTaking] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Indicadores da sidebar: refeitos a cada evento de chamado (socket) e a cada minuto.
  const { stats, onlineTeam, refresh: refreshStats, scheduleRefresh: scheduleStats } = useMyStats(user.id);

  // Filtros da lista (estado por perfil em areas/chamados/list/useTicketFilters).
  const filters = useTicketFilters(isAgent ? 'agent' : 'mgmt');
  const { search, fStatus, fPriority, fType, fCategory, fOrg, fAgent, sortBy, dateFrom, dateTo, fQueue, fOverdue } = filters;
  const colSort = useTableSort<string>();

  // Lista paginada no servidor: filtros, busca e ordenação viram query string
  const queueFilter =
    sideView.startsWith("queue_") && sideView !== "queue_my"
      ? sideView.replace("queue_", "")
      : null;
  const debouncedSearch = useDebounced(search);
  const sortFallback = isAgent ? SORT_BY.urgency : SORT_BY.sla;
  const ticketPage = useTicketPage({
    mine: sideView === "queue_my" || undefined,
    // Fila e SLA vencido só existem no filtro do painel (no analista ficam em "all"/false).
    queueId: fQueue !== "all" ? fQueue : queueFilter && queueFilter !== "all" ? queueFilter : undefined,
    status: fStatus !== "all" ? fStatus : undefined,
    priority: fPriority !== "all" ? fPriority : undefined,
    type: fType !== "all" ? fType : undefined,
    categoryId: fCategory !== "all" ? fCategory : undefined,
    orgId: fOrg !== "all" ? fOrg : undefined,
    ...assigneeParams(fAgent, user.id),
    overdue: fOverdue || undefined,
    search: debouncedSearch.trim() || undefined,
    createdFrom: dayStartIso(dateFrom),
    createdTo: dayEndIso(dateTo),
    ...serverSort(colSort.sort, COL_SORT, (isAgent || sortBy !== "urgency" ? SORT_BY[sortBy] : undefined) ?? sortFallback),
  // "Todos os chamados" no menu é a view "queue" (sem sufixo): também lista.
  }, { enabled: sideView.startsWith("queue") });
  const { rows: tickets, setRows: setTickets } = ticketPage;
  const { counts, refresh: refreshCounts, scheduleRefresh: scheduleCounts } = useTicketCounts({ orgId: fOrg !== "all" ? fOrg : undefined, ...assigneeParams(fAgent, user.id) });
  // O menu lateral mostra as filas, os contadores e os números de quem atende.
  useEffect(() => {
    useNavStore.getState().publish({
      queues, counts,
      stats: stats ? { ...stats, workload: counts.my ?? 0 } : null,
      online: onlineTeam.filter((a: any) => a.status === 'online').map((a: any) => a.name),
    });
  }, [queues, counts, stats, onlineTeam]);
  // Socket: a página/contadores são refeitos no servidor (o chamado pode entrar/sair do filtro)
  const reloadListRef = useRef(() => {});
  reloadListRef.current = () => { ticketPage.scheduleReload(); scheduleCounts(); scheduleStats(); };

  // Chamado visto: some do sino e (analista) zera os não lidos da linha.
  const markSeen = (ticketId: string) => { markTicketRead(ticketId); if (isAgent) markRead(ticketId) };

  // Abre um chamado pelo id (sino/popups/dashboard): usa a linha da página ou busca no servidor
  const openTicket = async (ticketId: string) => {
    const t = tickets.find((t) => t.id === ticketId) ?? (await ticketService.getTicket(ticketId).catch(() => null));
    if (!t) return;
    setSelected(t);
    markSeen(ticketId);
    if (!isAgent && !sideView.startsWith("queue")) { cameFrom.current = sideView; setSideView("queue_all"); }
  };

  // Chamado aberto ↔ ?ticket= (link do e-mail /c/<id>, nova aba, voltar).
  useTicketInUrl(selected?.id, (id) => { void openTicket(id) }, () => setSelected(null));

  // Não-lidos das linhas visíveis (latestMessage vem na página)
  useEffect(() => {
    if (isAgent) setUnreadBatch(computeUnreadFromTickets(tickets, user.id));
  }, [isAgent, tickets, user.id, setUnreadBatch]);

  // Keep ref in sync so the socket handler always sees the latest selected ticket
  useEffect(() => { selectedRef.current = selected }, [selected])

  useEffect(() => {
    loadData();
  }, [user.id]);

  // Empresa ou cliente cadastrados depois do carregamento das listas (ex.:
  // cadastro rápido no wizard): recarrega uma vez por chamado.
  const lookupRefreshFor = useRef(new Set<string>());
  useEffect(() => {
    if (!selected || lookupRefreshFor.current.has(selected.id)) return;
    const missingUser = !!selected.userId && !users.some((u) => u.id === selected.userId);
    const missingOrg = !!selected.orgId && !orgs.some((o) => o.id === selected.orgId);
    if (!missingUser && !missingOrg) return;
    lookupRefreshFor.current.add(selected.id);
    staticData.invalidate();
    void loadData();
  }, [selected?.id]);

  useEffect(() => {
    return events.onTicketUpdate((data) => {
      const { ticketId, ...updates } = data;
      applyTicketUpdate(ticketId, updates);
    });
  }, [selected?.id]);

  useEffect(() => {
    requestNotificationPermission()
  }, [])

  // Tempo real da lista (sino, avisos, chamado criado/alterado/apagado) e alerta de reabertura.
  useStaffRealtime({ accessToken, userId: user.id, selectedRef, reloadListRef, setTickets, setSelected, syncMyQueues: isAgent });
  const [reopenedAlert, setReopenedAlert] = useReopenedAlert(accessToken, user.id, queues);

  async function loadData() {
    if (!isAgent) return loadDataSettled();
    try {
      const [uData, qData, cData, oData, activity] = await Promise.all([
        adminService.getUsers(),
        staticData.getQueues(),
        staticData.getCategories(),
        staticData.getOrgs(),
        ticketService.getActivity().catch(() => []),
      ]);

      setUsers(uData);
      setQueues(qData);
      setCategories(cData);
      setOrgs(oData);

      const merged = await notificationService.getUnreadMerged(activity, user.id, getLastOpened())
      setBellItems(merged)

      setError(null);
    } catch (err) {
      console.error("[StaffWorkspace] Error loading data:", err);
      setError("Não foi possível carregar os dados operacionais.");
    }
  }

  // Painel: cada cadastro que falhar fica vazio, sem derrubar a tela.
  async function loadDataSettled() {
    try {
      const r = await Promise.allSettled([
        adminService.getUsers(),
        staticData.getQueues(),
        staticData.getCategories(),
        staticData.getOrgs(),
      ]);
      const val = <T,>(i: number, d: T): T => r[i].status === 'fulfilled' ? (r[i] as PromiseFulfilledResult<T>).value : d;

      setUsers(val(0, [] as User[]));
      setQueues(val(1, [] as Queue[]));
      setCategories(val(2, [] as Category[]));
      setOrgs(val(3, [] as Organization[]));

      void refreshUnreadNotifications(
        async () => notificationService.getUnreadMerged(await ticketService.getActivity().catch(() => []), user.id, getLastOpened()),
        (merged) => {
          setBellItems(merged)
        },
      )
    } catch (err) {
      console.error("[StaffWorkspace] Error loading data:", err);
    }
  }

  const refreshAll = () => { loadData(); ticketPage.reload(); refreshCounts(); refreshStats(); };
  // Botão do header: recarrega a página de verdade (antes só refazia a lista e não atualizava
  // o chamado aberto nem as telas de área). Tela e chamado aberto ficam na URL.
  const reloadPage = () => window.location.reload();

  const getUser = (id: string) => users.find((u) => u.id === id);
  const getOrg = (id: string) => orgs.find((o) => o.id === id);
  const getCat = (id: string) => categories.find((c) => c.id === id);

  function applyTicketUpdate(id: string, updates: Partial<Ticket>) {
    setTickets((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    );
    if (selected?.id === id) setSelected((s) => (s ? { ...s, ...updates } : s));
  }

  // Clique num número do dashboard: abre o chamado ou vai à lista com aqueles filtros.
  function handleDashboardFilter(action: any) {
    // O dashboard manda { view, filters: {...} }; aceita também o formato plano { status, ticketId, ... }
    const filter = action.filters ?? action;
    const { setFStatus, setFCategory, setFQueue, setFOverdue, setFOrg, setFAgent, setFPriority } = filters;

    if (filter.ticketId) {
      void openTicket(filter.ticketId);
      return;
    }

    // Reset all filters before applying new ones to avoid stale state
    setFStatus("all");
    setFCategory("all");
    setFQueue("all");
    setFOverdue(false);
    setFOrg("all");
    setFPriority("all");
    setFAgent("all");

    if (filter.status) setFStatus(filter.status);
    if (filter.categoryId) setFCategory(filter.categoryId);
    if (filter.queue) setFQueue(filter.queue);
    if (filter.assignedToId || filter.unassigned) setFAgent([filter.assignedToId, filter.unassigned && ASSIGNEE_NONE].filter(Boolean).join(","));
    if (filter.overdue) setFOverdue(true);
    if (filter.orgId) setFOrg(filter.orgId);

    setSideView("queue_all");
  }

  // Entrada escalonada das linhas de tickets — só ao trocar de view / quando a
  // lista passa a ter itens (não re-anima em updates de tempo real)
  const listRef = useStagger<HTMLDivElement>({
    selector: '.ticket-grid-row',
    y: 10,
    gap: 28,
    duration: 420,
    deps: [sideView, tickets.length > 0],
  })

  // Telas das áreas (registro único em areas/AreaScreen).
  const screenCtx: ScreenContext = {
    user, users, queues, orgs,
    onDashboardNavigate: isAgent ? ({ view }) => setSideView(view) : handleDashboardFilter,
    onOpenTicket: (id) => { if (isAgent) setSideView("queue"); void openTicket(id) },
    onBack: () => setSideView(home),
    onGo: setSideView,
  }

  // Assume o chamado sem responsável mais urgente das filas da pessoa e abre.
  async function takeNext() {
    if (taking) return;
    setTaking(true);
    try {
      const { data: [first] } = await ticketService.getTicketsPage({ page: 1, pageSize: 1, unassigned: true, status: "open,in_progress", sort: "urgency", dir: "asc" });
      if (!first) { toast.success("Nenhum chamado esperando nas suas filas."); return; }
      const updated = await ticketService.updateTicket(first.id, { assigned_to_id: user.id } as any);
      setSelected({ ...first, ...updated });
      markSeen(first.id);
      toast.success(`${first.displayNumber} é seu.`);
      refreshCounts();
    } catch (err) {
      // Outra pessoa pode ter pego antes.
      toast.error(apiErrorMessage(err, "Não foi possível pegar o próximo."));
      ticketPage.reload();
    } finally {
      setTaking(false);
    }
  }
  const queueName = sideView === "queue_my" ? "Meus chamados" : sideView === "queue" || sideView === "queue_all" ? "Todos os chamados" : queues.find(q => q.id === queueFilter)?.name ?? "Chamados";
  const header = (
    <>
      <PageHeader title={queueName} subtitle={`${ticketPage.total} ${ticketPage.total === 1 ? "chamado" : "chamados"} na lista`}
        actions={isAgent ? <Btn onClick={() => void takeNext()} disabled={taking}>{taking ? "Pegando…" : "Pegar o próximo"}</Btn> : undefined} />
      {isAgent && sideView === "queue_my" && (
        <div className="page-pad">
          <Figures>
            <StatCard icon={Inbox} label="Com você" value={counts.my ?? 0} />
            <StatCard icon={Clock} label="Vencendo" value={stats?.dueSoonCount ?? 0} tone={stats?.dueSoonCount ? "soon" : undefined} />
            <StatCard icon={CheckCircle2} label="Resolvidos hoje" value={stats?.resolvedToday ?? 0} tone="ok" />
            <StatCard icon={Gauge} label="SLA cumprido" value={`${stats?.slaCompliance ?? 100}%`} tone="alt" />
          </Figures>
        </div>
      )}
    </>
  );

  // Lista de chamados (cabeçalho e linhas compartilhados: areas/chamados/list/TicketGrid).
  const gridLookups = { getUser, getOrg, getCat, queues }
  const variant = isAgent ? "agent" : "mgmt";
  // O painel só mostra chamado e lista nas telas de fila; o analista, em qualquer tela que não seja de área.
  const inList = isAgent || sideView.startsWith("queue");

  const list = (
    <>
      {header}
      <TicketFilterBar filters={filters} categories={categories} orgs={orgs} users={users} me={user} queues={queues} page={ticketPage} />

      <ScrollFadeIndicator className="stack-list">
        {ticketPage.loading && !tickets.length ? (
          <Loading label="Carregando chamados…" className="app-loading-pinned" />
        ) : tickets.length === 0 ? (
          <EmptyState
            title="Nenhum chamado"
            desc="Ajuste os filtros ou aguarde novos chamados."
          />
        ) : (
          <div ref={listRef} className="ticket-list">
            <TicketGridHeader header={colSort.header} />
            {tickets.map((ticket) => (
              <TicketGridRow key={ticket.id} ticket={ticket} variant={variant} lookups={gridLookups}
                unreadCount={isAgent ? unreadByTicket[ticket.id] ?? 0 : undefined}
                onOpen={(t) => { setSelected(t); if (isAgent) markSeen(t.id) }} />
            ))}
          </div>
        )}
      </ScrollFadeIndicator>
    </>
  );

  const body: ReactNode = error ? (
    <EmptyState title="Erro de conexão" desc={error} action={<Btn onClick={refreshAll}>Recarregar dados</Btn>} />
  ) : sideView === 'new_ticket' ? (
    <UserPortalPage embedded organizations={orgs} />
  ) : screenDenied(sideView, user) ? (
    <AreaScreen view={sideView} ctx={screenCtx} />
  ) : selected && inList ? (
    <TicketDetail
      ticket={selected}
      currentUser={user}
      users={users}
      queues={queues}
      categories={categories}
      orgs={orgs}
      backLabel={cameFrom.current ? BACK_LABEL[cameFrom.current] ?? "Voltar" : "Chamados"}
      onClose={() => { setSelected(null); if (cameFrom.current) { setSideView(cameFrom.current); cameFrom.current = null; } }}
      onTicketUpdate={applyTicketUpdate}
      {...(isAgent ? {
        unreadCount: unreadByTicket[selected.id] ?? 0,
        onChatRead: () => markSeen(selected.id),
      } : {})}
    />
  ) : isAreaScreen(sideView) ? (
    <AreaScreen view={sideView} ctx={screenCtx} />
  ) : !inList ? null : isAgent ? (
    <div className="ticket-table-container">{list}</div>
  ) : (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>{list}</div>
  );

  const popups = (
    <>
      <MessageNotificationPopup
        notifications={notifications}
        onDismiss={dismissNotification}
        onOpen={(ticketId) => {
          void openTicket(ticketId)
        }}
      />
      <BellNotificationPopup
        items={bellPopups}
        onDismiss={dismissBellPopup}
        onOpen={(ticketId) => {
          void openTicket(ticketId)
        }}
      />
    </>
  );

  return (
    <div className="app-shell">
      <AppHeader
        responsive
        onRefresh={reloadPage}
        right={
          <NotificationBell
            bellItems={bellItems}
            onOpenTicket={(ticketId) => {
              void openTicket(ticketId)
            }}
            onMarkRead={markSeen}
            onMarkAllRead={() => { setBellItems([]); }}
          />
        }
      />
      <div className="app-body">
        <div className="app-main">

        {isAgent ? body : (
          <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>{body}</div>
        )}
        {isAgent && popups}

        {reopenedAlert?.show && (
          <div
            style={{
              position: "fixed", bottom: 24, right: 24, zIndex: 9999, padding: "16px 20px",
              background: "var(--bg-card)", border: "1px solid var(--border-strong)", boxShadow: "var(--pop-shadow)",
              display: "flex", flexDirection: "column", gap: 8, minWidth: 300, maxWidth: "min(420px, calc(100vw - 48px))",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <span style={{ color: "var(--danger)", fontWeight: 600, fontSize: 14 }}>Chamado reaberto</span>
              <button className="icon-act" style={{ margin: "-8px -12px 0 0" }} onClick={() => setReopenedAlert(null)} aria-label="Fechar">&times;</button>
            </div>
            <div style={{ fontSize: 14, color: "var(--text-1)", lineHeight: 1.5 }}>
              O chamado <strong>{reopenedAlert.ticketId}</strong> foi reaberto{isAgent ? " pelo usuário." : "."}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {reopenedAlert.title}
            </div>
            <div style={{ marginTop: 4 }}>
              <Btn
                size="sm"
                variant="danger"
                onClick={() => {
                  void openTicket(reopenedAlert.ticketId);
                  setReopenedAlert(null);
                }}
              >
                Ver Chamado
              </Btn>
            </div>
          </div>
        )}
        </div>
      </div>
      {!isAgent && popups}
    </div>
  );
}
