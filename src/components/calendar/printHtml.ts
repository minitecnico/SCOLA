import { escapeHtml as esc } from "../../lib/format";
import { hexToRgb, readableText } from "../../lib/calendarColors";
import type { CalendarBuilderData as CalendarData, CalendarHoliday } from "../../lib/types";
import { MONTHS_PT, chipLabel } from "./dates";
import { monthEntries, type Entry } from "./views";

/* ============================================================================
   Impressão do calendário: documento próprio (não a tela do sistema), em milímetros.
   Cada folha é um bloco de tamanho exato do papel, com margem zero na impressora (some o cabeçalho
   com endereço/data do navegador) e margem de verdade dentro do bloco. O tamanho das letras e dos
   quadradinhos se ajusta sozinho para o ano caber numa folha (fitDocument).
============================================================================ */

export type PrintLayout = "tudo" | "periodo" | "mes" | "lista";
export interface PrintOptions {
  layout: PrintLayout;
  landscape: boolean;
  paper: "A4" | "A3";
  /** Margem em mm. */
  margin: number;
  color: boolean;
  /** "year" | id do período | "m:<0-11>". */
  scope: string;
  list: boolean;
  legend: boolean;
  letivos: boolean;
  holidays: boolean;
  weekends: boolean;
}
export interface PrintInput {
  data: CalendarData;
  holidays: CalendarHoliday[];
  active: Set<string>;
  logo?: string | null;
  generated: string;
}

export const PAPER_MM = { A4: [210, 297], A3: [297, 420] } as const;
export const pageSize = (o: Pick<PrintOptions, "paper" | "landscape">) => {
  const [w, h] = PAPER_MM[o.paper];
  return o.landscape ? { w: h, h: w } : { w, h };
};

/* ----------------------------- Cores ----------------------------- */
const grayOf = (hex: string) => {
  const { r, g, b } = hexToRgb(hex);
  const l = Math.round(Math.min(215, Math.max(60, 0.299 * r + 0.587 * g + 0.114 * b)));
  const h = l.toString(16).padStart(2, "0");
  return `#${h}${h}${h}`;
};

/* ----------------------------- Meses do escopo ----------------------------- */
export function scopeMonths(data: CalendarData, scope: string): number[] {
  if (scope.startsWith("m:")) return [Math.min(11, Math.max(0, +scope.slice(2) || 0))];
  const p = data.periods.find((x) => x.id === scope);
  if (p) return Array.from({ length: p.endMonth - p.startMonth + 1 }, (_, i) => p.startMonth + i).filter((m) => m >= 0 && m <= 11);
  return Array.from({ length: 12 }, (_, i) => i);
}
export function scopeLabel(data: CalendarData, scope: string): string {
  if (scope.startsWith("m:")) return `${MONTHS_PT[+scope.slice(2)]} ${data.year}`;
  return data.periods.find((x) => x.id === scope)?.label ?? `Ano letivo ${data.year}`;
}

/** Colunas de meses numa folha, pela quantidade de meses e pela orientação. */
function monthCols(n: number, landscape: boolean) {
  if (landscape) return n <= 1 ? 1 : n === 2 ? 2 : n === 3 ? 3 : n === 4 ? 2 : n <= 6 ? 3 : 4;
  return n <= 1 ? 1 : n === 2 ? 2 : n === 3 ? 3 : n <= 6 ? 2 : 3;
}

/* ----------------------------- Peças de HTML ----------------------------- */
interface Ctx {
  inp: PrintInput;
  o: PrintOptions;
  col: (hex: string) => string;
  /** Compromissos visíveis de cada mês (filtros da tela + opções de impressão). */
  entries: (m: number) => Entry[];
  pageW: number;
  pageH: number;
}

const dow = ["S", "T", "Q", "Q", "S", "S", "D"];
const dowLong = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
const style = (c: string, t: string) => `--c:${c};--t:${t}`;

