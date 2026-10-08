/**
 * Leitor de calendários escolares: transforma tabelas (planilha, Word, PDF, foto lida por OCR) e textos
 * em eventos (data, título, categoria). Puro (sem DOM), para rodar também em teste.
 *
 * Entende os jeitos comuns de escrever um calendário:
 *   - tabela Data | Evento | Categoria (com ou sem cabeçalho, data em qualquer formato);
 *   - lista por mês: um título "MARÇO" e, embaixo, "02 - Início das aulas", "10 a 14 - Semana de provas";
 *   - meses lado a lado (uma coluna ou par de colunas por mês);
 *   - datas completas no meio do texto: "Reunião de pais - 14 de março", "19 a 29/05", "1 a 4 de setembro";
 *   - listas de dias ("10, 11 e 12 de março") e intervalos que viram um evento só;
 *   - célula de calendário (dia + eventos na mesma célula).
 */

export type Grid = unknown[][];
export interface RawEvent {
  title: string;
  start: string; // aaaa-mm-dd
  end?: string;
  category?: string; // rótulo vindo da própria tabela
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;
const daysIn = (y: number, m0: number) => new Date(y, m0 + 1, 0).getDate();
const validDay = (y: number, m0: number, d: number) => m0 >= 0 && m0 <= 11 && d >= 1 && d <= daysIn(y, m0);

/** Minúsculas e sem acento, SEM mudar o tamanho do texto (índices continuam valendo no original). */
const fold = (s: string) => s.normalize('NFC').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const MONTH_NAMES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MONTH_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MONTH_ALT = [...MONTH_NAMES, ...MONTH_ABBR].join('|');
const monthIndex = (w: string) => {
  const f = fold(w).replace(/\.$/, '');
  const i = MONTH_NAMES.indexOf(f);
  return i >= 0 ? i : MONTH_ABBR.indexOf(f);
};

const RANGE = String.raw`(?:a|ate|ao|-|–|—)`;
const DAYS = String.raw`\d{1,2}(?:\s*(?:,|e|&)\s*\d{1,2})*(?:\s*${RANGE}\s*\d{1,2})?`;

/* ----------------------------- Data no texto ----------------------------- */
export interface DateHit {
  index: number;
  length: number;
  dates: { start: string; end?: string }[];
  /** Só o dia, com o mês vindo do título do mês ("02 - Início das aulas"). */
  dayOnly?: boolean;
}
interface Ctx {
  month: number | null;
  year: number;
}

/** "10", "10 a 14", "10 e 11", "10, 11 e 12" → períodos dentro de (ano, mês). */
function expandDays(expr: string, y: number, m0: number): { start: string; end?: string }[] | null {
  const f = fold(expr);
  const range = new RegExp(String.raw`^(\d{1,2})\s*${RANGE}\s*(\d{1,2})$`).exec(f.trim());
  if (range) {
    const [a, b] = [+range[1], +range[2]];
    if (!validDay(y, m0, a) || !validDay(y, m0, b) || b < a) return null;
    return [{ start: isoOf(y, m0, a), end: b > a ? isoOf(y, m0, b) : undefined }];
  }
  const days = f.split(/\s*(?:,|e|&)\s*/).map((x) => +x.trim());
  if (!days.length || days.some((d) => !Number.isInteger(d) || !validDay(y, m0, d))) return null;
  // Dias seguidos (10, 11 e 12) viram um período; os demais, eventos separados.
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length > 1 && sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1)) return [{ start: isoOf(y, m0, sorted[0]), end: isoOf(y, m0, sorted[sorted.length - 1]) }];
  return days.map((d) => ({ start: isoOf(y, m0, d) }));
}

const yr = (s: string | undefined, fallback: number) => (s ? (s.length === 2 ? 2000 + +s : +s) : fallback);

