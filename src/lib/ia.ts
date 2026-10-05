import { useQuery } from '@tanstack/react-query';
import { marked, type Tokens } from 'marked';
import { rpc } from './api';
import { createEditableDoc, saveDocContent } from './queries';

/**
 * Central de IA do navegador (o servidor correspondente é worker/ia.ts):
 * chamadas ao servidor, conversa em streaming, leitura de anexos, ajustes de imagem,
 * Markdown/matemática → HTML, índice dos conteúdos da escola e salvar em Word/Planejamento.
 */

/* ===================================== Servidor ===================================== */
export type Aspect = 'paisagem' | 'retrato' | 'quadrado';
export type SmartMode = 'auto' | 'texto' | 'imagem' | 'ler' | 'editar';
export type TrechoAction = 'melhorar' | 'corrigir' | 'resumir' | 'simplificar' | 'topicos' | 'continuar';
export type SmartResult = { markdown: string | null; image: string | null; used: string[] };
export type AiStatus = { ready: boolean; images: boolean; school: boolean; engine: string | null; limit: number; imageLimit: number };
export type ChatMsg = {
  role: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
  image?: string | null;
  model?: string;
  sources?: { kind: string; name: string }[];
  error?: boolean;
};
export type ParecerInput = {
  subject?: string; className?: string; period?: string; term?: number; tone?: string; extra?: string;
  students: { n: number; terms?: (number | null)[]; final?: number | null; activities?: { name: string; score: number | null; max: number }[] }[];
};

export type EngineMode = 'auto' | 'rapido' | 'prioridade';
export type EngineHealth = { calls: number; successRate: number | null; avgMs: number | null; streak: number; lastError: string | null; lastOkAt: string | null; lastFailAt: string | null; restingUntil: number | null };
export type EngineInfo = {
  nvidia: boolean;
  mode: EngineMode;
  engines: ({ id: string; label: string; baseUrl: string; model: string; keyHint: string; enabled: boolean } & EngineHealth)[];
  models: ({ id: string; label: string; task: 'texto' | 'visao' | 'imagem'; enabled: boolean } & EngineHealth)[];
};

export const ia = {
  status: () => rpc<AiStatus>('aiStatus'),
  smart: (input: { prompt?: string; mode?: SmartMode; image?: string | null; aspect?: Aspect; context?: string; action?: TrechoAction; text?: string }) => rpc<SmartResult>('aiSmart', input),
  pareceres: (input: ParecerInput) => rpc<{ items: { n: number; text: string }[] }>('aiPareceres', input),
  chats: () => rpc<{ id: string; title: string; updated_at: string }[]>('listAiChats'),
  chat: (id: string) => rpc<{ id: string; title: string; messages: ChatMsg[] }>('getAiChat', id),
  saveChat: (input: { id?: string | null; title: string; messages: ChatMsg[] }) => rpc<{ id: string }>('saveAiChat', input),
  deleteChat: (id: string) => rpc<null>('deleteAiChat', id),
  engine: () => rpc<EngineInfo>('aiEngineInfo'),
  setEngine: (input: { id?: string; baseUrl: string; key?: string; model: string; label?: string }) => rpc<{ id: string; label: string; ms: number }>('setAiEngine', input),
  setConfig: (input: { mode?: EngineMode; enabled?: Record<string, boolean>; order?: string[] }) => rpc<null>('setAiConfig', input),
  testEngine: (id: string) => rpc<{ ok: boolean; ms: number; error?: string }>('testAiEngine', id),
  clearEngine: (id?: string) => rpc<null>('clearAiEngine', id),
};

/** A IA está ligada? (para mostrar ou esconder os botões) */
export function useAi() {
  return useQuery({ queryKey: ['ai-status'], queryFn: ia.status, staleTime: 5 * 60_000, retry: false }).data;
}

type ApiPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

