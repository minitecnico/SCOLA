import { EVENT_CATEGORIES } from './types';
import { assertCalendarImportFile, assertImportRowLimit } from './fileSecurity';

export interface ParsedEvent {
  title: string;
  description: string;
  category: string;       // categoria do sistema (evento|prova|gincana|…), normalizada
  rawCategory: string;    // texto original da coluna Categoria (preserva rótulos livres)
  event_date: string;     // yyyy-mm-dd
  end_date: string | null;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Converte vários formatos de data para yyyy-mm-dd. */
function parseDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v.getTime())) return toISO(v);
  if (typeof v === 'number') {
    // serial do Excel (dias desde 1899-12-30)
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : toISO(d);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); // yyyy-mm-dd
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/); // dd/mm/yyyy
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${pad(+m[2])}-${pad(+m[1])}`;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : toISO(d);
}

/** Casa o texto da categoria com uma das categorias do sistema. */
function matchCategory(v: unknown): string {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return 'evento';
  const hit = EVENT_CATEGORIES.find((c) => c.key === s || c.label.toLowerCase() === s);
  if (hit) return hit.key;
  if (s.includes('prova')) return 'prova';
  if (s.includes('ginc')) return 'gincana';
  if (s.includes('reuni')) return 'reuniao';
  if (s.includes('ativ')) return 'atividade';
  return 'evento';
}

/** Gera e baixa a planilha-modelo para o coordenador preencher. */
export async function downloadCalendarTemplate() {
  const XLSX = await import('xlsx');
  const rows = [
    ['Data', 'Título', 'Categoria', 'Descrição', 'Até (opcional)'],
    ['12/06/2026', 'Evento pedagógico', 'Evento', 'Use sempre o padrão brasileiro dd/mm/aaaa.', ''],
    ['20/03/2026', 'Gincana cultural', 'Gincana', 'Atividades no pátio', '21/03/2026'],
    ['15/06/2026', 'Semana de provas', 'Semana de provas', '1º trimestre', '19/06/2026'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['A2'].z = 'dd/mm/yyyy';
  ws['A3'].z = 'dd/mm/yyyy';
  ws['A4'].z = 'dd/mm/yyyy';
  ws['E3'].z = 'dd/mm/yyyy';
  ws['E4'].z = 'dd/mm/yyyy';
  ws['!cols'] = [{ wch: 14 }, { wch: 30 }, { wch: 20 }, { wch: 46 }, { wch: 16 }];
  ws['!autofilter'] = { ref: 'A1:E4' };
  const wb = XLSX.utils.book_new();
  const info = XLSX.utils.aoa_to_sheet([
    ['PLANILHA PADRÃO - CALENDÁRIO'],
    ['Use datas no formato brasileiro: 12/06/2026.'],
    ['Não use formato americano como 06/12/2026 para 12 de junho.'],
    ['Categorias aceitas: Evento, Atividade, Gincana, Semana de provas, Reunião, Outro.'],
    ['Eventos importados ficam visíveis para todos os perfis envolvidos por padrão.'],
  ]);
  info['!cols'] = [{ wch: 90 }];
  XLSX.utils.book_append_sheet(wb, info, 'Instruções');
  XLSX.utils.book_append_sheet(wb, ws, 'Calendario');
  XLSX.writeFile(wb, 'modelo-calendario.xlsx');
}

/** Lê o arquivo (.xlsx/.csv ou .ics) e devolve os eventos identificados. */
export async function parseCalendarFile(file: File): Promise<ParsedEvent[]> {
  assertCalendarImportFile(file);
  const name = file.name.toLowerCase();
  if (name.endsWith('.ics')) return parseIcs(await file.text());
  return parseSheet(file);
}

async function parseSheet(file: File): Promise<ParsedEvent[]> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const out: ParsedEvent[] = [];
  // Lê TODAS as abas (ex.: "Calendário geral", "1º Trimestre"…) e remove duplicatas
  // por data+título, para que uma aba-resumo não dobre os eventos das abas por período.
  const seen = new Set<string>();
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
    assertImportRowLimit(rows.length);
    for (const r of rows) {
      // aceita cabeçalhos em pt (Data/Título/...) de forma flexível
      const get = (keys: string[]) => {
        for (const k of Object.keys(r)) {
          const kk = k.toLowerCase().trim();
          if (keys.some((t) => kk.startsWith(t))) return r[k];
        }
        return '';
      };
      const date = parseDate(get(['data', 'date', 'dia', 'início', 'inicio']));
      const title = String(get(['título', 'titulo', 'evento', 'nome', 'title']) ?? '').trim();
      if (!date || !title) continue;
      const end = parseDate(get(['até', 'ate', 'fim', 'término', 'termino', 'end']));
      const key = `${date}|${end ?? ''}|${title.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const rawCat = String(get(['categoria', 'tipo', 'category']) ?? '').trim();
      out.push({
        title,
        description: String(get(['descri', 'detalhe', 'obs']) ?? '').trim(),
        category: matchCategory(rawCat),
        rawCategory: rawCat,
        event_date: date,
        end_date: end,
      });
    }
  }
  return out;
}

/** Parser mínimo de iCalendar (.ics): extrai VEVENTs (SUMMARY/DTSTART/DTEND/DESCRIPTION). */
function parseIcs(text: string): ParsedEvent[] {
  // desdobra linhas continuadas (RFC 5545: linha seguinte começa com espaço)
  const lines = text.replace(/\r\n[ \t]/g, '').split(/\r?\n/);
  const out: ParsedEvent[] = [];
  let cur: Record<string, string> | null = null;
  const icsDate = (v: string): string | null => {
    const m = v.match(/(\d{4})(\d{2})(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  };
  for (const line of lines) {
    if (line.startsWith('BEGIN:VEVENT')) cur = {};
    else if (line.startsWith('END:VEVENT')) {
      if (cur) {
        const date = icsDate(cur.DTSTART || '');
        const title = (cur.SUMMARY || '').trim();
        if (date && title) {
          let end = icsDate(cur.DTEND || '');
          // DTEND no ICS é exclusivo p/ datas inteiras — recua 1 dia se diferente
          if (end && end !== date) {
            const d = new Date(end + 'T00:00:00');
            d.setDate(d.getDate() - 1);
            end = toISO(d);
          }
          out.push({ title, description: (cur.DESCRIPTION || '').trim(), category: 'evento', rawCategory: '', event_date: date, end_date: end && end !== date ? end : null });
        }
        cur = null;
      }
    } else if (cur) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        const key = line.slice(0, idx).split(';')[0].toUpperCase();
        cur[key] = line.slice(idx + 1);
      }
    }
  }
  return out;
}
