/**
 * Importação de chamadas já feitas (planilha de outro sistema).
 * Entende dois formatos, detectados sozinhos:
 *   - "Mapa": uma linha por aluno e uma coluna por data (P, F, •, 1, 0…).
 *   - "Lista": uma linha por marcação, com colunas Data, Aluno e Situação (Turma opcional).
 * Os símbolos não são adivinhados às cegas: cada valor encontrado aparece para o
 * professor confirmar o significado (ex.: "X" é presença ou falta?).
 */
import type { AttendanceStatus } from './types';
import { assertImportRowLimit, assertSpreadsheetFile } from './fileSecurity';

export type Mapped = AttendanceStatus | 'ignore';
export interface RawEntry {
  row: number; // linha na planilha (1-based)
  name: string;
  turma: string | null;
  date: string; // yyyy-mm-dd
  value: string; // valor original normalizado (maiúsculas, sem espaços extras); '' = vazio
}
export interface ParsedAttendance {
  format: 'mapa' | 'lista';
  entries: RawEntry[];
  names: string[];
  turmas: string[];
  dates: string[];
  values: { value: string; count: number }[];
  warnings: string[];
}

export const normName = (s: string) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normHeader = (s: unknown) => normName(String(s ?? ''));
const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
};
const MESES: Record<string, number> = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };

