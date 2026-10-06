import { requireBase, type Ctx } from '../auth';
import { first, fail } from '../db';

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
  id: string; title: string; date: string; scope: 'state' | 'city'; state: string; city: string | null; source: string; generic?: boolean;
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

export async function listLocalHolidays(ctx: Ctx, year: number): Promise<LocalHolidays> {
  const baseId = requireBase(ctx);
  const y = Math.floor(Number(year));
  if (!Number.isFinite(y) || y < 2010 || y > 2100) fail('Ano inválido.');
  const b = await first<{ city: string | null; uf: string | null; ibge_code: string | null }>(ctx.db, 'SELECT city, uf, ibge_code FROM bases WHERE id = ?', baseId);
  if (!b?.ibge_code || !b.uf) return { status: 'sem-cidade', city: b?.city ?? null, uf: b?.uf ?? null, year: y, holidays: [] };

  const key = `h:${y}:${b.ibge_code}`;
  const hit = await ctx.env.FILES.get(key, 'json').catch(() => null);
  const base = { city: b.city, uf: b.uf, year: y };
  if (hit) return { ...base, ...(hit as Pick<LocalHolidays, 'status' | 'holidays'>) };

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
      if (date && r.uf === b.uf && r.nome) add({ id: `state-${date}-${r.nome}`, title: r.nome, date, scope: 'state', state: b.uf, city: null, source: 'feriados-brasil' });
    }
  }
  if (municipal) {
    for (const r of rowsOfCity(municipal, b.ibge_code)) {
      const date = iso(r.data, y);
      if (!date || !r.nome) continue;
      const generic = GENERIC.test(r.nome.trim());
      add({ id: `city-${date}-${r.nome}`, title: r.nome.trim(), date, scope: 'city', state: b.uf, city: b.city, source: 'feriados-brasil', generic });
    }
  }
  holidays.sort((a, c) => a.date.localeCompare(c.date));
  const result = { status: (estadual || municipal ? 'ok' : 'sem-dados') as LocalHolidays['status'], holidays };
  // Sem dados do ano: guarda por pouco tempo (a fonte pode publicar o ano novo a qualquer momento).
  await ctx.env.FILES.put(key, JSON.stringify(result), { expirationTtl: result.status === 'ok' ? CACHE_DAYS * 86_400 : 86_400 }).catch(() => null);
  return { ...base, ...result };
}
