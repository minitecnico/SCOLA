import type { CalendarHoliday } from './types';

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

type BrasilApiHoliday = {
  date: string;
  name: string;
  type: string;
};

export async function listNationalHolidays(year: number): Promise<CalendarHoliday[]> {
  try {
    const res = await fetch(`https://brasilapi.com.br/api/feriados/v1/${year}`);
    if (!res.ok) throw new Error('Falha ao buscar feriados nacionais');
    const rows = (await res.json()) as BrasilApiHoliday[];
    return rows.map((row) => ({
      id: `national-${row.date}-${row.name}`,
      title: row.name,
      date: row.date,
      scope: 'national',
      source: 'BrasilAPI',
    }));
  } catch {
    return fallbackNationalHolidays(year);
  }
}

function fallbackNationalHolidays(year: number): CalendarHoliday[] {
  const easter = easterDate(year);
  const goodFriday = addDays(easter, -2);
  const carnival = addDays(easter, -47);
  const corpusChristi = addDays(easter, 60);
  const fixed = [
    [`${year}-01-01`, 'Confraternização Universal'],
    [`${year}-04-21`, 'Tiradentes'],
    [`${year}-05-01`, 'Dia do Trabalho'],
    [`${year}-09-07`, 'Independência do Brasil'],
    [`${year}-10-12`, 'Nossa Senhora Aparecida'],
    [`${year}-11-02`, 'Finados'],
    [`${year}-11-15`, 'Proclamação da República'],
    [`${year}-12-25`, 'Natal'],
  ];
  const movable = [
    [iso(carnival), 'Carnaval'],
    [iso(goodFriday), 'Sexta-feira Santa'],
    [iso(corpusChristi), 'Corpus Christi'],
  ];
  return [...fixed, ...movable]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, title]) => ({
      id: `national-${date}-${title}`,
      title,
      date,
      scope: 'national',
      source: 'Fallback interno',
    }));
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function easterDate(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}