/** Conversa em streaming: onText recebe o texto acumulado; devolve texto, modelo e fontes da escola. */
export async function streamChat(
  messages: { role: 'user' | 'assistant'; content: string | ApiPart[] }[],
  opts: { escola?: boolean; docIds?: string[]; signal?: AbortSignal },
  onText: (text: string, model: string) => void,
) {
  const res = await fetch('/api/ai/chat', {
    method: 'POST', credentials: 'same-origin', signal: opts.signal,
    headers: { 'content-type': 'application/json', 'x-scola': '1' },
    body: JSON.stringify({ messages, escola: opts.escola, docIds: opts.docIds }),
  });
  if (!res.ok || !res.body) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || `A IA não respondeu (${res.status}).`);
  let model = decodeURIComponent(res.headers.get('x-ai-model') || '');
  const sources = JSON.parse(decodeURIComponent(res.headers.get('x-ai-sources') || '%5B%5D')) as ChatMsg['sources'];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let raw = '';
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += dec.decode(value, { stream: true });
    const head = raw.match(/^\u001e([^\u001e]*)\u001e/); // "\u001e<quem respondeu>\u001e" no começo do fluxo
    if (head) model = head[1];
    text = raw.replace(/^\u001e[^\u001e]*\u001e/, '');
    if (head || !raw.startsWith('\u001e')) onText(text, model);
  }
  return { text: text.trim(), model, sources };
}

/* =========================== Markdown e matemática → HTML =========================== */
// HTML cru, imagens e links que não sejam http(s)/e-mail nunca entram (a tela mostra este HTML).
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
marked.use({
  gfm: true,
  renderer: {
    image: () => '',
    html: () => '',
    link(this: { parser: { parseInline: (t: Tokens.Link['tokens']) => string } }, { href, tokens }: Tokens.Link) {
      const text = this.parser.parseInline(tokens);
      return /^(https?:|mailto:)/i.test(href) ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
    },
  },
});

