import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../auth/AuthProvider";
import { listLocalHolidays } from "../../lib/queries";
import type { ImportedEvent } from "../../lib/importCalendarBuilder";
import { listNationalHolidays, mergeHolidays } from "../../lib/holidays";
import { ArrowLeft, CalendarDays, Download, List as ListIcon, MapPin, MoreHorizontal, Pencil, Printer, Trash2, Upload, Users } from "lucide-react";
import { DropdownMenu, type MenuAction } from "../ui";
import type { OrgPerson, CalBuilderEvent as CalEvent, CalCategory as Category, CalendarBuilderData as CalendarData, CalPeriod as Period } from "../../lib/types";
import { DateInput } from "../DateInput";
import { downloadBlob } from "../../lib/storage";
import { CalendarFilters, type FilterChip } from "./CalendarFilters";
import "./calendar.css";
import { CAT_PALETTE, HOLIDAY_COLOR, LOCAL_HOLIDAY_COLOR } from "../../lib/calendarColors";
import { askConfirm } from "../Feedback";

import { eventDays, isoOf, todayISO, uid, whenLabel } from "./dates";
import { initialView } from "./calendarData";
import { AgendaView, MonthCard } from "./views";
import { CityModal, EditorsModal, ImportSmartModal } from "./modals";
import { CategoriesSection, EventsSection, HolidaysSection, IdentitySection, LetivosSection, PeriodsSection } from "./EditorSections";

/* ============================== Construtor =============================== */
export type SaveResult = "conflict" | { version: number; stamp: string | null };
export type Layout = "calendario" | "lista";

