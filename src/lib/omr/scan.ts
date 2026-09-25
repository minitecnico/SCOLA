/**
 * Leitura da folha de respostas pela câmera (roda 100% no aparelho, sem servidor).
 *
 *  1. Tons de cinza + limiar adaptativo (resiste a sombra e luz desigual).
 *  2. Componentes conectados → acha as 4 marcas de canto (anel com miolo),
 *     ignorando os quadradinhos do próprio QR code.
 *  3. Homografia folha(mm) → foto(px): corrige inclinação e perspectiva.
 *  4. Mede a escuridão de cada bolinha em relação ao papel ao redor e decide
 *     a alternativa marcada, apontando dupla marcação e leituras duvidosas.
 */
import { LETTERS, MARKERS, QR, sheetLayout, type SheetLayout } from './layout';

export interface Img {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}
export type Pt = { x: number; y: number };
export type H = number[]; // homografia 3×3 (9 valores, h[8] = 1)

export interface ScanResult {
  answers: string[]; // "A".."E" · "" em branco · "*" mais de uma
  uncertain: number[]; // questões que merecem conferência
  fill: number[][]; // escuridão de cada bolinha (0–1) [questão][alternativa]
  corners: Pt[]; // marcas encontradas na foto (TL, TR, BR, BL)
  h: H;
  layout: SheetLayout;
}

/* --------------------------------- Imagem ---------------------------------- */
export function toGray(img: Img): Uint8Array {
  const { data, width, height } = img;
  const g = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
  return g;
}

/** Limiar adaptativo de Bradley (média local por imagem integral). 1 = escuro. */
function adaptiveThreshold(g: Uint8Array, w: number, h: number, t = 0.18): Uint8Array {
  const ii = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += g[y * w + x];
      ii[(y + 1) * (w + 1) + x + 1] = ii[y * (w + 1) + x + 1] + row;
    }
  }
  const s = Math.max(8, Math.round(Math.min(w, h) / 14)) >> 1;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - s);
    const y1 = Math.min(h - 1, y + s);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - s);
      const x1 = Math.min(w - 1, x + s);
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = ii[(y1 + 1) * (w + 1) + x1 + 1] - ii[y0 * (w + 1) + x1 + 1] - ii[(y1 + 1) * (w + 1) + x0] + ii[y0 * (w + 1) + x0];
      out[y * w + x] = g[y * w + x] * count < sum * (1 - t) ? 1 : 0;
    }
  }
  return out;
}

interface Blob {
  area: number;
  cx: number;
  cy: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Componentes conectados (4-vizinhança) com union-find. */
function blobs(bin: Uint8Array, w: number, h: number, minArea: number): Blob[] {
  const labels = new Int32Array(w * h);
  const parent = new Int32Array((w * h) / 2 + 2);
  const find = (a: number) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  let next = 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!bin[i]) continue;
      const left = x > 0 ? labels[i - 1] : 0;
      const up = y > 0 ? labels[i - w] : 0;
      if (!left && !up) {
        if (next >= parent.length) return []; // imagem ruidosa demais
        parent[next] = next;
        labels[i] = next++;
      } else if (left && up) {
        const a = find(left);
        const b = find(up);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
        labels[i] = Math.min(a, b);
      } else labels[i] = left || up;
    }
  }
  const idx = new Int32Array(next).fill(-1);
  const out: Blob[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = labels[y * w + x];
      if (!l) continue;
      const r = find(l);
      let k = idx[r];
      if (k < 0) {
        k = idx[r] = out.length;
        out.push({ area: 0, cx: 0, cy: 0, minX: x, maxX: x, minY: y, maxY: y });
      }
      const b = out[k];
      b.area++;
      b.cx += x;
      b.cy += y;
      if (x < b.minX) b.minX = x;
      if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y;
      if (y > b.maxY) b.maxY = y;
    }
  }
  return out
    .filter((b) => b.area >= minArea)
    .map((b) => ({ ...b, cx: b.cx / b.area, cy: b.cy / b.area }));
}

