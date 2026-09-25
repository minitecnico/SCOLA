import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
import { successToast } from "../components/Feedback";
import { canManageCalendar } from "../lib/permissions";
import {
  CALENDAR_CONFLICT,
  createCalendar,
  deleteCalendar,
  listCalendars,
  listOrgPeople,
  loadCalendar,
  saveCalendar,
  type CalendarSummary,
} from "../lib/queries";
import { downloadCalendarTemplate } from "../lib/importCalendar";
import { parseAnyCalendarFile, type ImportedEvent } from "../lib/importCalendarBuilder";
import { listNationalHolidays } from "../lib/holidays";
import { Button, Modal } from "../components/ui";
import { Dropzone } from "../components/Dropzone";
import { cn } from "../lib/cn";
import type { CalendarHoliday, OrgPerson } from "../lib/types";
import type {
  CalBuilderEvent as CalEvent,
  CalCategory as Category,
  CalendarBuilderData as CalendarData,
  CalPeriod as Period,
} from "../lib/types";
import { DateInput } from '../components/DateInput';

/* ============================================================================
   Construtor de Calendário Escolar — React + TypeScript
   ----------------------------------------------------------------------------
   • A coordenação alimenta os dados no Editor (categorias, eventos, períodos)
     e o calendário aparece preenchido automaticamente (preview ao vivo).
   • Cores livres por categoria — o contraste do texto é calculado sozinho.
   • Visão "Ano completo" ou qualquer "Período/Trimestre" configurável.
   • Persistido no banco (D1): a coordenação salva e o calendário fica disponível
     para todos os usuários da organização (multi-tenant). Export/Import JSON e
     Imprimir/PDF continuam disponíveis.
============================================================================ */

/* --------------------------- Utilidades ---------------------------------- */
const MONTHS_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const DOW = [["S","seg"],["T","ter"],["Q","qua"],["Q","qui"],["S","sex"],["S","sáb"],["D","dom"]]; // semana inicia na segunda
const uid = () => Math.random().toString(36).slice(2, 9);
const pad2 = (n: number) => String(n).padStart(2, "0");
/** Paleta categórica de alto contraste: matizes bem espaçados no círculo cromático
 *  para que cores vizinhas (na lista e no calendário) nunca se confundam ao bater o olho. */
const CAT_PALETTE = ["#2563EB", "#DC2626", "#16A34A", "#9333EA", "#0D9488", "#DB2777", "#CA8A04", "#475569", "#4338CA", "#65A30D", "#BE123C", "#1E293B"];

function hexToRgb(hex: string) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h || "000000", 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
const rgba = (hex: string, a: number) => {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};
/** Texto legível (preto/branco) sobre qualquer cor — garante leitura ao professor. */
function readableText(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return L > 0.6 ? "#1F2A24" : "#FFFFFF";
}
function parseISO(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
/** Lista de {y,m,d} cobertos por um evento (intervalo inclusivo). */
function eventDays(ev: CalEvent) {
  const start = parseISO(ev.start);
  const end = ev.end ? parseISO(ev.end) : start;
  const out: { y: number; m: number; d: number }[] = [];
  const cur = new Date(start);
  let guard = 0;
  while (cur <= end && guard < 400) {
    out.push({ y: cur.getFullYear(), m: cur.getMonth(), d: cur.getDate() });
    cur.setDate(cur.getDate() + 1);
    guard++;
  }
  return out;
}
function daysInMonthFor(ev: CalEvent, year: number, month: number) {
  return eventDays(ev).filter((x) => x.y === year && x.m === month).map((x) => x.d).sort((a, b) => a - b);
}
function chipLabel(days: number[]) {
  if (days.length === 0) return "";
  if (days.length === 1) return pad2(days[0]);
  return `${pad2(days[0])}–${pad2(days[days.length - 1])}`;
}

/* ----------------------- Dados iniciais (semente) ------------------------ */
const d = (m: number, day: number) => `2026-${pad2(m + 1)}-${pad2(day)}`;
const SEED: CalendarData = {
  school: "Sua escola",
  title: "Calendário 2026",
  year: 2026,
  categories: [
    { id: "feriado", label: "Feriado", color: "#DC2626" },
    { id: "avaliacao", label: "Avaliação", color: "#0D9488" },
    { id: "pedagogico", label: "Pedagógico", color: "#2563EB" },
    { id: "evento", label: "Evento & Cultura", color: "#16A34A" },
    { id: "recuperacao", label: "Recuperação Paralela", color: "#9333EA" },
    { id: "comemorativa", label: "Data comemorativa", color: "#DB2777" },
    { id: "marco", label: "Marco do período", color: "#475569" },
  ],
  periods: [
    { id: uid(), label: "1º Trimestre", startMonth: 1, endMonth: 3 },
    { id: uid(), label: "2º Trimestre", startMonth: 4, endMonth: 7 },
    { id: uid(), label: "3º Trimestre", startMonth: 8, endMonth: 11 },
  ],
  letivosByMonth: {},
  notes: "",
  events: [
    { id: uid(), title: "Feriado do Dia do Trabalhador", categoryId: "feriado", start: d(4, 1) },
    { id: uid(), title: "Dia das Mães", categoryId: "comemorativa", start: d(4, 9) },
  ],
};

function fmtStamp(iso: string | null, name: string | null) {
  if (!name && !iso) return null;
  const when = iso
    ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;
  if (name && when) return `Última edição por ${name} · ${when}`;
  if (name) return `Última edição por ${name}`;
  return when ? `Última edição em ${when}` : null;
}

/** Semente para um calendário novo: categorias padrão, sem eventos. */
function newSeed(title: string): CalendarData {
  return { ...SEED, title, events: [], letivosByMonth: {}, notes: "" };
}

/* ====================== Centro de calendários (lista + CRUD) ====================== */
export function CalendarPage() {
  const { role, activeOrgId, profile, user } = useAuth();
  const canManage = canManageCalendar(role);
  const userId = user?.id ?? null;
  const updaterName = profile?.full_name || profile?.email || "Usuário";
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: list = [], isLoading, isError, error } = useQuery({
    queryKey: ["calendars", activeOrgId],
    queryFn: listCalendars,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["calendars", activeOrgId] });

  if (openId) {
    return (
      <CalendarEditorLoader
        id={openId}
        role={role}
        canManage={canManage}
        userId={userId}
        updaterName={updaterName}
        onBack={() => {
          setOpenId(null);
          refresh();
        }}
      />
    );
  }

  return (
    <CalendarCenter
      list={list}
      loading={isLoading}
      isError={isError}
      error={error as Error | null}
      canManage={canManage}
      role={role}
      userId={userId}
      creatorName={updaterName}
      onOpen={setOpenId}
      onCreated={(id) => {
        refresh();
        setOpenId(id);
      }}
      onChanged={refresh}
    />
  );
}

