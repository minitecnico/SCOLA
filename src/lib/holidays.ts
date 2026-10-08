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
  const carnivalMonday = addDays(easter, -48);
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
    ...(year >= 2024 ? [[`${year}-11-20`, 'Dia da Consciência Negra']] : []),
  ];
  const movable = [
    [iso(carnivalMonday), 'Carnaval'],
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

/** Datas que muitas redes de ensino tratam como ponto facultativo/recesso, mas que não são feriado por lei
 *  (Dia do Professor, Dia do Servidor, Quarta de Cinzas…). Aparecem no calendário como aviso e NÃO tiram o dia letivo,
 *  a menos que a escola cadastre a data como feriado dela. */
export function commemorativeDates(year: number): CalendarHoliday[] {
  const ashWednesday = iso(addDays(easterDate(year), -46));
  return [
    [ashWednesday, 'Quarta-feira de Cinzas'],
    [`${year}-10-15`, 'Dia do Professor'],
    [`${year}-10-28`, 'Dia do Servidor Público'],
    [`${year}-12-24`, 'Véspera de Natal'],
    [`${year}-12-31`, 'Véspera de Ano Novo'],
  ].map(([date, title]) => ({ id: `optional-${date}`, title, date, scope: 'optional', source: 'Data comemorativa' }));
}

/** Une os feriados nacionais, os locais (estado/município) e as datas comemorativas. Se a data já é feriado,
 *  o item de menor peso é descartado (muitas cidades repetem Sexta-feira Santa, Corpus Christi etc. como municipal). */
export function mergeHolidays(national: CalendarHoliday[], local: CalendarHoliday[], optional: CalendarHoliday[] = []): CalendarHoliday[] {
  const nationalDates = new Set(national.map((h) => h.date));
  const localKept = local.filter((h) => !nationalDates.has(h.date));
  const taken = new Set([...nationalDates, ...localKept.map((h) => h.date)]);
  const optionalKept = optional.filter((h) => !taken.has(h.date));
  return [...national, ...localKept, ...optionalKept].sort((a, b) => a.date.localeCompare(b.date));
}

/** Datas em que NÃO há aula: nacionais, estaduais e municipais (pontos facultativos ficam de fora). */
export function offDays(holidays: CalendarHoliday[]): Set<string> {
  return new Set(holidays.filter((h) => h.scope !== 'optional').map((h) => h.date));
}

/** Texto curto do tipo de feriado: "Feriado nacional", "Feriado estadual · GO", "Feriado municipal · Goiânia". */
export function holidayKindLabel(h: CalendarHoliday): string {
  if (h.scope === 'optional') return 'Ponto facultativo · data comemorativa';
  if (h.scope === 'state') return `Feriado estadual${h.state ? ` · ${h.state}` : ''}`;
  if (h.scope === 'city') return `Feriado municipal${h.city ? ` · ${h.city.replace(/\s*[-–/,]\s*[A-Za-z]{2}$/, '')}` : ''}`;
  return 'Feriado nacional';
}
