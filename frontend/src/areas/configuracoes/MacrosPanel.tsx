import { toast } from '@/store/toastStore'
import { useState, useEffect, useRef } from "react";
import { macroService, type MacroVariable } from "@/services/macroService";
import type { Macro } from "@/types";
import {
  Btn,
  Field,
  Inp,
  Txta,
  Modal,
  Toggle,
  PageHeader,
  AlertModal,
  ConfirmModal,
  Pagination,
} from "@/components/ui";
import { FilterSearchInput } from "@/components/filters/FilterSearchInput";
import { Edit, Trash2 } from "lucide-react";
import { VariablePicker } from "./VariablePicker";
import { unknownMessage } from "./macroText";

const CONTENT_ID = "macro-content";

const QUICK_VARIABLES = [
  { key: "primeiro_nome_usuario", label: "Nome solicitante" },
  { key: "numero_chamado", label: "Nº do chamado" },
  { key: "status", label: "Status" },
  { key: "nome_analista", label: "Analista" },
  { key: "link_chamado", label: "Link portal" },
];

export function MacrosPanel() {
  const [macros, setMacros] = useState<Macro[]>([]);
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editMacro, setEditMacro] = useState<Macro | null>(null);
  const [form, setForm] = useState<{ title: string; content: string }>({ title: "", content: "" });
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"editor" | "preview">("editor");
  const [recentlyInserted, setRecentlyInserted] = useState<string | null>(null);
  const [alert, setAlert] = useState<{ isOpen: boolean; title: string; message: string; variant: "danger" | "warning" | "primary" }>(
    { isOpen: false, title: "", message: "", variant: "warning" }
  );
  const [confirmDeleteModal, setConfirmDeleteModal] = useState<{ isOpen: boolean; macro: Macro | null }>({
    isOpen: false,
    macro: null,
  });

  const loadData = () => {
    macroService.getMacros().then(setMacros).catch(() => {
      setAlert({ isOpen: true, title: "Erro", message: "Não foi possível carregar as macros.", variant: "danger" });
    });
  };

  useEffect(() => { loadData(); }, []);

  // Variáveis ({chave}) — lista oficial do backend; inserir no cursor, pré-visualizar e avisar desconhecidas.
  const [variables, setVariables] = useState<MacroVariable[]>([]);
  const [preview, setPreview] = useState({ content: "", unknown: [] as string[] });
  const cursor = useRef<number | null>(null);

  useEffect(() => { macroService.getVariables().then(setVariables).catch(() => setVariables([])); }, []);

  useEffect(() => {
    if (!showModal || !form.content) { setPreview({ content: "", unknown: [] }); return; }
    const t = setTimeout(() => {
      macroService.render(form.content).then(setPreview).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [form.content, showModal]);

  const insertVariable = (key: string) => {
    const token = `{${key}}`;
    const pos = cursor.current ?? form.content.length;
    const content = (form.content.slice(0, pos) + token + form.content.slice(pos)).slice(0, 2000);
    setForm({ ...form, content });
    const next = pos + token.length;
    cursor.current = next;
    setRecentlyInserted(key);
    setTimeout(() => {
      setRecentlyInserted((prev) => (prev === key ? null : prev));
    }, 1200);

    if (activeTab === "preview") {
      setActiveTab("editor");
    }

    requestAnimationFrame(() => {
      const el = document.getElementById(CONTENT_ID) as HTMLTextAreaElement | null;
      el?.focus();
      el?.setSelectionRange(next, next);
    });
  };

  const openNew = () => {
    setEditMacro(null);
    setForm({ title: "", content: "" });
    cursor.current = null;
    setActiveTab("editor");
    setRecentlyInserted(null);
    setShowModal(true);
  };

  const openEdit = (macro: Macro) => {
    setEditMacro(macro);
    setForm({ title: macro.title, content: macro.content });
    cursor.current = null;
    setActiveTab("editor");
    setRecentlyInserted(null);
    setShowModal(true);
  };

  const save = async () => {
    const title = form.title.trim();
    const content = form.content.trim();
    if (!title) {
      setAlert({ isOpen: true, title: "Validação", message: "O título da macro é obrigatório.", variant: "warning" });
      return;
    }
    if (!content) {
      setAlert({ isOpen: true, title: "Validação", message: "O texto da resposta é obrigatório.", variant: "warning" });
      return;
    }
    setSaving(true);
    try {
      if (editMacro) await macroService.updateMacro(editMacro.id, { title, content });
      else await macroService.createMacro({ title, content });
      setShowModal(false);
      loadData();
      const { unknown } = await macroService.render(content).catch(() => ({ unknown: [] as string[] }));
      if (unknown.length) {
        setAlert({ isOpen: true, title: "Resposta salva com aviso", message: unknownMessage(unknown), variant: "warning" });
      } else {
        toast.success(editMacro ? "Resposta atualizada." : "Resposta criada.");
      }
    } catch {
      setAlert({ isOpen: true, title: "Erro", message: "Erro ao salvar a macro.", variant: "danger" });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (macro: Macro) => {
    try {
      const updated = await macroService.updateMacro(macro.id, { active: !macro.active });
      setMacros((prev) => prev.map((m) => (m.id === macro.id ? { ...m, active: updated.active } : m)));
    } catch {
      setAlert({ isOpen: true, title: "Erro", message: "Erro ao atualizar a macro.", variant: "danger" });
    }
  };

  const handleDelete = (macro: Macro) => {
    setConfirmDeleteModal({ isOpen: true, macro });
  };

  const confirmDelete = async () => {
    const macro = confirmDeleteModal.macro;
    if (!macro) return;

    try {
      await macroService.deleteMacro(macro.id);
      setAlert({ isOpen: true, title: "Sucesso", message: "Resposta excluída.", variant: "primary" });
      loadData();
    } catch {
      setAlert({ isOpen: true, title: "Erro", message: "Não foi possível excluir a macro.", variant: "danger" });
    }
  };

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const filtered = macros.filter((m) => m.title.toLowerCase().includes(search.trim().toLowerCase()));

  useEffect(() => {
    setPage(1);
  }, [search]);

  const totalMacros = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalMacros / pageSize));
  const currentPage = Math.min(page, totalPages);

  return (
    <div className="cfg-page">
      <PageHeader
        title="Respostas prontas"
        subtitle={`${macros.length} respostas pré-definidas`}
        actions={<Btn size="sm" onClick={openNew}>Nova resposta</Btn>}
      />

      <div className="cfg-body">
        <div className="cfg-inline" style={{ justifyContent: "space-between", marginBottom: 16 }}>
          <FilterSearchInput value={search} onChange={setSearch} placeholder="Buscar pelo título..." width={280} />
          <Pagination
            variant="toolbar"
            page={currentPage}
            pageSize={pageSize}
            total={totalMacros}
            onPageChange={setPage}
            onPageSizeChange={(newSize) => {
              setPageSize(newSize);
              setPage(1);
            }}
            label="macros"
          />
        </div>
        {filtered.length === 0 ? (
          <div className="cfg-empty">Nenhuma resposta encontrada.</div>
        ) : (
          <div className="cfg-scroll">
            <table className="table">
              <thead>
                <tr><th>Título</th><th>Texto</th><th>Ativa</th><th aria-label="Ações" /></tr>
              </thead>
              <tbody>
                {filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((macro) => (
                  <tr key={macro.id}>
                    <td className={macro.active ? "cfg-strong" : "cfg-off"} style={{ width: "28%" }}>{macro.title}</td>
                    <td><div className="cfg-clamp" title={macro.content}>{macro.content}</div></td>
                    <td title={macro.active ? "Desativar" : "Ativar"}><Toggle value={macro.active} onChange={() => toggleActive(macro)} label={`${macro.title} ativa`} /></td>
                    <td>
                      <div className="cfg-actions">
                        <button type="button" className="icon-act" aria-label={`Editar ${macro.title}`} title="Editar" onClick={() => openEdit(macro)}><Edit size={15} /></button>
                        <button type="button" className="icon-act danger" aria-label={`Excluir ${macro.title}`} title="Excluir macro" onClick={() => handleDelete(macro)}><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editMacro ? "Editar resposta" : "Nova resposta"}
        width={760}
        footer={
          <>
            <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancelar</Btn>
            <Btn onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar resposta"}</Btn>
          </>
        }
      >
        <div className="cfg-form">
          <Field label="Título da resposta" required>
            <Inp
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Ex: Solicitação de informações adicionais"
              maxLength={120}
              showCount
            />
          </Field>

          <div>
            <div className="cfg-group-head" style={{ alignItems: "center", marginBottom: 8 }}>
              <label htmlFor={CONTENT_ID} style={{ fontSize: 13, fontWeight: 500, color: "var(--text-2)" }}>
                Texto da resposta <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <div className="subtabs">
                <button type="button" aria-pressed={activeTab === "editor"} onClick={() => setActiveTab("editor")}>Escrever</button>
                <button type="button" aria-pressed={activeTab === "preview"} onClick={() => setActiveTab("preview")}>Pré-visualizar</button>
              </div>
            </div>

            {activeTab === "editor" ? (
              <Txta
                id={CONTENT_ID}
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                onSelect={(e) => { cursor.current = e.currentTarget.selectionStart; }}
                rows={10}
                placeholder="Ex: Olá {primeiro_nome_usuario}, recebemos seu chamado {numero_chamado} e já estamos atuando..."
                style={{ resize: "vertical", minHeight: 200, lineHeight: 1.6 }}
                maxLength={2000}
                showCount
              />
            ) : (
              <div className="msg-preview" style={{ minHeight: 200 }}>
                <div style={{ fontSize: 13, marginBottom: 12 }}>
                  <span style={{ fontWeight: 500 }}>João Lima</span>{" "}
                  <span className="cfg-off">(Atendente • Simulação)</span>
                </div>
                {preview.content ? (
                  <p className="msg-text">{preview.content}</p>
                ) : (
                  <div className="cfg-off" style={{ fontSize: 14 }}>Nenhum conteúdo digitado ainda. Volte para a aba "Escrever" e monte sua macro.</div>
                )}
                <p className="cfg-sub" style={{ marginTop: 16 }}>As variáveis foram substituídas com base no chamado de teste Maria Souza (#INC-000123).</p>
              </div>
            )}

            {preview.unknown.length > 0 && (
              <div role="alert" className="notice" style={{ marginTop: 12 }}>
                <span style={{ color: "var(--warning)", fontWeight: 600 }}>Variável não reconhecida.</span> {unknownMessage(preview.unknown)}
              </div>
            )}
          </div>
        </div>

        <VariablePicker
          variables={variables}
          hint="Clique para inserir no cursor. Ao aplicar a macro, entram os dados reais do chamado."
          inserted={recentlyInserted}
          onInsert={insertVariable}
        >
          <div className="var-quick" style={{ marginTop: 8 }}>
            Inserir rápido:
            {QUICK_VARIABLES.map((qv) => (
              <button key={qv.key} type="button" className="cfg-link" onClick={() => insertVariable(qv.key)}>+ {qv.label}</button>
            ))}
          </div>
        </VariablePicker>
      </Modal>

      <AlertModal
        isOpen={alert.isOpen}
        onClose={() => setAlert({ ...alert, isOpen: false })}
        title={alert.title}
        message={alert.message}
        variant={alert.variant}
      />

      <ConfirmModal
        isOpen={confirmDeleteModal.isOpen}
        onClose={() => setConfirmDeleteModal({ isOpen: false, macro: null })}
        onConfirm={confirmDelete}
        title="Confirmar exclusão"
        message={`Tem certeza que deseja excluir a macro "${confirmDeleteModal.macro?.title}"?`}
        confirmText="Confirmar exclusão"
        cancelText="Cancelar"
        variant="danger"
      />
    </div>
  );
}