function miniMonth(cx: Ctx, m: number, rows: number): string {
  const year = cx.inp.data.year;
  const first = (new Date(year, m, 1).getDay() + 6) % 7;
  const n = new Date(year, m + 1, 0).getDate();
  const byDay: Entry[][] = [];
  cx.entries(m).forEach((e) => e.days.forEach((d) => (byDay[d] = byDay[d] || []).push(e)));
  let cells = "";
  for (let i = 0; i < first; i++) cells += `<i class="d e"></i>`;
  for (let d = 1; d <= n; d++) {
    const list = byDay[d] ?? [];
    const we = cx.o.weekends && (first + d - 1) % 7 >= 5;
    if (!list.length) {
      cells += `<i class="d${we ? " we" : ""}">${d}</i>`;
      continue;
    }
    const c = cx.col((list.find((e) => !e.holiday) ?? list[0]).color);
    const colors = [...new Set(list.map((e) => cx.col(e.color)))].slice(0, 4);
    const stripes = colors.length > 1 ? `<u style="background:linear-gradient(90deg,${colors.map((x, i) => `${x} ${(i * 100) / colors.length}% ${((i + 1) * 100) / colors.length}%`).join(",")})"></u>` : "";
    cells += `<i class="d on" style="${style(c, readableText(c))}">${d}${stripes}</i>`;
  }
  const total = Math.ceil((first + n) / 7);
  for (let i = total; i < rows; i++) cells += `<i class="d e"></i><i class="d e"></i><i class="d e"></i><i class="d e"></i><i class="d e"></i><i class="d e"></i><i class="d e"></i>`;
  const lt = cx.o.letivos ? cx.inp.data.letivosByMonth[m] : 0;
  return `<div class="m"><div class="mh"><b>${MONTHS_PT[m]}</b>${lt ? `<i>${lt} dias letivos</i>` : ""}</div><div class="dw">${dow.map((s) => `<span>${s}</span>`).join("")}</div><div class="dg">${cells}</div></div>`;
}

const weeksOf = (year: number, m: number) => Math.ceil(((new Date(year, m, 1).getDay() + 6) % 7 + new Date(year, m + 1, 0).getDate()) / 7);

function bigMonth(cx: Ctx, m: number): string {
  const year = cx.inp.data.year;
  const first = (new Date(year, m, 1).getDay() + 6) % 7;
  const n = new Date(year, m + 1, 0).getDate();
  const wk = weeksOf(year, m);
  const byDay: Entry[][] = [];
  cx.entries(m).forEach((e) => e.days.forEach((d) => (byDay[d] = byDay[d] || []).push(e)));
  let h = dowLong.map((s) => `<div class="hh">${s.slice(0, 3).toUpperCase()}</div>`).join("");
  for (let i = 0; i < first; i++) h += `<div class="c x"></div>`;
  for (let d = 1; d <= n; d++) {
    const col = (first + d - 1) % 7;
    const list = byDay[d] ?? [];
    const pills = list.slice(0, 4).map((e) => {
      const c = cx.col(e.color);
      const show = d === e.days[0] || col === 0;
      return `<div class="p${show ? "" : " k"}" style="${style(c, readableText(c))}">${show ? esc(e.title) : "&nbsp;"}</div>`;
    }).join("");
    const more = list.length > 4 ? `<div class="pm">+${list.length - 4}</div>` : "";
    const hol = list.some((e) => e.holiday);
    h += `<div class="c${cx.o.weekends && col >= 5 ? " we" : ""}${hol ? " hol" : ""}"><b>${d}</b>${pills}${more}</div>`;
  }
  const rest = wk * 7 - first - n;
  for (let i = 0; i < rest; i++) h += `<div class="c x"></div>`;
  return `<div class="mcal" style="--wk:${wk}">${h}</div>`;
}

function legendHtml(cx: Ctx, months: number[]): string {
  if (!cx.o.legend) return "";
  const seen = new Map<string, string>();
  months.forEach((m) => cx.entries(m).forEach((e) => {
    const label = e.holiday ? e.label.split(" · ")[0] : e.label;
    const c = cx.col(e.color);
    if (!seen.has(`${label}|${c}`)) seen.set(`${label}|${c}`, `<span><i style="--c:${c}"></i>${esc(label)}</span>`);
  }));
  const we = cx.o.weekends ? `<span><i style="--c:#EFEFEF"></i>Sábado e domingo</span>` : "";
  const items = [...seen.values()].join("") + we;
  return items ? `<div class="lg">${items}</div>` : "";
}

