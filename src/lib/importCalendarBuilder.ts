import { parseCalendarFile } from './importCalendar';
import { EVENT_CATEGORIES } from './types';
import { fileExtension } from './fileSecurity';
import { embeddedImages, fileToGrids, imageToDataUrl, MAX_ANY_FILE, pdfToImages, type GridSheet } from './anyToGrid';
import { eventsFromGrids, gridsToText, guessCategory, type RawEvent } from './calendarText';
import { ia } from './ia';

/* ============================================================================
   Importação de calendário pronto para o Construtor de Calendário.
   Aceita qualquer arquivo: planilhas (xlsx, xls, ods, csv…), Word (doc, docx, odt, rtf), PDF, PowerPoint,
   HTML, texto, ICS e FOTOS/prints. A leitura é feita no aparelho (tabelas, textos, OCR) e, quando o
   resultado fica fraco (calendário desenhado, foto, PDF escaneado), a IA do sistema lê no lugar.
   O coordenador sempre revisa os eventos antes de entrarem no calendário.
============================================================================ */

export interface ImportedEvent {
  title: string;
  categoryLabel: string; // rótulo (casa com categoria existente ou cria uma nova)
  start: string; // yyyy-mm-dd
  end?: string; // yyyy-mm-dd (opcional, intervalo)
}

export type ReadMethod = 'planilha' | 'leitura' | 'ocr' | 'ia';
export interface ReadResult {
  events: ImportedEvent[];
  method: ReadMethod;
  /** Aviso para o usuário (ex.: "a IA não respondeu, usei a leitura simples"). */
  note?: string;
}
export interface ReadOptions {
  year: number;
  /** A IA do sistema está disponível? */
  ai: boolean;
  /** Pular a leitura local e usar a IA direto ("Reler com IA"). */
  forceAi?: boolean;
  progress?: (msg: string) => void;
}

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff', 'heic', 'heif', 'avif'];
const STRUCTURED_EXT = ['xlsx', 'xls', 'csv', 'ics'];
const WEAK = 3; // menos eventos que isto: vale tentar outro caminho

const categoryLabel = (raw: string | undefined, title: string) => {
  const r = (raw ?? '').trim().slice(0, 40);
  if (!r) return guessCategory(title);
  return EVENT_CATEGORIES.find((c) => c.key === r.toLowerCase())?.label ?? r;
};

const fromRaw = (rows: RawEvent[]): ImportedEvent[] =>
  rows.map((e) => ({ title: e.title, start: e.start, end: e.end && e.end > e.start ? e.end : undefined, categoryLabel: categoryLabel(e.category, e.title) }));

