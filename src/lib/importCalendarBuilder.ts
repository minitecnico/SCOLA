import { parseCalendarFile } from './importCalendar';
import { EVENT_CATEGORIES } from './types';
import { fileExtension, MAX_IMPORT_ROWS } from './fileSecurity';

/* ============================================================================
   Importação inteligente para o Construtor de Calendário.
   Lê Excel/CSV/ICS (parser estruturado já existente) E também PDF/DOCX, onde
   extrai o texto e detecta datas + eventos em PT-BR por heurística. Devolve
   eventos no formato do construtor, com um rótulo de categoria adivinhado.
   O coordenador revisa/edita no editor antes de salvar.
============================================================================ */

export interface ImportedEvent {
  title: string;
  categoryLabel: string; // rótulo (casa com categoria existente ou cria uma nova)
  start: string;         // yyyy-mm-dd
  end?: string;          // yyyy-mm-dd (opcional, intervalo)
}

const MB = 1024 * 1024;
const MAX_DOC_SIZE = 15 * MB;
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;

const MONTHS: Record<string, number> = {
  janeiro: 0, fevereiro: 1, marco: 2, 'março': 2, abril: 3, maio: 4, junho: 5,
  julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
  jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11,
};

/** Adivinha um rótulo de categoria a partir de palavras-chave do título. */
function guessCategory(text: string): string {
  const s = text.toLowerCase();
  if (/\b(feriado|recesso|f[eé]rias)\b/.test(s)) return 'Feriado';
  if (/(prova|avalia|simulado|e-?cerm|exame|teste|redaç)/.test(s)) return 'Avaliação';
  if (/(recupera|paralela|depend[eê]ncia)/.test(s)) return 'Recuperação Paralela';
  if (/(reuni|pedag|plant[ãa]o|encontro|conselho|formaç|planejamento)/.test(s)) return 'Pedagógico';
  if (/(ginc|jogos|festa|arrai|cultur|oficina|culmin|aula de campo|passeio|semin)/.test(s)) return 'Evento & Cultura';
  if (/(dia d|anivers|comemora|natal|p[áa]scoa|m[ãa]es|pais)/.test(s)) return 'Data comemorativa';
  if (/(in[íi]cio|t[ée]rmino|encerr|abertura|trimestre|unidade|marco)/.test(s)) return 'Marco do período';
  return 'Evento';
}

/** Lê qualquer formato suportado e devolve eventos prontos para o construtor. */
export async function parseAnyCalendarFile(file: File, defaultYear: number): Promise<ImportedEvent[]> {
  const ext = fileExtension(file.name);
  if (['xlsx', 'xls', 'csv', 'ics'].includes(ext)) {
    const parsed = await parseCalendarFile(file);
    return parsed.map((p) => ({
      title: p.title,
      // preserva o rótulo livre da planilha (ex.: "Feriado", "Avaliação"); senão, cai no rótulo do sistema
      categoryLabel: p.rawCategory || EVENT_CATEGORIES.find((c) => c.key === p.category)?.label || 'Evento',
      start: p.event_date,
      end: p.end_date ?? undefined,
    }));
  }
  if (file.size > MAX_DOC_SIZE) throw new Error('Arquivo muito grande. Envie PDF/DOCX de até 15 MB.');
  if (ext === 'docx') return fromText(await extractDocxText(file), defaultYear);
  if (ext === 'pdf') return fromText(await extractPdfText(file), defaultYear);
  if (ext === 'doc') throw new Error('Formato .doc antigo não é lido. Salve como .docx ou .pdf e tente de novo.');
  throw new Error('Formato não suportado. Use Excel (.xlsx/.csv), PDF, DOCX ou ICS.');
}

/* ----------------------------- Extração de texto ----------------------------- */

/** DOCX é um zip; o texto fica em word/document.xml. Sem dependência nova (jszip já existe). */
async function extractDocxText(file: File): Promise<string> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('DOCX inválido ou vazio.');
  return xml
    .replace(/<w:tab[^>]*\/?>/g, ' ')
    .replace(/<\/w:p>/g, '\n')   // fim de parágrafo -> quebra de linha
    .replace(/<\/w:tr>/g, '\n')  // fim de linha de tabela -> quebra
    .replace(/<[^>]+>/g, '')     // remove o restante das tags
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&apos;|&#39;/g, "'").replace(/&quot;/g, '"');
}

/** PDF: extrai o texto página a página, reconstruindo linhas pela posição vertical. */
async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // agrupa itens por coordenada Y (mesma linha) e ordena de cima p/ baixo
    const byRow = new Map<number, { x: number; s: string }[]>();
    for (const it of content.items as { str: string; transform: number[] }[]) {
      if (!it.str) continue;
      const y = Math.round(it.transform[5]);
      (byRow.get(y) ?? byRow.set(y, []).get(y)!).push({ x: it.transform[4], s: it.str });
    }
    for (const y of [...byRow.keys()].sort((a, b) => b - a)) {
      const row = byRow.get(y)!.sort((a, b) => a.x - b.x).map((r) => r.s).join(' ');
      lines.push(row);
    }
    page.cleanup();
  }
  return lines.join('\n');
}