/** Primeira data do texto. `anchored`: só vale se estiver no começo (usado para decidir onde um evento termina). */
export function findDate(text: string, ctx: Ctx, anchored = false): DateHit | null {
  const s = text.normalize('NFC');
  const f = fold(s);
  const best: DateHit[] = [];
  const add = (m: RegExpExecArray, dates: DateHit['dates'] | null, dayOnly = false) => {
    if (dates?.length) best.push({ index: m.index, length: m[0].length, dates, dayOnly });
  };
  const run = (re: RegExp, make: (m: RegExpExecArray) => DateHit['dates'] | null, dayOnly = false) => {
    const g = new RegExp(re.source, 'g');
    for (let m = g.exec(f); m; m = g.exec(f)) {
      if (anchored && m.index > 0) break;
      const d = make(m);
      if (d?.length) {
        add(m, d, dayOnly);
        break;
      }
    }
  };

  // 2026-03-12
  run(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/, (m) => (validDay(+m[1], +m[2] - 1, +m[3]) ? [{ start: isoOf(+m[1], +m[2] - 1, +m[3]) }] : null));

  // 12/03[/2026] a 15/03[/2026]
  run(
    new RegExp(String.raw`(?<![\d/])(\d{1,2})/(\d{1,2})(?:/(\d{4}|\d{2}))?\s*${RANGE}\s*(\d{1,2})/(\d{1,2})(?:/(\d{4}|\d{2}))?(?![\d/])`),
    (m) => {
      const y1 = yr(m[3], ctx.year);
      const y2 = m[6] ? yr(m[6], y1) : +m[2] > +m[5] && !m[3] ? y1 + 1 : y1;
      if (!validDay(y1, +m[2] - 1, +m[1]) || !validDay(y2, +m[5] - 1, +m[4])) return null;
      const a = isoOf(y1, +m[2] - 1, +m[1]);
      const b = isoOf(y2, +m[5] - 1, +m[4]);
      return b > a ? [{ start: a, end: b }] : [{ start: a }];
    },
  );

  // 12/03, 12/03/2026, 10 e 11/03, 19 a 29/05/2026
  run(new RegExp(String.raw`(?<![\d/.])(${DAYS})\s*/\s*(\d{1,2})(?:/(\d{4}|\d{2}))?(?![\d/])`), (m) => {
    const y = yr(m[3], ctx.year);
    // "3/4 do tempo", "1/2 dia": fração, não data.
    if (/^\d$/.test(m[1]) && /^\d$/.test(m[2]) && !m[3] && /^\s*(?:do|da|dos|das|de|dia|dias|hora|horas|h)\b/.test(f.slice(m.index + m[0].length))) return null;
    return +m[2] >= 1 && +m[2] <= 12 ? expandDays(m[1], y, +m[2] - 1) : null;
  });
  // 12.03 (só no formato dd.mm, para não confundir com nota "7.5")
  run(/(?<![\d.])(\d{2})\.(\d{2})(?:\.(\d{4}))?(?![\d.])/, (m) => {
    const y = yr(m[3], ctx.year);
    return +m[2] >= 1 && +m[2] <= 12 && validDay(y, +m[2] - 1, +m[1]) ? [{ start: isoOf(y, +m[2] - 1, +m[1]) }] : null;
  });

  // 28 de março a 3 de abril
  run(
    new RegExp(String.raw`(?<!\d)(\d{1,2})\s*(?:de\s+)?(${MONTH_ALT})\b\.?(?:\s*(?:de\s+|/|,\s*)?(\d{4}))?\s*${RANGE}\s*(\d{1,2})\s*(?:de\s+)?(${MONTH_ALT})\b\.?(?:\s*(?:de\s+|/|,\s*)?(\d{4}))?`),
    (m) => {
      const [m1, m2] = [monthIndex(m[2]), monthIndex(m[5])];
      const y1 = yr(m[3], ctx.year);
      const y2 = m[6] ? yr(m[6], y1) : m2 < m1 && !m[3] ? y1 + 1 : y1;
      if (!validDay(y1, m1, +m[1]) || !validDay(y2, m2, +m[4])) return null;
      const a = isoOf(y1, m1, +m[1]);
      const b = isoOf(y2, m2, +m[4]);
      return b > a ? [{ start: a, end: b }] : [{ start: a }];
    },
  );
  // 12 de março [de 2026], 1 a 4 de setembro, 10, 11 e 12 de março, 5 mar
  run(new RegExp(String.raw`(?<![\d/])(${DAYS})[º°]?\s*(?:de\s+)?(${MONTH_ALT})\b\.?(?:\s*(?:de\s+|/|,\s*)?(\d{4}))?`), (m) => expandDays(m[1], yr(m[3], ctx.year), monthIndex(m[2])));

  // Só o dia ("02 - Início das aulas") — precisa do mês do título e vir no começo.
  if (ctx.month != null) {
    const re = new RegExp(String.raw`^\s*(?:dia\s+)?(${DAYS})(?=\s*$|\s*[-–—:|]|\s*\(|\s+(?:dom|seg|ter|qua|qui|sex|sab)\b)`);
    const m = re.exec(f);
    if (m) {
      const dates = expandDays(m[1], ctx.year, ctx.month);
      if (dates) best.push({ index: 0, length: m[0].length, dates, dayOnly: true });
    }
  }

  if (!best.length) return null;
  best.sort((a, b) => a.index - b.index || b.length - a.length);
  const hit = best[0];
  return anchored && hit.index > 0 ? null : hit;
}