/** Linhas da lista de compromissos dos meses (títulos de mês entre elas). */
function eventRows(cx: Ctx, months: number[], detail: boolean): string {
  let out = "";
  for (const m of months) {
    const list = cx.entries(m);
    if (!list.length) continue;
    out += `<li class="grp${detail ? " d" : ""}">${detail ? "" : `<div class="mm">${MONTHS_PT[m]}</div>`}`;
    for (const e of list) {
      const c = cx.col(e.color);
      const meta = detail ? ` <small>${e.weekday ? `${e.weekday} · ` : ""}${esc(e.holiday ? e.label.split(" · ")[0] : e.label)}</small>` : "";
      out += `<div class="e"><span class="dt" style="${style(c, readableText(c))}">${chipLabel(e.days)}</span><span class="tt">${esc(e.title)}${meta}</span></div>`;
    }
    out += `</li>`;
  }
  return out;
}

const totalLetivos = (cx: Ctx, months: number[]) => (cx.o.letivos ? months.reduce((s, m) => s + (cx.inp.data.letivosByMonth[m] || 0), 0) : 0);

function header(cx: Ctx, opts: { eyebrow?: string; title?: string; sub?: string; months: number[] }) {
  const d = cx.inp.data;
  const lt = totalLetivos(cx, opts.months);
  return `<header class="hd">${cx.inp.logo ? `<img class="logo" src="${esc(cx.inp.logo)}" alt="">` : ""}<div class="ht"><div class="eb">${esc(opts.eyebrow ?? `${d.school} · ${d.year}`)}</div><h1>${esc(opts.title ?? d.title)}</h1>${opts.sub ? `<div class="sb">${esc(opts.sub)}</div>` : ""}</div>${lt ? `<div class="hs"><b>${lt}</b><span>dias letivos</span></div>` : ""}</header>`;
}

function footer(cx: Ctx) {
  const notes = cx.inp.data.notes?.trim();
  return `<footer class="ft"><span class="nt">${notes ? esc(notes) : ""}</span><span>SCOLA · gerado em ${esc(cx.inp.generated)}</span></footer>`;
}

const page = (inner: string, fit: "grid" | "side" | "flow") => `<div class="page" data-fit="${fit}"><div class="in">${inner}</div></div>`;

/** Folha com vários meses (mini calendários) + legenda + lista de datas. */
function gridPage(cx: Ctx, months: number[], head: { title?: string; sub?: string }) {
  const rows = Math.max(...months.map((m) => weeksOf(cx.inp.data.year, m)));
  const cols = monthCols(months.length, cx.o.landscape);
  const ecols = Math.max(2, Math.round((cx.pageW - 2 * cx.o.margin) / (62 * (cx.o.paper === "A3" ? 1.414 : 1))));
  const rowsHtml = cx.o.list ? eventRows(cx, months, false) : "";
  const body =
    header(cx, { ...head, months }) +
    `<section class="months" style="--cols:${cols}">${months.map((m) => miniMonth(cx, m, rows)).join("")}</section>` +
    legendHtml(cx, months) +
    (cx.o.list && rowsHtml ? `<section class="evs"><div class="evt">Datas importantes</div><ul class="evc" style="--ecols:${ecols}">${rowsHtml}</ul></section>` : "") +
    footer(cx);
  return page(body, "grid");
}

/** Folha de um mês grande, com os compromissos escritos nos dias e a lista ao lado (ou embaixo). */
function monthPage(cx: Ctx, m: number) {
  const d = cx.inp.data;
  const rowsHtml = eventRows(cx, [m], true);
  const side = cx.o.list ? `<aside class="side"><div class="evt">Compromissos</div><ul class="evc">${rowsHtml || `<li class="none">Sem compromissos neste mês.</li>`}</ul></aside>` : "";
  const body =
    header(cx, { eyebrow: `${d.school} · ${d.title}`, title: `${MONTHS_PT[m]} ${d.year}`, months: [m] }) +
    `<div class="mbody">${bigMonth(cx, m)}${side}</div>` +
    legendHtml(cx, [m]) +
    footer(cx);
  return page(body, "side");
}

