/** Extrai o texto de um arquivo no navegador e quebra em trechos para o assistente (o Worker não tem CPU para isso). */
export const MAX_CHARS = 250_000; // ~ 100 páginas; o excedente é ignorado

async function docxText(buf: ArrayBuffer) {
  const mammoth = await import('mammoth');
  return (await mammoth.extractRawText({ arrayBuffer: buf })).value;
}

async function sheetText(buf: ArrayBuffer) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'array' });
  return wb.SheetNames.map((n) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, blankrows: false });
    return `Aba ${n}\n` + rows.map((r) => r.map((c) => String(c ?? '').trim()).filter(Boolean).join(' | ')).filter(Boolean).join('\n');
  }).join('\n\n');
}

async function pdfText(buf: ArrayBuffer) {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const out: string[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, 80); n++) {
    const c = await (await doc.getPage(n)).getTextContent();
    out.push(c.items.map((i) => ('str' in i ? i.str : '')).join(' '));
  }
  return out.join('\n\n');
}

/** Texto do arquivo, ou '' se o formato não tem texto aproveitável (imagem, PDF escaneado...). */
export async function extractText(blob: Blob, name: string): Promise<string> {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const buf = await blob.arrayBuffer();
  let t = '';
  if (ext === 'docx') t = await docxText(buf);
  else if (['xlsx', 'xlsm', 'xls', 'ods'].includes(ext)) t = await sheetText(buf);
  else if (ext === 'pdf') t = await pdfText(buf);
  else if (['txt', 'md', 'csv', 'tsv', 'json', 'html', 'htm'].includes(ext)) t = new TextDecoder().decode(buf);
  else if (ext === 'pptx') {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buf);
    const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => parseInt(a.replace(/\D/g, '')) - parseInt(b.replace(/\D/g, '')));
    for (const f of slides) t += (await zip.files[f].async('string')).replace(/<\/a:p>/g, '\n').replace(/<[^>]+>/g, '') + '\n\n';
  }
  return t.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_CHARS);
}

/** Trechos de ~900 caracteres, quebrando em parágrafos/frases, com um pouco de sobreposição. */
export function chunkText(text: string, size = 900, overlap = 120): string[] {
  const parts = text.split(/\n{2,}|(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/).flatMap((p) => (p.length > size ? p.match(new RegExp(`.{1,${size}}`, 'gs')) ?? [] : [p]));
  const chunks: string[] = [];
  let cur = '';
  for (const p of parts) {
    if (cur && cur.length + p.length + 1 > size) {
      chunks.push(cur);
      cur = cur.slice(-overlap) + ' ' + p;
    } else cur = cur ? `${cur}\n${p}` : p;
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}
