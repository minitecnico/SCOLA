import { requireBase, requireRole, type Ctx } from '../auth';
import { all, fail, first, now, run, uid } from '../db';

/* Feriados estaduais e municipais da cidade da escola.
   Fonte: dados abertos "feriados-brasil" (GitHub, licença MIT) — 1 arquivo por ano e tipo.
   O arquivo municipal tem ~1,6 MB (5.570 cidades): para caber no limite de CPU do plano gratuito
   NÃO interpretamos o arquivo inteiro; procuramos só os registros da cidade no texto, e o resultado
   fica em cache no KV por 7 dias (1 gravação por cidade/ano). */
const RAW = 'https://raw.githubusercontent.com/joaopbini/feriados-brasil/master/dados/feriados';
const CACHE_DAYS = 7;
const GENERIC = /^feriado municipal$/i;

type Row = { data?: string; nome?: string; tipo?: string; uf?: string | null; codigo_ibge?: number | null };
export type LocalHoliday = {
  id: string; title: string; date: string; scope: 'state' | 'city'; state: string | null; city: string | null; source: string; generic?: boolean;
  /** Cadastrado pela escola (id da linha em school_holidays) — pode ser editado/removido. */
  custom?: string; yearly?: boolean;
};
export type LocalHolidays = {
  status: 'ok' | 'sem-cidade' | 'sem-dados';
  city: string | null;
  uf: string | null;
  year: number;
  holidays: LocalHoliday[];
};

const iso = (br: string | undefined, year: number) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br ?? '');
  return m && Number(m[3]) === year ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

async function fetchText(url: string): Promise<string | null> {
  const res = await fetch(url, { cf: { cacheTtl: 86_400, cacheEverything: true } });
  if (res.status === 404) return null; // ainda não há arquivo desse ano
  if (!res.ok) fail('Não foi possível consultar os feriados locais agora. Tente novamente em instantes.', 502);
  return res.text();
}

/** Registros de uma cidade sem interpretar o arquivo todo (cada registro termina em "codigo_ibge": N). */
function rowsOfCity(text: string, ibge: string): Row[] {
  const out: Row[] = [];
  const needle = `"codigo_ibge": ${ibge}\n`;
  if (!text.includes('"codigo_ibge": ')) {
    // formato diferente do esperado: interpreta o arquivo inteiro (mais pesado, mas correto)
    return (JSON.parse(text) as Row[]).filter((r) => String(r.codigo_ibge) === ibge);
  }
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
    const start = text.lastIndexOf('{', at);
    const end = text.indexOf('}', at);
    if (start < 0 || end < 0) continue;
    try {
      out.push(JSON.parse(text.slice(start, end + 1)) as Row);
    } catch {
      /* registro ilegível: ignora */
    }
  }
  return out;
}

/** Feriados estaduais e municipais da fonte aberta (cache no KV por cidade/ano). */
async function openDataHolidays(ctx: Ctx, y: number, uf: string, ibge: string, city: string | null) {
  const key = `h:${y}:${ibge}`;
  const hit = await ctx.env.FILES.get(key, 'json').catch(() => null);
  if (hit) return hit as { status: LocalHolidays['status']; holidays: LocalHoliday[] };

  const [estadual, municipal] = await Promise.all([fetchText(`${RAW}/estadual/json/${y}.json`), fetchText(`${RAW}/municipal/json/${y}.json`)]);
  const holidays: LocalHoliday[] = [];
  const seen = new Set<string>();
  const add = (h: LocalHoliday) => {
    const k = `${h.date}|${h.title.toLowerCase()}`;
    if (!seen.has(k)) {
      seen.add(k);
      holidays.push(h);
    }
  };
  if (estadual) {
    for (const r of JSON.parse(estadual) as Row[]) {
      const date = iso(r.data, y);
      if (date && r.uf === uf && r.nome) add({ id: `state-${date}-${r.nome}`, title: r.nome, date, scope: 'state', state: uf, city: null, source: 'feriados-brasil' });
    }
  }
  if (municipal) {
    for (const r of rowsOfCity(municipal, ibge)) {
      const date = iso(r.data, y);
      if (!date || !r.nome) continue;
      const generic = GENERIC.test(r.nome.trim());
      add({ id: `city-${date}-${r.nome}`, title: r.nome.trim(), date, scope: 'city', state: uf, city, source: 'feriados-brasil', generic });
    }
  }
  holidays.sort((a, c) => a.date.localeCompare(c.date));
  const result = { status: (estadual || municipal ? 'ok' : 'sem-dados') as LocalHolidays['status'], holidays };
  // Sem dados do ano: guarda por pouco tempo (a fonte pode publicar o ano novo a qualquer momento).
  await ctx.env.FILES.put(key, JSON.stringify(result), { expirationTtl: result.status === 'ok' ? CACHE_DAYS * 86_400 : 86_400 }).catch(() => null);
  return result;
}