/** Lista de compromissos do período: uma folha-modelo; fitDocument divide em quantas folhas precisar. */
function listPage(cx: Ctx, months: number[], label: string) {
  const rows = months.map((m) => {
    const list = cx.entries(m);
    if (!list.length) return "";
    const lt = cx.o.letivos ? cx.inp.data.letivosByMonth[m] : 0;
    const head = `<div class="blk mm2"><b>${MONTHS_PT[m]}</b><i>${list.length} compromisso(s)${lt ? ` · ${lt} dias letivos` : ""}</i></div>`;
    const rs = list.map((e, i) => {
      const c = cx.col(e.color);
      return `<div class="blk r${i === 0 ? " first" : ""}"><span class="dt" style="${style(c, readableText(c))}">${chipLabel(e.days)}</span><span class="tt">${esc(e.title)} <small>${e.weekday ? `${e.weekday} · ` : ""}${esc(e.holiday ? e.label.split(" · ")[0] : e.label)}</small></span></div>`;
    });
    return head + rs.join("");
  }).join("");
  const body =
    header(cx, { sub: label !== `Ano letivo ${cx.inp.data.year}` ? label : undefined, months }) +
    legendHtml(cx, months) +
    `<div class="flow">${rows || `<div class="none">Nenhum compromisso neste período com os filtros atuais.</div>`}</div>` +
    footer(cx);
  return page(body, "flow");
}

