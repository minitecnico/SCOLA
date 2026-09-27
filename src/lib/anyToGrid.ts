/**
 * Converte QUALQUER arquivo em tabelas (linhas × colunas) para os importadores:
 *   planilhas (xlsx, xls, xlsm, xlsb, ods, csv, tsv, html, xml), texto (txt), JSON,
 *   Word (docx), LibreOffice Writer (odt), PDF (com texto ou escaneado) e fotos (OCR).
 * Tudo roda no aparelho: nada é enviado para fora.
 * Em PDF e foto, as colunas são reconstruídas pela posição do texto na página.
 */
import { fileExtension } from './fileSecurity';

export type Grid = unknown[][];
export interface GridSheet {
  name: string;
  grid: Grid;
}
export type Progress = (msg: string) => void;

export const MAX_ANY_FILE = 25 * 1024 * 1024;
const SHEET_EXT = ['xlsx', 'xlsm', 'xlsb', 'xls', 'ods', 'fods', 'xml', 'html', 'htm', 'numbers', 'dif', 'sylk', 'slk', 'prn', 'dbf', 'wk1', 'wk3', 'qpw'];
const TEXT_EXT = ['csv', 'tsv', 'txt', 'tab', 'dat', 'md'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff', 'heic', 'heif', 'avif'];

export async function fileToGrids(file: File, progress: Progress = () => {}): Promise<GridSheet[]> {
  if (file.size > MAX_ANY_FILE) throw new Error('Arquivo muito grande (máximo 25 MB).');
  const ext = fileExtension(file.name);
  const type = file.type;
  if (ext === 'pdf' || type === 'application/pdf') return pdfToGrids(file, progress);
  if (ext === 'docx' || type.includes('wordprocessingml')) return docxToGrids(file);
  if (ext === 'odt' || type.includes('opendocument.text')) return odtToGrids(file);
  if (ext === 'json' || type === 'application/json') return [{ name: file.name, grid: jsonToGrid(await readText(file)) }];
  if (IMAGE_EXT.includes(ext) || type.startsWith('image/')) return [{ name: file.name, grid: await imageToGrid(file, progress) }];
  if (TEXT_EXT.includes(ext) || type.startsWith('text/plain') || type === 'text/csv') return [{ name: file.name, grid: textToGrid(await readText(file)) }];
  if (ext === 'doc') throw new Error('Arquivo .doc (Word antigo): abra no Word e salve como .docx ou PDF.');
  if (SHEET_EXT.includes(ext) || !ext) return sheetToGrids(file);
  // Formato desconhecido: tenta como planilha e, se não der, como texto.
  try {
    return await sheetToGrids(file);
  } catch {
    return [{ name: file.name, grid: textToGrid(await readText(file)) }];
  }
}

/* --------------------------------- Texto --------------------------------- */
async function readText(file: File) {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

/** Texto em colunas: descobre o separador (tab, ;, vírgula, |) ou usa 2+ espaços. */
export function textToGrid(text: string): Grid {
  const lines = text.split(/\r?\n/);
  const sample = lines.filter((l) => l.trim()).slice(0, 50);
  const seps = ['\t', ';', '|', ','];
  let best: string | null = null;
  let bestScore = 0;
  for (const s of seps) {
    const counts = sample.map((l) => l.split(s).length - 1).filter((n) => n > 0);
    if (counts.length < Math.max(2, sample.length * 0.5)) continue;
    const score = counts.length * Math.min(...counts);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return lines.map((l) => {
    if (best) return splitDelimited(l, best);
    return l.trim() ? l.trim().split(/\s{2,}/) : [];
  });
}

function splitDelimited(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (c === sep && !q) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** JSON: lista de objetos, lista de listas, ou objeto que contém uma lista. */
export function jsonToGrid(text: string): Grid {
  let data: unknown = JSON.parse(text);
  if (data && !Array.isArray(data) && typeof data === 'object') {
    const arr = Object.values(data as Record<string, unknown>).find(Array.isArray);
    if (arr) data = arr;
  }
  if (!Array.isArray(data) || !data.length) throw new Error('JSON sem lista de registros.');
  if (Array.isArray(data[0])) return data as Grid;
  const keys = [...new Set(data.flatMap((o) => (o && typeof o === 'object' ? Object.keys(o) : [])))];
  return [keys, ...data.map((o) => keys.map((k) => (o as Record<string, unknown>)?.[k] ?? ''))];
}

/* ------------------------------- Planilhas ------------------------------- */
async function sheetToGrids(file: File): Promise<GridSheet[]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  return wb.SheetNames.map((n) => ({ name: n, grid: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, defval: '', raw: true, blankrows: true }) }));
}

/* ---------------------------- Word / Writer ---------------------------- */
async function docxToGrids(file: File): Promise<GridSheet[]> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('Não consegui abrir este arquivo do Word.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const text = (el: Element) => [...el.getElementsByTagNameNS(W, 'p')].map((p) => [...p.getElementsByTagNameNS(W, 't')].map((t) => t.textContent).join('')).join(' ').trim();
  const tables = [...doc.getElementsByTagNameNS(W, 'tbl')].filter((t) => !t.parentElement?.closest?.('tbl'));
  if (tables.length) {
    return tables.map((t, i) => ({
      name: `Tabela ${i + 1}`,
      grid: [...t.getElementsByTagNameNS(W, 'tr')].map((tr) =>
        [...tr.children].filter((c) => c.localName === 'tc').flatMap((tc) => {
          // Célula mesclada horizontalmente ocupa várias colunas.
          const span = Number(tc.getElementsByTagNameNS(W, 'gridSpan')[0]?.getAttributeNS(W, 'val') ?? 1) || 1;
          return [text(tc), ...Array(span - 1).fill('')];
        }),
      ),
    }));
  }
  // Sem tabela: o texto dos parágrafos, em colunas.
  return [{ name: file.name, grid: textToGrid([...doc.getElementsByTagNameNS(W, 'p')].map((p) => [...p.getElementsByTagNameNS(W, 't')].map((t) => t.textContent).join('')).join('\n')) }];
}

async function odtToGrids(file: File): Promise<GridSheet[]> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = await zip.file('content.xml')?.async('string');
  if (!xml) throw new Error('Não consegui abrir este documento.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const T = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
  const tables = [...doc.getElementsByTagNameNS(T, 'table')];
  if (!tables.length) return [{ name: file.name, grid: textToGrid(doc.documentElement.textContent ?? '') }];
  return tables.map((t, i) => ({
    name: t.getAttributeNS(T, 'name') || `Tabela ${i + 1}`,
    grid: [...t.getElementsByTagNameNS(T, 'table-row')].map((tr) =>
      [...tr.children]
        .filter((c) => c.localName === 'table-cell' || c.localName === 'covered-table-cell')
        .flatMap((c) => Array(Math.min(50, Number(c.getAttributeNS(T, 'number-columns-repeated') ?? 1) || 1)).fill((c.textContent ?? '').trim())),
    ),
  }));
}

/* ------------------------ Texto posicionado → tabela ------------------------ */
export interface Item {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  text: string;
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : 0;
};

/**
 * Reconstrói a tabela a partir de pedaços de texto com posição (PDF, OCR):
 * agrupa em linhas pela altura, junta palavras da mesma célula e descobre as
 * colunas pelas faixas horizontais que os textos ocupam.
 */
export function itemsToGrid(items: Item[]): Grid {
  const it = items.filter((i) => i.text.trim());
  if (!it.length) return [];
  const h = median(it.map((i) => i.y1 - i.y0)) || 10;
  // Linhas
  const sorted = [...it].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const lines: Item[][] = [];
  for (const i of sorted) {
    const yc = (i.y0 + i.y1) / 2;
    const last = lines[lines.length - 1];
    if (last && Math.abs(median(last.map((x) => (x.y0 + x.y1) / 2)) - yc) < h * 0.6) last.push(i);
    else lines.push([i]);
  }
  // Células: palavras próximas na mesma linha formam uma célula ("Ana Clara Souza").
  const cells = lines.map((line) => {
    const byX = line.sort((a, b) => a.x0 - b.x0);
    const out: Item[] = [];
    for (const w of byX) {
      const prev = out[out.length - 1];
      if (prev && w.x0 - prev.x1 < h * 0.7) {
        prev.text += ' ' + w.text.trim();
        prev.x1 = Math.max(prev.x1, w.x1);
      } else out.push({ ...w, text: w.text.trim() });
    }
    return out;
  });
  // Colunas: faixas horizontais ocupadas (ignora títulos que atravessam a página).
  const width = Math.max(...it.map((i) => i.x1)) - Math.min(...it.map((i) => i.x0));
  // Só linhas com cara de tabela (várias células) definem as colunas — títulos e
  // cabeçalhos soltos por cima da tabela não.
  // Número de células mais comum entre as linhas (as linhas de aluno); aceita ±1 (célula vazia).
  const freq = new Map<number, number>();
  cells.filter((r) => r.length > 1).forEach((r) => freq.set(r.length, (freq.get(r.length) ?? 0) + 1));
  const mode = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 2;
  const spans = cells
    .filter((row) => row.length > 1 && Math.abs(row.length - mode) <= 1)
    .flat()
    .filter((c) => c.x1 - c.x0 < width * 0.4)
    .map((c) => [c.x0 - h * 0.15, c.x1 + h * 0.15] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const cols: [number, number][] = [];
  for (const s of spans) {
    const last = cols[cols.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else cols.push([...s]);
  }
  if (!cols.length) return cells.map((row) => row.map((c) => c.text));
  const colOf = (c: Item) => {
    const xc = (c.x0 + c.x1) / 2;
    let best = 0;
    let dist = Infinity;
    cols.forEach(([a, b], k) => {
      const d = xc < a ? a - xc : xc > b ? xc - b : 0;
      if (d < dist) {
        dist = d;
        best = k;
      }
    });
    return best;
  };
  return cells.map((row) => {
    const out: string[] = Array(cols.length).fill('');
    for (const c of row) {
      const k = colOf(c);
      out[k] = out[k] ? `${out[k]} ${c.text}` : c.text;
    }
    return out;
  });
}

/* ----------------------------------- PDF ----------------------------------- */
async function pdfToGrids(file: File, progress: Progress): Promise<GridSheet[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const sheets: GridSheet[] = [];
  const pages = Math.min(doc.numPages, 40);
  for (let n = 1; n <= pages; n++) {
    progress(`Lendo o PDF… página ${n} de ${pages}`);
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: Item[] = [];
    for (const raw of content.items) {
      if (!('str' in raw) || !raw.str.trim()) continue;
      const [, , , d, e, f] = raw.transform as number[];
      const hgt = Math.abs(d) || raw.height || 10;
      const y1 = vp.height - f;
      items.push({ x0: e, x1: e + (raw.width || raw.str.length * hgt * 0.5), y0: y1 - hgt, y1, text: raw.str });
    }
    if (items.map((i) => i.text).join('').length > 20) {
      sheets.push({ name: `Página ${n}`, grid: itemsToGrid(items) });
    } else {
      // Página escaneada (imagem): lê com OCR.
      const scale = 2.5;
      const v = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = v.width;
      canvas.height = v.height;
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport: v, canvas } as Parameters<typeof page.render>[0]).promise;
      sheets.push({ name: `Página ${n}`, grid: await ocrToGrid(canvas, (p) => progress(`Lendo a página ${n} (escaneada)… ${p}%`)) });
    }
  }
  return sheets;
}

/* ------------------------------ Foto (OCR) ------------------------------ */
async function imageToGrid(file: File, progress: Progress): Promise<Grid> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error('Não consegui abrir esta imagem. Se for HEIC (iPhone), exporte como JPG ou tire um print da tela.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0);
  return ocrToGrid(canvas, (p) => progress(`Lendo o texto da foto… ${p}%`));
}

/* ------------------- Preparação da imagem para o OCR ------------------- */
/** Redimensiona para ~2400 px no lado maior: foto pequena fica legível, foto enorme fica rápida. */
function resized(src: HTMLCanvasElement, target = 2400) {
  const s = target / Math.max(src.width, src.height);
  if (Math.abs(s - 1) < 0.05) return src;
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * s);
  c.height = Math.round(src.height * s);
  const x = c.getContext('2d')!;
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function grayOf(c: HTMLCanvasElement) {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
  const g = new Uint8Array(c.width * c.height);
  for (let i = 0; i < g.length; i++) g[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8;
  return g;
}

function otsu(g: Uint8Array) {
  const hist = new Array(256).fill(0);
  g.forEach((v) => hist[v]++);
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0;
  let wB = 0;
  let best = 0;
  let thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = g.length - wB;
    if (!wF) break;
    sB += t * hist[t];
    const v = wB * wF * (sB / wB - (sum - sB) / wF) ** 2;
    if (v > best) {
      best = v;
      thr = t;
    }
  }
  return thr;
}

/** Ângulo em que as linhas de texto ficam mais "retas" (perfil horizontal mais nítido). */
function skewAngle(c: HTMLCanvasElement): number {
  const small = resized(c, 900);
  const W = small.width;
  const H = small.height;
  const g = grayOf(small);
  // Pontos de borda horizontal (topo/base das letras e linhas da tabela): o fundo
  // liso (mesa, sombra) não conta, só o que é texto/tabela.
  const pts: number[] = [];
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W; x += 2) if (Math.abs(g[y * W + x] - g[(y + 1) * W + x]) > 45) pts.push(x, y);
  if (pts.length < 200) return 0;
  const score = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    const sin = Math.sin(a);
    const cos = Math.cos(a);
    const bins = new Float64Array(H * 2 + W);
    for (let i = 0; i < pts.length; i += 2) bins[Math.round(pts[i + 1] * cos - pts[i] * sin + W)]++;
    let s = 0;
    for (const b of bins) s += b * b;
    return s;
  };
  let best = 0;
  let bestS = score(0);
  for (let d = -12; d <= 12; d += 0.5) {
    const v = score(d);
    if (v > bestS) {
      bestS = v;
      best = d;
    }
  }
  for (let d = best - 0.5; d <= best + 0.5; d += 0.1) {
    const v = score(d);
    if (v > bestS) {
      bestS = v;
      best = d;
    }
  }
  return best;
}

