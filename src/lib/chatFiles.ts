import { extractText } from './rag';
import { toDataUrl } from './imageTools';

/**
 * Anexos da página "IA": o navegador lê o arquivo (o servidor não tem CPU para isso).
 * Documentos viram texto; imagens e PDFs escaneados viram imagens para a IA "enxergar".
 */
export type ChatAttachment = { name: string; kind: 'doc' | 'image'; text?: string; image?: string; note?: string };

const DOC_EXT = ['docx', 'xlsx', 'xlsm', 'xls', 'ods', 'pdf', 'pptx', 'txt', 'md', 'csv', 'tsv', 'json', 'html', 'htm'];
export const ACCEPT = '.docx,.xlsx,.xlsm,.xls,.ods,.pdf,.pptx,.txt,.md,.csv,.tsv,.json,.html,.htm,image/*';
export const MAX_FILE_MB = 25;

async function pdfPagesAsImages(file: File, max = 5): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out: string[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, max); n++) {
    const page = await doc.getPage(n);
    const vp0 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(2, 1400 / Math.max(vp0.width, vp0.height)) });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    await page.render({ canvasContext: c.getContext('2d')!, viewport: vp, canvas: c } as never).promise;
    out.push(c.toDataURL('image/jpeg', 0.82));
  }
  return out;
}

export async function readAttachment(file: File): Promise<ChatAttachment[]> {
  if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`${file.name}: maior que ${MAX_FILE_MB} MB.`);
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (file.type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic'].includes(ext)) {
    return [{ name: file.name, kind: 'image', image: await toDataUrl(file, 1400) }];
  }
  if (ext === 'doc') throw new Error(`${file.name}: Word antigo (.doc). Salve como .docx e anexe de novo.`);
  if (!DOC_EXT.includes(ext)) throw new Error(`${file.name}: formato não suportado.`);
  const text = await extractText(file, file.name).catch(() => '');
  if (text.trim().length > 30) return [{ name: file.name, kind: 'doc', text }];
  if (ext === 'pdf') {
    // PDF escaneado (sem texto): as primeiras páginas vão como imagem.
    const pages = await pdfPagesAsImages(file);
    return pages.map((image, i) => ({ name: `${file.name} (pág. ${i + 1})`, kind: 'image' as const, image, note: 'PDF escaneado' }));
  }
  throw new Error(`${file.name}: não encontrei texto neste arquivo.`);
}
