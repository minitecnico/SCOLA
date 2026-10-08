import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CalendarDays, LayoutGrid, List as ListIcon, Printer, Rows3, X } from "lucide-react";
import { cn } from "../../lib/cn";
import type { CalendarBuilderData as CalendarData, CalendarHoliday } from "../../lib/types";
import { MONTHS_PT } from "./dates";
import { buildCalendarDoc, fitDocument, pageSize, scopeLabel, type FitReport, type PrintLayout, type PrintOptions } from "./printHtml";

const KEY = "scola-print-calendar";
const mmToPx = (mm: number) => (mm * 96) / 25.4;

const LAYOUTS: { id: PrintLayout; title: string; hint: string; icon: ReactNode }[] = [
  { id: "tudo", title: "Tudo em 1 folha", hint: "Todos os meses do período numa folha só", icon: <LayoutGrid size={18} /> },
  { id: "periodo", title: "1 folha por período", hint: "Cada trimestre/bimestre numa folha", icon: <Rows3 size={18} /> },
  { id: "mes", title: "Um mês por folha", hint: "Grande, com os eventos escritos nos dias", icon: <CalendarDays size={18} /> },
  { id: "lista", title: "Lista de eventos", hint: "Datas em ordem, em colunas", icon: <ListIcon size={18} /> },
];

const defaults = (scope: string): PrintOptions => ({
  layout: "tudo", landscape: true, paper: "A4", margin: 8, color: true, scope, list: true, legend: true, letivos: true, holidays: true, weekends: true,
});

function load(scope: string): PrintOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null") as Partial<PrintOptions> | null;
    const o = { ...defaults(scope), ...(saved ?? {}), scope };
    return o.layout === "periodo" && scope !== "year" ? { ...o, layout: "tudo" } : o;
  } catch {
    return defaults(scope);
  }
}

function Seg<T extends string | number | boolean>({ value, options, onChange, label }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex w-full rounded-lg bg-neutral-100 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.v)}
          type="button"
          aria-pressed={value === o.v}
          onClick={() => onChange(o.v)}
          className={cn("min-h-9 flex-1 rounded-md px-2 text-xs font-bold transition", value === o.v ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:text-neutral-900")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex min-h-8 cursor-pointer items-center gap-2 text-sm font-semibold text-neutral-800">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-neutral-900" />
      {children}
    </label>
  );
}

