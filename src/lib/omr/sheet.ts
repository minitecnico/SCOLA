/**
 * Folha de respostas para impressão (SVG em milímetros, A4).
 * Tudo vem de layout.ts — a mesma geometria que a câmera usa para ler.
 */
import { LETTERS, MARKER, MARKERS, PAGE, QR, keyPayload, qrPayload, sheetLayout } from './layout';

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

/**
 * QR em SVG, posicionado na página. Na folha do aluno, correção "M" cabe na
 * versão 1 (21×21): módulos maiores, legíveis com a folha mais longe da câmera.
 */
async function qrSvg(text: string, box: { x: number; y: number; size: number } = QR, level: 'M' | 'Q' = 'M'): Promise<string> {
  const QRCode = await import('qrcode');
  const svg = await QRCode.toString(text, { type: 'svg', margin: 0, errorCorrectionLevel: level, color: { dark: '#000000', light: '#ffffff' } });
  return svg.replace('<svg ', `<svg x="${box.x}" y="${box.y}" width="${box.size}" height="${box.size}" `);
}

/** QR como imagem, para mostrar na tela. */
export async function qrDataUrl(text: string): Promise<string> {
  const QRCode = await import('qrcode');
  return QRCode.toDataURL(text, { margin: 1, width: 480, errorCorrectionLevel: 'M' });
}

export interface KeyInfo extends SheetInfo {
  key: string[];
  points: number;
}

/**
 * Gabarito do professor (A4): as respostas certas + o QR que abre a correção desta
 * prova com este gabarito. Fica com o professor — não vai para os alunos.
 */