/* ------------------------------ Marcas de canto ----------------------------- */
interface Marker extends Pt {
  size: number;
}

/** Anel escuro com um miolo escuro no centro (o miolo é outro componente). */
function findMarkers(bin: Uint8Array, w: number, h: number): Marker[] {
  const minArea = Math.max(12, (w * h) / 60000);
  const all = blobs(bin, w, h, minArea / 6);
  const rings = all.filter((b) => {
    const bw = b.maxX - b.minX + 1;
    const bh = b.maxY - b.minY + 1;
    const fill = b.area / (bw * bh);
    return b.area >= minArea && b.area < (w * h) / 40 && bw / bh > 0.4 && bw / bh < 2.5 && fill > 0.2 && fill < 0.85;
  });
  const out: Marker[] = [];
  for (const r of rings) {
    const size = Math.max(r.maxX - r.minX, r.maxY - r.minY);
    const core = all.find(
      (c) =>
        c !== r &&
        Math.hypot(c.cx - r.cx, c.cy - r.cy) < size * 0.14 &&
        c.minX > r.minX && c.maxX < r.maxX && c.minY > r.minY && c.maxY < r.maxY &&
        r.area / c.area > 1.3 && r.area / c.area < 9,
    );
    if (core) out.push({ x: (r.cx + core.cx) / 2, y: (r.cy + core.cy) / 2, size });
  }
  return out;
}