/** Lê um arquivo de calendário e devolve os eventos encontrados. */
export async function readCalendarFile(file: File, opts: ReadOptions): Promise<ReadResult> {
  if (file.size > MAX_ANY_FILE) throw new Error('Arquivo muito grande (máximo 25 MB).');
  const ext = fileExtension(file.name);
  const type = file.type;
  const progress = opts.progress ?? (() => {});
  const isImage = IMAGE_EXT.includes(ext) || type.startsWith('image/');
  const isPdf = ext === 'pdf' || type === 'application/pdf';

  if (opts.forceAi) {
    const events = await viaAi(file, opts, null);
    if (!events.length) throw new Error('A IA não encontrou eventos neste arquivo.');
    return { events, method: 'ia' };
  }

  // 1) Planilha no formato do sistema (colunas Data, Título, Categoria) e ICS: leitura exata.
  if (STRUCTURED_EXT.includes(ext)) {
    try {
      const parsed = await parseCalendarFile(file);
      if (parsed.length) {
        return {
          method: 'planilha',
          events: parsed.map((p) => ({
            title: p.title,
            // preserva o rótulo livre da planilha (ex.: "Feriado", "Avaliação"); senão, cai no rótulo do sistema
            categoryLabel: p.rawCategory || EVENT_CATEGORIES.find((c) => c.key === p.category)?.label || guessCategory(p.title),
            start: p.event_date,
            end: p.end_date ?? undefined,
          })),
        };
      }
    } catch (e) {
      if (ext === 'ics') throw e;
      /* planilha fora do modelo: segue para a leitura livre */
    }
  }

  // 2) Foto: a IA lê melhor (calendário desenhado, letra bonita); sem IA, OCR no aparelho.
  if (isImage) {
    let note: string | undefined;
    if (opts.ai) {
      try {
        const events = await viaAi(file, opts, null);
        if (events.length) return { events, method: 'ia' };
        note = 'A IA não achou eventos na foto; tentei a leitura simples.';
      } catch (e) {
        note = `A IA não respondeu (${(e as Error).message}); tentei a leitura simples.`;
      }
    }
    const sheets = await fileToGrids(file, progress, { lines: true });
    return { events: fromRaw(eventsFromGrids(sheets, opts.year)), method: 'ocr', note };
  }

  // 3) Qualquer outro formato: vira tabela/linhas e é interpretado.
  const sheets = await fileToGrids(file, progress, { lines: true, noOcr: opts.ai && isPdf });
  let events = fromRaw(eventsFromGrids(sheets, opts.year));
  let method: ReadMethod = 'leitura';
  let note: string | undefined;

  if (events.length < WEAK && opts.ai) {
    try {
      const ai = await viaAi(file, opts, sheets);
      if (ai.length > events.length) {
        events = ai;
        method = 'ia';
      }
    } catch (e) {
      note = `A IA não respondeu (${(e as Error).message}).`;
    }
  }
  // PDF escaneado sem IA (ou IA sem resultado): lê as páginas com OCR.
  if (!events.length && isPdf && sheets.some((s) => s.scanned)) {
    const again = await fileToGrids(file, progress, { lines: true });
    events = fromRaw(eventsFromGrids(again, opts.year));
    method = 'ocr';
  }
  return { events, method, note };
}

/** Lê com a IA: texto extraído (se bom) ou imagens (PDF, foto, figuras de dentro do Word). */
async function viaAi(file: File, opts: ReadOptions, sheets: GridSheet[] | null): Promise<ImportedEvent[]> {
  const progress = opts.progress ?? (() => {});
  const ext = fileExtension(file.name);
  const isImage = IMAGE_EXT.includes(ext) || file.type.startsWith('image/');
  const isPdf = ext === 'pdf' || file.type === 'application/pdf';
  const found: ImportedEvent[] = [];
  const add = (rows: { title: string; start: string; end: string | null; category: string }[]) =>
    rows.forEach((e) => found.push({ title: e.title, start: e.start, end: e.end ?? undefined, categoryLabel: categoryLabel(e.category, e.title) }));

  // Texto bom: um pedido só, sem gastar com imagem.
  const text = sheets ? gridsToText(sheets) : '';
  if (text.length >= 80) {
    progress('A IA está lendo o calendário…');
    add((await ia.calendar({ year: opts.year, text })).events);
    if (found.length >= WEAK) return found;
  }

  let images: string[] = [];
  if (isImage) images = [await imageToDataUrl(file)];
  else if (isPdf) images = await pdfToImages(file, 6, progress);
  else images = await embeddedImages(file);
  for (let i = 0; i < images.length; i += 2) {
    progress(`A IA está lendo ${images.length > 1 ? `as imagens ${i + 1}–${Math.min(i + 2, images.length)} de ${images.length}` : 'a imagem'}…`);
    add((await ia.calendar({ year: opts.year, images: images.slice(i, i + 2) })).events);
  }
  return dedupe(found);
}

export const normText = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export const eventKey = (e: { start: string; end?: string; title: string }) => `${e.start}|${e.end ?? ''}|${normText(e.title)}`;

/** Tira repetidos (mesma data, período e título). */
export function dedupe<T extends { start: string; end?: string; title: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((e) => {
    const k = eventKey(e);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