export async function keyCardSvg(info: KeyInfo, origin = window.location.origin): Promise<string> {
  const Q = { x: 140, y: 40, size: 58 };
  const qr = await qrSvg(keyPayload(origin, info.examCode, info.choices, info.points, info.key, info.questions), Q, 'M');
  const n = info.questions;
  const k = info.choices;
  const p: string[] = [];
  // Faixa de aviso
  p.push(`<rect x="0" y="0" width="${PAGE.w}" height="14" fill="#000"/>`);
  p.push(`<text x="12" y="9.2" font-size="4.2" font-weight="800" fill="#fff">GABARITO DO PROFESSOR</text>`);
  p.push(`<text x="${PAGE.w - 12}" y="9.2" font-size="3.2" font-weight="600" fill="#fff" text-anchor="end">NÃO ENTREGUE AOS ALUNOS</text>`);
  // Dados da prova (recortados para não invadir o QR)
  p.push(`<clipPath id="khdr"><rect x="0" y="14" width="${Q.x - 4}" height="90"/></clipPath><g clip-path="url(#khdr)">`);
  p.push(`<text x="12" y="27" font-size="3.4" fill="#444">${esc(info.school.toUpperCase())}</text>`);
  p.push(`<text x="12" y="36" font-size="6" font-weight="800">${esc(info.title)}</text>`);
  p.push(`<text x="12" y="43" font-size="3.6" fill="#333">${esc(info.className)}${info.date ? ` · ${br(info.date)}` : ''}</text>`);
  const facts = [
    ['Questões', String(n)],
    ['Alternativas', `A a ${LETTERS[k - 1]}`],
    ['Valor', String(info.points).replace('.', ',')],
    ['Código', info.examCode],
  ];
  facts.forEach(([l, v], i) => {
    const x = 12 + i * 30;
    p.push(`<text x="${x}" y="54" font-size="2.7" fill="#666">${l.toUpperCase()}</text>`);
    p.push(`<text x="${x}" y="60.5" font-size="5" font-weight="800">${esc(v)}</text>`);
  });
  // Como corrigir
  const steps = [
    'Aponte a câmera do celular para o QR ao lado: a correção',
    'desta prova abre já com este gabarito.',
    'Passe as folhas dos alunos, uma atrás da outra. Cada nota é',
    'salva sozinha (e vai para o diário, se estiver configurado).',
  ];
  p.push(`<text x="12" y="74" font-size="3" font-weight="700">COMO CORRIGIR</text>`);
  p.push(`<circle cx="14" cy="80" r="2.2" fill="#000"/><text x="14" y="81.1" font-size="3" font-weight="800" fill="#fff" text-anchor="middle">1</text>`);
  p.push(`<text x="19" y="81" font-size="3.1" fill="#222">${steps[0]}</text><text x="19" y="85.5" font-size="3.1" fill="#222">${steps[1]}</text>`);
  p.push(`<circle cx="14" cy="92" r="2.2" fill="#000"/><text x="14" y="93.1" font-size="3" font-weight="800" fill="#fff" text-anchor="middle">2</text>`);
  p.push(`<text x="19" y="93" font-size="3.1" fill="#222">${steps[2]}</text><text x="19" y="97.5" font-size="3.1" fill="#222">${steps[3]}</text>`);
  p.push('</g>');
  // QR do professor
  p.push(`<rect x="${Q.x - 3}" y="${Q.y - 3}" width="${Q.size + 6}" height="${Q.size + 6}" rx="3" fill="none" stroke="#000" stroke-width="0.5"/>`);
  p.push(qr);
  p.push(`<text x="${Q.x + Q.size / 2}" y="${Q.y + Q.size + 8}" font-size="3" font-weight="700" text-anchor="middle">QR DO PROFESSOR</text>`);
  p.push(`<text x="${Q.x + Q.size / 2}" y="${Q.y + Q.size + 12.5}" font-size="2.6" fill="#555" text-anchor="middle">abre a correção com o gabarito</text>`);

  // Respostas certas (bolinha preenchida), em colunas de até 15
  const top = 122;
  p.push(`<line x1="12" y1="${top - 8}" x2="${PAGE.w - 12}" y2="${top - 8}" stroke="#000" stroke-width="0.3"/>`);
  p.push(`<text x="12" y="${top - 2}" font-size="3.2" font-weight="800">RESPOSTAS</text>`);
  const perCol = 15;
  const cols = Math.ceil(n / perCol);
  const colW = (PAGE.w - 24) / Math.max(cols, 2);
  const rowH = 10;
  for (let q = 0; q < n; q++) {
    const c = Math.floor(q / perCol);
    const r = q % perCol;
    const x0 = 12 + c * colW;
    const y = top + 8 + r * rowH;
    const ans = info.key[q] ?? '';
    p.push(`<text x="${x0 + 7}" y="${y + 1.4}" font-size="3.8" font-weight="800" text-anchor="end">${String(q + 1).padStart(2, '0')}</text>`);
    if (ans === 'X') {
      p.push(`<text x="${x0 + 10}" y="${y + 1.3}" font-size="3.2" font-weight="700" fill="#555">ANULADA</text>`);
      continue;
    }
    for (let a = 0; a < k; a++) {
      const cx = x0 + 12.5 + a * 6.2;
      const on = LETTERS[a] === ans;
      p.push(`<circle cx="${cx}" cy="${y}" r="2.4" fill="${on ? '#000' : '#fff'}" stroke="${on ? '#000' : '#aaa'}" stroke-width="0.3"/>`);
      p.push(`<text x="${cx}" y="${y + 1.05}" font-size="2.8" font-weight="${on ? 800 : 500}" text-anchor="middle" fill="${on ? '#fff' : '#aaa'}">${LETTERS[a]}</text>`);
    }
    if (!ans) p.push(`<text x="${x0 + 12.5 + k * 6.2}" y="${y + 1.1}" font-size="2.6" fill="#c00">sem resposta</text>`);
  }
  p.push(`<text x="${PAGE.w / 2}" y="291.5" font-size="2.5" text-anchor="middle" fill="#888">SCOLA · gabarito da prova ${esc(info.examCode)} · se o gabarito for alterado no sistema, imprima de novo</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAGE.w} ${PAGE.h}" width="${PAGE.w}mm" height="${PAGE.h}mm" font-family="Inter, Arial, sans-serif">
<rect width="${PAGE.w}" height="${PAGE.h}" fill="#fff"/>
${p.join('\n')}
</svg>`;
}

export async function printKeyCard(info: KeyInfo) {
  await printPages([await keyCardSvg(info)], `Gabarito do professor - ${info.title} - ${info.className}`);
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

/**
 * Imprime uma folha por aluno (e folhas avulsas, se pedido) direto desta página:
 * as folhas entram num contêiner que só aparece na impressão. Sem abrir aba nova,
 * funciona em qualquer navegador (inclusive celular e navegadores embutidos).
 */
export async function printSheets(info: SheetInfo, students: { id: string; name: string }[], blanks = 0) {
  const pages: string[] = [];
  for (const s of students) pages.push(await sheetSvg(info, s));
  for (let i = 0; i < blanks; i++) pages.push(await sheetSvg(info, null));
  await printPages(pages, `Folhas de resposta - ${info.title} - ${info.className}`);
}

/** Páginas A4 (SVG) num contêiner que só aparece na impressão. */
async function printPages(pages: string[], title: string) {
  if (!pages.length) return;
  document.getElementById('scola-print')?.remove();
  document.getElementById('scola-print-style')?.remove();

  const style = document.createElement('style');
  style.id = 'scola-print-style';
  style.textContent = `
    #scola-print { display: none; }
    @media print {
      @page { size: A4 portrait; margin: 0; }
      html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; height: auto !important; overflow: visible !important; }
      body > *:not(#scola-print) { display: none !important; }
      #scola-print { display: block !important; }
      #scola-print .page { width: 210mm; height: 297mm; overflow: hidden; break-after: page; page-break-after: always; }
      #scola-print .page:last-child { break-after: auto; page-break-after: auto; }
      #scola-print .page svg { display: block; width: 210mm; height: 297mm; }
    }`;
  const root = document.createElement('div');
  root.id = 'scola-print';
  // Cada folha com ids próprios (o recorte do cabeçalho usa um id no SVG).
  root.innerHTML = pages.map((p, i) => `<div class="page">${p.replace(/(k?hdr)/g, `$1${i}`)}</div>`).join('');
  document.head.appendChild(style);
  document.body.appendChild(root);

  const prevTitle = document.title;
  document.title = title;
  const cleanup = () => {
    document.title = prevTitle;
    root.remove();
    style.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  // Dá tempo de o navegador montar as imagens (logo) antes de abrir a impressão.
  await new Promise((r) => setTimeout(r, 150));
  window.print();
}
