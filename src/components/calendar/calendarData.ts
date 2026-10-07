import type { CalendarBuilderData as CalendarData } from "../../lib/types";

import { pad2, uid } from "./dates";

/* ----------------------- Dados iniciais (semente) ------------------------ */
export const d = (m: number, day: number) => `2026-${pad2(m + 1)}-${pad2(day)}`;
export const SEED: CalendarData = {
  school: "Sua escola",
  title: "Calendário 2026",
  year: 2026,
  categories: [
    { id: "feriado", label: "Feriado", color: "#DC2626" },
    { id: "avaliacao", label: "Avaliação", color: "#2563EB" },
    { id: "pedagogico", label: "Pedagógico", color: "#7C3AED" },
    { id: "evento", label: "Evento & Cultura", color: "#16A34A" },
    { id: "recuperacao", label: "Recuperação Paralela", color: "#EA580C" },
    { id: "comemorativa", label: "Data comemorativa", color: "#DB2777" },
    { id: "marco", label: "Marco do período", color: "#0891B2" },
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

export function fmtStamp(iso: string | null, name: string | null) {
  if (!name && !iso) return null;
  const when = iso
    ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;
  if (name && when) return `Última edição por ${name} · ${when}`;
  if (name) return `Última edição por ${name}`;
  return when ? `Última edição em ${when}` : null;
}

/** Semente para um calendário novo: categorias padrão, sem eventos, no ano corrente. */
export function newSeed(title: string): CalendarData {
  return { ...SEED, title, year: new Date().getFullYear(), events: [], letivosByMonth: {}, notes: "" };
}


/** Abre no período em que a escola está hoje (ex.: 3º trimestre); fora do ano letivo, mostra o ano todo. */
export function initialView(d: CalendarData): string {
  const t = new Date();
  if (t.getFullYear() !== d.year) return "year";
  return d.periods.find((p) => p.startMonth <= t.getMonth() && t.getMonth() <= p.endMonth)?.id ?? "year";
}

