/**
 * Folha de respostas para impressão (SVG em milímetros, A4).
 * Tudo vem de layout.ts — a mesma geometria que a câmera usa para ler.
 */
import { LETTERS, MARKER, MARKERS, PAGE, QR, qrPayload, sheetLayout } from './layout';

export interface SheetInfo {
  school: string;
  logo?: string | null;
  title: string;
  className: string;
  date?: string | null; // yyyy-mm-dd
  examCode: string;
  questions: number;
  choices: number;
}

const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const br = (iso?: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

function marker(cx: number, cy: number) {
  const s = MARKER.size;
  const x = cx - s / 2;
  const y = cy - s / 2;
  const inset = MARKER.ring;
  const c = MARKER.core;
  // Anel = quadrado preto com furo branco (evenodd) + miolo preto.
  return `<path fill-rule="evenodd" fill="#000" d="M${x} ${y}h${s}v${s}h-${s}z M${x + inset} ${y + inset}v${s - 2 * inset}h${s - 2 * inset}v-${s - 2 * inset}z"/>
<rect x="${cx - c / 2}" y="${cy - c / 2}" width="${c}" height="${c}" fill="#000"/>`;
}

async function qrSvg(text: string): Promise<string> {
  const QRCode = await import('qrcode');
  const svg = await QRCode.toString(text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
  // Reposiciona o <svg> do QR dentro da folha.
  return svg.replace('<svg ', `<svg x="${QR.x}" y="${QR.y}" width="${QR.size}" height="${QR.size}" `);
}

/** Uma página (SVG) — com o nome do aluno, ou avulsa (nome em branco). */
export async function sheetSvg(info: SheetInfo, student: { id: string; name: string; number?: number } | null): Promise<string> {
  const L = sheetLayout(info.questions, info.choices);
  const qr = await qrSvg(qrPayload(info.examCode, student?.id ?? null));
  const hasLogo = !!info.logo;
  const tx = hasLogo ? 34 : 12;

  const parts: string[] = [];
  // Cabeçalho (recortado para nunca invadir o QR code)
  parts.push(`<clipPath id="hdr"><rect x="0" y="0" width="${QR.x - 4}" height="66"/></clipPath><g clip-path="url(#hdr)">`);
  if (hasLogo) parts.push(`<image href="${esc(info.logo!)}" x="12" y="12" width="18" height="18" preserveAspectRatio="xMidYMid meet"/>`);
  parts.push(`<text x="${tx}" y="17.5" font-size="4.6" font-weight="800">${esc(info.school.toUpperCase())}</text>`);
  parts.push(`<text x="${tx}" y="23" font-size="3.2" fill="#444">FOLHA DE RESPOSTAS · ${esc(info.className)}${info.date ? ` · ${br(info.date)}` : ''}</text>`);
  parts.push(`<text x="${tx}" y="29.5" font-size="4.2" font-weight="700">${esc(info.title)}</text>`);

  // Aluno
  parts.push(`<text x="12" y="41" font-size="3" fill="#555">ALUNO(A)</text>`);
  if (student) {
    parts.push(`<text x="12" y="47.5" font-size="5" font-weight="700">${esc(student.name)}</text>`);
  }
  parts.push(`<line x1="12" y1="49.5" x2="${QR.x - 4}" y2="49.5" stroke="#000" stroke-width="0.25"/>`);

  // Instruções
  const ix = 12;
  parts.push(`<text x="${ix}" y="56" font-size="2.9" fill="#333">Use caneta azul ou preta e preencha todo o círculo:</text>`);
  parts.push(`<circle cx="${ix + 72}" cy="55" r="1.7" fill="#000"/>`);
  parts.push(`<text x="${ix + 76}" y="56" font-size="2.9" fill="#333">certo</text>`);
  parts.push(`<circle cx="${ix + 88}" cy="55" r="1.7" fill="none" stroke="#000" stroke-width="0.25"/><path d="M${ix + 86.8} ${55} l0.9 0.9 l1.6 -1.8" stroke="#000" stroke-width="0.35" fill="none"/>`);
  parts.push(`<text x="${ix + 92}" y="56" font-size="2.9" fill="#333">errado</text>`);
  parts.push(`<text x="${ix}" y="61" font-size="2.9" fill="#333">Não rasure, não dobre e não escreva perto dos quadrados pretos dos cantos.</text>`);
  parts.push('</g>');

  // QR + código legível
  parts.push(qr);
  parts.push(`<text x="${QR.x + QR.size / 2}" y="${QR.y + QR.size + 4}" font-size="2.6" text-anchor="middle" fill="#555">${esc(info.examCode)}</text>`);

  // Marcas de canto
  for (const m of MARKERS) parts.push(marker(m.x, m.y));

  // Cabeçalho das colunas (A B C D E)
  for (const col of L.letters) for (const l of col) parts.push(`<text x="${l.x}" y="${l.y}" font-size="2.8" font-weight="700" text-anchor="middle" fill="#333">${LETTERS[l.a]}</text>`);

  // Números e bolinhas
  for (const n of L.numbers)
    parts.push(`<text x="${n.x}" y="${n.y + 1.2}" font-size="3.3" font-weight="700" text-anchor="end">${String(n.q + 1).padStart(2, '0')}</text>`);
  const fs = (L.bubbleR * 1.15).toFixed(2);
  for (const b of L.bubbles) {
    parts.push(`<circle cx="${b.x}" cy="${b.y}" r="${b.r}" fill="#fff" stroke="#222" stroke-width="0.28"/>`);
    parts.push(`<text x="${b.x}" y="${b.y + L.bubbleR * 0.4}" font-size="${fs}" text-anchor="middle" fill="#b5b5b5">${LETTERS[b.a]}</text>`);
  }

  // Rodapé
  parts.push(`<text x="${PAGE.w / 2}" y="291.5" font-size="2.5" text-anchor="middle" fill="#888">Correção automática SCOLA · prova ${esc(info.examCode)}${student ? '' : ' · folha avulsa'}</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAGE.w} ${PAGE.h}" width="${PAGE.w}mm" height="${PAGE.h}mm" font-family="Inter, Arial, sans-serif">
<rect width="${PAGE.w}" height="${PAGE.h}" fill="#fff"/>
${parts.join('\n')}
</svg>`;
}

/** Abre a impressão com uma folha por aluno (e folhas avulsas, se pedido). */
export async function printSheets(info: SheetInfo, students: { id: string; name: string }[], blanks = 0) {
  const win = window.open('', '_blank');
  if (!win) {
    alert('Permita pop-ups para imprimir as folhas.');
    return;
  }
  win.document.write('<p style="font-family:sans-serif;padding:24px">Gerando folhas…</p>');
  const pages: string[] = [];
  for (const s of students) pages.push(await sheetSvg(info, s));
  for (let i = 0; i < blanks; i++) pages.push(await sheetSvg(info, null));
  win.document.open();
  win.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/>
<title>Folhas de resposta - ${esc(info.title)} - ${esc(info.className)}</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  html, body { margin: 0; padding: 0; background: #e5e5e5; }
  .page { width: 210mm; height: 297mm; margin: 12px auto; background: #fff; box-shadow: 0 1px 6px rgba(0,0,0,.2); break-after: page; overflow: hidden; }
  .page:last-child { break-after: auto; }
  .page svg { display: block; width: 210mm; height: 297mm; }
  .tip { font-family: Inter, Arial, sans-serif; max-width: 210mm; margin: 12px auto; font-size: 13px; color: #333; }
  @media print { html, body { background: #fff; } .page { margin: 0; box-shadow: none; } .tip { display: none; } }
</style></head><body>
<p class="tip">Imprima em A4, <b>escala 100%</b> (sem "ajustar à página"), preto e branco. ${pages.length} folha(s).</p>
${pages.map((p) => `<div class="page">${p}</div>`).join('\n')}
<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 300); };</script>
</body></html>`);
  win.document.close();
}