/* ----------------------------- Heurística PT-BR ----------------------------- */

/** Extrai eventos de texto livre, detectando datas no padrão brasileiro. */
function fromText(text: string, year: number): ImportedEvent[] {
  const out: ImportedEvent[] = [];
  const seen = new Set<string>();
  const push = (e: ImportedEvent) => {
    const title = cleanTitle(e.title);
    if (title.length < 3) return;
    const key = `${e.start}|${title.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...e, title, categoryLabel: guessCategory(title) });
    if (out.length > MAX_IMPORT_ROWS) throw new Error(`Documento grande demais. Importe no máximo ${MAX_IMPORT_ROWS} eventos por vez.`);
  };

  const lines = text.split(/\n+/).map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length >= 1);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length < 3) continue;
    const hit = matchDate(line, year);
    if (!hit) continue;
    let title = (line.slice(0, hit.index) + ' ' + line.slice(hit.index + hit.length)).trim();
    // Data isolada (ex.: célula de tabela ou layout "data / descrição"): usa a próxima linha como título.
    if (cleanTitle(title).length < 3) {
      const next = lines[i + 1];
      if (next && !matchDate(next, year)) {
        title = next;
        i++;
      }
    }
    push({ title, categoryLabel: 'Evento', start: hit.start, end: hit.end });
  }
  return out;
}

type DateHit = { index: number; length: number; start: string; end?: string };

/** Tenta achar a 1ª data da linha. Ordem: textual (mais específica) -> numérica. */
function matchDate(line: string, year: number): DateHit | null {
  // "12 de junho [de 2026]" ou "1 a 4 de setembro [de 2026]"
  const txt = line.match(/(\d{1,2})\s*(?:a|à|at[ée]|-|–|\/)\s*(\d{1,2})?\s*(?:de\s+)?([a-zçãéêíóôúâ]+)(?:\s+de\s+(\d{4}))?/i)
    || line.match(/(\d{1,2})\s+de\s+([a-zçãéêíóôúâ]+)(?:\s+de\s+(\d{4}))?/i);
  if (txt) {
    // dois formatos de captura acima; normaliza
    let d1: number, d2: number | undefined, monthWord: string, yr: number;
    if (txt.length === 5) { // range: d1, d2?, mês, ano?
      d1 = +txt[1]; d2 = txt[2] ? +txt[2] : undefined; monthWord = txt[3]; yr = txt[4] ? +txt[4] : year;
    } else {               // simples: d1, mês, ano?
      d1 = +txt[1]; d2 = undefined; monthWord = txt[2]; yr = txt[3] ? +txt[3] : year;
    }
    const m = MONTHS[stripAccents(monthWord.toLowerCase())] ?? MONTHS[monthWord.toLowerCase()];
    if (m != null && d1 >= 1 && d1 <= 31) {
      return {
        index: txt.index ?? 0,
        length: txt[0].length,
        start: iso(yr, m, d1),
        end: d2 && d2 >= d1 && d2 <= 31 ? iso(yr, m, d2) : undefined,
      };
    }
  }
  // intervalo numérico no mesmo mês: "19 a 29/05[/2026]"
  const numRange = line.match(/(\d{1,2})\s*(?:a|à|at[ée]|-|–)\s*(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?/);
  if (numRange) {
    const d1 = +numRange[1], d2 = +numRange[2], mo = +numRange[3] - 1;
    const yr = numRange[4] ? normYear(numRange[4]) : year;
    if (valid(d1, mo) && d2 >= d1 && d2 <= 31) {
      return { index: numRange.index ?? 0, length: numRange[0].length, start: iso(yr, mo, d1), end: iso(yr, mo, d2) };
    }
  }
  // data simples: "dd/mm[/yyyy]" ou "dd.mm"
  const num = line.match(/(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?/);
  if (num) {
    const d = +num[1], mo = +num[2] - 1;
    const yr = num[3] ? normYear(num[3]) : year;
    if (valid(d, mo)) return { index: num.index ?? 0, length: num[0].length, start: iso(yr, mo, d) };
  }
  return null;
}

const valid = (d: number, m0: number) => d >= 1 && d <= 31 && m0 >= 0 && m0 <= 11;
const normYear = (s: string) => (s.length === 2 ? 2000 + +s : +s);
const stripAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function cleanTitle(s: string) {
  return s.replace(/\s+/g, ' ').replace(/^[\s\-–—:•·.,;]+|[\s\-–—:•·.,;]+$/g, '').trim();
}
