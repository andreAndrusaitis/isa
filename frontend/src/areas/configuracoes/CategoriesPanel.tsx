import { CategoryIcon } from '@/areas/solicitacoes/categoryIcon'
import '@/areas/inicio/client.css'
import { useState, useEffect, useRef } from "react";
import { adminService } from "@/services/adminService";
import { apiErrorMessage } from "@/services/api";
import { toast } from "@/store/toastStore";

import {
  Btn,
  Field,
  Inp,
  Sel,
  Txta,
  Modal,
  PageHeader,
  ConfirmModal,
  Toggle,
  CopyableId,
} from "@/components/ui";
import { CategoryOrgsModal } from "./CategoryOrgsModal";
import { ColorSwatch, IdRow } from "./parts";
import { Trash2, X, ArrowUp, ArrowDown, ChevronRight } from "lucide-react";
import type { SpecialFormField, SpecialFormOption } from "@/types";

const FIELD_TYPE_LABELS: Record<SpecialFormField["type"], string> = {
  text: "Texto curto",
  textarea: "Texto longo",
  date: "Data",
  email: "E-mail",
  select: "Lista de opções",
};

const slugifyKey = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^([0-9])/, "_$1");

export function validateSpecialSelectFields(fields: SpecialFormField[]): string | null {
  for (const field of fields) {
    if (field.type !== "select") continue;
    const options = field.options ?? [];
    if (options.length === 0 || options.some(option => !option.value.trim() || !option.label.trim())) {
      return `Configure ao menos uma opção válida para "${field.label || field.key}".`;
    }
    if (new Set(options.map(option => option.value.trim())).size !== options.length) {
      return `As opções de "${field.label || field.key}" não podem repetir o valor.`;
    }
  }
  return null;
}

function renderPreviewTitle(template: string, fields: SpecialFormField[]): string {
  if (!template.trim()) return "";
  return template.replace(/\{([a-z0-9_]+)\}/g, (match, key) => {
    const field = fields.find((f) => f.key === key);
    return field ? `[${field.label || field.key}]` : match;
  });
}

const FIELD_TYPE_PREVIEW: Record<SpecialFormField["type"], string> = {
  text: "Texto do usuário...",
  textarea: "Texto do usuário...",
  date: "dd/mm/aaaa",
  email: "nome@empresa.com",
  select: "Selecione...",
};