/* ------------------------------ Títulos de mês ------------------------------ */
export function monthHeading(text: string): { month: number; year?: number } | null {
  const f = fold(text).replace(/\s+/g, ' ').trim();
  if (!f || f.length > 48) return null;
  const m = new RegExp(String.raw`^(?:(?:mes|periodo)\s*(?:de|:)?\s*)?(?:\d{1,2}\s*[-–./]\s*)?(${MONTH_ALT})\b\.?(.*)$`).exec(f);
  if (!m) return null;
  // Depois do mês só pode haver ano e "dias letivos" (senão é uma frase: "março é o mês das…").
  const rest = m[2].replace(/^[\s\-–—:/.,()]*/, '');
  const ok = /^(?:(?:de\s+)?(\d{4}))?[\s\-–—:/.,()]*(?:\d{1,3}\s*dias?(?:\s*(?:letivos?|uteis?))?)?[\s\-–—:/.,()]*$/.exec(rest);
  if (!ok) return null;
  return { month: monthIndex(m[1]), year: ok[1] ? +ok[1] : undefined };
}

/* ------------------------------ Categoria ------------------------------ */
const NATIONAL = /^(?:feriado[:\s-]*)?(?:confraternizacao universal|ano novo|(?:segunda-feira de |terca-feira de )?carnaval|quarta-feira de cinzas|sexta-feira santa|sexta-feira da paixao|paixao de cristo|tiradentes|dia do trabalho|dia do trabalhador|corpus christi|independencia(?: do brasil)?|nossa senhora aparecida|dia de finados|finados|proclamacao da republica|dia da consciencia negra|consciencia negra|natal)\b/;

/** Adivinha o rótulo da categoria pelas palavras do título. */
export function guessCategory(text: string): string {
  const s = fold(text);
  if (NATIONAL.test(s) || /\b(feriados?|recessos?|ferias|ponto facultativo|nao havera aula|sem aula)\b/.test(s)) return 'Feriado';
  if (/(prova|avalia|simulado|e-?cerm|exame|teste|redac|sondagem|prova brasil|saeb|enem)/.test(s)) return 'Avaliação';
  if (/(recupera|paralela|\bdependencia|reforco)/.test(s)) return 'Recuperação Paralela';
  if (/(reuni|pedag|plantao|encontro|conselho|formac|planejamento|jornada|capacitac|coordenac)/.test(s)) return 'Pedagógico';
  if (/(ginc|jogos|festa|arrai|cultur|oficina|culmin|aula de campo|passeio|semin|(?<![-\w])feira\b|exposic|apresentac|formatura|olimpiada|campeonato|torneio)/.test(s)) return 'Evento & Cultura';
  if (/(dia d|dia n|anivers|comemora|natal|pascoa|maes|pais\b|professor|criança|estudante|consciencia|independencia|tiradentes|trabalhador|folclore)/.test(s)) return 'Data comemorativa';
  if (/(inicio|termino|encerr|abertura|trimestre|bimestre|semestre|unidade|matricula|rematricula|boletim|resultado|divulgac|retorno|volta as aulas)/.test(s)) return 'Marco do período';
  return 'Evento';
}