export function CalendarBuilder({
  initialData,
  initialVersion,
  initialStamp,
  initialEditors,
  creatorName,
  canManage,
  canDelete,
  canManageEditors,
  canSetCity,
  people,
  onBack,
  onDelete,
  save,
}: {
  initialData: CalendarData;
  initialVersion: number;
  initialStamp: string | null;
  initialEditors: string[];
  creatorName: string | null;
  canManage: boolean;
  canDelete: boolean;
  canManageEditors: boolean;
  canSetCity: boolean;
  people: OrgPerson[];
  onBack: () => void;
  onDelete: () => void;
  save: (args: { data: CalendarData; editors: string[]; expectedVersion: number }) => Promise<SaveResult>;
}) {
  const [data, setData] = useState<CalendarData>(initialData);
  const [editors, setEditors] = useState<string[]>(initialEditors);
  const [savedJson, setSavedJson] = useState(() => JSON.stringify({ data: initialData, editors: initialEditors }));
  const [editing, setEditing] = useState(false); // começa fechado — abre só ao clicar em "Editar"
  const [viewId, setViewId] = useState<string>(() => initialView(initialData));
  const [layout, setLayout] = useState<Layout>("calendario");
  const [active, setActive] = useState<Set<string>>(new Set(initialData.categories.map((c) => c.id)));
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState<number>(initialVersion);
  const [stamp, setStamp] = useState<string | null>(initialStamp);
  const [importOpen, setImportOpen] = useState(false);
  const [editorsOpen, setEditorsOpen] = useState(false);
  const [showHolidays, setShowHolidays] = useState(true);
  const [showLocal, setShowLocal] = useState(true);
  const [cityOpen, setCityOpen] = useState(false);
  const { activeOrgId } = useAuth();
  const [eventQuery, setEventQuery] = useState("");
  const [newEventId, setNewEventId] = useState<string | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  // No celular as abas rolam de lado: mantém a aba escolhida visível (centralizada).
  useEffect(() => {
    const box = tabsRef.current;
    const tab = box?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (box && tab) box.scrollLeft = tab.offsetLeft - (box.clientWidth - tab.offsetWidth) / 2;
  }, [viewId]);

  // Feriados nacionais do ano (BrasilAPI, com fallback offline) — ver lib/holidays.
  const { data: nationalHolidays = [] } = useQuery({
    queryKey: ["national-holidays", data.year],
    queryFn: () => listNationalHolidays(data.year),
  });
  // Feriados do estado e do município da escola (cidade definida em Configurações > Escola).
  const { data: local } = useQuery({
    queryKey: ["local-holidays", activeOrgId, data.year],
    queryFn: () => listLocalHolidays(data.year),
    staleTime: 60 * 60_000,
    retry: 1,
  });
  const allHolidays = useMemo(() => mergeHolidays(nationalHolidays, local?.holidays ?? []), [nationalHolidays, local]);
  // Não duplica: esconde o marcador automático quando o feriado já virou evento (mesma data+título).
  const eventKeys = useMemo(
    () => new Set(data.events.map((e) => `${e.start}|${e.title.toLowerCase()}`)),
    [data.events]
  );
  const holidays = useMemo(
    () =>
      allHolidays.filter(
        (h) => (h.scope === "national" ? showHolidays : showLocal) && !eventKeys.has(`${h.date}|${h.title.toLowerCase()}`)
      ),
    [showHolidays, showLocal, allHolidays, eventKeys]
  );
  const cityShort = (local?.city ?? "").replace(/\s*[-–/,]\s*[A-Za-z]{2}$/, "");
  const localCount = local?.holidays.length ?? 0;

  const dirty = JSON.stringify({ data, editors }) !== savedJson;

  // Não deixa perder trabalho sem querer (fechar a aba ou voltar com alterações pendentes).
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const goBack = async () => {
    if (dirty && !(await askConfirm("Há alterações que ainda não foram salvas.\n\nSair mesmo assim?"))) return;
    onBack();
  };

  const catById = useMemo(
    () => Object.fromEntries(data.categories.map((c) => [c.id, c])),
    [data.categories]
  );
  const catCount = useMemo(() => {
    const n: Record<string, number> = {};
    data.events.forEach((e) => (n[e.categoryId] = (n[e.categoryId] || 0) + 1));
    return n;
  }, [data.events]);

  // Meses visíveis conforme a seleção (Ano completo ou período)
  const months = useMemo<number[]>(() => {
    if (viewId === "year") return Array.from({ length: 12 }, (_, i) => i);
    const p = data.periods.find((x) => x.id === viewId);
    if (!p) return Array.from({ length: 12 }, (_, i) => i);
    const out: number[] = [];
    for (let m = p.startMonth; m <= p.endMonth; m++) out.push(m);
    return out;
  }, [viewId, data.periods]);

  const totalLetivos = useMemo(
    () => months.reduce((s, m) => s + (data.letivosByMonth[m] || 0), 0),
    [months, data.letivosByMonth]
  );
  const yearLetivos = useMemo(
    () => Array.from({ length: 12 }, (_, m) => data.letivosByMonth[m] || 0).reduce((a, b) => a + b, 0),
    [data.letivosByMonth]
  );

  /* ---- resumo do período (o que a coordenação quer ver de relance) ---- */
  const today = todayISO();
  const periodEventCount = useMemo(
    () =>
      data.events.filter(
        (ev) => active.has(ev.categoryId) && eventDays(ev).some((x) => x.y === data.year && months.includes(x.m))
      ).length,
    [data.events, data.year, months, active]
  );
  /** Contagem por categoria e por tipo de feriado dentro do período visível (muda ao trocar de aba). */
  const periodCounts = useMemo(() => {
    const inPeriod = (iso: string) => +iso.slice(0, 4) === data.year && months.includes(+iso.slice(5, 7) - 1);
    const byCat: Record<string, number> = {};
    data.events.forEach((ev) => {
      if (eventDays(ev).some((x) => x.y === data.year && months.includes(x.m))) byCat[ev.categoryId] = (byCat[ev.categoryId] || 0) + 1;
    });
    let national = 0;
    let state = 0;
    allHolidays.forEach((h) => {
      if (!inPeriod(h.date) || eventKeys.has(`${h.date}|${h.title.toLowerCase()}`)) return;
      h.scope === "national" ? national++ : state++;
    });
    return { byCat, national, state };
  }, [data.events, data.year, months, allHolidays, eventKeys]);
  const next = useMemo(() => {
    const all = [
      ...data.events.filter((e) => active.has(e.categoryId)).map((e) => ({ title: e.title, start: e.start, end: e.end ?? e.start })),
      ...holidays.map((h) => ({ title: h.title, start: h.date, end: h.date })),
    ]
      .filter((e) => e.end >= today)
      .sort((a, b) => a.start.localeCompare(b.start));
    return all[0] ?? null;
  }, [data.events, holidays, active, today]);

  /* ---- helpers de mutação ---- */
  const set = (patch: Partial<CalendarData>) => setData((p) => ({ ...p, ...patch }));
  const toggleCat = (id: string) =>
    setActive((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const setAllFilters = (on: boolean) => {
    setActive(on ? new Set(data.categories.map((c) => c.id)) : new Set());
    setShowHolidays(on);
    setShowLocal(on);
  };
  const filterChips: FilterChip[] = [
    ...data.categories.map((c) => ({
      id: c.id,
      label: c.label,
      color: c.color,
      count: periodCounts.byCat[c.id] || 0,
      on: active.has(c.id),
      onToggle: () => toggleCat(c.id),
    })),
    ...(nationalHolidays.length > 0
      ? [{ id: "feriados-nacionais", label: "Feriados nacionais", color: HOLIDAY_COLOR, count: periodCounts.national, on: showHolidays, onToggle: () => setShowHolidays((v) => !v), title: "Feriados nacionais (BrasilAPI)" }]
      : []),
    ...(localCount > 0
      ? [{ id: "feriados-locais", label: `Feriados de ${cityShort || "sua cidade"}`, color: LOCAL_HOLIDAY_COLOR, count: periodCounts.state, on: showLocal, onToggle: () => setShowLocal((v) => !v), title: `Feriados do estado e do município (${local?.city ?? ""})` }]
      : []),
  ];

  const addCategory = () =>
    set({ categories: [...data.categories, { id: uid(), label: "Nova categoria", color: CAT_PALETTE[data.categories.length % CAT_PALETTE.length] }] });
  const updateCategory = (id: string, patch: Partial<Category>) =>
    set({ categories: data.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const removeCategory = async (id: string) => {
    const n = catCount[id] || 0;
    if (n > 0 && !(await askConfirm(`Remover esta categoria também apaga os ${n} evento(s) dela.\n\nDeseja continuar?`))) return;
    set({
      categories: data.categories.filter((c) => c.id !== id),
      events: data.events.filter((e) => e.categoryId !== id),
    });
  };

  /** Novo evento — sem data, usa hoje (se estiver no ano do calendário) ou 1º de janeiro. */
  const addEvent = (start?: string) => {
    const id = uid();
    const fallback = today.startsWith(String(data.year)) ? today : `${data.year}-01-01`;
    set({
      events: [
        ...data.events,
        { id, title: "Novo evento", categoryId: data.categories[0]?.id ?? "", start: start ?? fallback },
      ],
    });
    setNewEventId(id);
    setEventQuery("");
    setEditing(true);
  };
  const updateEvent = (id: string, patch: Partial<CalEvent>) =>
    set({ events: data.events.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  const removeEvent = (id: string) => set({ events: data.events.filter((e) => e.id !== id) });

  const addPeriod = () =>
    set({ periods: [...data.periods, { id: uid(), label: "Novo período", startMonth: 0, endMonth: 2 }] });
  const updatePeriod = (id: string, patch: Partial<Period>) =>
    set({ periods: data.periods.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const removePeriod = (id: string) => {
    set({ periods: data.periods.filter((p) => p.id !== id) });
    if (viewId === id) setViewId("year");
  };

  const setLetivos = (m: number, raw: string) => {
    const next = { ...data.letivosByMonth };
    const n = Math.max(0, Math.min(31, Math.floor(Number(raw))));
    if (!raw || Number.isNaN(n) || n === 0) delete next[m];
    else next[m] = n;
    set({ letivosByMonth: next });
  };
  /** Sugestão: segunda a sexta, descontando feriados nacionais e eventos de feriado/recesso/férias. */
  const suggestLetivos = async () => {
    if (
      Object.values(data.letivosByMonth).some(Boolean) &&
      !(await askConfirm("Já existem dias letivos preenchidos.\n\nSubstituir pelos valores sugeridos?", { confirmLabel: "Substituir" }))
    )
      return;
    const off = new Set<string>(nationalHolidays.map((h) => h.date));
    data.events.forEach((ev) => {
      if (/feriado|recesso|f[ée]rias/i.test(catById[ev.categoryId]?.label ?? "")) {
        eventDays(ev).forEach((x) => off.add(isoOf(x.y, x.m, x.d)));
      }
    });
    const out: Record<number, number> = {};
    for (let m = 0; m < 12; m++) {
      const n = new Date(data.year, m + 1, 0).getDate();
      let count = 0;
      for (let day = 1; day <= n; day++) {
        const dow = new Date(data.year, m, day).getDay();
        if (dow !== 0 && dow !== 6 && !off.has(isoOf(data.year, m, day))) count++;
      }
      out[m] = count;
    }
    set({ letivosByMonth: out });
  };

  /* ---- salvar no servidor (trava otimista por versão) ---- */
  const handleSave = async () => {
    if (saving) return;
    const snapshot = data;
    const snapEditors = editors;
    setSaving(true);
    try {
      const res = await save({ data: snapshot, editors: snapEditors, expectedVersion: version });
      if (res === "conflict") return; // a página remonta com os dados frescos do banco
      setVersion(res.version);
      setStamp(res.stamp);
      setSavedJson(JSON.stringify({ data: snapshot, editors: snapEditors }));
    } catch (e) {
      alert("Não foi possível salvar: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  /* ---- exportar / importar JSON ---- */
  const exportJSON = () => {
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), `calendario-${data.year}.json`);
  };
  const importJSON = (file: File) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        const parsed = JSON.parse(String(r.result)) as CalendarData;
        setData(parsed);
        setActive(new Set(parsed.categories.map((c) => c.id)));
        setViewId("year");
      } catch {
        alert("Arquivo inválido. Selecione um JSON exportado por este app.");
      }
    };
    r.readAsText(file);
  };

  /* ---- importação inteligente (Excel/CSV/PDF/DOCX/ICS) → eventos no construtor ---- */
  const applyImported = (events: ImportedEvent[], mode: "add" | "replace") => {
    const cats = [...data.categories];
    const findOrCreateCat = (label: string) => {
      const want = (label || "Evento").trim();
      const hit = cats.find((c) => c.label.toLowerCase() === want.toLowerCase());
      if (hit) return hit.id;
      const created = { id: uid(), label: want, color: CAT_PALETTE[cats.length % CAT_PALETTE.length] };
      cats.push(created);
      return created.id;
    };
    const mapped: CalEvent[] = events.map((e) => ({
      id: uid(),
      title: e.title,
      categoryId: findOrCreateCat(e.categoryLabel),
      start: e.start,
      end: e.end,
    }));
    const nextEvents = mode === "replace" ? mapped : [...data.events, ...mapped];
    setData({ ...data, categories: cats, events: nextEvents });
    setActive(new Set(cats.map((c) => c.id)));
    if (canManage) setEditing(true);
    setImportOpen(false);
  };

  /* ---- feriados nacionais → eventos editáveis (categoria Feriado) ---- */
  const addHolidays = () => {
    if (!allHolidays.length) {
      alert("Feriados ainda carregando. Tente em instantes.");
      return;
    }
    const cats = [...data.categories];
    let cat = cats.find((c) => c.label.toLowerCase() === "feriado");
    if (!cat) {
      cat = { id: uid(), label: "Feriado", color: "#DC2626" };
      cats.push(cat);
    }
    const existing = new Set(data.events.map((e) => `${e.start}|${e.title.toLowerCase()}`));
    const toAdd = allHolidays
      .filter((h) => !existing.has(`${h.date}|${h.title.toLowerCase()}`))
      .map((h) => ({ id: uid(), title: h.generic ? "Feriado municipal" : h.title, categoryId: cat!.id, start: h.date }));
    if (!toAdd.length) {
      alert(`Os feriados de ${data.year} já estão no calendário.`);
      return;
    }
    setData({ ...data, categories: cats, events: [...data.events, ...toAdd] });
    setActive(new Set(cats.map((c) => c.id)));
  };

  const menuItems: MenuAction[] = [
    { label: "Participantes", hint: "Quem mais pode editar", icon: <Users size={16} />, onClick: () => setEditorsOpen(true), hidden: !canManageEditors },
    { label: "Cidade da escola", hint: local?.city ? `${local.city} · feriados locais` : "Para mostrar feriados locais", icon: <MapPin size={16} />, onClick: () => setCityOpen(true), hidden: !canSetCity },
    { label: "Importar calendário", hint: "Excel, CSV, PDF, Word ou ICS", icon: <Upload size={16} />, onClick: () => setImportOpen(true), hidden: !canManage },
    { label: "Imprimir / PDF", icon: <Printer size={16} />, onClick: () => window.print() },
    { label: "Baixar backup (.json)", icon: <Download size={16} />, onClick: exportJSON },
    { label: "Excluir calendário", icon: <Trash2 size={16} />, onClick: onDelete, danger: true, hidden: !canDelete },
  ];

  const tabs = [{ id: "year", label: `Ano ${data.year}` }, ...data.periods.map((p) => ({ id: p.id, label: p.label }))];

  /* ============================== Render ============================== */
  return (
    <div className="cb-app">
      {/* Cabeçalho global */}
      <header className="cb-top">
        <div className="cb-brand">
          <button className="cb-back" onClick={goBack} title="Voltar aos calendários" aria-label="Voltar aos calendários">
            <ArrowLeft size={18} />
          </button>
          <div className="cb-titles">
            <div className="cb-eyebrow">{data.school} · {data.year}</div>
            <h1 className="cb-h1">{data.title}</h1>
            <div className="cb-stamp">
              {dirty ? <b className="cb-unsaved">● Alterações não salvas</b> : null}
              {dirty && (creatorName || stamp) ? " · " : null}
              {creatorName ? <>Criado por {creatorName}</> : null}
              {creatorName && stamp ? " · " : null}
              {stamp}
            </div>
          </div>
        </div>
        <div className="cb-top-actions">
          {canManage ? (
            <button className={`cb-btn ${editing ? "is-on" : ""}`} onClick={() => setEditing((v) => !v)} aria-pressed={editing}>
              <Pencil size={15} /> {editing ? "Fechar edição" : "Editar"}
            </button>
          ) : null}
          {canManage ? (
            <button className="cb-btn cb-btn-primary" onClick={handleSave} disabled={!dirty || saving}>
              {saving ? "Salvando…" : dirty ? "Salvar alterações" : "✓ Salvo"}
            </button>
          ) : null}
          <DropdownMenu label="Mais" icon={<MoreHorizontal size={16} />} items={menuItems} />
        </div>
      </header>

      <div className={`cb-layout ${editing ? "with-editor" : ""}`}>
        {/* ---------------- EDITOR (no celular abre em tela cheia) ---------------- */}
        {editing && canManage && (
          <aside className="cb-editor" aria-label="Editar calendário">
            <div className="cb-editor-head">
              <strong>Editar calendário</strong>
              <div className="cb-editor-head-actions">
                <button className="cb-btn cb-btn-primary" onClick={handleSave} disabled={!dirty || saving}>
                  {saving ? "Salvando…" : dirty ? "Salvar" : "✓ Salvo"}
                </button>
                <button className="cb-btn" onClick={() => setEditing(false)}>Fechar</button>
              </div>
            </div>

            <EventsSection events={data.events} categories={data.categories} query={eventQuery} newEventId={newEventId} onQuery={setEventQuery} onAdd={() => addEvent()} onUpdate={updateEvent} onRemove={removeEvent} />

            <CategoriesSection categories={data.categories} counts={catCount} onAdd={addCategory} onUpdate={updateCategory} onRemove={removeCategory} />

            <PeriodsSection periods={data.periods} onAdd={addPeriod} onUpdate={updatePeriod} onRemove={removePeriod} />

            <LetivosSection byMonth={data.letivosByMonth} total={yearLetivos} onChange={setLetivos} onSuggest={suggestLetivos} />

            <HolidaysSection year={data.year} holidayCount={allHolidays.length} city={local?.city} cityShort={cityShort} cityStatus={local?.status} canSetCity={canSetCity} onAdd={addHolidays} onChangeCity={() => setCityOpen(true)} />

            <IdentitySection data={data} onChange={set} />
          </aside>
        )}

        {/* ---------------- VISUALIZAÇÃO ---------------- */}
        <main className="cb-preview">
          {/* Período + modo de exibição */}
          <div className="cb-toolbar">
            <div className="cb-tabs" role="tablist" aria-label="Período" ref={tabsRef}>
              {tabs.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={viewId === t.id}
                  className="cb-tab"
                  onClick={() => setViewId(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="cb-seg" role="group" aria-label="Modo de exibição">
              <button aria-pressed={layout === "calendario"} onClick={() => setLayout("calendario")}>
                <CalendarDays size={15} /> Calendário
              </button>
              <button aria-pressed={layout === "lista"} onClick={() => setLayout("lista")}>
                <ListIcon size={15} /> Lista
              </button>
            </div>
          </div>

          {/* Resumo do período */}
          <div className="cb-stats">
            <div className="cb-stat">
              <span>Eventos no período</span>
              <strong>{periodEventCount}</strong>
            </div>
            {totalLetivos > 0 ? (
              <div className="cb-stat">
                <span>Dias letivos</span>
                <strong>
                  {totalLetivos}
                  {viewId === "year" ? <em> de 200 (mín.)</em> : null}
                </strong>
              </div>
            ) : null}
            {next ? (
              <div className="cb-stat cb-stat-wide">
                <span>Próximo compromisso</span>
                <strong className="cb-trunc">{next.title}</strong>
                <em>{whenLabel(today, next.start, next.end)}</em>
              </div>
            ) : null}
          </div>

          <CalendarFilters chips={filterChips} onSetAll={setAllFilters} />

          {local && local.status !== "ok" ? (
            <div className="cb-notice">
              <MapPin size={16} aria-hidden />
              <span>
                {local.status === "sem-cidade"
                  ? canSetCity
                    ? "Informe a cidade da escola para ver também os feriados do estado e do município."
                    : "A coordenação ainda não informou a cidade da escola — por isso só aparecem os feriados nacionais."
                  : `Ainda não há feriados estaduais/municipais publicados para ${data.year}. Os nacionais continuam aparecendo.`}
              </span>
              {local.status === "sem-cidade" && canSetCity ? (
                <button className="cb-link" onClick={() => setCityOpen(true)}>Definir cidade</button>
              ) : null}
            </div>
          ) : local && local.status === "ok" ? (
            <div className="cb-notice cb-notice-soft">
              <MapPin size={16} aria-hidden />
              <span>
                {localCount > 0
                  ? `Feriados do estado e de ${cityShort} (${local.uf}) vêm de dados abertos — confirme com a prefeitura. Onde a fonte não traz o nome, aparece “Feriado municipal”.`
                  : `Nenhum feriado do estado ou de ${cityShort} encontrado em ${data.year}. Se houver algum, cadastre-o como evento.`}
              </span>
              {canSetCity ? <button className="cb-link" onClick={() => setCityOpen(true)}>Alterar cidade</button> : null}
            </div>
          ) : null}

          {layout === "calendario" ? (
            <div className="cb-months">
              {months.map((m) => (
                <MonthCard
                  key={m}
                  year={data.year}
                  month={m}
                  events={data.events}
                  holidays={holidays}
                  catById={catById}
                  active={active}
                  letivos={data.letivosByMonth[m]}
                  today={today}
                  onDayClick={editing && canManage ? (iso) => addEvent(iso) : undefined}
                />
              ))}
            </div>
          ) : (
            <AgendaView
              year={data.year}
              months={months}
              events={data.events}
              holidays={holidays}
              catById={catById}
              active={active}
              letivosByMonth={data.letivosByMonth}
              today={today}
            />
          )}

          <footer className="cb-foot">
            <div className="cb-note">{data.notes}</div>
            {totalLetivos > 0 && (
              <div>Dias letivos no período: <strong>{totalLetivos}</strong></div>
            )}
          </footer>
        </main>
      </div>

      {importOpen && canManage ? (
        <ImportSmartModal
          year={data.year}
          onJSON={importJSON}
          onApply={applyImported}
          onClose={() => setImportOpen(false)}
        />
      ) : null}

      {cityOpen && canSetCity ? <CityModal onClose={() => setCityOpen(false)} /> : null}

      {editorsOpen && canManageEditors ? (
        <EditorsModal
          people={people}
          editors={editors}
          onChange={setEditors}
          onClose={() => setEditorsOpen(false)}
        />
      ) : null}
    </div>
  );
}