const SUP: Record<string, string> = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', n: 'ⁿ' };
const LATEX: [RegExp, string][] = [
  [/\\times/g, '×'], [/\\cdot/g, '·'], [/\\div/g, '÷'], [/\\pm/g, '±'], [/\\leq?/g, '≤'], [/\\geq?/g, '≥'], [/\\neq/g, '≠'], [/\\approx/g, '≈'],
  [/\\infty/g, '∞'], [/\\pi/g, 'π'], [/\\alpha/g, 'α'], [/\\beta/g, 'β'], [/\\theta/g, 'θ'], [/\\Delta/g, 'Δ'], [/\\%/g, '%'], [/\\degree|\^\{?\\circ\}?/g, '°'],
  [/\\rightarrow|\\to/g, '→'], [/\\Rightarrow/g, '⇒'], [/\\quad|\\qquad|\\,|\\;|\\!/g, ' '], [/\\left|\\right/g, ''], [/\\(?:text|mathrm)\{([^{}]*)\}/g, '$1'],
  [/\\(?:d|t)?frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1/$2'], [/\\sqrt\{([^{}]*)\}/g, '√($1)'], [/\\boxed\{([^{}]*)\}/g, '**$1**'],
];
function math(t: string) {
  let s = t;
  for (let i = 0; i < 3; i++) for (const [re, to] of LATEX) s = s.replace(re, to); // frações aninhadas
  s = s.replace(/\^\{([0-9+\-n]+)\}|\^([0-9n])/g, (_m, a: string, b: string) => [...(a ?? b)].map((c) => SUP[c] ?? c).join(''));
  return s.replace(/√\((\w+)\)/g, '√$1').replace(/\(([0-9]+\/[0-9]+)\)/g, '$1').replace(/[{}]/g, '').replace(/\\([a-zA-Z]+)/g, '$1');
}
/** LaTeX (\frac{3}{8}, $x^2$, \times) → texto legível (3/8, x², ×), fora de blocos de código. */
export const delatex = (md: string) =>
  md.split(/(```[\s\S]*?```|`[^`\n]*`)/).map((part, i) => (i % 2 ? part : part
    .replace(/\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g, (_m, a?: string, b?: string) => `\n\n${math(a ?? b ?? '').trim()}\n\n`)
    .replace(/\\\((.*?)\\\)/g, (_m, x: string) => math(x))
    .replace(/\$([^$\n]{1,200}?)\$/g, (m, x: string) => (/[\\^_{}]/.test(x) ? math(x) : m)) // "custa $5 e $10" fica
    .replace(/\\(?:d|t)?frac\{[^{}]*\}\{[^{}]*\}|\\sqrt\{[^{}]*\}|\\(?:times|cdot|div|pm|leq?|geq?|neq|approx|infty|pi|rightarrow|Rightarrow)\b/g, math)))
    .join('');

export const mdToHtml = (md: string) => marked.parse(delatex(md), { async: false }) as string;

/* ===================================== Imagens ===================================== */
export type ImageTool = 'girar' | 'pb' | 'contraste' | 'colorir';
const loadImg = (src: string) =>
  new Promise<HTMLImageElement>((ok, bad) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => ok(img);
    img.onerror = () => bad(new Error('Não consegui abrir a imagem.'));
    img.src = src;
  });

/** Qualquer imagem → JPEG em data URL com no máximo `max` px (leve para enviar e guardar). */
export async function toDataUrl(src: string | Blob, max = 1400) {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  try {
    const img = await loadImg(url);
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(img.naturalWidth * s)), height: Math.max(1, Math.round(img.naturalHeight * s)) });
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  } finally {
    if (typeof src !== 'string') URL.revokeObjectURL(url);
  }
}

export async function imageAspect(src: string): Promise<Aspect> {
  const img = await loadImg(src);
  const r = img.naturalWidth / img.naturalHeight;
  return r > 1.15 ? 'paisagem' : r < 0.87 ? 'retrato' : 'quadrado';
}

/** Ajustes sem IA, no navegador: girar, preto e branco, contraste e "para colorir" (contorno Sobel). */
export async function applyTool(src: string, tool: ImageTool) {
  const img = await loadImg(src);
  const [w, h] = [img.naturalWidth, img.naturalHeight];
  const c = Object.assign(document.createElement('canvas'), tool === 'girar' ? { width: h, height: w } : { width: w, height: h });
  const g = c.getContext('2d', { willReadFrequently: true })!;
  if (tool === 'girar') {
    g.translate(h, 0);
    g.rotate(Math.PI / 2);
    g.drawImage(img, 0, 0);
    return c.toDataURL('image/jpeg', 0.9);
  }
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, w, h);
  const p = data.data;
  const gray = new Float32Array(w * h).map((_, i) => 0.299 * p[i * 4] + 0.587 * p[i * 4 + 1] + 0.114 * p[i * 4 + 2]);
  const set = (i: number, v: number) => (p[i * 4] = p[i * 4 + 1] = p[i * 4 + 2] = v);
  if (tool === 'pb') gray.forEach((v, i) => set(i, v));
  else if (tool === 'contraste') for (let i = 0; i < w * h * 4; i++) if (i % 4 !== 3) p[i] = Math.max(0, Math.min(255, (p[i] - 128) * 1.35 + 128));
  else {
    const blur = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += gray[(y + dy) * w + x + dx];
      blur[y * w + x] = s / 9;
    }
    const mag = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = blur[i - w + 1] + 2 * blur[i + 1] + blur[i + w + 1] - blur[i - w - 1] - 2 * blur[i - 1] - blur[i + w - 1];
      const gy = blur[i + w - 1] + 2 * blur[i + w] + blur[i + w + 1] - blur[i - w - 1] - 2 * blur[i - w] - blur[i - w + 1];
      mag[i] = Math.hypot(gx, gy);
    }
    const t = Math.max(1, ...mag) * 0.12;
    mag.forEach((m, i) => set(i, m > t ? 0 : 255));
  }
  g.putImageData(data, 0, 0);
  return c.toDataURL(tool === 'colorir' ? 'image/png' : 'image/jpeg', 0.9);
}

/* ============================== Anexos e texto de arquivos ============================== */
export type Attachment = { name: string; kind: 'doc' | 'image'; text?: string; image?: string };
export const ACCEPT = '.docx,.xlsx,.xlsm,.xls,.ods,.pdf,.pptx,.txt,.md,.csv,.tsv,.json,.html,.htm,image/*';
const MAX_CHARS = 250_000; // ~100 páginas

async function pdfDoc(buf: ArrayBuffer) {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  return pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
}

/** Texto do arquivo (Word, planilhas, PDF, PowerPoint, texto) ou '' se não tiver texto aproveitável. */
export async function extractText(blob: Blob, name: string) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const buf = await blob.arrayBuffer();
  let t = '';
  if (ext === 'docx') t = (await (await import('mammoth')).extractRawText({ arrayBuffer: buf })).value;
  else if (['xlsx', 'xlsm', 'xls', 'ods'].includes(ext)) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buf, { type: 'array' });
    t = wb.SheetNames.map((n) => `Aba ${n}\n${XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, blankrows: false }).map((r) => r.map((c) => String(c ?? '').trim()).filter(Boolean).join(' | ')).filter(Boolean).join('\n')}`).join('\n\n');
  } else if (ext === 'pdf') {
    const doc = await pdfDoc(buf);
    for (let n = 1; n <= Math.min(doc.numPages, 80); n++) t += `${(await (await doc.getPage(n)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ')}\n\n`;
  } else if (ext === 'pptx') {
    const zip = await (await import('jszip')).default.loadAsync(buf);
    const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => parseInt(a.replace(/\D/g, '')) - parseInt(b.replace(/\D/g, '')));
    for (const f of slides) t += `${(await zip.files[f].async('string')).replace(/<\/a:p>/g, '\n').replace(/<[^>]+>/g, '')}\n\n`;
  } else if (['txt', 'md', 'csv', 'tsv', 'json', 'html', 'htm'].includes(ext)) t = new TextDecoder().decode(buf);
  return t.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_CHARS);
}