export function CategoriesPanel() {
  const [categories, setCategories] = useState<any[]>([]);
  const [, setLoading] = useState(true);
  const [orgSummary, setOrgSummary] = useState<Record<string, { enabled: number; total: number }>>({});
  const [orgsCat, setOrgsCat] = useState<{ id: string; name: string } | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editCat, setEditCat] = useState<any | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [showSubModal, setShowSubModal] = useState(false);
  const [editSub, setEditSub] = useState<any | null>(null);
  const [subForm, setSubForm] = useState<Record<string, any>>({});
  const [openFieldIndexes, setOpenFieldIndexes] = useState<Set<number>>(new Set());
  const newFieldLabelRef = useRef<HTMLInputElement | null>(null);

  const [confirmDelete, setConfirmDelete] = useState<{
    isOpen: boolean;
    type: "category" | "subcategory";
    id: string;
  } | null>(null);

  const loadData = () => {
    adminService.getCategories().then((data) => {
      setCategories(data);
      setLoading(false);
    });
    // Contador é auxiliar: falha não impede o painel.
    adminService.getCategoryOrgSummary().then(setOrgSummary).catch(() => setOrgSummary({}));
  };

  useEffect(() => {
    loadData();
  }, []);

  const openEdit = (cat: any) => {
    setEditCat(cat);
    setForm({ ...cat });
    setShowModal(true);
  };
  const openNew = () => {
    setEditCat(null);
    setForm({ name: "", color: "#0f73ac", description: "", image_url: "" });
    setShowModal(true);
  };

  const saveCat = async () => {
    try {
      if (editCat) {
        await adminService.updateCategory(editCat.id, form);
        toast.success('Categoria atualizada com sucesso!');
      } else {
        await adminService.createCategory(form);
        toast.success('Categoria criada com sucesso!');
      }
      setShowModal(false);
      loadData();
    } catch (err: any) {
      toast.error('Erro ao salvar categoria: ' + apiErrorMessage(err, err.message));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setForm((prev) => ({ ...prev, image_url: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const deleteCat = (id: string) => {
    setConfirmDelete({ isOpen: true, type: "category", id });
  };

  const performDeleteCat = async (id: string) => {
    try {
      await adminService.deleteCategory(id);
      toast.success('Categoria excluída com sucesso!');
      loadData();
    } catch (err: any) {
      toast.error('Erro ao excluir categoria: ' + apiErrorMessage(err, err.message));
    }
  };

  const openSubEdit = (catId: string, sub: any) => {
    setEditSub({ ...sub, category_id: catId });
    setSubForm({ ...sub, image_url: sub.image_url || "" });
    setOpenFieldIndexes(new Set());
    setShowSubModal(true);
  };
  const openSubNew = (catId: string) => {
    setEditSub({ category_id: catId });
    setSubForm({
      name: "",
      description: "",
      icon: "",
      image_url: "",
      category_id: catId,
      is_special: false,
      special_form_schema: [],
      special_title_template: "",
    });
    setOpenFieldIndexes(new Set());
    setShowSubModal(true);
  };

  const saveSub = async () => {
    try {
      const fields = (subForm.special_form_schema ?? []) as SpecialFormField[];
      const validationError = validateSpecialSelectFields(fields);
      if (validationError) {
        toast.error(validationError);
        return;
      }

      const payload = {
        ...subForm,
        special_form_schema: fields.map(({ type, options, multiple, ...field }) =>
          type === "select"
            ? { ...field, type, options: options?.map(option => ({ value: option.value.trim(), label: option.label.trim() })), multiple: !!multiple }
            : { ...field, type },
        ),
      };
      if (editSub?.id) {
        await adminService.updateSubcategory(editSub.id, payload);
        toast.success('Subcategoria atualizada com sucesso!');
      } else {
        await adminService.createSubcategory(payload);
        toast.success('Subcategoria criada com sucesso!');
      }
      setShowSubModal(false);
      loadData();
    } catch (err: any) {
      toast.error('Erro ao salvar subcategoria: ' + apiErrorMessage(err, err.message));
    }
  };

  const setFields = (fields: SpecialFormField[]) => setSubForm((prev) => ({ ...prev, special_form_schema: fields }));
  const patchField = (idx: number, patch: Partial<SpecialFormField>) =>
    setFields((subForm.special_form_schema as SpecialFormField[]).map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  const setOptions = (idx: number, change: (options: SpecialFormOption[]) => SpecialFormOption[]) =>
    patchField(idx, { options: change([...(subForm.special_form_schema[idx].options ?? [])]) });

  const moveField = (idx: number, dir: -1 | 1) => {
    const other = idx + dir;
    const fields = [...subForm.special_form_schema];
    [fields[other], fields[idx]] = [fields[idx], fields[other]];
    setFields(fields);
    setOpenFieldIndexes((prev) => {
      const next = new Set(prev);
      if (prev.has(idx)) next.add(other); else next.delete(other);
      if (prev.has(other)) next.add(idx); else next.delete(idx);
      return next;
    });
  };

  const removeField = (idx: number) => {
    setFields((subForm.special_form_schema as SpecialFormField[]).filter((_, i) => i !== idx));
    setOpenFieldIndexes((prev) => new Set([...prev].filter((i) => i !== idx).map((i) => (i > idx ? i - 1 : i))));
  };

  const insertTitleKey = (key: string) => {
    const input = document.getElementById("special-title-template-input") as HTMLInputElement | null;
    const token = `{${key}}`;
    const pos = input?.selectionStart ?? (subForm.special_title_template || "").length;
    setSubForm((prev) => {
      const current = prev.special_title_template || "";
      return { ...prev, special_title_template: current.slice(0, pos) + token + current.slice(pos) };
    });
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(pos + token.length, pos + token.length);
    });
  };

  const deleteSub = (id: string) => {
    setConfirmDelete({ isOpen: true, type: "subcategory", id });
  };

  const performDeleteSub = async (id: string) => {
    try {
      await adminService.deleteSubcategory(id);
      toast.success('Subcategoria excluída com sucesso!');
      loadData();
    } catch (err: any) {
      toast.error('Erro ao excluir subcategoria: ' + apiErrorMessage(err, err.message));
    }
  };

  const specialFields = (subForm.special_form_schema ?? []) as SpecialFormField[];
  const previewTitle = renderPreviewTitle(subForm.special_title_template || "", specialFields);

  return (
    <div className="cfg-page">
      <PageHeader
        title="Categorias"
        subtitle={`${categories.length} categorias de atendimento`}
        actions={<Btn size="sm" onClick={openNew}>Nova categoria</Btn>}
      />
      <div className="cfg-body">
        <div className="cat-index">
          {categories.map((cat) => (
            <section key={cat.id} className="cat-entry">
              <div>
                <CategoryIcon category={cat} size={44} />
                <h2>{cat.name}</h2>
                {cat.description && <p className="cfg-sub cfg-clamp" title={cat.description}>{cat.description}</p>}
                <CopyableId id={cat.id} size="xs" style={{ marginTop: 4 }} />
              </div>
              <div className="cat-subs">
                {cat.subcategories.map((s: any, i: number) => (
                  <span
                    key={s.id}
                    className="cat-sub"
                    title={`ID: ${s.id}`}
                    data-tooltip={`ID: ${s.id}`}
                    data-last={i === cat.subcategories.length - 1 || undefined}
                  >
                    <button type="button" className="cat-sub-name" onClick={() => openSubEdit(cat.id, s)}>{s.name}</button>
                    {s.is_special && <span className="cfg-off">&nbsp;(especial)</span>}
                    <span className="cat-sub-acts">
                      <CopyableId id={s.id} iconOnly size="sm" tooltip={`Copiar ID: ${s.id}`} />
                      <button type="button" className="icon-act danger" aria-label={`Excluir ${s.name}`} title="Excluir subcategoria" onClick={() => deleteSub(s.id)}>
                        <X size={13} />
                      </button>
                    </span>
                  </span>
                ))}
                <button type="button" className="cfg-link" style={{ marginLeft: cat.subcategories.length ? 10 : 0 }} aria-label={`Adicionar subcategoria em ${cat.name}`} onClick={() => openSubNew(cat.id)}>Adicionar</button>
              </div>
              <div className="cfg-actions">
                <Btn
                  variant="ghost"
                  size="xs"
                  onClick={() => setOrgsCat({ id: cat.id, name: cat.name })}
                  title="Empresas que têm esta categoria do plano ligada ou desligada"
                >
                  Empresas{orgSummary[cat.id] && ` ${orgSummary[cat.id].enabled}/${orgSummary[cat.id].total}`}
                </Btn>
                <Btn variant="ghost" size="xs" onClick={() => openEdit(cat)}>Editar</Btn>
                <button type="button" className="icon-act danger" aria-label={`Excluir ${cat.name}`} title="Excluir" onClick={() => deleteCat(cat.id)}>
                  <Trash2 size={15} />
                </button>
              </div>
            </section>
          ))}
        </div>
      </div>

      {showModal && (
        <Modal
          isOpen
          onClose={() => setShowModal(false)}
          title={editCat ? "Editar categoria" : "Nova categoria"}
          width={520}
          footer={
            <>
              <Btn variant="secondary" onClick={() => setShowModal(false)}>Cancelar</Btn>
              <Btn onClick={saveCat}>Salvar</Btn>
            </>
          }
        >
          <div className="cfg-form">
            {editCat?.id && <IdRow label="ID da categoria" id={editCat.id} />}
            <Field label="Nome da categoria" required>
              <Inp
                value={form.name || ""}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ex: Infraestrutura, Software..."
                maxLength={100}
                showCount
              />
            </Field>
            <Field label="Descrição">
              <Txta
                value={form.description || ""}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                placeholder="Opcional: Descreva o propósito desta categoria..."
                maxLength={500}
                showCount
              />
            </Field>
            <div className="cfg-row">
              Imagem
              <span className="cfg-inline">
                {form.image_url && <img src={form.image_url} alt="" style={{ width: 40, height: 40, objectFit: "cover" }} />}
                <Btn variant="secondary" size="sm" onClick={() => document.getElementById("cat-image-upload")?.click()}>
                  {form.image_url ? "Trocar" : "Carregar"}
                </Btn>
                <input id="cat-image-upload" type="file" accept="image/*" onChange={handleFileChange} style={{ display: "none" }} />
              </span>
            </div>
            <div className="cfg-row">
              Cor de fundo
              <span className="cfg-inline">
                <code className="cfg-mono">{form.color?.toUpperCase() || "#0f73ac"}</code>
                <ColorSwatch value={form.color || ""} onChange={(color) => setForm({ ...form, color })} label="Cor de fundo" />
              </span>
            </div>
          </div>
        </Modal>
      )}

      {showSubModal && (
        <Modal
          isOpen
          onClose={() => setShowSubModal(false)}
          title={editSub?.id ? "Editar subcategoria" : "Nova subcategoria"}
          width={subForm.is_special ? 980 : 520}
          footer={
            <>
              <Btn variant="secondary" onClick={() => setShowSubModal(false)}>Cancelar</Btn>
              <Btn onClick={saveSub}>Salvar</Btn>
            </>
          }
        >
          <div className="cat-split">
            <div className="cfg-form">
              {editSub?.id && <IdRow label="ID da subcategoria" id={editSub.id} />}
              <Field label="Nome" required>
                <Inp value={subForm.name || ""} onChange={(e) => setSubForm({ ...subForm, name: e.target.value })} maxLength={100} showCount />
              </Field>
              <Field label="Descrição">
                <Txta
                  value={subForm.description || ""}
                  onChange={(e) => setSubForm({ ...subForm, description: e.target.value })}
                  rows={2}
                  placeholder="Opcional: explique quando usar esta subcategoria..."
                  maxLength={500}
                  showCount
                />
              </Field>

              <div className="cfg-row">
                <div>
                  <div>Chamado especial</div>
                  <small>Substitui título/descrição livres por um formulário estruturado</small>
                </div>
                <Toggle
                  value={!!subForm.is_special}
                  onChange={(v) => setSubForm({ ...subForm, is_special: v, special_form_schema: subForm.special_form_schema ?? [] })}
                  label="Chamado especial"
                />
              </div>

              {subForm.is_special && (
                <>
                  <Field label="Template do título" required>
                    <Inp
                      value={subForm.special_title_template || ""}
                      onChange={(e) => setSubForm({ ...subForm, special_title_template: e.target.value })}
                      placeholder="Ex: Criação de usuário — {nome_completo}"
                      id="special-title-template-input"
                      maxLength={150}
                      showCount
                    />
                    {specialFields.some((f) => f.key) ? (
                      <div className="var-quick">
                        {specialFields.filter((f) => f.key).map((f, i) => (
                          <button key={i} type="button" className="cfg-link cfg-mono" onClick={() => insertTitleKey(f.key)}>{`{${f.key}}`}</button>
                        ))}
                      </div>
                    ) : (
                      <div className="cfg-sub">Adicione campos para ver as chaves disponíveis.</div>
                    )}
                  </Field>

                  <div className="cfg-group" style={{ gap: 8 }}>
                    <h4>Campos do formulário</h4>
                    <div className="cfg-lines">
                      {specialFields.map((field, idx) => {
                        const isOpen = openFieldIndexes.has(idx);
                        const toggleOpen = () => setOpenFieldIndexes((prev) => {
                          const next = new Set(prev);
                          if (next.has(idx)) next.delete(idx);
                          else next.add(idx);
                          return next;
                        });
                        return (
                          <div key={idx}>
                            <div
                              className="cat-field-head"
                              onClick={toggleOpen}
                              role="button"
                              tabIndex={0}
                              aria-expanded={isOpen}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  toggleOpen();
                                }
                              }}
                            >
                              <ChevronRight size={14} style={{ color: "var(--text-3)", transform: isOpen ? "rotate(90deg)" : "none", flexShrink: 0 }} />
                              <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{field.label || "(sem rótulo)"}</span>
                              <span className="cfg-off" style={{ fontSize: 13 }}>{FIELD_TYPE_LABELS[field.type]}</span>
                              {field.required && <span className="cfg-off" style={{ fontSize: 13 }}>Obrig.</span>}
                              <span className="cfg-actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                                <button type="button" className="icon-act" aria-label="Mover para cima" disabled={idx === 0} style={{ opacity: idx === 0 ? 0.3 : 1 }} onClick={() => moveField(idx, -1)}><ArrowUp size={13} /></button>
                                <button type="button" className="icon-act" aria-label="Mover para baixo" disabled={idx === specialFields.length - 1} style={{ opacity: idx === specialFields.length - 1 ? 0.3 : 1 }} onClick={() => moveField(idx, 1)}><ArrowDown size={13} /></button>
                                <button type="button" className="icon-act danger" aria-label="Remover campo" onClick={() => removeField(idx)}><X size={14} /></button>
                              </span>
                            </div>
                            {isOpen && (
                              <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "2px 0 16px 22px" }}>
                                <div className="cfg-pair">
                                  <input
                                    ref={idx === specialFields.length - 1 ? newFieldLabelRef : undefined}
                                    className="cfg-input"
                                    value={field.label}
                                    onChange={(e) => {
                                      const autoKey = !field.key || field.key === slugifyKey(field.label);
                                      patchField(idx, { label: e.target.value, key: autoKey ? slugifyKey(e.target.value) : field.key });
                                    }}
                                    placeholder="Rótulo (ex: Nome completo)"
                                    maxLength={100}
                                  />
                                  <input
                                    className="cfg-input cfg-mono"
                                    value={field.key}
                                    onChange={(e) => patchField(idx, { key: slugifyKey(e.target.value) })}
                                    placeholder="chave"
                                    maxLength={50}
                                  />
                                </div>
                                <div className="cfg-inline" style={{ gap: 18 }}>
                                  <Sel value={field.type} aria-label="Tipo do campo" onChange={(e) => patchField(idx, { type: e.target.value as SpecialFormField["type"] })} style={{ width: 190 }}>
                                    {Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => (
                                      <option key={value} value={value}>{label}</option>
                                    ))}
                                  </Sel>
                                  {field.type === "select" && (
                                    <label className="cfg-check" style={{ padding: 0 }}>
                                      <input type="checkbox" checked={!!field.multiple} onChange={(e) => patchField(idx, { multiple: e.target.checked })} />
                                      Múltipla
                                    </label>
                                  )}
                                  <label className="cfg-check" style={{ padding: 0 }}>
                                    <input type="checkbox" checked={field.required} onChange={(e) => patchField(idx, { required: e.target.checked })} />
                                    Obrigatório
                                  </label>
                                </div>
                                {field.type === "select" && (
                                  <div>
                                    <div className="cfg-sub" style={{ margin: "0 0 4px" }}>Opções disponíveis</div>
                                    {(field.options ?? []).map((option: SpecialFormOption, optionIdx: number) => (
                                      <div key={`${idx}-${optionIdx}`} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                                        <input
                                          className="cfg-input"
                                          value={option.label}
                                          onChange={(e) => setOptions(idx, (o) => o.map((x, i) => (i === optionIdx ? { ...x, label: e.target.value } : x)))}
                                          placeholder="Rótulo"
                                          aria-label={`Rótulo da opção ${optionIdx + 1}`}
                                          maxLength={100}
                                        />
                                        <input
                                          className="cfg-input cfg-mono"
                                          value={option.value}
                                          onChange={(e) => setOptions(idx, (o) => o.map((x, i) => (i === optionIdx ? { ...x, value: slugifyKey(e.target.value) } : x)))}
                                          placeholder="valor"
                                          aria-label={`Valor da opção ${optionIdx + 1}`}
                                          maxLength={50}
                                          style={{ width: 140, flexShrink: 0 }}
                                        />
                                        <button type="button" className="icon-act danger" aria-label={`Remover opção ${optionIdx + 1}`} onClick={() => setOptions(idx, (o) => o.filter((_, i) => i !== optionIdx))}>
                                          <X size={14} />
                                        </button>
                                      </div>
                                    ))}
                                    <button type="button" className="cfg-link" onClick={() => setOptions(idx, (o) => [...o, { value: "", label: "" }])}>Adicionar opção</button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div>
                      <button
                        type="button"
                        className="cfg-link"
                        onClick={() => {
                          const newIndex = specialFields.length;
                          setFields([...specialFields, { key: "", label: "", type: "text", required: true, multiple: false }]);
                          setOpenFieldIndexes((prev) => new Set(prev).add(newIndex));
                          requestAnimationFrame(() => newFieldLabelRef.current?.focus());
                        }}
                      >
                        Adicionar campo
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
            {subForm.is_special && (
              <div className="cat-preview">
                <div className="cfg-sub" style={{ margin: "0 0 8px" }}><span>Pré-visualização</span></div>
                <div style={{ borderTop: "1px solid var(--rule)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 16 }}>
                  {previewTitle ? (
                    <div>
                      <div className="cfg-sub" style={{ margin: 0 }}>Título gerado</div>
                      <div style={{ fontSize: 18, fontWeight: 500, overflowWrap: "anywhere" }}>{previewTitle}</div>
                    </div>
                  ) : (
                    <div className="cfg-sub" style={{ margin: 0 }}>O título aparecerá aqui</div>
                  )}
                  {specialFields.length === 0 ? (
                    <div className="cfg-sub" style={{ margin: 0 }}>Adicione campos para ver o formulário</div>
                  ) : (
                    specialFields.map((field, i) => (
                      <div key={i}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-2)", marginBottom: 4 }}>
                          {field.label || "(sem rótulo)"}
                          {field.required && <span style={{ color: "var(--danger)" }}> *</span>}
                        </div>
                        <div className="cfg-input" style={{ color: "var(--text-3)", borderWidth: "0 0 1px", minHeight: field.type === "textarea" ? 64 : undefined }}>
                          {field.type === "select" ? field.options?.[0]?.label || "Selecione..." : FIELD_TYPE_PREVIEW[field.type]}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
      {orgsCat && (
        <CategoryOrgsModal category={orgsCat} onClose={() => setOrgsCat(null)} onChanged={loadData} />
      )}
      {confirmDelete && (
        <ConfirmModal
          isOpen={confirmDelete.isOpen}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() =>
            confirmDelete.type === "category"
              ? performDeleteCat(confirmDelete.id)
              : performDeleteSub(confirmDelete.id)
          }
          title={
            confirmDelete.type === "category"
              ? "Excluir categoria"
              : "Excluir subcategoria"
          }
          message={
            confirmDelete.type === "category"
              ? "Deseja realmente excluir esta categoria e todas as suas subcategorias? Esta ação não pode ser desfeita."
              : "Deseja realmente excluir esta subcategoria?"
          }
          confirmText="Excluir"
          variant="danger"
        />
      )}
    </div>
  );
}