/** Data de célula: Date, número serial do Excel, "dd/mm/aaaa", "dd/mm", "aaaa-mm-dd", "10/mar", "seg 10/03"… */
export function parseDateCell(v: unknown, yearHint: number): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    // O xlsx cria a data no fuso local à meia-noite: usa os campos locais.
    return isoOf(v.getFullYear(), v.getMonth() + 1, v.getDate());
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const ms = Math.round((v - 25569) * 86400_000);
    const d = new Date(ms);
    return isoOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return isoOf(+m[1], +m[2], +m[3]);
  m = /(?:^|\D)(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?(?:\D|$)/.exec(s);
  if (m) {
    let y = m[3] ? +m[3] : yearHint;
    if (y < 100) y += 2000;
    return isoOf(y, +m[2], +m[1]);
  }
  m = /(?:^|\D)(\d{1,2})\s*(?:de\s*)?[/.-]?\s*(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\.?(?:\s*(?:de\s*)?[/.-]?\s*(\d{2,4}))?/.exec(s.normalize('NFD').replace(/\p{Diacritic}/gu, ''));
  if (m) {
    let y = m[3] ? +m[3] : yearHint;
    if (y < 100) y += 2000;
    return isoOf(y, MESES[m[2]], +m[1]);
  }
  return null;
}

/** Sugestão de significado para cada valor da planilha. `undefined` = o professor decide. */
export function suggestStatus(value: string): Mapped | undefined {
  const v = normName(value).replace(/\s/g, '');
  const raw = value.trim();
  if (!raw) return 'ignore';
  if (['•', '·', '.', '✓', '✔', '☑'].includes(raw)) return 'present';
  if (['p', 'pres', 'presente', 'presenca', 'c', 'compareceu', '1', 'ok', 'sim', 's', 'v', 'true'].includes(v)) return 'present';
  if (['f', 'falta', 'faltou', 'a', 'ausente', 'aus', '0', 'n', 'nao', 'false', '✗', '✘'].includes(v) || raw === '✗' || raw === '✘') return 'absent';
  if (['at', 'atr', 'atraso', 'atrasado', 'atrasada', 'l', 'late', 'tarde'].includes(v)) return 'late';
  if (['fj', 'j', 'jus', 'just', 'justificada', 'justificado', 'faltajustificada', 'abonada', 'abonado', 'ab', 'atestado', 'at med', 'atm'].includes(v)) return 'justified';
  return undefined;
}

/** Mês/ano escrito num título: "Março/2025", "MARÇO 2025", "03/2025". */
function monthOf(text: string, yearHint: number): { y: number; m: number } | null {
  const t = text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  let m = /\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\b\.?\s*(?:de\s*)?[/\-]?\s*(\d{4})?/.exec(t);
  if (m) return { y: m[2] ? +m[2] : yearHint, m: MESES[m[1].slice(0, 3)] };
  m = /\b(0?[1-9]|1[0-2])\s*\/\s*(20\d{2})\b/.exec(t);
  if (m) return { y: +m[2], m: +m[1] };
  return null;
}

const NAME_HEADERS = ['aluno', 'aluna', 'nome', 'nome do aluno', 'nome completo', 'estudante', 'aluno a', 'alunos'];
const DATE_HEADERS = ['data', 'dia', 'data da aula', 'data da chamada', 'data aula'];
const STATUS_HEADERS = ['situacao', 'status', 'presenca', 'frequencia', 'falta', 'faltas', 'marcacao', 'registro', 'presente', 'p f'];
const TURMA_HEADERS = ['turma', 'classe', 'serie', 'sala'];

const cellText = (v: unknown) => (v instanceof Date ? '' : String(v ?? '').replace(/\s+/g, ' ').trim());

export async function parseAttendanceFile(file: File, yearHint = new Date().getFullYear()): Promise<ParsedAttendance> {
  assertSpreadsheetFile(file);
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  let wb;
  if (/\.csv$/i.test(file.name)) {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      text = new TextDecoder('windows-1252').decode(buffer);
    }
    wb = XLSX.read(text.replace(/^﻿/, ''), { type: 'string', raw: true });
  } else {
    wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  }

  // Todas as abas (muitos sistemas exportam um mês por aba).
  const sheets: unknown[][][] = wb.SheetNames.map((n) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, defval: '', raw: true, blankrows: true }));
  assertImportRowLimit(sheets.reduce((a, g) => a + g.length, 0));

  const entries: RawEntry[] = [];
  const warnings: string[] = [];
  let format: 'mapa' | 'lista' | null = null;

  for (const [si, grid] of sheets.entries()) {
    const sheetName = wb.SheetNames[si];
    // Formato lista: cabeçalho com Data + Aluno + Situação.
    const listHdr = grid.slice(0, 15).findIndex((r) => {
      const h = r.map(normHeader);
      return h.some((x) => DATE_HEADERS.includes(x)) && h.some((x) => NAME_HEADERS.includes(x)) && h.some((x) => STATUS_HEADERS.includes(x));
    });
    if (listHdr >= 0) {
      format ??= 'lista';
      const h = grid[listHdr].map(normHeader);
      const ci = {
        date: h.findIndex((x) => DATE_HEADERS.includes(x)),
        name: h.findIndex((x) => NAME_HEADERS.includes(x)),
        status: h.findIndex((x) => STATUS_HEADERS.includes(x)),
        turma: h.findIndex((x) => TURMA_HEADERS.includes(x)),
      };
      grid.slice(listHdr + 1).forEach((r, i) => {
        const name = cellText(r[ci.name]);
        if (!name) return;
        const date = parseDateCell(r[ci.date], yearHint);
        if (!date) {
          if (String(r[ci.date] ?? '').trim()) warnings.push(`${sheetName}, linha ${listHdr + i + 2}: data "${String(r[ci.date])}" não reconhecida`);
          return;
        }
        entries.push({ row: listHdr + i + 2, name, turma: ci.turma >= 0 ? cellText(r[ci.turma]) || null : null, date, value: cellText(r[ci.status]).toUpperCase() });
      });
      continue;
    }

    // Formato mapa: linha de cabeçalho com 2+ datas.
    let hdr = -1;
    let dateCols: { col: number; date: string }[] = [];
    for (let i = 0; i < Math.min(grid.length, 25); i++) {
      const dc = grid[i].map((c, col) => ({ col, date: parseDateCell(c, yearHint) })).filter((x): x is { col: number; date: string } => !!x.date);
      if (dc.length >= 2 && dc.length > dateCols.length) {
        hdr = i;
        dateCols = dc;
      }
    }
    // Só o dia (1, 2, 3…) nas colunas, com o mês no título ou no nome da aba ("Março/2025").
    if (hdr < 0) {
      const month = monthOf([sheetName, ...grid.slice(0, 10).flat().map(cellText)].join(' '), yearHint);
      if (month) {
        for (let i = 0; i < Math.min(grid.length, 25); i++) {
          const dc = grid[i]
            .map((c, col) => ({ col, d: /^\d{1,2}$/.test(cellText(c)) || (typeof c === 'number' && c >= 1 && c <= 31) ? Number(c) : NaN }))
            .filter((x) => x.d >= 1 && x.d <= 31)
            .map((x) => ({ col: x.col, date: isoOf(month.y, month.m, x.d) }))
            .filter((x): x is { col: number; date: string } => !!x.date);
          if (dc.length >= 5 && dc.length > dateCols.length) {
            hdr = i;
            dateCols = dc;
          }
        }
      }
    }
    if (hdr < 0) continue;
    format ??= 'mapa';
    // Coluna de nomes: cabeçalho "Aluno/Nome"; senão, a coluna antes das datas com mais textos.
    const h = grid[hdr].map(normHeader);
    let nameCol = h.findIndex((x) => NAME_HEADERS.includes(x));
    const turmaCol = h.findIndex((x) => TURMA_HEADERS.includes(x));
    const firstDate = Math.min(...dateCols.map((d) => d.col));
    if (nameCol < 0) {
      let best = -1;
      for (let c = 0; c < firstDate; c++) {
        const n = grid.slice(hdr + 1).filter((r) => /[a-zA-ZÀ-ú]{2,}\s+[a-zA-ZÀ-ú]{2,}/.test(cellText(r[c]))).length;
        if (n > best) {
          best = n;
          nameCol = c;
        }
      }
    }
    if (nameCol < 0) continue;
    grid.slice(hdr + 1).forEach((r, i) => {
      const name = cellText(r[nameCol]);
      if (!name || /^(total|presen|falt|legenda|obs)/i.test(normName(name))) return;
      for (const { col, date } of dateCols) {
        entries.push({ row: hdr + i + 2, name, turma: turmaCol >= 0 ? cellText(r[turmaCol]) || null : null, date, value: cellText(r[col]).toUpperCase() });
      }
    });
  }

  if (!format) throw new Error('Não encontrei chamadas nesta planilha. Use uma linha por aluno com as datas nas colunas, ou colunas Data, Aluno e Situação.');

  // No mapa, data sem nenhuma marcação (coluna toda vazia) não é aula: descarta.
  const marked = new Set(entries.filter((e) => e.value).map((e) => e.date));
  const kept = entries.filter((e) => marked.has(e.date));
  const count = new Map<string, number>();
  kept.forEach((e) => count.set(e.value, (count.get(e.value) ?? 0) + 1));

  return {
    format,
    entries: kept,
    names: [...new Set(kept.map((e) => e.name))],
    turmas: [...new Set(kept.map((e) => e.turma).filter((t): t is string => !!t))],
    dates: [...marked].sort(),
    values: [...count.entries()].map(([value, c]) => ({ value, count: c })).sort((a, b) => b.count - a.count),
    warnings: warnings.slice(0, 20),
  };
}