type SchoolHolidayRow = { id: string; date: string; title: string; yearly: number };

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Os feriados da escola que caem no ano `y` (os anuais repetem a data; 29/02 só em ano bissexto). */
function schoolHolidaysOf(rows: SchoolHolidayRow[], y: number, uf: string | null, city: string | null): LocalHoliday[] {
  const out: LocalHoliday[] = [];
  for (const r of rows) {
    const md = r.date.slice(5);
    if (!r.yearly && Number(r.date.slice(0, 4)) !== y) continue;
    if (md === '02-29' && !isLeap(y)) continue;
    const date = `${y}-${md}`;
    out.push({ id: `school-${r.id}-${y}`, title: r.title, date, scope: 'city', state: uf, city, source: 'Cadastrado pela escola', custom: r.id, yearly: !!r.yearly });
  }
  return out;
}

export async function listLocalHolidays(ctx: Ctx, year: number): Promise<LocalHolidays> {
  const baseId = requireBase(ctx);
  const y = Math.floor(Number(year));
  if (!Number.isFinite(y) || y < 2010 || y > 2100) fail('Ano inválido.');
  const [b, mine] = await Promise.all([
    first<{ city: string | null; uf: string | null; ibge_code: string | null }>(ctx.db, 'SELECT city, uf, ibge_code FROM bases WHERE id = ?', baseId),
    all<SchoolHolidayRow>(ctx.db, 'SELECT id, date, title, yearly FROM school_holidays WHERE base_id = ?', baseId).catch(() => [] as SchoolHolidayRow[]),
  ]);
  const base = { city: b?.city ?? null, uf: b?.uf ?? null, year: y };
  const own = schoolHolidaysOf(mine, y, base.uf, base.city);

  const open = b?.ibge_code && b.uf ? await openDataHolidays(ctx, y, b.uf, b.ibge_code, b.city) : null;
  // O que a escola cadastrou manda: substitui o "Feriado municipal" sem nome da fonte na mesma data e não repete nomes iguais.
  const ownDates = new Set(own.map((h) => h.date));
  const ownKeys = new Set(own.map((h) => `${h.date}|${h.title.toLowerCase()}`));
  const fromSource = (open?.holidays ?? []).filter((h) => !(h.generic && ownDates.has(h.date)) && !ownKeys.has(`${h.date}|${h.title.toLowerCase()}`));
  const holidays = [...fromSource, ...own].sort((a, c) => a.date.localeCompare(c.date));
  const status: LocalHolidays['status'] = open ? open.status : own.length ? 'ok' : 'sem-cidade';
  return { ...base, status, holidays };
}

/* ------------------------- Feriados cadastrados pela escola ------------------------- */
const MANAGE = ['gestor', 'secretaria'] as const;

export async function listSchoolHolidays(ctx: Ctx) {
  const baseId = requireBase(ctx);
  const rows = await all<SchoolHolidayRow>(ctx.db, 'SELECT id, date, title, yearly FROM school_holidays WHERE base_id = ? ORDER BY substr(date, 6), date', baseId);
  return rows.map((r) => ({ id: r.id, date: r.date, title: r.title, yearly: !!r.yearly }));
}

export async function saveSchoolHoliday(ctx: Ctx, input: { id?: string; date: string; title: string; yearly?: boolean }) {
  const baseId = requireRole(ctx, ...MANAGE);
  const title = String(input.title ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!title) fail('Informe o nome do feriado.');
  const date = String(input.date ?? '');
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const valid = d && new Date(Date.UTC(+d[1], +d[2] - 1, +d[3])).toISOString().slice(0, 10) === date && +d[1] >= 2010 && +d[1] <= 2100;
  if (!valid) fail('Informe uma data válida.');
  const yearly = input.yearly === false ? 0 : 1;
  const dup = await first<{ id: string }>(ctx.db, 'SELECT id FROM school_holidays WHERE base_id = ? AND substr(date, 6) = substr(?, 6) AND lower(title) = lower(?) AND id <> ?', baseId, date, title, input.id ?? '');
  if (dup && yearly) fail('Esse feriado já está cadastrado.');
  if (input.id) {
    const res = await run(ctx.db, 'UPDATE school_holidays SET date = ?, title = ?, yearly = ? WHERE id = ? AND base_id = ?', date, title, yearly, input.id, baseId);
    if (!res.meta.changes) fail('Feriado não encontrado.', 404);
    return { id: input.id };
  }
  const id = uid();
  await run(ctx.db, 'INSERT INTO school_holidays (id, base_id, date, title, yearly, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, baseId, date, title, yearly, now());
  return { id };
}

export async function deleteSchoolHoliday(ctx: Ctx, id: string) {
  const baseId = requireRole(ctx, ...MANAGE);
  await run(ctx.db, 'DELETE FROM school_holidays WHERE id = ? AND base_id = ?', String(id), baseId);
  return { ok: true };
}
