import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { ArrowLeft, CalendarDays, ChevronDown, Download, List as ListIcon, MoreHorizontal, Pencil, Printer, Trash2, Upload, Users } from "lucide-react";
import { Button, DropdownMenu, Modal, type MenuAction } from "../components/ui";
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
const DOW = ["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"]; // semana inicia na segunda
const WEEKDAY = ["dom","seg","ter","qua","qui","sex","sáb"]; // índice de Date.getDay()
const uid = () => Math.random().toString(36).slice(2, 9);
const pad2 = (n: number) => String(n).padStart(2, "0");
/** Paleta categórica de alto contraste: matizes bem espaçados no círculo cromático
 *  para que cores vizinhas (na lista e no calendário) nunca se confundam ao bater o olho. */
const CAT_PALETTE = ["#000000", "#262626", "#404040", "#595959", "#737373", "#8C8C8C", "#171717", "#333333", "#4D4D4D", "#666666", "#808080", "#0A0A0A"];

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
const isoOf = (y: number, m: number, d: number) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
const todayISO = () => {
  const t = new Date();
  return isoOf(t.getFullYear(), t.getMonth(), t.getDate());
};
function parseISO(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
/** "hoje", "amanhã", "em 12 dias · 18/10" — quanto falta para um compromisso. */
function whenLabel(today: string, start: string, end: string) {
  const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  if (start <= today && today <= end) return start === end ? "hoje" : `em andamento · até ${br(end)}`;
  const diff = Math.round((parseISO(start).getTime() - parseISO(today).getTime()) / 86400000);
  return diff === 1 ? `amanhã · ${br(start)}` : `em ${diff} dias · ${br(start)}`;
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
    { id: "feriado", label: "Feriado", color: "#000000" },
    { id: "avaliacao", label: "Avaliação", color: "#404040" },
    { id: "pedagogico", label: "Pedagógico", color: "#262626" },
    { id: "evento", label: "Evento & Cultura", color: "#595959" },
    { id: "recuperacao", label: "Recuperação Paralela", color: "#737373" },
    { id: "comemorativa", label: "Data comemorativa", color: "#8C8C8C" },
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
          <p className="text-xs font-black uppercase tracking-wide text-neutral-500">Centro de calendários</p>
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
        <p className="mb-4 rounded-xl bg-neutral-100 p-3 text-sm font-bold text-neutral-800">
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
type Layout = "calendario" | "lista";

/** Abre no período em que a escola está hoje (ex.: 3º trimestre); fora do ano letivo, mostra o ano todo. */
function initialView(d: CalendarData): string {
  const t = new Date();
  if (t.getFullYear() !== d.year) return "year";
  return d.periods.find((p) => p.startMonth <= t.getMonth() && t.getMonth() <= p.endMonth)?.id ?? "year";
}

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
  const [viewId, setViewId] = useState<string>(() => initialView(initialData));
  const [layout, setLayout] = useState<Layout>("calendario");
  const [active, setActive] = useState<Set<string>>(new Set(initialData.categories.map((c) => c.id)));
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState<number>(initialVersion);
  const [stamp, setStamp] = useState<string | null>(initialStamp);
  const [importOpen, setImportOpen] = useState(false);
  const [editorsOpen, setEditorsOpen] = useState(false);
  const [showHolidays, setShowHolidays] = useState(true);
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
  const goBack = () => {
    if (dirty && !confirm("Há alterações que ainda não foram salvas.\n\nSair mesmo assim?")) return;
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
  const allCatsOn = data.categories.every((c) => active.has(c.id));

  const addCategory = () =>
    set({ categories: [...data.categories, { id: uid(), label: "Nova categoria", color: CAT_PALETTE[data.categories.length % CAT_PALETTE.length] }] });
  const updateCategory = (id: string, patch: Partial<Category>) =>
    set({ categories: data.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const removeCategory = (id: string) => {
    const n = catCount[id] || 0;
    if (n > 0 && !confirm(`Remover esta categoria também apaga os ${n} evento(s) dela.\n\nDeseja continuar?`)) return;
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
  const suggestLetivos = () => {
    if (
      Object.values(data.letivosByMonth).some(Boolean) &&
      !confirm("Já existem dias letivos preenchidos.\n\nSubstituir pelos valores sugeridos?")
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
      cat = { id: uid(), label: "Feriado", color: "#171717" };
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

  const menuItems: MenuAction[] = [
    { label: "Participantes", hint: "Quem mais pode editar", icon: <Users size={16} />, onClick: () => setEditorsOpen(true), hidden: !canManageEditors },
    { label: "Importar calendário", hint: "Excel, CSV, PDF, Word ou ICS", icon: <Upload size={16} />, onClick: () => setImportOpen(true), hidden: !canManage },
    { label: "Imprimir / PDF", icon: <Printer size={16} />, onClick: () => window.print() },
    { label: "Baixar backup (.json)", icon: <Download size={16} />, onClick: exportJSON },
    { label: "Excluir calendário", icon: <Trash2 size={16} />, onClick: onDelete, danger: true, hidden: !canDelete },
  ];

  const q = eventQuery.trim().toLowerCase();
  const sortedEvents = [...data.events].sort((a, b) => a.start.localeCompare(b.start));
  const shownEvents = q ? sortedEvents.filter((e) => e.title.toLowerCase().includes(q)) : sortedEvents;
  const tabs = [{ id: "year", label: `Ano ${data.year}` }, ...data.periods.map((p) => ({ id: p.id, label: p.label }))];

  /* ============================== Render ============================== */
  return (
    <div className="cb-app">
      <style>{CSS}</style>

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

            <Section title="Eventos" count={data.events.length} defaultOpen>
              <div className="cb-section-tools">
                <button className="cb-add" onClick={() => addEvent()}>+ Evento</button>
                <p className="cb-help cb-grow">Dica: clique em um dia do calendário para criar o evento já com a data.</p>
              </div>
              {data.events.length > 6 ? (
                <input
                  className="cb-input cb-search"
                  type="search"
                  placeholder="Buscar evento…"
                  value={eventQuery}
                  onChange={(e) => setEventQuery(e.target.value)}
                  aria-label="Buscar evento"
                />
              ) : null}
              {data.events.length === 0 ? <p className="cb-help">Nenhum evento ainda.</p> : null}
              {q && shownEvents.length === 0 ? <p className="cb-help">Nenhum evento encontrado para “{eventQuery}”.</p> : null}
              <div className="cb-event-list">
              {shownEvents.map((ev) => (
                <div className="cb-event" key={ev.id} style={{ borderLeftColor: catById[ev.categoryId]?.color ?? "#ccc" }}>
                  <input
                    className="cb-input"
                    value={ev.title}
                    placeholder="Título do evento"
                    autoFocus={ev.id === newEventId}
                    onFocus={(e) => ev.id === newEventId && e.currentTarget.select()}
                    onChange={(e) => updateEvent(ev.id, { title: e.target.value })}
                  />
                  <div className="cb-event-grid">
                    <select className="cb-input cb-span2" value={ev.categoryId} onChange={(e) => updateEvent(ev.id, { categoryId: e.target.value })} aria-label="Categoria">
                      {data.categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                    <DateInput value={ev.start} onChange={(v) => v && updateEvent(ev.id, { start: v })} aria-label="Data de início" />
                    <DateInput value={ev.end ?? ""} min={ev.start} placeholder="fim (opcional)" onChange={(v) => updateEvent(ev.id, { end: v || undefined })} aria-label="Data de término" />
                  </div>
                  <button className="cb-del" onClick={() => removeEvent(ev.id)}>Remover evento</button>
                </div>
              ))}
              </div>
            </Section>

            <Section title="Categorias" count={data.categories.length} defaultOpen>
              <div className="cb-section-tools">
                <button className="cb-add" onClick={addCategory}>+ Categoria</button>
                <p className="cb-help cb-grow">Escolha uma cor para cada tipo de evento.</p>
              </div>
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
                    aria-label="Nome da categoria"
                  />
                  <span className="cb-count" title="Eventos nesta categoria">{catCount[c.id] || 0}</span>
                  <button className="cb-del" onClick={() => removeCategory(c.id)} aria-label={`Remover ${c.label}`}>×</button>
                </div>
              ))}
            </Section>

            <Section title="Períodos / Trimestres" count={data.periods.length}>
              <div className="cb-section-tools">
                <button className="cb-add" onClick={addPeriod}>+ Período</button>
                <p className="cb-help cb-grow">Cada período vira uma aba acima do calendário.</p>
              </div>
              {data.periods.map((p) => (
                <div className="cb-prow" key={p.id}>
                  <input
                    className="cb-input cb-grow"
                    value={p.label}
                    onChange={(e) => updatePeriod(p.id, { label: e.target.value })}
                    aria-label="Nome do período"
                  />
                  <select className="cb-input cb-mini" value={p.startMonth} onChange={(e) => updatePeriod(p.id, { startMonth: Number(e.target.value) })} aria-label="Mês inicial">
                    {MONTHS_PT.map((m, i) => <option key={i} value={i}>{m.slice(0, 3)}</option>)}
                  </select>
                  <span className="cb-to">→</span>
                  <select className="cb-input cb-mini" value={p.endMonth} onChange={(e) => updatePeriod(p.id, { endMonth: Number(e.target.value) })} aria-label="Mês final">
                    {MONTHS_PT.map((m, i) => <option key={i} value={i}>{m.slice(0, 3)}</option>)}
                  </select>
                  <button className="cb-del" onClick={() => removePeriod(p.id)} aria-label={`Remover ${p.label}`}>×</button>
                </div>
              ))}
            </Section>

            <Section title="Dias letivos" count={yearLetivos || undefined}>
              <p className="cb-help">Quantos dias de aula há em cada mês. O mínimo legal é de 200 dias letivos no ano.</p>
              <div className="cb-letivos">
                {MONTHS_PT.map((name, i) => (
                  <label key={i} className="cb-lt">
                    <span>{name.slice(0, 3)}</span>
                    <input
                      className="cb-input"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={31}
                      value={data.letivosByMonth[i] ?? ""}
                      onChange={(e) => setLetivos(i, e.target.value)}
                    />
                  </label>
                ))}
              </div>
              <p className={`cb-lt-total ${yearLetivos >= 200 ? "ok" : ""}`}>
                Total no ano: <strong>{yearLetivos}</strong> de 200 dias
              </p>
              <button className="cb-add" onClick={suggestLetivos}>Sugerir a partir do calendário</button>
              <p className="cb-help cb-mt">Conta de segunda a sexta, descontando feriados e eventos de recesso/férias. Ajuste à mão o que for diferente.</p>
            </Section>

            <Section title="Feriados nacionais">
              <p className="cb-help">
                Os feriados nacionais de {data.year} já aparecem no calendário (fonte BrasilAPI). Para deixá-los fixos e editáveis,
                adicione como eventos na categoria “Feriado”.
              </p>
              <button className="cb-add" onClick={addNationalHolidays}>+ Adicionar feriados de {data.year}</button>
            </Section>

            <Section title="Identificação e rodapé">
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
              <Field label="Observações (aparecem no rodapé)">
                <textarea className="cb-input cb-area" rows={3} value={data.notes} onChange={(e) => set({ notes: e.target.value })} />
              </Field>
            </Section>
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

          {/* Filtros por categoria */}
          <div className="cb-filters">
            <span className="cb-hint">Mostrar:</span>
            {data.categories.map((c) => {
              const on = active.has(c.id);
              return (
                <button
                  key={c.id}
                  className="cb-chip"
                  aria-pressed={on}
                  onClick={() => toggleCat(c.id)}
                  style={{
                    borderColor: on ? rgba(c.color, 0.55) : undefined,
                    background: on ? rgba(c.color, 0.1) : undefined,
                  }}
                >
                  <span className="cb-cdot" style={{ background: c.color }} />
                  {c.label}
                  <span className="cb-chip-n">{catCount[c.id] || 0}</span>
                </button>
              );
            })}
            {nationalHolidays.length > 0 ? (
              <button
                className="cb-chip"
                aria-pressed={showHolidays}
                onClick={() => setShowHolidays((v) => !v)}
                style={{
                  borderColor: showHolidays ? rgba(HOLIDAY_COLOR, 0.55) : undefined,
                  background: showHolidays ? rgba(HOLIDAY_COLOR, 0.1) : undefined,
                }}
                title="Feriados nacionais (BrasilAPI)"
              >
                <span className="cb-cdot" style={{ background: HOLIDAY_COLOR }} />
                Feriados nacionais
              </button>
            ) : null}
            {data.categories.length > 1 ? (
              <button
                className="cb-link"
                onClick={() => setActive(allCatsOn ? new Set() : new Set(data.categories.map((c) => c.id)))}
              >
                {allCatsOn ? "Desmarcar todas" : "Marcar todas"}
              </button>
            ) : null}
          </div>

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
                    className="h-4 w-4 accent-neutral-900"
                  />
                  <span className="min-w-0 flex-1 truncate font-bold text-foreground">{p.full_name || p.email || p.user_id}</span>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-black uppercase text-muted-foreground">{p.role}</span>
                  {byRole ? <span className="shrink-0 text-[10px] font-bold text-muted-foreground">edita por padrão</span> : null}
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
        <div className="rounded-xl border border-border bg-muted p-3">
          <p className="text-sm font-bold text-foreground">Forma recomendada: planilha Excel</p>
          <p className="mt-0.5 text-xs font-medium text-muted-foreground">
            Baixe o modelo, preencha (Data, Título, Categoria) e suba aqui. É a leitura mais confiável.
          </p>
          <button
            type="button"
            onClick={() => downloadCalendarTemplate()}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-black text-white hover:bg-black"
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
              <p className="mb-2 rounded-lg bg-neutral-100 px-3 py-2 text-xs font-bold text-neutral-800">
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
/** Seção recolhível do editor — a coordenação abre só o que está usando. */
function Section({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="cb-section" open={defaultOpen}>
      <summary className="cb-section-head">
        <h3>{title}</h3>
        {count !== undefined ? <span className="cb-count">{count}</span> : null}
        <ChevronDown size={16} className="cb-chev" aria-hidden />
      </summary>
      <div className="cb-section-body">{children}</div>
    </details>
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

const HOLIDAY_COLOR = "#525252";

/** Um compromisso (evento ou feriado) dentro de um mês, pronto para listar. */
type Entry = {
  key: string;
  days: number[];
  title: string;
  label: string;
  color: string;
  categoryId?: string;
  holiday?: boolean;
  endISO: string;
  weekday: string | null; // só para compromissos de 1 dia
};

/** Compromissos do mês em ordem de data (feriados e eventos juntos). */
function monthEntries(
  year: number,
  month: number,
  events: CalEvent[],
  holidays: CalendarHoliday[],
  catById: Record<string, Category>
): Entry[] {
  const wd = (day: number) => WEEKDAY[new Date(year, month, day).getDay()];
  const out: Entry[] = [];
  holidays.forEach((h) => {
    if (+h.date.slice(0, 4) !== year || +h.date.slice(5, 7) - 1 !== month) return;
    const day = +h.date.slice(8, 10);
    out.push({ key: `h-${h.id}`, days: [day], title: h.title, label: "Feriado nacional", color: HOLIDAY_COLOR, holiday: true, endISO: h.date, weekday: wd(day) });
  });
  events.forEach((ev) => {
    const days = daysInMonthFor(ev, year, month);
    const cat = catById[ev.categoryId];
    if (!days.length || !cat) return;
    out.push({
      key: ev.id,
      days,
      title: ev.title,
      label: cat.label,
      color: cat.color,
      categoryId: ev.categoryId,
      endISO: ev.end ?? ev.start,
      weekday: days.length === 1 ? wd(days[0]) : null,
    });
  });
  return out.sort((a, b) => a.days[0] - b.days[0] || Number(!!b.holiday) - Number(!!a.holiday));
}

function EntryRow({ e, on, past }: { e: Entry; on: boolean; past: boolean }) {
  return (
    <div className={`cb-ev ${on ? "" : "dim"} ${past ? "past" : ""}`}>
      <span className="cb-date" style={{ background: e.color, color: readableText(e.color) }}>
        {chipLabel(e.days)}
        {e.weekday ? <small>{e.weekday}</small> : null}
      </span>
      <span className="cb-txt">
        {e.title}
        <small>
          <i style={{ background: e.color }} />
          {e.label}
        </small>
      </span>
    </div>
  );
}

function MonthCard({
  year, month, events, holidays, catById, active, letivos, today, onDayClick,
}: {
  year: number; month: number; events: CalEvent[]; holidays: CalendarHoliday[];
  catById: Record<string, Category>; active: Set<string>; letivos?: number; today: string;
  onDayClick?: (iso: string) => void;
}) {
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // 0 = segunda
  const nDays = new Date(year, month + 1, 0).getDate();
  const isCurrentMonth = today.startsWith(`${year}-${pad2(month + 1)}`);

  const entries = monthEntries(year, month, events, holidays, catById);
  const byDay: Record<number, Entry[]> = {};
  entries.forEach((e) => e.days.forEach((day) => (byDay[day] = byDay[day] || []).push(e)));

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(<div key={`e${i}`} className="cb-cell empty" />);
  for (let day = 1; day <= nDays; day++) {
    const iso = isoOf(year, month, day);
    const list = byDay[day] || [];
    const visible = list.filter((e) => e.holiday || (e.categoryId && active.has(e.categoryId)));
    const isHoliday = list.some((e) => e.holiday);
    const isToday = iso === today;
    const weekend = (firstDow + day - 1) % 7 >= 5;
    const primary = (visible.find((e) => !e.holiday) ?? visible[0])?.color;
    const className = [
      "cb-cell",
      visible.length ? "has" : "",
      isHoliday ? "holiday" : "",
      weekend ? "weekend" : "",
      isToday ? "today" : "",
      list.length > 0 && visible.length === 0 ? "dim" : "",
      onDayClick ? "clickable" : "",
    ].join(" ");
    const style = primary ? { background: rgba(primary, 0.16) } : undefined;
    const tip = list.length ? list.map((e) => e.title).join(" · ") : undefined;
    const content = (
      <>
        {day}
        {visible.length > 0 && (
          <span className="cb-dots">
            {visible.slice(0, 3).map((e, i) => (
              <i key={i} style={{ background: e.color }} />
            ))}
          </span>
        )}
      </>
    );
    cells.push(
      onDayClick ? (
        <button key={day} type="button" className={className} style={style} title={tip ?? "Adicionar evento neste dia"} onClick={() => onDayClick(iso)}>
          {content}
        </button>
      ) : (
        <div key={day} className={className} style={style} title={tip}>
          {content}
        </div>
      )
    );
  }

  return (
    <section className={`cb-month ${isCurrentMonth ? "current" : ""}`}>
      <div className="cb-month-head">
        <h2>{MONTHS_PT[month]}</h2>
        <span className="cb-month-tags">
          {isCurrentMonth ? <span className="cb-badge now">Mês atual</span> : null}
          {letivos ? <span className="cb-badge">{letivos} dias letivos</span> : null}
        </span>
      </div>
      <div className="cb-cal">
        <div className="cb-dow">
          {DOW.map((s, i) => <span key={i} className={i >= 5 ? "weekend" : ""}>{s}</span>)}
        </div>
        <div className="cb-grid">{cells}</div>
      </div>
      <div className="cb-events">
        {entries.length === 0 && <p className="cb-empty">Sem eventos neste mês.</p>}
        {entries.map((e) => (
          <EntryRow key={e.key} e={e} on={!!e.holiday || (!!e.categoryId && active.has(e.categoryId))} past={e.endISO < today} />
        ))}
      </div>
    </section>
  );
}

/** Visão em lista: todos os compromissos do período em ordem de data, um mês após o outro. */
function AgendaView({
  year, months, events, holidays, catById, active, letivosByMonth, today,
}: {
  year: number; months: number[]; events: CalEvent[]; holidays: CalendarHoliday[];
  catById: Record<string, Category>; active: Set<string>; letivosByMonth: Record<number, number>; today: string;
}) {
  const groups = months
    .map((m) => ({
      m,
      entries: monthEntries(year, m, events, holidays, catById).filter((e) => e.holiday || (e.categoryId && active.has(e.categoryId))),
    }))
    .filter((g) => g.entries.length > 0);

  if (groups.length === 0) {
    return <p className="cb-agenda-empty">Nenhum compromisso neste período com os filtros atuais.</p>;
  }
  return (
    <div className="cb-agenda">
      {groups.map((g) => (
        <section className="cb-agenda-month" key={g.m}>
          <div className="cb-agenda-head">
            <h2>{MONTHS_PT[g.m]}</h2>
            <span className="cb-agenda-meta">
              {g.entries.length} compromisso(s)
              {letivosByMonth[g.m] ? ` · ${letivosByMonth[g.m]} dias letivos` : ""}
            </span>
          </div>
          <div className="cb-agenda-list">
            {g.entries.map((e) => (
              <EntryRow key={e.key} e={e} on past={e.endISO < today} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ------------------------------- Estilo ---------------------------------- */
const CSS = `
.cb-app{--paper:#FAFAFA;--surface:#fff;--ink:#171717;--ink-soft:#525252;--line:#E5E5E5;--line-soft:#F0F0F0;--accent:#171717;
  font-family:inherit;color:var(--ink);background:var(--paper);min-height:100%;line-height:1.5;border-radius:16px;overflow:clip;border:1px solid var(--line)}
.cb-app *{box-sizing:border-box}
.cb-app button{font-family:inherit}

/* Cabeçalho */
.cb-top{display:flex;flex-wrap:wrap;gap:12px 16px;align-items:center;justify-content:space-between;padding:16px clamp(14px,3vw,28px);border-bottom:1px solid var(--line);background:var(--surface)}
.cb-brand{display:flex;align-items:center;gap:12px;min-width:0;flex:1 1 280px}
.cb-titles{min-width:0}
.cb-eyebrow{font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-soft);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cb-h1{margin:1px 0 0;font-weight:800;font-size:clamp(20px,3vw,28px);letter-spacing:-.02em;line-height:1.15;overflow-wrap:anywhere}
.cb-stamp{margin-top:3px;font-size:12px;font-weight:500;color:var(--ink-soft)}
.cb-stamp:empty{display:none}
.cb-unsaved{color:var(--ink);font-weight:700}
.cb-top-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.cb-btn{font:inherit;font-weight:600;font-size:14px;cursor:pointer;border:1px solid var(--line);background:var(--surface);color:var(--ink);min-height:40px;padding:0 14px;border-radius:10px;transition:.15s;display:inline-flex;align-items:center;justify-content:center;gap:7px;white-space:nowrap}
.cb-btn:hover{background:#F5F5F5;border-color:#D4D4D4}
.cb-btn.is-on{background:#F0F0F0;border-color:#A3A3A3}
.cb-btn:disabled{opacity:.55;cursor:default}
.cb-btn-primary{background:var(--accent);border-color:var(--accent);color:#fff}
.cb-btn-primary:hover{background:#000;border-color:#000}
.cb-btn-primary:disabled{background:var(--surface);color:var(--ink-soft);border-color:var(--line)}
.cb-back{cursor:pointer;border:1px solid var(--line);background:var(--surface);color:var(--ink);width:40px;height:40px;border-radius:10px;flex:none;display:grid;place-items:center;transition:.15s}
.cb-back:hover{background:#F5F5F5}
.cb-app :focus-visible{outline:2px solid var(--ink);outline-offset:2px}

/* Estrutura: editor + visualização */
.cb-layout{display:grid;grid-template-columns:minmax(0,1fr);gap:0}
.cb-layout.with-editor{grid-template-columns:minmax(330px,380px) minmax(0,1fr)}

/* Editor */
.cb-editor{background:var(--surface);border-right:1px solid var(--line);padding:0 clamp(12px,2vw,20px) 24px}
.cb-editor-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 0;margin-bottom:4px;background:var(--surface);border-bottom:1px solid var(--line)}
.cb-editor-head strong{font-size:15px;font-weight:800}
.cb-editor-head-actions{display:flex;gap:6px}
.cb-editor-head .cb-btn{min-height:36px;padding:0 12px;font-size:13px}
@media (min-width:901px){.cb-editor{position:sticky;top:0;align-self:start;max-height:100vh;overflow:auto}}
/* Celular/tablet: o editor ocupa a tela toda (não empurra o calendário para baixo) */
@media (max-width:900px){
  .cb-layout.with-editor{grid-template-columns:minmax(0,1fr)}
  .cb-editor{position:fixed;inset:0;z-index:55;overflow-y:auto;border-right:none;padding-bottom:calc(32px + env(safe-area-inset-bottom));overscroll-behavior:contain}
}

.cb-section{border-bottom:1px solid var(--line-soft)}
.cb-section-head{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;padding:14px 0;min-height:48px}
.cb-section-head::-webkit-details-marker{display:none}
.cb-section-head h3{margin:0;flex:1;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--ink)}
.cb-chev{color:var(--ink-soft);transition:transform .15s}
.cb-section[open] .cb-chev{transform:rotate(180deg)}
.cb-section-body{padding:0 0 16px}
.cb-section-tools{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.cb-section-tools .cb-help{margin:0}
.cb-count{font-size:11px;font-weight:700;color:var(--ink-soft);background:#F0F0F0;border-radius:999px;padding:1px 8px;min-width:24px;text-align:center}
.cb-help{margin:0 0 10px;font-size:12.5px;color:var(--ink-soft)}
.cb-mt{margin-top:10px;margin-bottom:0}
.cb-field{display:block;margin-bottom:10px}
.cb-field>span{display:block;font-size:12px;font-weight:600;color:var(--ink-soft);margin-bottom:4px}
.cb-input{width:100%;font:inherit;font-size:14px;color:var(--ink);background:#fff;border:1px solid #D4D4D4;border-radius:10px;min-height:40px;padding:8px 10px;outline:none;transition:.15s}
.cb-input:focus{border-color:var(--ink);box-shadow:0 0 0 3px rgba(23,23,23,.12)}
.cb-area{resize:vertical;line-height:1.4}
.cb-search{margin-bottom:10px}
.cb-grow{flex:1;min-width:0}
.cb-mini{width:74px;padding:8px 6px;flex:none}
.cb-row{display:flex;gap:8px;align-items:center;margin-bottom:8px}
.cb-prow{display:flex;gap:6px;align-items:center;margin-bottom:8px}
.cb-to{color:var(--ink-soft);font-size:13px}
.cb-color{width:40px;height:40px;flex:none;border:1px solid #D4D4D4;border-radius:10px;background:#fff;padding:3px;cursor:pointer}
.cb-add{font:inherit;font-size:13px;font-weight:600;cursor:pointer;border:1px dashed #A3A3A3;color:var(--ink);background:#F5F5F5;min-height:36px;padding:0 14px;border-radius:999px;white-space:nowrap;flex:none}
.cb-add:hover{background:#EBEBEB;border-color:var(--ink)}
.cb-del{font:inherit;font-size:13px;font-weight:600;cursor:pointer;border:none;background:none;color:#B91C1C;min-height:34px;padding:4px 8px;border-radius:8px;white-space:nowrap}
.cb-del:hover{background:#FEF2F2}
.cb-event-list{max-height:min(62vh,560px);overflow-y:auto;margin:0 -4px;padding:0 4px}
.cb-event{border:1px solid var(--line);border-left-width:4px;border-radius:12px;padding:10px;margin-bottom:10px;display:flex;flex-direction:column;gap:8px;background:#fff}
.cb-event-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px}
.cb-span2{grid-column:1 / -1}
.cb-event .cb-del{align-self:flex-end;margin:-2px -2px 0 0}
.cb-letivos{display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:8px;margin-bottom:10px}
.cb-lt span{display:block;font-size:11.5px;font-weight:600;color:var(--ink-soft);margin-bottom:2px}
.cb-lt .cb-input{padding:6px 8px;text-align:center}
.cb-lt-total{margin:0 0 10px;font-size:13px;color:var(--ink-soft)}
.cb-lt-total strong{color:var(--ink)}
.cb-lt-total.ok strong::after{content:" ✓"}

/* Visualização */
.cb-preview{padding:clamp(14px,2.4vw,28px) clamp(12px,3vw,32px) 48px;min-width:0}
.cb-toolbar{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center;justify-content:space-between;margin-bottom:14px}
.cb-tabs{position:relative;display:flex;gap:4px;padding:4px;background:#EFEFEF;border-radius:12px;overflow-x:auto;max-width:100%;scrollbar-width:none}
.cb-tabs::-webkit-scrollbar{display:none}
.cb-tab{font:inherit;font-size:13.5px;font-weight:600;cursor:pointer;border:none;background:transparent;color:var(--ink-soft);min-height:36px;padding:0 14px;border-radius:9px;white-space:nowrap;transition:.15s;flex:none}
.cb-tab:hover{color:var(--ink)}
.cb-tab[aria-selected="true"]{background:#fff;color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.14)}
.cb-seg{display:inline-flex;padding:4px;gap:4px;background:#EFEFEF;border-radius:12px}
.cb-seg button{font:inherit;font-size:13.5px;font-weight:600;cursor:pointer;border:none;background:transparent;color:var(--ink-soft);min-height:36px;padding:0 12px;border-radius:9px;display:inline-flex;align-items:center;gap:6px;transition:.15s}
.cb-seg button[aria-pressed="true"]{background:#fff;color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.14)}

.cb-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px}
.cb-stat{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:10px 14px;min-width:0;display:flex;flex-direction:column;gap:1px}
.cb-stat span{font-size:11.5px;font-weight:600;color:var(--ink-soft);text-transform:uppercase;letter-spacing:.05em}
.cb-stat strong{font-size:20px;font-weight:800;line-height:1.25}
.cb-stat strong em,.cb-stat>em{font-size:12.5px;font-weight:500;font-style:normal;color:var(--ink-soft)}
.cb-stat-wide{grid-column:span 2}
.cb-stat-wide strong{font-size:16px}
.cb-trunc{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width:520px){.cb-stat-wide{grid-column:1 / -1}.cb-stats{grid-template-columns:1fr 1fr}}

.cb-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:18px}
.cb-hint{font-size:13px;font-weight:600;color:var(--ink-soft);margin-right:2px}
.cb-chip{font:inherit;font-size:13px;font-weight:600;cursor:pointer;min-height:34px;padding:0 12px 0 10px;border-radius:999px;border:1px solid var(--line);background:#fff;color:var(--ink);display:inline-flex;align-items:center;gap:7px;transition:.15s}
.cb-chip[aria-pressed="false"]{opacity:.5;color:var(--ink-soft)}
.cb-chip:hover{border-color:#A3A3A3}
.cb-chip-n{font-size:11px;font-weight:700;color:var(--ink-soft);background:#F0F0F0;border-radius:999px;padding:0 7px}
.cb-cdot{width:11px;height:11px;border-radius:50%;flex:none}
.cb-link{font:inherit;font-size:13px;font-weight:600;cursor:pointer;border:none;background:none;color:var(--ink-soft);text-decoration:underline;min-height:34px;padding:0 6px}
.cb-link:hover{color:var(--ink)}

.cb-months{display:grid;gap:clamp(12px,2vw,20px);grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))}
.cb-month{background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:0 1px 2px rgba(0,0,0,.04);overflow:hidden;display:flex;flex-direction:column;min-width:0}
.cb-month.current{border-color:var(--ink);box-shadow:0 0 0 1px var(--ink)}
.cb-month-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px 10px;padding:14px 16px 10px;border-bottom:1px solid var(--line-soft)}
.cb-month-head h2{margin:0;font-weight:800;font-size:19px;letter-spacing:-.01em}
.cb-month-tags{display:flex;flex-wrap:wrap;gap:6px}
.cb-badge{font-size:11.5px;font-weight:600;color:var(--ink);background:#F0F0F0;border:1px solid var(--line);padding:2px 9px;border-radius:999px;white-space:nowrap}
.cb-badge.now{background:var(--ink);border-color:var(--ink);color:#fff}
.cb-cal{padding:10px 10px 2px}
.cb-dow{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));margin-bottom:4px}
.cb-dow span{text-align:center;font-size:11px;font-weight:700;color:var(--ink-soft);padding:3px 0}
.cb-dow span.weekend{opacity:.6}
.cb-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px}
.cb-cell{aspect-ratio:1/1;border-radius:9px;display:flex;align-items:center;justify-content:center;position:relative;font-size:13px;font-weight:500;color:var(--ink);border:none;background:transparent;padding:0}
.cb-cell.empty{visibility:hidden}
.cb-cell.weekend{color:#8A8A8A;background:#F7F7F7}
.cb-cell.has{font-weight:700;color:var(--ink)}
.cb-cell.holiday{font-weight:800;color:var(--ink)}
.cb-cell.dim{opacity:.3}
.cb-cell.today{outline:2px solid var(--ink);outline-offset:1px;font-weight:800}
.cb-cell.clickable{cursor:pointer}
.cb-cell.clickable:hover{background:#E8E8E8}
.cb-dots{display:flex;gap:2px;position:absolute;bottom:4px}
.cb-dots i{width:5px;height:5px;border-radius:50%}
.cb-events{padding:6px 12px 14px;display:flex;flex-direction:column;gap:2px;flex:1}
.cb-empty{font-size:12.5px;color:var(--ink-soft);padding:6px 4px;margin:0}
.cb-ev{display:flex;gap:11px;padding:7px 6px;border-radius:10px;align-items:flex-start;transition:.12s}
.cb-ev:hover{background:var(--line-soft)}
.cb-ev.dim{opacity:.25}
.cb-ev.past:not(.dim){opacity:.6}
.cb-date{flex:none;min-width:46px;text-align:center;font-weight:800;font-size:13px;border-radius:9px;padding:4px 6px;line-height:1.15}
.cb-date small{display:block;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;opacity:.85}
.cb-txt{font-size:14px;color:var(--ink);padding-top:1px;min-width:0;overflow-wrap:anywhere}
.cb-txt small{display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;color:var(--ink-soft);margin-top:2px}
.cb-txt small i{width:8px;height:8px;border-radius:50%;flex:none}

/* Visão em lista */
.cb-agenda{display:flex;flex-direction:column;gap:16px;max-width:820px}
.cb-agenda-month{background:var(--surface);border:1px solid var(--line);border-radius:16px;overflow:hidden}
.cb-agenda-head{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:4px 12px;padding:14px 16px 10px;border-bottom:1px solid var(--line-soft)}
.cb-agenda-head h2{margin:0;font-weight:800;font-size:19px}
.cb-agenda-meta{font-size:12.5px;font-weight:500;color:var(--ink-soft)}
.cb-agenda-list{padding:8px 12px 12px;display:flex;flex-direction:column;gap:2px}
.cb-agenda-empty{padding:32px 16px;text-align:center;font-size:14px;font-weight:600;color:var(--ink-soft);background:var(--surface);border:1px dashed var(--line);border-radius:16px}

.cb-foot{margin-top:24px;padding-top:14px;border-top:1px solid var(--line);display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:center;font-size:13px;color:var(--ink-soft)}
.cb-note{max-width:680px;white-space:pre-wrap}
.cb-foot strong{color:var(--ink)}

/* Telas pequenas: botões do cabeçalho ocupam a linha toda, fáceis de tocar */
@media (max-width:640px){
  .cb-top{padding:12px}
  .cb-top-actions{width:100%}
  .cb-top-actions>.cb-btn{flex:1}
  .cb-top-actions>div{flex:none}
  .cb-toolbar{flex-direction:column;align-items:stretch}
  .cb-seg{display:grid;grid-template-columns:1fr 1fr}
  .cb-seg button{justify-content:center}
  .cb-hint{width:100%}
  .cb-editor-head-actions .cb-btn{padding:0 10px}
}

@media print{
  @page{size:A4 portrait;margin:6mm}
  .cb-top-actions,.cb-editor,.cb-filters,.cb-back,.cb-stamp,.cb-toolbar,.cb-stats{display:none!important}
  .cb-app{background:#fff;border:none;border-radius:0;font-size:10px}
  .cb-app *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .cb-top{padding:0 0 6px;border:none}
  .cb-h1{font-size:18px}
  .cb-eyebrow{font-size:9px}
  .cb-layout.with-editor{grid-template-columns:1fr}
  .cb-preview{padding:0}
  /* 3 meses por linha, bem compacto, p/ caber tudo em poucas folhas */
  .cb-months{grid-template-columns:repeat(3,1fr);gap:6px}
  .cb-month{box-shadow:none;border-color:#ddd;border-radius:8px;break-inside:avoid}
  .cb-month.current{border-color:#ddd;box-shadow:none}
  .cb-badge.now{display:none}
  .cb-month-head{padding:6px 8px 4px}
  .cb-month-head h2{font-size:14px}
  .cb-badge{font-size:9px;padding:1px 6px}
  .cb-cal{padding:4px 6px 0}
  .cb-dow span{font-size:8px;padding:1px 0}
  .cb-grid{gap:1px}
  .cb-cell{font-size:9px;border-radius:3px;font-weight:600}
  .cb-cell.today{outline:none}
  .cb-dots{bottom:1px;gap:1px}
  .cb-dots i{width:3px;height:3px}
  .cb-events{padding:3px 8px 8px;gap:0}
  .cb-empty{font-size:8px;padding:2px}
  .cb-ev{padding:2px;gap:5px}
  .cb-ev.dim{display:none}             /* não imprime eventos de categorias ocultas */
  .cb-ev.past:not(.dim){opacity:1}
  .cb-date{min-width:26px;font-size:8px;padding:2px 3px;border-radius:4px;line-height:1.1}
  .cb-date small{display:none}
  .cb-txt{font-size:8.5px;padding-top:0;line-height:1.2}
  .cb-txt small{font-size:7px;margin-top:0}
  .cb-txt small i{display:none}
  .cb-foot{margin-top:8px;padding-top:6px;font-size:8px}
  .cb-agenda{max-width:none}
  .cb-agenda-month{break-inside:avoid;border-radius:6px}
}
@media (prefers-reduced-motion:reduce){.cb-app *{transition:none!important}}
`;