/* ------------------------------ Limpeza de título ------------------------------ */
const WEEKDAY = String.raw`(?:domingo|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|dom|seg|ter|qua|qui|sex|s[aá]b)(?:-feira)?\.?`;
const HEADER_WORDS = new Set(['data', 'datas', 'dia', 'dias', 'evento', 'eventos', 'atividade', 'atividades', 'categoria', 'tipo', 'descricao', 'observacao', 'observacoes', 'obs', 'mes', 'titulo', 'calendario', 'legenda', 'ate', 'fim', 'inicio', 'total', 'dias letivos', 'letivos']);

export function cleanTitle(raw: string): string {
  let t = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  // dia da semana solto no começo: "(seg) ", "segunda-feira - "
  t = t.replace(new RegExp(String.raw`^\(\s*${WEEKDAY}\s*\)\s*`, 'iu'), '');
  t = t.replace(new RegExp(String.raw`^${WEEKDAY}(?:\s+[-–—]\s+|\s*[:,]\s*)`, 'iu'), '');
  t = t.replace(new RegExp(String.raw`\s*\(\s*${WEEKDAY}\s*\)\s*$`, 'iu'), '');
  t = t.replace(/^[\s\-–—:•·.,;|()\[\]*_]+|[\s\-–—:•·.,;|(\[*_]+$/g, '').trim();
  return t.slice(0, 120);
}

const hasLetters = (t: string, n = 3) => (t.match(/\p{L}/gu) ?? []).length >= n;
function goodTitle(t: string) {
  if (!hasLetters(t)) return false;
  if (HEADER_WORDS.has(fold(t).replace(/[:.]/g, '').trim())) return false;
  if (new RegExp(String.raw`^(?:${WEEKDAY}[\s,;/-]*)+$`, 'iu').test(t)) return false;
  return true;
}

/* ------------------------------ Células ------------------------------ */
/** Célula → texto. Data do Excel vira aaaa-mm-dd; número de série de data idem. */
export function cellText(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    const d = new Date(v.getTime() + 12 * 3600_000); // folga de fuso: data do Excel vem a poucos minutos de meia-noite
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  if (typeof v === 'number') {
    if (Number.isInteger(v) && v >= 36526 && v <= 73050) {
      const d = new Date(Math.round((v - 25569) * 86400_000) + 12 * 3600_000);
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
    return String(v);
  }
  return String(v).normalize('NFC').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

/* ------------------------------ Cabeçalho de tabela ------------------------------ */
interface Cols {
  date?: number;
  end?: number;
  title?: number;
  desc?: number;
  cat?: number;
  row: number;
}
function detectHeader(rows: string[][]): Cols | null {
  for (let r = 0; r < Math.min(rows.length, 8); r++) {
    const cols: Cols = { row: r };
    rows[r].forEach((c, i) => {
      const f = fold(c).replace(/[:.]/g, '').trim();
      if (!f || f.length > 24) return;
      if (/^(data|dia|inicio|date)\b/.test(f) && cols.date == null) cols.date = i;
      else if (/^(ate|fim|termino|data final|data fim|end)\b/.test(f) && cols.end == null) cols.end = i;
      else if (/^(titulo|evento|nome|atividade|title|assunto|acontecimento)\b/.test(f) && cols.title == null) cols.title = i;
      else if (/^(descri|detalhe|obs)/.test(f) && cols.desc == null) cols.desc = i;
      else if (/^(categoria|tipo|category)\b/.test(f) && cols.cat == null) cols.cat = i;
    });
    if (cols.date != null && (cols.title != null || cols.desc != null)) return cols;
  }
  return null;
}

/* ------------------------------ Seções ("Feriados:") ------------------------------ */
function sectionCategory(text: string): string | null {
  const f = fold(text).trim();
  if (f.length > 45 || /\d/.test(f)) return null;
  if (!/^(feriados?|recessos?|ferias|datas? comemorativas?|avaliac\w+|provas?|reunio\w+|recuperac\w+|eventos?|atividades?)\b[\s\w&/-]*:?$/.test(f)) return null;
  return guessCategory(text);
}

/* ============================== Grade → eventos ============================== */
export function eventsFromGrid(grid: Grid, opts: { year: number; month?: number | null; name?: string }): RawEvent[] {
  const rows = grid.map((r) => (Array.isArray(r) ? r.map(cellText) : []));
  const out: RawEvent[] = [];
  const header = detectHeader(rows);
  let year = opts.year;
  let rowMonth: number | null = opts.month ?? null;
  let heads: { col: number; month: number }[] = [];
  let sectionCat: string | null = null;
  // Datas que ficaram sem título: o texto está na linha de baixo, na mesma coluna.
  let pending = new Map<number, DateHit['dates']>();

  // O nome da aba pode ser o mês ("Março").
  const sheet = opts.name ? monthHeading(opts.name) : null;
  if (sheet && rowMonth == null) {
    rowMonth = sheet.month;
    if (sheet.year) year = sheet.year;
  }

  const monthAt = (col: number): number | null => {
    let m: number | null = null;
    for (const h of heads) if (h.col <= col) m = h.month;
    return m ?? rowMonth;
  };
  const ctxAt = (col: number): Ctx => ({ month: monthAt(col), year });
  /** A célula (a primeira linha dela) começa com uma data? */
  const startsWithDate = (text: string, col: number) => !!findDate(text.split('\n')[0], ctxAt(col), true);

  const push = (dates: DateHit['dates'], title: string, category?: string) => {
    const t = cleanTitle(title);
    if (!goodTitle(t)) return false;
    for (const d of dates) out.push({ title: t, start: d.start, end: d.end, category: category || sectionCategoryFor(t) });
    return true;
  };
  const sectionCategoryFor = (t: string) => (sectionCat && guessCategory(t) === 'Evento' ? sectionCat : undefined);

  const handleCell = (text: string, col: number, rowCells: string[], used: Set<number>): void => {
    const ctx = ctxAt(col);
    const hit = findDate(text, ctx);
    if (!hit) return;
    const before = text.slice(0, hit.index).replace(/(?:^|\s)(?:no dia|do dia|dia|em|at[eé]|a partir d[eo]|desde|de|da|do|dos|das|no|na|entre|para|dia)\s*$/iu, '');
    const after = text.slice(hit.index + hit.length);
    let title = `${before} ${after}`;
    // Título nas células seguintes da mesma linha, até a próxima data.
    if (!goodTitle(cleanTitle(title))) {
      const extra: string[] = [];
      for (let j = col + 1; j < rowCells.length; j++) {
        if (!rowCells[j]) continue;
        if (startsWithDate(rowCells[j], j)) break;
        extra.push(rowCells[j]);
        used.add(j);
      }
      title = `${title} ${extra.join(' ')}`;
    }
    // Ainda sem título e a data é explícita (tem mês): vale o texto à esquerda ("Reunião | 12/03").
    if (!goodTitle(cleanTitle(title)) && !hit.dayOnly) {
      const left = rowCells.slice(0, col).filter((c, j) => c && !used.has(j) && !startsWithDate(c, j));
      title = left.join(' ');
    }
    if (push(hit.dates, title)) return;
    pending.set(col, hit.dates);
  };

  const processText = (text: string, col: number, rowCells: string[], used: Set<number>) => {
    if (text.includes('\n')) {
      // Célula com várias linhas (dia + eventos, ou lista de eventos). Linha só com o dia vale para as seguintes.
      let cur: DateHit['dates'] | null = null;
      for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
        const hit = findDate(line, ctxAt(col));
        if (hit) {
          const rest = `${line.slice(0, hit.index)} ${line.slice(hit.index + hit.length)}`;
          if (!push(hit.dates, rest)) cur = hit.dates;
          else cur = hit.dayOnly ? hit.dates : null;
        } else if (cur && hasLetters(line)) push(cur, line);
      }
      return;
    }
    handleCell(text, col, rowCells, used);
  };

  for (let r = header ? header.row + 1 : 0; r < rows.length; r++) {
    const cells = rows[r];
    const filled = cells.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
    if (!filled.length) continue;

    // Título que ficou para esta linha (a data estava na linha de cima, mesma coluna).
    const taken = new Set<number>();
    if (pending.size) {
      const waiting = pending;
      pending = new Map();
      for (const i of filled) {
        const dates = waiting.get(i);
        if (dates && !startsWithDate(cells[i], i) && hasLetters(cells[i]) && push(dates, cells[i])) taken.add(i);
      }
      if (!taken.size && waiting.size === 1 && filled.length === 1 && !startsWithDate(cells[filled[0]], filled[0]) && hasLetters(cells[filled[0]])) {
        if (push([...waiting.values()][0], cells[filled[0]])) continue;
      }
      if (taken.size && taken.size === filled.length) continue;
    }

    // Título de mês (uma ou várias colunas).
    const mh = filled.map((i) => ({ col: i, h: monthHeading(cells[i]) }));
    if (!taken.size && mh.every((x) => x.h)) {
      pending = new Map();
      sectionCat = null;
      if (mh.length === 1) {
        rowMonth = mh[0].h!.month;
        heads = [];
      } else heads = mh.map((x) => ({ col: x.col, month: x.h!.month }));
      const y = mh.find((x) => x.h!.year)?.h!.year;
      if (y) year = y;
      continue;
    }

    // Uma linha só com "Feriados:" / "Avaliações" muda a categoria padrão dos próximos.
    if (!taken.size && filled.length === 1 && !startsWithDate(cells[filled[0]], filled[0])) {
      const sc = sectionCategory(cells[filled[0]]);
      if (sc) {
        sectionCat = sc;
        continue;
      }
    }

    // Tabela com cabeçalho: colunas conhecidas.
    if (header && header.date != null) {
      const dateText = cells[header.date];
      const hit = dateText ? findDate(dateText, ctxAt(header.date)) : null;
      if (hit) {
        const title = (header.title != null ? cells[header.title] : '') || (header.desc != null ? cells[header.desc] : '') || dateText.slice(0, hit.index) + dateText.slice(hit.index + hit.length);
        const endHit = header.end != null && cells[header.end] ? findDate(cells[header.end], ctxAt(header.end)) : null;
        const dates = endHit && hit.dates.length === 1 && endHit.dates[0].start >= hit.dates[0].start ? [{ start: hit.dates[0].start, end: endHit.dates[0].start }] : hit.dates;
        const cat = header.cat != null ? cells[header.cat] : undefined;
        if (push(dates, title, cat)) continue;
      }
    }

    const used = new Set<number>(taken);
    for (const i of filled) {
      if (used.has(i)) continue;
      processText(cells[i], i, cells, used);
    }
  }
  return out;
}

/** Lê várias tabelas (abas/páginas) e junta, sem repetir. */
export function eventsFromGrids(sheets: { name: string; grid: Grid }[], year: number): RawEvent[] {
  const seen = new Set<string>();
  const out: RawEvent[] = [];
  for (const s of sheets) {
    for (const e of eventsFromGrid(s.grid, { year, name: s.name })) {
      const k = `${e.start}|${e.end ?? ''}|${fold(e.title)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(e);
    }
  }
  return out;
}

/** Texto corrido (uma linha por linha do documento) → eventos. */
export function eventsFromText(text: string, year: number): RawEvent[] {
  return eventsFromGrids([{ name: '', grid: text.split(/\r?\n/).map((l) => [l]) }], year);
}

/** Texto de uma grade (para mandar à IA quando a leitura direta não bastou). */
export function gridsToText(sheets: { name: string; grid: Grid }[], maxChars = 24_000): string {
  const lines: string[] = [];
  for (const s of sheets) {
    if (s.name && sheets.length > 1) lines.push(`## ${s.name}`);
    for (const row of s.grid) {
      const cells = (Array.isArray(row) ? row : []).map(cellText).filter(Boolean);
      if (cells.length) lines.push(cells.join(' | '));
    }
  }
  return lines.join('\n').slice(0, maxChars);
}