const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
function quadArea(p: Pt[]) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}
function orderCyclic(p: Pt[]): Pt[] {
  const c = { x: p.reduce((s, q) => s + q.x, 0) / p.length, y: p.reduce((s, q) => s + q.y, 0) / p.length };
  // Em coordenadas de imagem (y para baixo), ângulo crescente = sentido horário na tela.
  return [...p].sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));
}
const inPoly = (p: Pt, poly: Pt[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

/**
 * Escolhe as 4 marcas e as ordena como TL, TR, BR, BL.
 * O QR fica acima da borda de cima: a aresta mais próxima dele é o topo —
 * assim a folha pode estar girada em qualquer sentido.
 */
export function locateCorners(img: Img, qr?: Pt[] | null): Pt[] | null {
  const g = toGray(img);
  const bin = adaptiveThreshold(g, img.width, img.height);
  let cands = findMarkers(bin, img.width, img.height);
  if (qr && qr.length >= 3) {
    // Exclui os padrões do próprio QR (um pouco de folga em volta dele).
    const c = { x: qr.reduce((s, q) => s + q.x, 0) / qr.length, y: qr.reduce((s, q) => s + q.y, 0) / qr.length };
    const grown = qr.map((q) => ({ x: c.x + (q.x - c.x) * 1.25, y: c.y + (q.y - c.y) * 1.25 }));
    cands = cands.filter((m) => !inPoly(m, grown));
  }
  if (cands.length < 4) return null;
  cands.sort((a, b) => b.size - a.size);
  const top = cands.slice(0, 9);
  let best: Pt[] | null = null;
  let bestArea = 0;
  for (let a = 0; a < top.length; a++)
    for (let b = a + 1; b < top.length; b++)
      for (let c = b + 1; c < top.length; c++)
        for (let d = c + 1; d < top.length; d++) {
          const quad = orderCyclic([top[a], top[b], top[c], top[d]]);
          // Precisa ser convexo.
          const signs = quad.map((_, i) => Math.sign(cross(quad[i], quad[(i + 1) % 4], quad[(i + 2) % 4])));
          if (!signs.every((s) => s === signs[0])) continue;
          const sizes = [top[a], top[b], top[c], top[d]].map((m) => m.size);
          if (Math.min(...sizes) < Math.max(...sizes) * 0.4) continue;
          const area = quadArea(quad);
          if (area > bestArea) {
            bestArea = area;
            best = quad;
          }
        }
  if (!best || bestArea < img.width * img.height * 0.08) return null;

  // Qual aresta é o topo? A mais próxima do QR (ou, sem QR, a de cima na imagem).
  let topEdge = 0;
  let bestDist = Infinity;
  const ref = qr && qr.length ? { x: qr.reduce((s, q) => s + q.x, 0) / qr.length, y: qr.reduce((s, q) => s + q.y, 0) / qr.length } : null;
  for (let i = 0; i < 4; i++) {
    const m = { x: (best[i].x + best[(i + 1) % 4].x) / 2, y: (best[i].y + best[(i + 1) % 4].y) / 2 };
    const dist = ref ? Math.hypot(m.x - ref.x, m.y - ref.y) : m.y;
    if (dist < bestDist) {
      bestDist = dist;
      topEdge = i;
    }
  }
  const ordered = [0, 1, 2, 3].map((k) => best![(topEdge + k) % 4]);
  // Proporção esperada entre os lados (176 × 210 mm): recusa quadriláteros absurdos.
  const d = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.y - q.y);
  const wTop = d(ordered[0], ordered[1]);
  const hLeft = d(ordered[0], ordered[3]);
  const ratio = hLeft / wTop / (210 / 176);
  if (ratio < 0.55 || ratio > 1.8) return null;
  return ordered;
}

/* -------------------------------- Homografia -------------------------------- */
/** Resolve H tal que H·src ≈ dst (4 pares de pontos). */
export function homography(src: Pt[], dst: Pt[]): H {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  // Eliminação de Gauss com pivoteamento parcial.
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < 8; r++) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(8).fill(0);
  for (let r = 7; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < 8; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return [...x, 1];
}
export function project(h: H, p: Pt): Pt {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

function sample(g: Uint8Array, w: number, h: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return 255;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * w + x0;
  return g[i] * (1 - fx) * (1 - fy) + g[i + 1] * fx * (1 - fy) + g[i + w] * (1 - fx) * fy + g[i + w + 1] * fx * fy;
}

/* ------------------------------ Leitura completa ----------------------------- */
export function readSheet(img: Img, questions: number, choices: number, qr?: Pt[] | null): ScanResult | null {
  const corners = locateCorners(img, qr);
  return corners ? readAt(img, questions, choices, corners) : null;
}

/** Lê as bolinhas a partir dos 4 cantos já localizados (TL, TR, BR, BL). */
export function readAt(img: Img, questions: number, choices: number, corners: Pt[]): ScanResult {
  const layout = sheetLayout(questions, choices);
  const h = homography([...MARKERS], corners);
  const g = toGray(img);
  const { width: W, height: Hh } = img;

  // Pontos de amostragem (em mm, relativos ao centro): miolo e anel de papel em volta.
  const r = layout.bubbleR;
  const inner: Pt[] = [];
  for (let dy = -0.62; dy <= 0.62; dy += 0.155)
    for (let dx = -0.62; dx <= 0.62; dx += 0.155) if (dx * dx + dy * dy <= 0.62 * 0.62) inner.push({ x: dx * r, y: dy * r });
  const ring: Pt[] = Array.from({ length: 16 }, (_, i) => {
    const t = (i / 16) * Math.PI * 2;
    return { x: Math.cos(t) * r * 1.55, y: Math.sin(t) * r * 1.55 };
  });

  const fill: number[][] = Array.from({ length: layout.questions }, () => new Array(layout.choices).fill(0));
  for (const b of layout.bubbles) {
    let sum = 0;
    for (const o of inner) {
      const p = project(h, { x: b.x + o.x, y: b.y + o.y });
      sum += sample(g, W, Hh, p.x, p.y);
    }
    const papers = ring.map((o) => {
      const p = project(h, { x: b.x + o.x, y: b.y + o.y });
      return sample(g, W, Hh, p.x, p.y);
    });
    papers.sort((a, c) => a - c);
    const paper = Math.max(40, papers[Math.floor(papers.length * 0.75)]);
    fill[b.q][b.a] = Math.max(0, Math.min(1, 1 - sum / inner.length / paper));
  }

  // Limiar pela distribuição da própria folha: a maioria das bolinhas está vazia.
  const flat = fill.flat().sort((a, c) => a - c);
  const base = flat[Math.floor(flat.length * 0.5)];
  const hi = flat[Math.floor(flat.length * 0.97)];
  const thr = base + Math.max(0.16, (hi - base) * 0.42);

  const answers: string[] = [];
  const uncertain: number[] = [];
  fill.forEach((row, q) => {
    const order = row.map((v, a) => ({ v, a })).sort((x, y) => y.v - x.v);
    const marked = order.filter((o) => o.v >= thr);
    if (marked.length === 0) {
      answers.push('');
      if (order[0].v > thr - 0.07) uncertain.push(q);
    } else if (marked.length === 1) {
      answers.push(LETTERS[marked[0].a]);
      if (marked[0].v < thr + 0.07 || (order[1] && order[1].v > thr - 0.07)) uncertain.push(q);
    } else {
      // Uma bem mais escura que as outras = rasura apagada; senão, dupla marcação.
      if (marked[0].v - marked[1].v > 0.25) {
        answers.push(LETTERS[marked[0].a]);
        uncertain.push(q);
      } else {
        answers.push('*');
      }
    }
  });

  return { answers, uncertain, fill, corners, h, layout };
}

/* --------------------------------- QR code ---------------------------------- */
export interface QrHit {
  text: string;
  corners: Pt[];
}

type Detector = { detect: (src: ImageBitmapSource) => Promise<{ rawValue: string; cornerPoints: Pt[] }[]> };
let nativeDetector: Detector | null | undefined;

/** Lê o QR: usa o leitor nativo do aparelho quando existe; senão, jsQR. */
export async function decodeQr(img: Img): Promise<QrHit | null> {
  if (nativeDetector === undefined) {
    const BD = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    try {
      nativeDetector = BD ? new BD({ formats: ['qr_code'] }) : null;
    } catch {
      nativeDetector = null;
    }
  }
  if (nativeDetector) {
    try {
      const found = await nativeDetector.detect(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height));
      const hit = found.find((f) => f.rawValue.startsWith('S1:'));
      if (hit) return { text: hit.rawValue, corners: hit.cornerPoints };
    } catch {
      /* cai no jsQR */
    }
  }
  const { default: jsQR } = await import('jsqr');
  const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
  if (!r) return null;
  const l = r.location;
  return { text: r.data, corners: [l.topLeftCorner, l.topRightCorner, l.bottomRightCorner, l.bottomLeftCorner] };
}

/**
 * Encontra a folha: QR + cantos, já na orientação certa.
 * Se o QR estiver pequeno demais para ler direto, localiza a folha pelas marcas,
 * "recorta e amplia" a região do QR (testando os 4 sentidos) e lê de novo.
 */
export async function findSheet(img: Img): Promise<{ text: string | null; corners: Pt[] | null } | null> {
  const qr = await decodeQr(img);
  if (qr) return { text: qr.text, corners: locateCorners(img, qr.corners) };
  const base = locateCorners(img, null);
  if (!base) return null;
  const { default: jsQR } = await import('jsqr');
  const g = toGray(img);
  const PX = 8; // px por mm no recorte
  const pad = 3;
  const size = Math.round((QR.size + pad * 2) * PX);
  const out = new Uint8ClampedArray(size * size * 4);
  for (let rot = 0; rot < 4; rot++) {
    const corners = [0, 1, 2, 3].map((k) => base[(rot + k) % 4]);
    const h = homography([...MARKERS], corners);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const p = project(h, { x: QR.x - pad + x / PX, y: QR.y - pad + y / PX });
        const v = sample(g, img.width, img.height, p.x, p.y);
        const o = (y * size + x) * 4;
        out[o] = out[o + 1] = out[o + 2] = v;
        out[o + 3] = 255;
      }
    const r = jsQR(out, size, size, { inversionAttempts: 'dontInvert' });
    if (r && r.data.startsWith('S1:')) return { text: r.data, corners };
  }
  // Achou a folha, mas o QR está pequeno demais: a folha está longe.
  return { text: null, corners: base };
}
