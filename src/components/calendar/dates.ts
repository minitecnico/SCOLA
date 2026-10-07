import type { CalBuilderEvent as CalEvent } from "../../lib/types";

import { d } from "./calendarData";

export const MONTHS_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
export const DOW = ["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"]; // semana inicia na segunda
export const WEEKDAY = ["dom","seg","ter","qua","qui","sex","sáb"]; // índice de Date.getDay()
export const uid = () => Math.random().toString(36).slice(2, 9);
export const pad2 = (n: number) => String(n).padStart(2, "0");
export const isoOf = (y: number, m: number, d: number) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
export const todayISO = () => {
  const t = new Date();
  return isoOf(t.getFullYear(), t.getMonth(), t.getDate());
};
export function parseISO(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
/** "hoje", "amanhã", "em 12 dias · 18/10" — quanto falta para um compromisso. */
export function whenLabel(today: string, start: string, end: string) {
  const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  if (start <= today && today <= end) return start === end ? "hoje" : `em andamento · até ${br(end)}`;
  const diff = Math.round((parseISO(start).getTime() - parseISO(today).getTime()) / 86400000);
  return diff === 1 ? `amanhã · ${br(start)}` : `em ${diff} dias · ${br(start)}`;
}
/** Lista de {y,m,d} cobertos por um evento (intervalo inclusivo). */
export function eventDays(ev: CalEvent) {
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
export function daysInMonthFor(ev: CalEvent, year: number, month: number) {
  return eventDays(ev).filter((x) => x.y === year && x.m === month).map((x) => x.d).sort((a, b) => a - b);
}
export function chipLabel(days: number[]) {
  if (days.length === 0) return "";
  if (days.length === 1) return pad2(days[0]);
  return `${pad2(days[0])}–${pad2(days[days.length - 1])}`;
}

