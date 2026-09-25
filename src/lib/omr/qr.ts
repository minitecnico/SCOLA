/**
 * Leitura de QR code com o ZXing (C++ compilado para WebAssembly): lê QR pequeno,
 * torto, com pouca luz, borrado ou parcialmente sujo — bem mais robusto que o jsQR.
 * O arquivo .wasm é servido pelo próprio app (e fica no cache do PWA): funciona offline.
 * Se o WebAssembly não carregar, cai no jsQR para nunca ficar sem leitura.
 */
import type { Pt } from './scan';

export interface QrRead {
  text: string;
  corners: Pt[]; // TL, TR, BR, BL (na orientação do próprio QR)
}

type Pixels = { data: Uint8ClampedArray; width: number; height: number };

let zxing: Promise<typeof import('zxing-wasm/reader') | null> | null = null;

function loadZxing() {
  zxing ??= (async () => {
    try {
      const [mod, wasm] = await Promise.all([import('zxing-wasm/reader'), import('zxing-wasm/reader/zxing_reader.wasm?url')]);
      await mod.prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasm.default : prefix + path) }, fireImmediately: true });
      return mod;
    } catch {
      return null;
    }
  })();
  return zxing;
}

/** Começa a baixar o leitor antes de precisar (ao abrir a câmera). */
export const warmUpQr = () => void loadZxing();

/**
 * Lê todos os QR codes da imagem. `hard` = procura com mais esforço
 * (usado no recorte ampliado, quando a folha está longe).
 */
export async function readQrCodes(img: Pixels, hard = false): Promise<QrRead[]> {
  const z = await loadZxing();
  if (z) {
    try {
      const found = await z.readBarcodes(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), {
        formats: ['QRCode'],
        tryHarder: true,
        tryRotate: true,
        tryInvert: false,
        tryDownscale: true,
        tryDenoise: hard,
        maxNumberOfSymbols: 4,
      });
      return found
        .filter((r) => r.isValid && r.text)
        .map((r) => ({ text: r.text, corners: [r.position.topLeft, r.position.topRight, r.position.bottomRight, r.position.bottomLeft] }));
    } catch {
      /* cai no jsQR */
    }
  }
  const { default: jsQR } = await import('jsqr');
  const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
  if (!r) return [];
  const l = r.location;
  return [{ text: r.data, corners: [l.topLeftCorner, l.topRightCorner, l.bottomRightCorner, l.bottomLeftCorner] }];
}

/** Qual leitor está ativo (diagnóstico). */
export const qrEngine = async () => ((await loadZxing()) ? 'zxing' : 'jsqr');