function rotated(src: HTMLCanvasElement, deg: number) {
  if (Math.abs(deg) < 0.2) return src;
  const a = (deg * Math.PI) / 180;
  const c = document.createElement('canvas');
  c.width = Math.round(Math.abs(src.width * Math.cos(a)) + Math.abs(src.height * Math.sin(a)));
  c.height = Math.round(Math.abs(src.width * Math.sin(a)) + Math.abs(src.height * Math.cos(a)));
  const x = c.getContext('2d')!;
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  x.translate(c.width / 2, c.height / 2);
  x.rotate(-a);
  x.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

/** Preto e branco (limiar de Otsu) e sem as linhas da tabela, que confundem o OCR. */
function cleaned(c: HTMLCanvasElement) {
  const W = c.width;
  const H = c.height;
  const g = grayOf(c);
  // Limiar adaptativo (Bradley): cada ponto comparado à média da vizinhança —
  // resiste a sombra, luz desigual e fundo (mesa) na foto.
  const ii = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += g[y * W + x];
      ii[(y + 1) * (W + 1) + x + 1] = ii[y * (W + 1) + x + 1] + row;
    }
  }
  const r = Math.max(8, Math.round(Math.min(W, H) / 40));
  const dark = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(H - 1, y + r);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(W - 1, x + r);
      const n = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = ii[(y1 + 1) * (W + 1) + x1 + 1] - ii[y0 * (W + 1) + x1 + 1] - ii[(y1 + 1) * (W + 1) + x0] + ii[y0 * (W + 1) + x0];
      dark[y * W + x] = g[y * W + x] * n < sum * 0.82 ? 1 : 0;
    }
  }
  // Linhas da tabela: trechos longos e quase contínuos (tolera falhas de até 6 px,
  // comuns depois de endireitar a foto). Apaga também a vizinhança (espessura da linha).
  const kill = new Uint8Array(W * H);
  const hMin = Math.max(40, W / 14);
  const vMin = Math.max(30, H / 12);
  const GAP = 6;
  const mark = (i: number) => {
    kill[i] = 1;
  };
  for (let y = 0; y < H; y++) {
    let s = -1;
    let last = -1;
    let n = 0;
    for (let x = 0; x <= W; x++) {
      const on = x < W && dark[y * W + x];
      if (on) {
        if (s < 0) s = x;
        last = x;
        n++;
      } else if (s >= 0 && (x - last > GAP || x === W)) {
        // Linha de tabela: longa E quase toda preta (texto tem muitos vãos).
        if (last - s > hMin && n / (last - s + 1) > 0.9) for (let k = s; k <= last; k++) for (let dy = -1; dy <= 1; dy++) if (y + dy >= 0 && y + dy < H) mark((y + dy) * W + k);
        s = -1;
        n = 0;
      }
    }
  }
  for (let x = 0; x < W; x++) {
    let s = -1;
    let last = -1;
    let n = 0;
    for (let y = 0; y <= H; y++) {
      const on = y < H && dark[y * W + x];
      if (on) {
        if (s < 0) s = y;
        last = y;
        n++;
      } else if (s >= 0 && (y - last > GAP || y === H)) {
        if (last - s > vMin && n / (last - s + 1) > 0.9) for (let k = s; k <= last; k++) for (let dx = -1; dx <= 1; dx++) if (x + dx >= 0 && x + dx < W) mark(k * W + x + dx);
        s = -1;
        n = 0;
      }
    }
  }
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const x = out.getContext('2d')!;
  const img = x.createImageData(W, H);
  for (let i = 0; i < dark.length; i++) {
    const v = dark[i] && !kill[i] ? 0 : 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return out;
}