/** Imprimir / salvar PDF do calendário: escolhe o formato, vê a folha como vai sair e imprime. */
export function PrintCalendarModal({
  data, holidays, active, logo, viewId, onClose,
}: {
  data: CalendarData;
  holidays: CalendarHoliday[];
  active: Set<string>;
  logo?: string | null;
  viewId: string;
  onClose: () => void;
}) {
  const [o, setO] = useState<PrintOptions>(() => load(viewId));
  const [report, setReport] = useState<FitReport | null>(null);
  const [src, setSrc] = useState("");
  const [contentH, setContentH] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(640);

  const set = (patch: Partial<PrintOptions>) => setO((p) => ({ ...p, ...patch }));
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...o, scope: undefined }));
    } catch {
      /* sem armazenamento: tudo bem */
    }
  }, [o]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth));
    ro.observe(el);
    setAvail(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const generated = useMemo(() => new Date().toLocaleDateString("pt-BR"), []);
  const doc = useMemo(() => buildCalendarDoc({ data, holidays, active, logo, generated }, o), [data, holidays, active, logo, generated, o]);

  // Cada mudança gera o documento de novo, num endereço temporário (blob) que o iframe abre.
  useEffect(() => {
    setReport(null);
    const url = URL.createObjectURL(new Blob([doc.html], { type: "text/html" }));
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [doc]);

  const onLoad = () => {
    const d = frame.current?.contentDocument;
    if (!d) return;
    setReport(fitDocument(d));
    setContentH(d.documentElement.scrollHeight);
  };

  const print = () => {
    const w = frame.current?.contentWindow;
    if (!w) return;
    const prev = document.title;
    document.title = `${data.title} — ${scopeLabel(data, o.scope)}`;
    w.addEventListener("afterprint", () => (document.title = prev), { once: true });
    w.focus();
    w.print();
    setTimeout(() => (document.title = prev), 4000);
  };

  const pickLayout = (layout: PrintLayout) => set({ layout, landscape: layout !== "lista" });
  const size = pageSize(o);
  const scale = Math.max(0.2, Math.min(1.1, (avail - 8) / mmToPx(size.w)));
  const periodOk = o.scope === "year" && data.periods.length > 0;
  const scopes = [
    { v: "year", label: `Ano letivo ${data.year} (todos os meses)` },
    ...data.periods.map((p) => ({ v: p.id, label: p.label })),
    ...MONTHS_PT.map((m, i) => ({ v: `m:${i}`, label: m })),
  ];

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-neutral-950/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Imprimir calendário">
      <div className="flex items-center gap-2 bg-neutral-950 px-3 py-2.5 text-white sm:px-4">
        <p className="min-w-0 flex-1 truncate text-sm font-bold">Imprimir / PDF — {data.title}</p>
        <button onClick={print} disabled={!report} className="inline-flex h-10 items-center gap-2 rounded-lg bg-white px-4 text-sm font-bold text-neutral-950 hover:bg-neutral-200 disabled:opacity-50">
          <Printer size={16} /> Imprimir / salvar PDF
        </button>
        <button onClick={onClose} className="grid h-10 w-10 place-items-center rounded-lg bg-white/10 hover:bg-white/20" aria-label="Fechar">
          <X size={18} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:grid lg:grid-cols-[21rem_minmax(0,1fr)] lg:overflow-hidden">
        {/* Opções */}
        <aside className="space-y-4 bg-white p-4 lg:overflow-y-auto">
          <section>
            <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-neutral-500">Formato</h3>
            <div className="grid grid-cols-2 gap-2">
              {LAYOUTS.map((l) => {
                const off = l.id === "periodo" && !periodOk;
                return (
                  <button
                    key={l.id}
                    type="button"
                    disabled={off}
                    aria-pressed={o.layout === l.id}
                    onClick={() => pickLayout(l.id)}
                    title={off ? "Disponível quando o período escolhido é o ano todo e há períodos cadastrados" : l.hint}
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-xl border p-2.5 text-left transition disabled:opacity-40",
                      o.layout === l.id ? "border-neutral-900 bg-neutral-50 ring-1 ring-neutral-900" : "border-neutral-200 hover:border-neutral-400",
                    )}
                  >
                    {l.icon}
                    <span className="text-[13px] font-extrabold leading-tight text-neutral-900">{l.title}</span>
                    <span className="text-[11px] font-medium leading-snug text-neutral-500">{l.hint}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-neutral-500">O que imprimir</h3>
            <select
              value={o.scope}
              onChange={(e) => set({ scope: e.target.value, ...(e.target.value !== "year" && o.layout === "periodo" ? { layout: "tudo" as const } : {}) })}
              className="h-10 w-full rounded-lg border border-neutral-300 bg-white px-2 text-sm font-semibold outline-none focus:border-neutral-900"
              aria-label="Período a imprimir"
            >
              {scopes.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
            </select>
            <p className="text-[11px] font-medium text-neutral-500">Vale o que está marcado nos filtros da tela: categorias desmarcadas não saem na folha.</p>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-neutral-500">Folha</h3>
            <Seg label="Papel" value={o.paper} onChange={(v) => set({ paper: v })} options={[{ v: "A4", label: "A4" }, { v: "A3", label: "A3 (cartaz)" }]} />
            <Seg label="Orientação" value={o.landscape} onChange={(v) => set({ landscape: v })} options={[{ v: true, label: "Paisagem" }, { v: false, label: "Retrato" }]} />
            <Seg label="Margens" value={o.margin} onChange={(v) => set({ margin: v })} options={[{ v: 5, label: "Estreitas" }, { v: 8, label: "Normais" }, { v: 12, label: "Largas" }]} />
            <Seg label="Cores" value={o.color} onChange={(v) => set({ color: v })} options={[{ v: true, label: "Colorido" }, { v: false, label: "Preto e branco" }]} />
          </section>

          <section>
            <h3 className="mb-1 text-xs font-extrabold uppercase tracking-wider text-neutral-500">Incluir</h3>
            <Check checked={o.list} onChange={(v) => set({ list: v })}>{o.layout === "lista" ? "Lista de eventos" : "Lista de datas importantes"}</Check>
            <Check checked={o.legend} onChange={(v) => set({ legend: v })}>Legenda de cores</Check>
            <Check checked={o.letivos} onChange={(v) => set({ letivos: v })}>Dias letivos</Check>
            <Check checked={o.holidays} onChange={(v) => set({ holidays: v })}>Feriados</Check>
            <Check checked={o.weekends} onChange={(v) => set({ weekends: v })}>Sombrear sábado e domingo</Check>
          </section>

          <section className="space-y-2 rounded-xl bg-neutral-100 p-3 text-xs font-semibold text-neutral-700">
            {!report ? (
              <p>Preparando a folha…</p>
            ) : (
              <p>{report.pages} folha(s) {o.paper} · {o.landscape ? "paisagem" : "retrato"}. Letras e quadradinhos se ajustam sozinhos para caber.</p>
            )}
            {report && report.omitted > 0 ? (
              <p className="rounded-lg bg-white p-2 font-bold text-red-700 ring-1 ring-red-200">
                ⚠ {report.omitted} compromisso(s) não couberam. Experimente papel A3, “1 folha por período”, “Um mês por folha” ou desligue a lista de datas.
              </p>
            ) : null}
            <p>Na janela de impressão, escolha <b>Salvar como PDF</b> para gerar o arquivo.</p>
          </section>
        </aside>

        {/* Pré-visualização */}
        <div ref={wrap} className="min-h-[60vh] p-3 sm:p-6 lg:overflow-auto">
          <div className="mx-auto" style={{ width: mmToPx(size.w) * scale, height: contentH ? contentH * scale : undefined }}>
            {src ? (
              <iframe
                ref={frame}
                src={src}
                title="Pré-visualização do calendário"
                onLoad={onLoad}
                className="block origin-top-left border-0 bg-transparent"
                style={{ width: mmToPx(size.w), height: contentH || mmToPx(size.h), transform: `scale(${scale})` }}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
