/**
 * Geometria da folha de respostas (em milímetros, A4 retrato 210 × 297).
 * É a ÚNICA fonte da verdade: a impressão desenha a partir daqui e a leitura
 * pela câmera procura as bolinhas exatamente nestas posições.
 *
 * Quatro marcas de canto (quadrado vazado com miolo) delimitam a área das
 * respostas; com elas a câmera corrige inclinação e perspectiva da foto.
 */
export const PAGE = { w: 210, h: 297 } as const;
export const LETTERS = ['A', 'B', 'C', 'D', 'E'] as const;
export const MAX_QUESTIONS = 60;

/** Marca de canto: quadrado de 12 mm, anel de 2 mm, vão de 2 mm e miolo de 4 mm (legível mesmo de longe). */
export const MARKER = { size: 12, ring: 2, core: 4 } as const;
/** Centros das marcas: TL, TR, BR, BL (sentido horário). */
export const MARKERS = [
  { x: 17, y: 72 },
  { x: 193, y: 72 },
  { x: 193, y: 282 },
  { x: 17, y: 282 },
] as const;
/** QR code: canto superior direito, fora da área das marcas. */
export const QR = { x: 164, y: 10, size: 34 } as const;

export interface Bubble {
  q: number; // índice da questão (0-based)
  a: number; // índice da alternativa (0 = A)
  x: number;
  y: number;
  r: number;
}
export interface SheetLayout {
  questions: number;
  choices: number;
  bubbles: Bubble[];
  numbers: { q: number; x: number; y: number }[];
  letters: { a: number; x: number; y: number }[][]; // cabeçalho A B C D E de cada coluna
  bubbleR: number;
}

/** Posições de todas as bolinhas para uma prova com N questões e K alternativas. */
export function sheetLayout(questions: number, choices: number): SheetLayout {
  const n = Math.max(1, Math.min(MAX_QUESTIONS, Math.floor(questions)));
  const k = Math.max(2, Math.min(5, Math.floor(choices)));
  const cols = n <= 20 ? 1 : n <= 40 ? 2 : 3;
  const rows = Math.ceil(n / cols);

  // Área útil entre as marcas (com folga para não encostar nelas).
  const left = 30;
  const right = 180;
  const top = 88;
  const bottom = 272;
  const colW = (right - left) / cols;
  const rowH = Math.min(9, (bottom - top) / rows);
  const step = Math.min(9, (colW - 14) / k); // distância entre bolinhas
  const r = Math.min(2.7, rowH * 0.32, step * 0.34);

  const bubbles: Bubble[] = [];
  const numbers: SheetLayout['numbers'] = [];
  const letters: SheetLayout['letters'] = [];
  for (let c = 0; c < cols; c++) {
    // Centraliza o bloco (número + bolinhas) dentro da coluna.
    const blockW = 10 + step * k;
    const x0 = left + c * colW + (colW - blockW) / 2;
    letters.push(Array.from({ length: k }, (_, a) => ({ a, x: x0 + 10 + step * (a + 0.5), y: top - 4 })));
    for (let row = 0; row < rows; row++) {
      const q = c * rows + row;
      if (q >= n) break;
      const y = top + rowH * (row + 0.5);
      numbers.push({ q, x: x0 + 6, y });
      for (let a = 0; a < k; a++) bubbles.push({ q, a, x: x0 + 10 + step * (a + 0.5), y, r });
    }
  }
  return { questions: n, choices: k, bubbles, numbers, letters, bubbleR: r };
}

/** Conteúdo do QR: S1:<código da prova>:<8 primeiros do id do aluno | 0 para folha avulsa>. */
export const qrPayload = (examCode: string, studentId: string | null) =>
  `S1:${examCode.toUpperCase()}:${studentId ? studentId.replace(/-/g, '').slice(0, 8).toUpperCase() : '0'}`;

export function parseQr(text: string): { code: string; student: string | null } | null {
  const m = /^S1:([A-Z0-9]{4,12}):([A-Z0-9]{1,12})$/.exec(String(text || '').trim().toUpperCase());
  if (!m) return null;
  return { code: m[1], student: m[2] === '0' ? null : m[2] };
}

export const studentShort = (id: string) => id.replace(/-/g, '').slice(0, 8).toUpperCase();