/**
 * Casa o nome da planilha com um aluno da turma: igual (sem acento/maiúscula);
 * senão, primeiro + último nome; senão, todos os nomes da planilha contidos no cadastro.
 */
export function matchStudent(name: string, students: { id: string; full_name: string }[]): string | null {
  const n = normName(name);
  if (!n) return null;
  const exact = students.find((s) => normName(s.full_name) === n);
  if (exact) return exact.id;
  const parts = n.split(' ');
  const fl = students.filter((s) => {
    const p = normName(s.full_name).split(' ');
    return p[0] === parts[0] && p[p.length - 1] === parts[parts.length - 1];
  });
  if (fl.length === 1) return fl[0].id;
  const contains = students.filter((s) => {
    const p = new Set(normName(s.full_name).split(' '));
    return parts.every((x) => p.has(x));
  });
  return contains.length === 1 ? contains[0].id : null;
}

/** Modelo em mapa: alunos da turma × dias úteis do mês atual. */
export async function downloadAttendanceTemplate(className: string, students: string[]) {
  const XLSX = await import('xlsx');
  const now = new Date();
  const days: string[] = [];
  for (let d = 1; d <= new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(); d++) {
    const dt = new Date(now.getFullYear(), now.getMonth(), d);
    if (dt.getDay() !== 0 && dt.getDay() !== 6) days.push(`${pad(d)}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`);
  }
  const aoa = [['Aluno', ...days], ...(students.length ? students : ['Nome do aluno']).map((n) => [n, ...days.map(() => '')])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 32 }, ...days.map(() => ({ wch: 11 }))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Chamada');
  XLSX.writeFile(wb, `Modelo de chamada - ${className}.xlsx`.replace(/[\\/:*?"<>|]/g, '-'));
}