/* ----------------------------- Documento ----------------------------- */
export function buildCalendarDoc(inp: PrintInput, o: PrintOptions): { html: string; pageW: number; pageH: number } {
  const { w: pageW, h: pageH } = pageSize(o);
  const data = inp.data;
  const col = (hex: string) => (o.color ? hex : grayOf(hex));
  const cache = new Map<number, Entry[]>();
  const catById = Object.fromEntries(data.categories.map((c) => [c.id, c]));
  const entries = (m: number) => {
    let r = cache.get(m);
    if (!r) {
      r = monthEntries(data.year, m, data.events, o.holidays ? inp.holidays : [], catById).filter((e) => e.holiday || (e.categoryId && inp.active.has(e.categoryId)));
      cache.set(m, r);
    }
    return r;
  };
  const cx: Ctx = { inp, o, col, entries, pageW, pageH };
  const months = scopeMonths(data, o.scope);
  const label = scopeLabel(data, o.scope);

  let pages = "";
  if (o.layout === "mes") pages = months.map((m) => monthPage(cx, m)).join("");
  else if (o.layout === "lista") pages = listPage(cx, months, label);
  else if (o.layout === "periodo" && o.scope === "year" && data.periods.length) {
    // Meses fora de qualquer período (ex.: janeiro e dezembro) entram na folha do período vizinho, sem folha sozinha.
    const groups = data.periods.map((p) => ({ label: p.label, months: scopeMonths(data, p.id), extra: [] as number[] }));
    const used = new Set(groups.flatMap((g) => g.months));
    const rest = months.filter((m) => !used.has(m));
    const orphans: number[] = [];
    for (const m of rest) {
      const next = groups.filter((g) => g.months.length && Math.min(...g.months) > m).sort((a, b) => Math.min(...a.months) - Math.min(...b.months))[0];
      const prev = groups.filter((g) => g.months.length && Math.max(...g.months) < m).sort((a, b) => Math.max(...b.months) - Math.max(...a.months))[0];
      const g = next ?? prev;
      if (g) g.extra.push(m);
      else orphans.push(m);
    }
    for (const g of groups) {
      const all = [...g.extra, ...g.months].sort((a, b) => a - b);
      if (!all.length) continue;
      pages += gridPage(cx, all, { sub: g.extra.length ? `${g.label} · inclui ${g.extra.map((m) => MONTHS_PT[m].toLowerCase()).join(" e ")}` : g.label });
    }
    if (orphans.length) pages += gridPage(cx, orphans, { sub: "Demais meses" });
  } else pages = gridPage(cx, months, { sub: o.scope === "year" ? undefined : label });

  const M = o.margin;
  const fs = 3 * (o.paper === "A3" ? 1.414 : 1);
  const css = `
@page{size:${o.paper} ${o.landscape ? "landscape" : "portrait"};margin:0}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
html,body{margin:0;padding:0}
body{font-family:Inter,"Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif;color:#0a0a0a;-webkit-font-smoothing:antialiased}
.page{--chn:1.9;--es:1;position:relative;width:${pageW}mm;height:${pageH - 0.4}mm;overflow:hidden;background:#fff;font-size:${fs}mm;line-height:1.25;break-after:page;page-break-after:always}
.page:last-child{break-after:auto;page-break-after:auto}
.in{position:absolute;inset:${M}mm;display:flex;flex-direction:column;gap:.75em;overflow:hidden}
.in>*{flex:none}
@media screen{body{background:#d4d4d4;display:flex;flex-direction:column;gap:6mm;width:${pageW}mm}.page{box-shadow:0 .5mm 3mm rgba(0,0,0,.28)}}
.hd{display:flex;align-items:center;gap:1.2em;padding-bottom:.7em;border-bottom:.5mm solid #0a0a0a}
.logo{height:3.8em;width:3.8em;object-fit:contain;flex:none}
.ht{flex:1;min-width:0}
.eb{font-size:.78em;letter-spacing:.12em;text-transform:uppercase;color:#525252;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hd h1{margin:.05em 0 0;font-size:2.3em;line-height:1.05;font-weight:800;letter-spacing:-.02em;overflow-wrap:anywhere}
.sb{font-size:.95em;color:#404040;font-weight:700;margin-top:.15em}
.hs{text-align:right;line-height:1.05;flex:none}.hs b{display:block;font-size:2.1em;font-weight:800}.hs span{font-size:.72em;color:#525252;text-transform:uppercase;letter-spacing:.08em;font-weight:700}
.months{display:grid;grid-template-columns:repeat(var(--cols),minmax(0,26em));justify-content:center;gap:1em 1.5em;align-content:start}
.m{min-width:0}
.mh{display:flex;justify-content:space-between;align-items:baseline;gap:.5em;border-bottom:.2mm solid #0a0a0a;margin-bottom:.3em;padding-bottom:.15em}
.mh b{font-size:1.2em;font-weight:800;text-transform:uppercase;letter-spacing:.05em}
.mh i{font-style:normal;font-size:.68em;color:#525252;font-weight:700;white-space:nowrap}
.dw,.dg{display:grid;grid-template-columns:repeat(7,minmax(0,1fr))}
.dw span{text-align:center;font-size:.68em;font-weight:700;color:#737373;padding-bottom:.15em}
.dg{gap:.14em;grid-auto-rows:calc(var(--chn)*1em)}
.d{position:relative;display:grid;place-items:center;border-radius:.28em;font-style:normal;font-weight:600;line-height:1;overflow:hidden}
.d.e{visibility:hidden}
.d.we{background:#EFEFEF;color:#525252}
.d.on{background:var(--c);color:var(--t);font-weight:800}
.d u{position:absolute;left:0;right:0;bottom:0;height:.3em}
.lg{display:flex;flex-wrap:wrap;gap:.3em 1.3em;font-size:.82em;font-weight:600;color:#262626}
.lg span{display:inline-flex;align-items:center;gap:.4em}
.lg i{width:.95em;height:.95em;border-radius:.25em;background:var(--c);border:.1mm solid rgba(0,0,0,.3);flex:none}
.evt{font-size:.8em;font-weight:800;letter-spacing:.12em;text-transform:uppercase;border-bottom:.2mm solid #0a0a0a;margin:0 0 .4em;padding-bottom:.15em}
.evc{font-size:calc(var(--es)*1em);column-count:var(--ecols,1);column-gap:1.6em;list-style:none;margin:0;padding:0}
.evc li{margin:0}
.evc .mm{font-weight:800;font-size:.85em;text-transform:uppercase;letter-spacing:.08em;margin:0 0 .15em;break-after:avoid;border-bottom:.1mm solid #A3A3A3;padding-bottom:.05em}
.evc .grp{margin:0 0 .6em;break-inside:auto}
.evc .mm.cont{margin-top:0}
.evc .more{font-size:.85em;font-weight:700;color:#525252;font-style:italic;padding-top:.4em}
.evc .none,.none{color:#525252;font-weight:600;padding:.5em 0}
.e,.r{display:flex;gap:.5em;align-items:baseline;padding:.13em 0;font-size:.92em;line-height:1.2;break-inside:avoid}
.dt{flex:none;min-width:2.6em;text-align:center;background:var(--c);color:var(--t);border-radius:.3em;font-weight:800;font-size:.85em;padding:.12em .25em;white-space:nowrap}
.tt{min-width:0;overflow-wrap:anywhere}
.tt small{color:#525252;font-weight:600;font-size:.82em}
.ft{margin-top:auto!important;display:flex;justify-content:space-between;align-items:flex-end;gap:1em;font-size:.72em;color:#737373;border-top:.2mm solid #A3A3A3;padding-top:.5em}
.ft .nt{white-space:pre-line;max-width:72%;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ft span:last-child{white-space:nowrap}
/* um mês por folha */
.mbody{flex:1 1 0!important;min-height:0;display:flex;gap:1.2em;flex-direction:${o.landscape ? "row" : "column"}}
.mcal{flex:1 1 0;min-width:0;min-height:0;display:grid;grid-template-columns:repeat(7,minmax(0,1fr));grid-template-rows:auto repeat(var(--wk),minmax(0,1fr));gap:.2em}
.hh{text-align:center;font-size:.75em;font-weight:800;letter-spacing:.1em;background:#0a0a0a;color:#fff;border-radius:.25em;padding:.3em 0}
.c{border:.15mm solid #A3A3A3;border-radius:.3em;padding:.22em .25em;display:flex;flex-direction:column;gap:.15em;overflow:hidden;min-height:0;background:#fff}
.c.we{background:#F0F0F0}.c.x{border-color:transparent;background:transparent}
.c b{font-size:1.15em;font-weight:800;line-height:1}
.c.hol b{text-decoration:underline;text-decoration-thickness:.2em;text-underline-offset:.15em}
.p{font-size:.84em;line-height:1.15;background:var(--c);color:var(--t);border-radius:.25em;padding:.12em .3em;overflow:hidden;font-weight:700;flex:none;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow-wrap:anywhere}
.p.k{color:transparent;user-select:none}
.pm{font-size:.7em;font-weight:800;color:#525252}
.side{min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;${o.landscape ? "flex:0 0 31%" : "flex:0 0 auto;max-height:34%"}}
.side .evc{flex:1 1 auto;min-height:0;overflow:hidden;column-count:${o.landscape ? 1 : Math.max(2, Math.round((pageW - 2 * M) / (80 * (o.paper === "A3" ? 1.414 : 1))))}}
/* lista */
.flow{flex:1 1 0!important;min-height:0;column-count:2;column-gap:1.8em;column-fill:auto;overflow:hidden}
.mm2{display:flex;justify-content:space-between;align-items:baseline;gap:.5em;border-bottom:.2mm solid #0a0a0a;margin:.7em 0 .25em;padding-bottom:.1em;break-after:avoid}
.mm2 b{font-size:1.15em;font-weight:800;text-transform:uppercase;letter-spacing:.06em}
.mm2 i{font-style:normal;font-size:.7em;color:#525252;font-weight:700}
.flow>.mm2:first-child{margin-top:0}
`;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(data.title)}</title><style>${css}</style></head><body>${pages}</body></html>`;
  return { html, pageW, pageH };
}

/* ----------------------------- Ajuste automático ----------------------------- */
export interface FitReport {
  pages: number;
  /** Compromissos que não couberam (só quando o mínimo de letra/quadrado ainda estoura a folha). */
  omitted: number;
}

/** Coluna nova no meio de um mês: repete o nome do mês no topo ("MARÇO (cont.)"), para não ficar compromisso solto. */
function markContinuations(ul: HTMLElement | null) {
  if (!ul) return;
  ul.querySelectorAll(".mm.cont").forEach((x) => x.remove());
  ul.querySelectorAll<HTMLElement>(".grp:not(.d)").forEach((g) => {
    const head = g.querySelector<HTMLElement>(".mm");
    if (!head) return;
    let lastX = head.getBoundingClientRect().left;
    g.querySelectorAll<HTMLElement>(".e").forEach((e) => {
      const x = e.getBoundingClientRect().left;
      if (x > lastX + 5) {
        const c = head.cloneNode(false) as HTMLElement;
        c.classList.add("cont");
        c.textContent = `${head.textContent} (cont.)`;
        e.before(c);
        lastX = x;
      }
    });
  });
}

const over = (el: HTMLElement) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;

/** Ajusta cada folha dentro do documento já carregado: encolhe/estica letras e quadradinhos até caber, e divide a lista em folhas. */
export function fitDocument(doc: Document): FitReport {
  let omitted = 0;
  // 1) Folhas com mini calendários: o ano todo numa folha.
  doc.querySelectorAll<HTMLElement>('.page[data-fit="grid"]').forEach((pg) => {
    const box = pg.querySelector<HTMLElement>(".in")!;
    const set = (ch: number, es: number) => {
      pg.style.setProperty("--chn", ch.toFixed(2));
      pg.style.setProperty("--es", es.toFixed(2));
    };
    const ulAll = box.querySelector<HTMLElement>(".evc");
    const bad = () => {
      markContinuations(ulAll);
      return over(box);
    };
    // Tamanhos do maior ao menor (t: 0 → 1): quadradinhos de 3,2 → 1,0 e letras de 1,25 → 0,72. Acha o maior que cabe.
    const lerp = (x: number, y: number, t: number) => x + (y - x) * t;
    const sizes = (t: number): [number, number] => (t <= 0.5 ? [lerp(3.2, 1.9, t * 2), lerp(1.25, 1, t * 2)] : [lerp(1.9, 1.0, (t - 0.5) * 2), lerp(1, 0.72, (t - 0.5) * 2)]);
    const apply = (t: number) => set(...sizes(t));
    apply(1);
    if (bad()) {
      // Nem no menor cabe: tira compromissos do fim (e avisa quantos).
      const items = [...box.querySelectorAll<HTMLElement>(".evc .e")];
      let n = 0;
      while (bad() && items.length) {
        items.pop()!.remove();
        n++;
      }
      if (n) {
        const ul = box.querySelector<HTMLElement>(".evc")!;
        const more = doc.createElement("li");
        more.className = "more";
        ul.appendChild(more);
        const note = () => (more.textContent = `+ ${n} compromisso(s) não couberam nesta folha`);
        note();
        while (bad() && ul.querySelectorAll(".e").length) {
          [...ul.querySelectorAll<HTMLElement>(".e")].pop()!.remove();
          n++;
          note();
        }
        [...ul.querySelectorAll<HTMLElement>(".grp")].forEach((g) => g.querySelector(".e") || g.remove());
        bad();
        omitted += n;
      }
    } else {
      let lo = 0;
      let hi = 1;
      apply(0);
      if (!bad()) hi = 0;
      else
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          apply(mid);
          if (bad()) lo = mid;
          else hi = mid;
        }
      apply(hi);
      bad();
    }
  });

  // 2) Um mês por folha: só a lista lateral se ajusta.
  doc.querySelectorAll<HTMLElement>('.page[data-fit="side"]').forEach((pg) => {
    const side = pg.querySelector<HTMLElement>(".side");
    const list = side?.querySelector<HTMLElement>(".evc");
    if (!side || !list) return;
    const bad = () => over(list) || over(side);
    let es = 1;
    while (bad() && es > 0.72) pg.style.setProperty("--es", (es -= 0.04).toFixed(2));
    const items = [...list.querySelectorAll<HTMLElement>(".e")];
    let n = 0;
    while (bad() && items.length) {
      items.pop()!.remove();
      n++;
    }
    if (!n) {
      // Sobrou lugar: letra maior na lista.
      while (es < 1.4) {
        pg.style.setProperty("--es", (es + 0.05).toFixed(2));
        if (bad()) {
          pg.style.setProperty("--es", es.toFixed(2));
          break;
        }
        es += 0.05;
      }
    }
    if (n) {
      const more = doc.createElement("li");
      more.className = "more";
      more.textContent = `+ ${n} compromisso(s) não couberam`;
      list.appendChild(more);
      omitted += n;
    }
  });

  // 3) Lista: reparte em quantas folhas precisar (cada mês começa junto do primeiro compromisso).
  doc.querySelectorAll<HTMLElement>('.page[data-fit="flow"]').forEach((first) => {
    const flow = first.querySelector<HTMLElement>(".flow")!;
    const blocks = [...flow.children] as HTMLElement[];
    // junta o título do mês com o primeiro compromisso para não ficar sozinho no fim da coluna
    const units: HTMLElement[][] = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.classList.contains("mm2") && blocks[i + 1]) {
        units.push([b, blocks[i + 1]]);
        i++;
      } else units.push([b]);
    }
    const template = first.cloneNode(true) as HTMLElement;
    template.querySelector<HTMLElement>(".flow")!.innerHTML = "";
    flow.innerHTML = "";
    let pg = first;
    let cur = flow;
    for (const u of units) {
      u.forEach((b) => cur.appendChild(b));
      if (over(cur) && cur.children.length > u.length) {
        u.forEach((b) => cur.removeChild(b));
        const next = template.cloneNode(true) as HTMLElement;
        pg.after(next);
        pg = next;
        cur = next.querySelector<HTMLElement>(".flow")!;
        u.forEach((b) => cur.appendChild(b));
      }
    }
  });

  return { pages: doc.querySelectorAll(".page").length, omitted };
}