function CalendarCenter({
  list,
  loading,
  isError,
  error,
  canManage,
  role,
  userId,
  creatorName,
  onOpen,
  onCreated,
  onChanged,
}: {
  list: CalendarSummary[];
  loading: boolean;
  isError: boolean;
  error: Error | null;
  canManage: boolean;
  role: string | null;
  userId: string | null;
  creatorName: string;
  onOpen: (id: string) => void;
  onCreated: (id: string) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const canDelete = (c: CalendarSummary) => role === "superadmin" || role === "gestor" || c.createdBy === userId;

  const create = async () => {
    setBusy(true);
    try {
      const id = await createCalendar({ data: newSeed("Novo calendário"), title: "Novo calendário", creatorId: userId, creatorName });
      successToast("Calendário criado");
      onCreated(id);
    } catch (e) {
      alert("Não foi possível criar: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (c: CalendarSummary) => {
    if (!confirm(`Excluir o calendário “${c.title}”?\n\nEssa ação não pode ser desfeita e remove o calendário para todos da escola.`)) return;
    try {
      await deleteCalendar(c.id);
      successToast("Calendário excluído");
      onChanged();
    } catch (e) {
      alert("Não foi possível excluir: " + (e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-1">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-emerald-700">Centro de calendários</p>
          <h1 className="text-2xl font-black text-foreground">Calendários da escola</h1>
          <p className="mt-1 max-w-2xl text-sm font-medium text-muted-foreground">
            Crie quantos calendários precisar (anual, por trimestre, por turno…). Todos da escola visualizam; a edição é de quem cria
            mais a coordenação, e você pode liberar para outros usuários como participantes.
          </p>
        </div>
        {canManage ? (
          <Button onClick={create} disabled={busy}>{busy ? "Criando…" : "+ Novo calendário"}</Button>
        ) : null}
      </div>

      {isError ? (
        <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-700">
          Não foi possível carregar. {error?.message}
        </p>
      ) : null}

      {loading ? (
        <div className="grid place-items-center p-16 text-sm font-bold text-muted-foreground">Carregando…</div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <p className="text-sm font-bold text-muted-foreground">Nenhum calendário ainda.</p>
          {canManage ? <p className="mt-1 text-xs text-muted-foreground">Clique em “+ Novo calendário” para começar.</p> : null}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((c) => (
            <article key={c.id} className="flex flex-col rounded-2xl border border-border bg-card p-4 shadow-sm transition hover:shadow-md">
              <div className="flex items-start justify-between gap-2">
                <h2 className="min-w-0 flex-1 truncate text-base font-black text-foreground">{c.title || "Sem título"}</h2>
                {c.editors.length > 0 ? (
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-black text-muted-foreground">
                    {c.editors.length} participante(s)
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs font-bold text-muted-foreground">
                {c.createdByName ? `Criado por ${c.createdByName}` : "Criador desconhecido"}
              </p>
              <p className="text-xs text-muted-foreground">{fmtStamp(c.updatedAt, c.updatedByName) ?? "Sem edições ainda"}</p>
              <div className="mt-3 flex gap-2 border-t border-border pt-3">
                <Button variant="soft" className="flex-1" onClick={() => onOpen(c.id)}>Abrir</Button>
                {canDelete(c) ? (
                  <button
                    onClick={() => remove(c)}
                    className="rounded-xl bg-red-50 px-3 text-sm font-bold text-red-600 transition hover:bg-red-100"
                    aria-label="Excluir calendário"
                  >
                    Excluir
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/* ====================== Carrega 1 calendário e abre o construtor ====================== */
function CalendarEditorLoader({
  id,
  role,
  canManage,
  userId,
  updaterName,
  onBack,
}: {
  id: string;
  role: string | null;
  canManage: boolean;
  userId: string | null;
  updaterName: string;
  onBack: () => void;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const { data: people = [] } = useQuery({ queryKey: ["org-people"], queryFn: listOrgPeople, enabled: canManage });
  const { data: rec, isLoading } = useQuery({ queryKey: ["calendar", id, reloadKey], queryFn: () => loadCalendar(id) });

  if (isLoading) return <div className="grid place-items-center p-16 text-sm font-bold text-muted-foreground">Carregando calendário…</div>;
  if (!rec) {
    return (
      <div className="grid place-items-center gap-3 p-16 text-center">
        <p className="text-sm font-bold text-muted-foreground">Calendário não encontrado (pode ter sido excluído).</p>
        <Button variant="soft" onClick={onBack}>← Voltar aos calendários</Button>
      </div>
    );
  }

  const canEdit = canManage || rec.createdBy === userId || (!!userId && rec.editors.includes(userId));
  const canDelete = role === "superadmin" || role === "gestor" || rec.createdBy === userId;
  const canManageEditors = canManage || rec.createdBy === userId;
  const hasData = rec.data && Object.keys(rec.data).length > 0;

  return (
    <CalendarBuilder
      key={`${id}:${reloadKey}`}
      initialData={hasData ? rec.data : newSeed(rec.title || "Calendário")}
      initialVersion={rec.version}
      initialStamp={fmtStamp(rec.updatedAt, rec.updatedByName)}
      creatorName={rec.createdByName}
      canManage={canEdit}
      canDelete={canDelete}
      canManageEditors={canManageEditors}
      people={people}
      initialEditors={rec.editors}
      onBack={onBack}
      onDelete={async () => {
        if (!confirm(`Excluir o calendário “${rec.title}”?\n\nEssa ação não pode ser desfeita.`)) return;
        try {
          await deleteCalendar(id);
          successToast("Calendário excluído");
          onBack();
        } catch (e) {
          alert("Não foi possível excluir: " + (e as Error).message);
        }
      }}
      save={async ({ data, editors, expectedVersion }) => {
        try {
          const meta = await saveCalendar({ id, data, title: data.title, editors, expectedVersion, updaterId: userId, updaterName });
          successToast("Calendário salvo para toda a equipe");
          return { version: meta.version, stamp: fmtStamp(meta.updatedAt, meta.updatedByName) };
        } catch (e) {
          if ((e as Error).message === CALENDAR_CONFLICT) {
            alert(
              "Outra pessoa salvou este calendário enquanto você editava.\n\n" +
                "Para não sobrescrever o trabalho dela, suas alterações não salvas serão descartadas e a versão atual será recarregada.",
            );
            setReloadKey((k) => k + 1);
            return "conflict";
          }
          throw e;
        }
      }}
    />
  );
}

/* ============================== Construtor =============================== */
type SaveResult = "conflict" | { version: number; stamp: string | null };
function CalendarBuilder({
  initialData,
  initialVersion,
  initialStamp,
  initialEditors,
  creatorName,
  canManage,
  canDelete,
  canManageEditors,
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
  people: OrgPerson[];
  onBack: () => void;
  onDelete: () => void;
  save: (args: { data: CalendarData; editors: string[]; expectedVersion: number }) => Promise<SaveResult>;
}) {
  const [data, setData] = useState<CalendarData>(initialData);
  const [editors, setEditors] = useState<string[]>(initialEditors);
  const [savedJson, setSavedJson] = useState(() => JSON.stringify({ data: initialData, editors: initialEditors }));
  const [editing, setEditing] = useState(false); // começa fechado — abre só ao clicar em "Editar"
  const [viewId, setViewId] = useState<string>(initialData.periods[1]?.id ?? "year");
  const [active, setActive] = useState<Set<string>>(new Set(initialData.categories.map((c) => c.id)));
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState<number>(initialVersion);
  const [stamp, setStamp] = useState<string | null>(initialStamp);
  const [importOpen, setImportOpen] = useState(false);
  const [editorsOpen, setEditorsOpen] = useState(false);
  const [showHolidays, setShowHolidays] = useState(true);

  // Feriados nacionais do ano (BrasilAPI, com fallback offline) — ver lib/holidays.
  const { data: nationalHolidays = [] } = useQuery({
    queryKey: ["national-holidays", data.year],
    queryFn: () => listNationalHolidays(data.year),
  });
  // Não duplica: esconde o marcador automático quando o feriado já virou evento (mesma data+título).
  const eventKeys = useMemo(
    () => new Set(data.events.map((e) => `${e.start}|${e.title.toLowerCase()}`)),
    [data.events]
  );
  const holidays = useMemo(
    () => (showHolidays ? nationalHolidays.filter((h) => !eventKeys.has(`${h.date}|${h.title.toLowerCase()}`)) : []),
    [showHolidays, nationalHolidays, eventKeys]
  );

  const dirty = JSON.stringify({ data, editors }) !== savedJson;

  const catById = useMemo(
    () => Object.fromEntries(data.categories.map((c) => [c.id, c])),
    [data.categories]
  );

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

  /* ---- helpers de mutação ---- */
  const set = (patch: Partial<CalendarData>) => setData((p) => ({ ...p, ...patch }));
  const toggleCat = (id: string) =>
    setActive((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const addCategory = () =>
    set({ categories: [...data.categories, { id: uid(), label: "Nova categoria", color: CAT_PALETTE[data.categories.length % CAT_PALETTE.length] }] });
  const updateCategory = (id: string, patch: Partial<Category>) =>
    set({ categories: data.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const removeCategory = (id: string) =>
    set({
      categories: data.categories.filter((c) => c.id !== id),
      events: data.events.filter((e) => e.categoryId !== id),
    });

  const addEvent = () =>
    set({
      events: [
        ...data.events,
        { id: uid(), title: "Novo evento", categoryId: data.categories[0]?.id ?? "", start: `${data.year}-01-01` },
      ],
    });
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
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `calendario-${data.year}.json`;
    a.click();
    URL.revokeObjectURL(url);
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
  const addNationalHolidays = () => {
    if (!nationalHolidays.length) {
      alert("Feriados nacionais ainda carregando. Tente em instantes.");
      return;
    }
    const cats = [...data.categories];
    let cat = cats.find((c) => c.label.toLowerCase() === "feriado");
    if (!cat) {
      cat = { id: uid(), label: "Feriado", color: "#DC2626" };
      cats.push(cat);
    }
    const existing = new Set(data.events.map((e) => `${e.start}|${e.title.toLowerCase()}`));
    const toAdd = nationalHolidays
      .filter((h) => !existing.has(`${h.date}|${h.title.toLowerCase()}`))
      .map((h) => ({ id: uid(), title: h.title, categoryId: cat!.id, start: h.date }));
    if (!toAdd.length) {
      alert(`Os feriados nacionais de ${data.year} já estão no calendário.`);
      return;
    }
    setData({ ...data, categories: cats, events: [...data.events, ...toAdd] });
    setActive(new Set(cats.map((c) => c.id)));
  };

  /* ============================== Render ============================== */
  return (
    <div className="cb-app">
      <style>{CSS}</style>

      {/* Cabeçalho global */}
      <header className="cb-top">
        <div className="cb-brand">
          <button className="cb-back" onClick={onBack} title="Voltar aos calendários">←</button>
          <div className="cb-mark">{(data.school[0] || "C").toUpperCase()}</div>
          <div>
            <div className="cb-eyebrow">{data.school}</div>
            <h1 className="cb-h1">{data.title}</h1>
            <div className="cb-stamp">
              {creatorName ? <>Criado por {creatorName}</> : null}
              {creatorName && stamp ? " · " : null}
              {stamp}
            </div>
          </div>
        </div>
        <div className="cb-top-actions">
          <select className="cb-select" value={viewId} onChange={(e) => setViewId(e.target.value)} aria-label="Visualização">
            <option value="year">Ano completo ({data.year})</option>
            {data.periods.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          {canManage ? (
            <button className="cb-btn" onClick={() => setEditing((v) => !v)}>
              {editing ? "Ocultar editor" : "✎ Editar"}
            </button>
          ) : null}
          {canManageEditors ? (
            <button className="cb-btn" onClick={() => setEditorsOpen(true)}>
              Participantes{editors.length ? ` (${editors.length})` : ""}
            </button>
          ) : null}
          {canManage ? (
            <button className="cb-btn cb-btn-primary" onClick={handleSave} disabled={!dirty || saving}>
              {saving ? "Salvando…" : dirty ? "Salvar" : "✓ Salvo"}
            </button>
          ) : null}
          <button className="cb-btn" onClick={() => window.print()}>Imprimir / PDF</button>
          <button className="cb-btn" onClick={exportJSON}>Exportar</button>
          {canManage ? (
            <button className="cb-btn cb-btn-primary" onClick={() => setImportOpen(true)}>↑ Importar calendário</button>
          ) : null}
          {canDelete ? (
            <button className="cb-btn cb-btn-danger" onClick={onDelete}>Excluir</button>
          ) : null}
        </div>
      </header>

      <div className={`cb-layout ${editing ? "with-editor" : ""}`}>
        {/* ---------------- EDITOR ---------------- */}
        {editing && canManage && (
          <aside className="cb-editor">
            <Section title="Identificação">
              <Field label="Escola">
                <input className="cb-input" value={data.school} onChange={(e) => set({ school: e.target.value })} />
              </Field>
              <Field label="Título do calendário">
                <input className="cb-input" value={data.title} onChange={(e) => set({ title: e.target.value })} />
              </Field>
              <Field label="Ano letivo">
                <input
                  className="cb-input"
                  type="number"
                  value={data.year}
                  onChange={(e) => set({ year: Number(e.target.value) })}
                />
              </Field>
            </Section>

            <Section title="Feriados nacionais">
              <p className="cb-help">
                Os feriados nacionais de {data.year} já aparecem no calendário (fonte BrasilAPI). Para deixá-los fixos e editáveis,
                adicione como eventos na categoria “Feriado”.
              </p>
              <button className="cb-add" onClick={addNationalHolidays}>+ Adicionar feriados de {data.year}</button>
            </Section>

            <Section title="Categorias" action={<button className="cb-add" onClick={addCategory}>+ Categoria</button>}>
              <p className="cb-help">Cores livres — o texto se ajusta para boa leitura automaticamente.</p>
              {data.categories.map((c) => (
                <div className="cb-row" key={c.id}>
                  <input
                    type="color"
                    className="cb-color"
                    value={c.color}
                    onChange={(e) => updateCategory(c.id, { color: e.target.value })}
                    aria-label={`Cor de ${c.label}`}
                  />
                  <input
                    className="cb-input cb-grow"
                    value={c.label}
                    onChange={(e) => updateCategory(c.id, { label: e.target.value })}
                  />
                  <button className="cb-del" onClick={() => removeCategory(c.id)} aria-label="Remover">×</button>
                </div>
              ))}
            </Section>

            <Section title="Períodos / Trimestres" action={<button className="cb-add" onClick={addPeriod}>+ Período</button>}>
              <p className="cb-help">Cada período vira uma opção no seletor “Visualização”.</p>
              {data.periods.map((p) => (
                <div className="cb-prow" key={p.id}>
                  <input
                    className="cb-input cb-grow"
                    value={p.label}
                    onChange={(e) => updatePeriod(p.id, { label: e.target.value })}
                  />
                  <select className="cb-input cb-mini" value={p.startMonth} onChange={(e) => updatePeriod(p.id, { startMonth: Number(e.target.value) })}>
                    {MONTHS_PT.map((m, i) => <option key={i} value={i}>{m.slice(0, 3)}</option>)}
                  </select>
                  <span className="cb-to">→</span>
                  <select className="cb-input cb-mini" value={p.endMonth} onChange={(e) => updatePeriod(p.id, { endMonth: Number(e.target.value) })}>
                    {MONTHS_PT.map((m, i) => <option key={i} value={i}>{m.slice(0, 3)}</option>)}
                  </select>
                  <button className="cb-del" onClick={() => removePeriod(p.id)} aria-label="Remover">×</button>
                </div>
              ))}
            </Section>

            <Section title={`Eventos (${data.events.length})`} action={<button className="cb-add" onClick={addEvent}>+ Evento</button>}>
              {[...data.events].sort((a, b) => a.start.localeCompare(b.start)).map((ev) => (
                <div className="cb-event" key={ev.id} style={{ borderLeftColor: catById[ev.categoryId]?.color ?? "#ccc" }}>
                  <input
                    className="cb-input"
                    value={ev.title}
                    placeholder="Título do evento"
                    onChange={(e) => updateEvent(ev.id, { title: e.target.value })}
                  />
                  <div className="cb-event-grid">
                    <select className="cb-input" value={ev.categoryId} onChange={(e) => updateEvent(ev.id, { categoryId: e.target.value })}>
                      {data.categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                    <DateInput value={ev.start} onChange={(v) => v && updateEvent(ev.id, { start: v })} />
                    <DateInput value={ev.end ?? ""} min={ev.start} placeholder="fim (opcional)" onChange={(v) => updateEvent(ev.id, { end: v || undefined })} />
                    <button className="cb-del" onClick={() => removeEvent(ev.id)} aria-label="Remover">× remover</button>
                  </div>
                </div>
              ))}
            </Section>

            <Section title="Rodapé">
              <Field label="Observações">
                <textarea className="cb-input cb-area" rows={3} value={data.notes} onChange={(e) => set({ notes: e.target.value })} />
              </Field>
            </Section>
          </aside>
        )}

        {/* ---------------- PREVIEW (visual aprovado) ---------------- */}
        <main className="cb-preview">
          {/* Filtros por categoria */}
          <div className="cb-filters">
            <span className="cb-hint">Filtrar:</span>
            {data.categories.map((c) => {
              const on = active.has(c.id);
              return (
                <button
                  key={c.id}
                  className="cb-chip"
                  aria-pressed={on}
                  onClick={() => toggleCat(c.id)}
                  style={{
                    color: on ? "#1F2A24" : "#5C6B62",
                    borderColor: on ? rgba(c.color, 0.55) : "#E7E4DA",
                    background: on ? rgba(c.color, 0.1) : "#fff",
                    opacity: on ? 1 : 0.55,
                  }}
                >
                  <span className="cb-cdot" style={{ background: c.color }} />
                  {c.label}
                </button>
              );
            })}
            {nationalHolidays.length > 0 ? (
              <button
                className="cb-chip"
                aria-pressed={showHolidays}
                onClick={() => setShowHolidays((v) => !v)}
                style={{
                  color: showHolidays ? "#1F2A24" : "#5C6B62",
                  borderColor: showHolidays ? rgba("#d97706", 0.55) : "#E7E4DA",
                  background: showHolidays ? rgba("#d97706", 0.1) : "#fff",
                  opacity: showHolidays ? 1 : 0.55,
                }}
                title="Feriados nacionais (BrasilAPI)"
              >
                <span className="cb-cdot" style={{ background: "#d97706" }} />
                Feriados nacionais
              </button>
            ) : null}
          </div>

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
              />
            ))}
          </div>

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

/* ------------------- Modal de participantes (quem pode editar) --------------------- */
function EditorsModal({
  people,
  editors,
  onChange,
  onClose,
}: {
  people: OrgPerson[];
  editors: string[];
  onChange: (ids: string[]) => void;
  onClose: () => void;
}) {
  const set = new Set(editors);
  const toggle = (id: string) => {
    const n = new Set(set);
    n.has(id) ? n.delete(id) : n.add(id);
    onChange([...n]);
  };
  // Coordenação/direção já editam por papel — destacamos para não confundir.
  const alwaysEdit = (r: string) => r === "gestor" || r === "superadmin";

  return (
    <Modal open onClose={onClose} title="Participantes — quem pode editar" size="xl">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Todos da escola <b>veem</b> este calendário. Marque abaixo quem mais pode <b>editar</b>. A gestão já editam por
          padrão. As mudanças entram ao clicar em <b>Salvar</b>.
        </p>
        {people.length === 0 ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm font-bold text-muted-foreground">Nenhum usuário na escola ainda.</p>
        ) : (
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
            {people.map((p) => {
              const byRole = alwaysEdit(p.role);
              const checked = byRole || set.has(p.user_id);
              return (
                <label
                  key={p.user_id}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-2 py-2 text-sm",
                    byRole ? "opacity-60" : "cursor-pointer hover:bg-muted",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={byRole}
                    onChange={() => toggle(p.user_id)}
                    className="h-4 w-4 accent-emerald-600"
                  />
                  <span className="min-w-0 flex-1 truncate font-bold text-foreground">{p.full_name || p.email || p.user_id}</span>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-black uppercase text-muted-foreground">{p.role}</span>
                  {byRole ? <span className="shrink-0 text-[10px] font-bold text-emerald-700">edita por padrão</span> : null}
                </label>
              );
            })}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button onClick={onClose}>Concluir</Button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------- Modal de importação inteligente --------------------- */
function ImportSmartModal({
  year,
  onJSON,
  onApply,
  onClose,
}: {
  year: number;
  onJSON: (file: File) => void;
  onApply: (events: ImportedEvent[], mode: "add" | "replace") => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [events, setEvents] = useState<ImportedEvent[] | null>(null);
  const [fileName, setFileName] = useState("");

  async function handleFile(file?: File | null) {
    if (!file) return;
    setErr("");
    setEvents(null);
    setFileName(file.name);
    if (file.name.toLowerCase().endsWith(".json")) {
      onJSON(file); // restaura backup completo do construtor
      onClose();
      return;
    }
    setBusy(true);
    try {
      const ev = await parseAnyCalendarFile(file, year);
      if (!ev.length) {
        setErr('Nenhum evento reconhecido. Confira se o documento tem datas (ex.: 12/06/2026 ou “12 de junho”).');
      }
      setEvents(ev);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const isDoc = /\.(pdf|docx)$/i.test(fileName);

  return (
    <Modal open onClose={onClose} title="Importar calendário pronto" size="xl">
      <div className="space-y-4">
        {/* Caminho recomendado: planilha-modelo (leitura 100% confiável). */}
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-sm font-bold text-emerald-900">Forma recomendada: planilha Excel</p>
          <p className="mt-0.5 text-xs font-medium text-emerald-800">
            Baixe o modelo, preencha (Data, Título, Categoria) e suba aqui. É a leitura mais confiável.
          </p>
          <button
            type="button"
            onClick={() => downloadCalendarTemplate()}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-black text-white hover:bg-emerald-700"
          >
            Baixar planilha-modelo
          </button>
        </div>

        <Dropzone
          accept=".xlsx,.xls,.csv,.ics,.pdf,.docx,.json"
          multiple={false}
          title="Arraste o calendário aqui, ou clique para procurar"
          hint="Excel/CSV (recomendado) · PDF/Word e ICS (leitura aproximada) · backup .json — até 15 MB"
          onFiles={(l) => handleFile(l?.[0])}
        />

        <p className="text-xs text-muted-foreground">
          PDF e Word são lidos por aproximação — calendários com layout livre (dia sem mês, colunas) podem sair
          incompletos. Sempre revise antes de salvar; para garantir, use o Excel.
        </p>

        {busy ? <p className="text-sm font-bold text-muted-foreground">Lendo “{fileName}”…</p> : null}
        {err ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{err}</p> : null}

        {events && events.length > 0 ? (
          <div>
            {isDoc ? (
              <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                Leitura aproximada de PDF/Word. Confira datas e títulos no editor — alguns eventos podem faltar.
              </p>
            ) : null}
            <p className="mb-2 text-sm font-bold text-foreground">{events.length} evento(s) encontrado(s):</p>
            <div className="max-h-60 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
              {events.slice(0, 80).map((e, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-24 shrink-0 font-bold text-muted-foreground">
                    {e.start.slice(8, 10)}/{e.start.slice(5, 7)}
                    {e.end ? `–${e.end.slice(8, 10)}/${e.end.slice(5, 7)}` : ""}
                  </span>
                  <span className="truncate font-bold text-foreground">{e.title}</span>
                  <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-black text-muted-foreground">{e.categoryLabel}</span>
                </div>
              ))}
              {events.length > 80 ? <p className="px-1 pt-1 text-[11px] font-bold text-muted-foreground">+{events.length - 80} evento(s)…</p> : null}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
              <Button variant="ghost" onClick={onClose}>Cancelar</Button>
              <Button variant="soft" onClick={() => onApply(events, "replace")}>Substituir eventos</Button>
              <Button onClick={() => onApply(events, "add")}>Adicionar {events.length} ao calendário</Button>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/* --------------------------- Subcomponentes ------------------------------ */
function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="cb-section">
      <div className="cb-section-head">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="cb-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

const HOLIDAY_COLOR = "#d97706";
function MonthCard({
  year, month, events, holidays, catById, active, letivos,
}: {
  year: number; month: number; events: CalEvent[]; holidays: CalendarHoliday[];
  catById: Record<string, Category>; active: Set<string>; letivos?: number;
}) {
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // 0 = segunda
  const nDays = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  // feriados nacionais deste mês: dia -> título
  const monthHolidays = holidays
    .filter((h) => +h.date.slice(0, 4) === year && +h.date.slice(5, 7) - 1 === month)
    .map((h) => ({ day: +h.date.slice(8, 10), title: h.title }))
    .sort((a, b) => a.day - b.day);
  const holidayDays = new Set(monthHolidays.map((h) => h.day));

  // dia -> categorias presentes
  const dayCats: Record<number, string[]> = {};
  const monthEvents = events
    .map((ev) => ({ ev, days: daysInMonthFor(ev, year, month) }))
    .filter((x) => x.days.length > 0);
  monthEvents.forEach(({ ev, days }) => {
    days.forEach((day) => {
      (dayCats[day] = dayCats[day] || []).push(ev.categoryId);
    });
  });

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(<div key={`e${i}`} className="cb-cell empty" />);
  for (let day = 1; day <= nDays; day++) {
    const cats = Array.from(new Set(dayCats[day] || []));
    const visible = cats.filter((c) => active.has(c));
    const has = cats.length > 0;
    const isHoliday = holidayDays.has(day);
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
    const primary = visible[0] ? catById[visible[0]]?.color : isHoliday ? HOLIDAY_COLOR : undefined;
    cells.push(
      <div
        key={day}
        className={`cb-cell ${has || isHoliday ? "has" : ""} ${isToday ? "today" : ""} ${has && visible.length === 0 && !isHoliday ? "dim" : ""}`}
        style={primary ? { background: rgba(primary, 0.16), fontWeight: 700 } : undefined}
      >
        {day}
        {(visible.length > 0 || isHoliday) && (
          <span className="cb-dots">
            {visible.slice(0, 3).map((c, i) => (
              <i key={i} style={{ background: catById[c]?.color }} />
            ))}
            {isHoliday ? <i style={{ background: HOLIDAY_COLOR }} /> : null}
          </span>
        )}
      </div>
    );
  }

  const listed = monthEvents
    .map(({ ev, days }) => ({ ev, days, min: days[0] }))
    .sort((a, b) => a.min - b.min);

  return (
    <section className="cb-month">
      <div className="cb-month-head">
        <h2>{MONTHS_PT[month]}</h2>
        {letivos ? <span className="cb-badge">{letivos} dias letivos</span> : null}
      </div>
      <div className="cb-cal">
        <div className="cb-dow">
          {DOW.map(([s, full], i) => <span key={i} title={full}>{s}</span>)}
        </div>
        <div className="cb-grid">{cells}</div>
      </div>
      <div className="cb-events">
        {listed.length === 0 && monthHolidays.length === 0 && <p className="cb-empty">Sem eventos neste mês.</p>}
        {monthHolidays.map((h) => (
          <div className="cb-ev" key={`h-${h.day}`}>
            <span className="cb-date" style={{ background: HOLIDAY_COLOR, color: "#fff" }}>{pad2(h.day)}</span>
            <span className="cb-txt">
              {h.title}
              <small style={{ color: HOLIDAY_COLOR }}>Feriado nacional</small>
            </span>
          </div>
        ))}
        {listed.map(({ ev, days }) => {
          const cat = catById[ev.categoryId];
          const on = active.has(ev.categoryId);
          if (!cat) return null;
          return (
            <div className={`cb-ev ${on ? "" : "dim"}`} key={ev.id}>
              <span className="cb-date" style={{ background: cat.color, color: readableText(cat.color) }}>
                {chipLabel(days)}
              </span>
              <span className="cb-txt">
                {ev.title}
                <small style={{ color: cat.color }}>{cat.label}</small>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------- Estilo ---------------------------------- */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');

.cb-app{--paper:#FBFAF6;--surface:#fff;--ink:#1F2A24;--ink-soft:#5C6B62;--line:#E7E4DA;--line-soft:#F0EEE6;--green:#1B6B4C;--green-2:#2E9E6B;
  font-family:"Plus Jakarta Sans",system-ui,-apple-system,sans-serif;color:var(--ink);background:var(--paper);min-height:100%;line-height:1.5;-webkit-font-smoothing:antialiased;border-radius:18px;overflow:hidden;border:1px solid var(--line)}
.cb-app *{box-sizing:border-box}

.cb-top{display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:space-between;padding:18px clamp(16px,3vw,32px);border-bottom:1px solid var(--line);background:var(--surface)}
.cb-brand{display:flex;align-items:center;gap:13px}
.cb-mark{width:44px;height:44px;border-radius:50%;flex:none;display:grid;place-items:center;color:#fff;font-weight:700;font-family:"Fraunces",serif;font-size:19px;background:radial-gradient(circle at 30% 30%,var(--green-2),var(--green))}
.cb-eyebrow{font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-soft);font-weight:600}
.cb-h1{margin:1px 0 0;font-family:"Fraunces",serif;font-weight:600;font-size:clamp(22px,3.2vw,30px);letter-spacing:-.01em;line-height:1.05}
.cb-stamp{margin-top:4px;font-size:11.5px;font-weight:600;color:var(--ink-soft)}
.cb-top-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.cb-btn,.cb-select{font:inherit;font-weight:600;font-size:13.5px;cursor:pointer;border:1px solid var(--line);background:var(--surface);color:var(--ink);padding:8px 14px;border-radius:999px;transition:.15s}
.cb-btn:hover,.cb-select:hover{border-color:var(--green-2);color:var(--green)}
.cb-btn:disabled{opacity:.5;cursor:default;border-color:var(--line);color:var(--ink-soft)}
.cb-btn-primary{background:var(--green);border-color:var(--green);color:#fff}
.cb-btn-primary:hover{background:var(--green-2);border-color:var(--green-2);color:#fff}
.cb-btn-primary:disabled{background:var(--surface);color:var(--ink-soft)}
.cb-btn-danger{color:#E0544A;border-color:${rgba("#E0544A", 0.4)}}
.cb-btn-danger:hover{background:${rgba("#E0544A", 0.1)};border-color:#E0544A;color:#E0544A}
.cb-back{font:inherit;font-size:18px;line-height:1;cursor:pointer;border:1px solid var(--line);background:var(--surface);color:var(--ink);width:38px;height:38px;border-radius:50%;flex:none;display:grid;place-items:center;transition:.15s}
.cb-back:hover{border-color:var(--green-2);color:var(--green)}

.cb-layout{display:grid;grid-template-columns:1fr;gap:0}
.cb-layout.with-editor{grid-template-columns:minmax(320px,380px) 1fr}
@media (max-width:900px){.cb-layout.with-editor{grid-template-columns:1fr}}

/* Editor */
.cb-editor{background:var(--surface);border-right:1px solid var(--line);padding:20px clamp(14px,2vw,22px);max-height:none}
@media (min-width:901px){.cb-editor{position:sticky;top:0;align-self:start;max-height:100vh;overflow:auto}}
.cb-section{padding:14px 0;border-bottom:1px solid var(--line-soft)}
.cb-section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.cb-section-head h3{margin:0;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--ink)}
.cb-help{margin:0 0 10px;font-size:12px;color:var(--ink-soft)}
.cb-field{display:block;margin-bottom:10px}
.cb-field>span{display:block;font-size:12px;font-weight:600;color:var(--ink-soft);margin-bottom:4px}
.cb-input{width:100%;font:inherit;font-size:13.5px;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:9px;padding:8px 10px;outline:none;transition:.15s}
.cb-input:focus{border-color:var(--green-2);box-shadow:0 0 0 3px ${rgba("#2E9E6B", 0.12)}}
.cb-area{resize:vertical;line-height:1.4}
.cb-grow{flex:1;min-width:0}
.cb-mini{width:78px;padding:8px 6px}
.cb-row{display:flex;gap:8px;align-items:center;margin-bottom:8px}
.cb-prow{display:flex;gap:6px;align-items:center;margin-bottom:8px}
.cb-to{color:var(--ink-soft);font-size:13px}
.cb-color{width:34px;height:34px;flex:none;border:1px solid var(--line);border-radius:9px;background:#fff;padding:2px;cursor:pointer}
.cb-add{font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;border:1px dashed var(--green-2);color:var(--green);background:${rgba("#2E9E6B", 0.06)};padding:5px 11px;border-radius:999px}
.cb-add:hover{background:${rgba("#2E9E6B", 0.12)}}
.cb-del{font:inherit;font-size:13px;font-weight:700;cursor:pointer;border:none;background:none;color:#E0544A;padding:4px 6px;border-radius:8px;white-space:nowrap}
.cb-del:hover{background:${rgba("#E0544A", 0.1)}}
.cb-event{border:1px solid var(--line);border-left-width:4px;border-radius:10px;padding:10px;margin-bottom:10px;display:flex;flex-direction:column;gap:8px;background:#fff}
.cb-event-grid{display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:6px;align-items:center}
@media (max-width:520px){.cb-event-grid{grid-template-columns:1fr 1fr}}

/* Preview */
.cb-preview{padding:clamp(18px,3vw,32px) clamp(16px,3vw,36px) 60px;min-width:0}
.cb-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:22px}
.cb-hint{font-size:13px;color:var(--ink-soft);margin-right:2px}
.cb-chip{font:inherit;font-size:13px;font-weight:600;cursor:pointer;padding:6px 13px 6px 11px;border-radius:999px;border:1px solid var(--line);display:inline-flex;align-items:center;gap:7px;transition:.15s}
.cb-chip:hover{transform:translateY(-1px)}
.cb-cdot{width:11px;height:11px;border-radius:50%;flex:none}

.cb-months{display:grid;gap:clamp(16px,2.2vw,24px);grid-template-columns:repeat(auto-fit,minmax(290px,1fr))}
.cb-month{background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:0 1px 2px rgba(31,42,36,.04),0 8px 24px rgba(31,42,36,.06);overflow:hidden;display:flex;flex-direction:column}
.cb-month-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:16px 18px 12px;border-bottom:1px solid var(--line-soft)}
.cb-month-head h2{margin:0;font-family:"Fraunces",serif;font-weight:600;font-size:22px;letter-spacing:-.01em}
.cb-badge{font-size:11.5px;font-weight:600;color:var(--green);background:${rgba("#2E9E6B", 0.12)};border:1px solid ${rgba("#2E9E6B", 0.22)};padding:3px 10px;border-radius:999px;white-space:nowrap}
.cb-cal{padding:12px 12px 2px}
.cb-dow{display:grid;grid-template-columns:repeat(7,1fr);margin-bottom:4px}
.cb-dow span{text-align:center;font-size:11px;font-weight:700;color:var(--ink-soft);padding:3px 0}
.cb-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}
.cb-cell{aspect-ratio:1/1;border-radius:9px;display:flex;align-items:center;justify-content:center;position:relative;font-size:13px;font-weight:500;color:var(--ink)}
.cb-cell.empty{visibility:hidden}
.cb-cell.dim{opacity:.25}
.cb-cell.today{outline:2px solid var(--green);outline-offset:1px}
.cb-cell.today::after{content:"hoje";position:absolute;top:-7px;font-size:8px;font-weight:700;color:var(--green);background:var(--surface);padding:0 3px}
.cb-dots{display:flex;gap:2px;position:absolute;bottom:5px}
.cb-dots i{width:5px;height:5px;border-radius:50%}
.cb-events{padding:6px 16px 18px;display:flex;flex-direction:column;gap:2px;flex:1}
.cb-empty{font-size:12.5px;color:var(--ink-soft);padding:6px 4px;margin:0}
.cb-ev{display:flex;gap:11px;padding:8px 6px;border-radius:10px;align-items:flex-start;transition:.12s}
.cb-ev:hover{background:var(--line-soft)}
.cb-ev.dim{opacity:.2;filter:grayscale(.3)}
.cb-date{flex:none;min-width:42px;text-align:center;font-weight:700;font-size:12.5px;border-radius:8px;padding:5px 6px;line-height:1.15}
.cb-txt{font-size:13.5px;color:var(--ink);padding-top:2px}
.cb-txt small{display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-top:2px;opacity:.9}
.cb-foot{margin-top:28px;padding-top:16px;border-top:1px solid var(--line);display:flex;flex-wrap:wrap;gap:14px;justify-content:space-between;align-items:center;font-size:12.5px;color:var(--ink-soft)}
.cb-note{max-width:680px;white-space:pre-wrap}
.cb-foot strong{color:var(--ink)}

@media print{
  @page{size:A4 portrait;margin:6mm}
  .cb-top-actions,.cb-editor,.cb-filters,.cb-back,.cb-stamp{display:none!important}
  .cb-app{background:#fff;border:none;border-radius:0;font-size:10px}
  .cb-app *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .cb-top{padding:0 0 6px;border:none}
  .cb-mark{width:30px;height:30px;font-size:14px}
  .cb-h1{font-size:18px}
  .cb-eyebrow{font-size:9px}
  .cb-layout.with-editor{grid-template-columns:1fr}
  .cb-preview{padding:0}
  /* 3 meses por linha, bem compacto, p/ caber tudo em poucas folhas */
  .cb-months{grid-template-columns:repeat(3,1fr);gap:6px}
  .cb-month{box-shadow:none;border-color:#ddd;border-radius:8px;break-inside:avoid}
  .cb-month-head{padding:6px 8px 4px}
  .cb-month-head h2{font-size:14px}
  .cb-badge{font-size:9px;padding:1px 6px}
  .cb-cal{padding:4px 6px 0}
  .cb-dow span{font-size:8px;padding:1px 0}
  .cb-grid{gap:1px}
  .cb-cell{font-size:9px;border-radius:3px;font-weight:600}
  .cb-cell.today{outline:none}
  .cb-cell.today::after{display:none}
  .cb-dots{bottom:1px;gap:1px}
  .cb-dots i{width:3px;height:3px}
  .cb-events{padding:3px 8px 8px;gap:0}
  .cb-empty{font-size:8px;padding:2px}
  .cb-ev{padding:2px;gap:5px}
  .cb-ev.dim{display:none}             /* não imprime eventos de categorias ocultas */
  .cb-date{min-width:26px;font-size:8px;padding:2px 3px;border-radius:4px;line-height:1.1}
  .cb-txt{font-size:8.5px;padding-top:0;line-height:1.2}
  .cb-txt small{font-size:7px;margin-top:0}
  .cb-foot{margin-top:8px;padding-top:6px;font-size:8px}
}
@media (prefers-reduced-motion:reduce){.cb-app *{transition:none!important}}
`;
