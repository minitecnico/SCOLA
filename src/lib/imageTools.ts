/**
 * Ajustes de imagem feitos no navegador (sem IA, instantâneos e sem custo):
 * girar, preto e branco, contraste e "para colorir" (contorno preto em fundo branco).
 */
export type ImageTool = 'girar' | 'pb' | 'contraste' | 'colorir';

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, bad) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => ok(img);
    img.onerror = () => bad(new Error('Não consegui abrir a imagem.'));
    img.src = src;
  });
}

/** Qualquer imagem (arquivo, colada, do documento) → JPEG/PNG em data URL, no máximo `max` px. */
export async function toDataUrl(src: string | Blob, max = 1400): Promise<string> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  try {
    const img = await load(url);
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * s));
    c.height = Math.max(1, Math.round(img.naturalHeight * s));
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  } finally {
    if (typeof src !== 'string') URL.revokeObjectURL(url);
  }
}

export async function imageAspect(src: string): Promise<'paisagem' | 'retrato' | 'quadrado'> {
  const img = await load(src);
  const r = img.naturalWidth / img.naturalHeight;
  return r > 1.15 ? 'paisagem' : r < 0.87 ? 'retrato' : 'quadrado';
}

export async function applyTool(src: string, tool: ImageTool): Promise<string> {
  const img = await load(src);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const c = document.createElement('canvas');
  if (tool === 'girar') {
    c.width = h;
    c.height = w;
    const g = c.getContext('2d')!;
    g.translate(h, 0);
    g.rotate(Math.PI / 2);
    g.drawImage(img, 0, 0);
    return c.toDataURL('image/jpeg', 0.9);
  }
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, w, h);
  const p = data.data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * p[i * 4] + 0.587 * p[i * 4 + 1] + 0.114 * p[i * 4 + 2];

  if (tool === 'pb' || tool === 'contraste') {
    for (let i = 0; i < w * h; i++) {
      if (tool === 'pb') p[i * 4] = p[i * 4 + 1] = p[i * 4 + 2] = gray[i];
      else for (let k = 0; k < 3; k++) p[i * 4 + k] = Math.max(0, Math.min(255, (p[i * 4 + k] - 128) * 1.35 + 128));
    }
  } else {
    // Para colorir: bordas (Sobel) sobre a imagem suavizada → linhas pretas grossas em fundo branco.
    const blur = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += gray[(y + dy) * w + x + dx];
        blur[y * w + x] = s / 9;
      }
    const mag = new Float32Array(w * h);
    let maxM = 1;
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = blur[i - w + 1] + 2 * blur[i + 1] + blur[i + w + 1] - blur[i - w - 1] - 2 * blur[i - 1] - blur[i + w - 1];
        const gy = blur[i + w - 1] + 2 * blur[i + w] + blur[i + w + 1] - blur[i - w - 1] - 2 * blur[i - w] - blur[i - w + 1];
        mag[i] = Math.hypot(gx, gy);
        if (mag[i] > maxM) maxM = mag[i];
      }
    const t = maxM * 0.12;
    for (let i = 0; i < w * h; i++) {
      const v = mag[i] > t ? 0 : 255;
      p[i * 4] = p[i * 4 + 1] = p[i * 4 + 2] = v;
    }
  }
  g.putImageData(data, 0, 0);
  return c.toDataURL(tool === 'colorir' ? 'image/png' : 'image/jpeg', 0.9);
}
