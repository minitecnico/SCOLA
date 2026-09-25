/**
 * Dias letivos para o "Mapa de chamada" mensal.
 *
 * Escola não funciona sábado nem domingo — só conta segunda a sexta. Feriados
 * nacionais (recebidos como conjunto de datas "YYYY-MM-DD") também saem da conta.
 * Recessos/feriados municipais específicos não são detectáveis aqui; ficam de fora
 * dessa regra (o coordenador pode lançar falta/observação manualmente se precisar).
 */

const pad = (n: number) => String(n).padStart(2, '0');
export const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Constrói uma Date local a partir de "YYYY-MM-DD" sem cair em fuso (evita -1 dia). */
export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** É dia útil de escola? (segunda a sexta e não-feriado) */
export function isSchoolDay(iso: string, holidays?: Set<string>): boolean {
  const wd = parseISO(iso).getDay(); // 0=dom … 6=sáb
  if (wd === 0 || wd === 6) return false;
  if (holidays?.has(iso)) return false;
  return true;
}

/** Letra do dia da semana (pt-BR): D S T Q Q S S. */
const WD_LETTER = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
export function weekdayLetter(iso: string): string {
  return WD_LETTER[parseISO(iso).getDay()];
}

/** Todas as datas letivas (seg–sex, sem feriados) no intervalo [from, to] inclusivo. */
export function schoolDaysBetween(from: string, to: string, holidays?: Set<string>): string[] {
  const out: string[] = [];
  const start = parseISO(from);
  const end = parseISO(to);
  for (const cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
    const iso = isoOf(cur);
    if (isSchoolDay(iso, holidays)) out.push(iso);
  }
  return out;
}

/** Agrupa datas (ISO ordenadas) por mês "YYYY-MM", preservando a ordem. */
export function groupByMonth(dates: string[]): { key: string; year: number; month: number; days: string[] }[] {
  const map = new Map<string, string[]>();
  for (const d of dates) {
    const key = d.slice(0, 7);
    const arr = map.get(key) ?? [];
    arr.push(d);
    map.set(key, arr);
  }
  return [...map.entries()].map(([key, days]) => {
    const [year, month] = key.split('-').map(Number);
    return { key, year, month, days };
  });
}