/** Anexo da conversa: documento vira texto; imagem e PDF escaneado (5 primeiras páginas) viram imagem. */
export async function readAttachment(file: File): Promise<Attachment[]> {
  if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name}: maior que 25 MB.`);
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext)) return [{ name: file.name, kind: 'image', image: await toDataUrl(file) }];
  if (ext === 'doc') throw new Error(`${file.name}: Word antigo (.doc). Salve como .docx e anexe de novo.`);
  if (!ACCEPT.includes(`.${ext},`) && !ACCEPT.endsWith(`.${ext}`)) throw new Error(`${file.name}: formato não suportado.`);
  const text = await extractText(file, file.name).catch(() => '');
  if (text.length > 30) return [{ name: file.name, kind: 'doc', text }];
  if (ext !== 'pdf') throw new Error(`${file.name}: não encontrei texto neste arquivo.`);
  const doc = await pdfDoc(await file.arrayBuffer());
  const pages: Attachment[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, 5); n++) {
    const page = await doc.getPage(n);
    const vp0 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(2, 1400 / Math.max(vp0.width, vp0.height)) });
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(vp.width), height: Math.round(vp.height) });
    await page.render({ canvasContext: c.getContext('2d')!, viewport: vp, canvas: c } as never).promise;
    pages.push({ name: `${file.name} (pág. ${n})`, kind: 'image', image: c.toDataURL('image/jpeg', 0.82) });
  }
  return pages;
}

/* ========================= Conteúdos da escola (índice de busca) ========================= */
/** Trechos de ~900 caracteres, quebrando em parágrafos e frases, com um pouco de sobreposição. */
function chunkText(text: string, size = 900, overlap = 120) {
  const out: string[] = [];
  let cur = '';
  for (const p of text.split(/\n{2,}|(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/).flatMap((p) => (p.length > size ? p.match(new RegExp(`.{1,${size}}`, 'gs')) ?? [] : [p]))) {
    if (cur && cur.length + p.length + 1 > size) {
      out.push(cur);
      cur = `${cur.slice(-overlap)} ${p}`;
    } else cur = cur ? `${cur}\n${p}` : p;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

type RagStatus = { total: number; ready: number; pending: { id: string; name: string; kind: string; google_kind: string | null }[] };
const EXPORT_EXT: Record<string, string> = { document: '.docx', spreadsheet: '.xlsx', presentation: '.pptx' };

/**
 * Prepara a busca: o navegador lê os documentos novos ou editados do Planejamento (o servidor tem
 * pouca CPU) e o servidor atualiza avisos, calendários, planejamentos e provas. Devolve os sem texto.
 */
export async function prepareSchool(onProgress: (label: string) => void) {
  const st = await rpc<RagStatus>('ragStatus');
  const skipped: string[] = [];
  for (const [i, d] of st.pending.entries()) {
    onProgress(`Preparando ${i + 1} de ${st.pending.length}: ${d.name}`);
    let chunks: string[] = [];
    try {
      const r = await fetch(d.kind === 'google' ? `/api/google/export/${d.id}` : `/api/files/${d.id}`, { credentials: 'same-origin' });
      if (!r.ok) throw new Error();
      chunks = chunkText(await extractText(await r.blob(), d.kind === 'google' ? d.name + (EXPORT_EXT[d.google_kind ?? ''] ?? '') : d.name));
    } catch {
      skipped.push(d.name); // sem texto aproveitável: não tenta de novo a cada vez
    }
    await rpc('ragIndexDoc', d.id, chunks).catch(() => {}); // falha do provedor: tenta na próxima vez
  }
  onProgress('Preparando avisos, calendário, planejamentos e provas');
  for (let guard = 0; guard < 50; guard++) if (!(await rpc<{ remaining: number }>('ragSync').catch(() => ({ remaining: 0 }))).remaining) break;
  return skipped;
}

/* ========================== Word e Planejamento a partir de HTML ========================== */
/** HTML → conteúdo do editor do Planejamento (mesmas extensões do editor de documentos). */
async function htmlToDocJson(html: string) {
  const [{ Editor }, { default: StarterKit }, { TableKit }, { default: Image }, { default: TextAlign }, { default: Highlight }, ts] = await Promise.all([
    import('@tiptap/core'), import('@tiptap/starter-kit'), import('@tiptap/extension-table'), import('@tiptap/extension-image'),
    import('@tiptap/extension-text-align'), import('@tiptap/extension-highlight'), import('@tiptap/extension-text-style'),
  ]);
  const ed = new Editor({
    extensions: [StarterKit, ts.TextStyle, ts.Color, ts.FontSize, Highlight.configure({ multicolor: true }), TextAlign.configure({ types: ['heading', 'paragraph'] }), TableKit, Image.configure({ allowBase64: true })],
    content: html,
  });
  const json = ed.getJSON();
  ed.destroy();
  return json;
}

export function downloadBlob(blob: Blob, name: string) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name.replace(/[\\/:*?"<>|]/g, '-') });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export async function downloadDocx(title: string, html: string) {
  const { docToDocx } = await import('./docxConvert');
  downloadBlob(await docToDocx(await htmlToDocJson(html), title), `${title.slice(0, 80) || 'documento'}.docx`);
}

/** Cria um documento editável no Planejamento com este conteúdo. Devolve o id. */
export async function saveToPlanejamento(title: string, html: string, segment: string) {
  const name = title.trim().slice(0, 90) || 'Documento da IA';
  const json = await htmlToDocJson(html);
  const { id } = await createEditableDoc({ kind: 'doc', name, segment });
  const { docToDocx } = await import('./docxConvert');
  await saveDocContent(id, { content: json, file: await docToDocx(json, name), baseVersion: 0, kind: 'doc', name });
  return id;
}