async function ocrToGrid(source: HTMLCanvasElement, onPct: (p: number) => void): Promise<Grid> {
  const { createWorker } = await import('tesseract.js');
  onPct(0);
  // Tamanho bom para leitura → endireita a foto → preto e branco sem as linhas da tabela.
  const base = resized(source);
  const img = cleaned(rotated(base, skewAngle(base)));
  const worker = await createWorker('por', 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onPct(Math.round(m.progress * 100));
    },
  });
  try {
    await worker.setParameters({ preserve_interword_spaces: '1' });
    const { data } = await worker.recognize(img, {}, { blocks: true });
    const items: Item[] = [];
    for (const b of data.blocks ?? [])
      for (const p of b.paragraphs)
        for (const l of p.lines)
          for (const w of l.words) {
            // Restos de borda e sujeira ("|", "[", aspas, asterisco) não são texto;
            // "•" sozinho é marcação de presença e fica.
            const t = w.text
              .replace(/[|[\]{}_—–]+/g, ' ')
              .replace(/^[\s'"“”‘’`*+,;:!.]+|[\s'"“”‘’`*+,;:!]+$/g, '')
              .trim();
            if (!t && !/^[•·]$/.test(w.text.trim())) continue;
            if (!/[\p{L}\p{N}•·]/u.test(t || w.text)) continue;
            if (w.confidence > 15) items.push({ x0: w.bbox.x0, x1: w.bbox.x1, y0: w.bbox.y0, y1: w.bbox.y1, text: t || w.text.trim() });
          }
    if (!items.length) throw new Error('Não encontrei texto na imagem. Tire a foto de frente, com boa luz e a folha inteira.');
    return itemsToGrid(items);
  } finally {
    await worker.terminate();
  }
}
