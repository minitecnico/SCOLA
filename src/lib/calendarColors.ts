import type { CalCategory } from "./types";

/** Cores do calendário escolar: categorias vivas e sólidas, fáceis de achar de relance. */

/** Paleta categórica de alto contraste: matizes bem espaçados no círculo cromático
 *  para que cores vizinhas (na lista e no calendário) nunca se confundam ao bater o olho. */
export const CAT_PALETTE = ["#DC2626", "#2563EB", "#16A34A", "#EA580C", "#7C3AED", "#0891B2", "#DB2777", "#65A30D", "#4338CA", "#CA8A04", "#92400E", "#475569"];
/** Cores por tipo de categoria conhecido (feriado = vermelho, avaliação = azul…) — usadas para migrar calendários antigos em cinza. */
const CAT_BY_NAME: [RegExp, string][] = [
  [/feriado|recesso|f[ée]rias/i, "#DC2626"],
  [/avalia|prova|teste/i, "#2563EB"],
  [/pedag|reuni|conselho|forma[cç]/i, "#7C3AED"],
  [/evento|cultur|festa|gincana/i, "#16A34A"],
  [/recupera/i, "#EA580C"],
  [/comemor/i, "#DB2777"],
  [/marco|per[ií]odo|trimestre|in[ií]cio|fim/i, "#0891B2"],
];
const isGray = (hex: string) => {
  const { r, g, b } = hexToRgb(hex);
  return Math.max(r, g, b) - Math.min(r, g, b) < 24;
};
/** Calendários criados quando a paleta era toda cinza ganham cores vivas (só quem ainda está em cinza/preto). */
export function vividCategories(cats: CalCategory[]): CalCategory[] {
  const used = new Set(cats.filter((c) => !isGray(c.color)).map((c) => c.color.toUpperCase()));
  return cats.map((c) => {
    if (!isGray(c.color)) return c;
    const byName = CAT_BY_NAME.find(([re]) => re.test(c.label))?.[1];
    const color = byName && !used.has(byName) ? byName : CAT_PALETTE.find((p) => !used.has(p)) ?? CAT_PALETTE[0];
    used.add(color);
    return { ...c, color };
  });
}

export function hexToRgb(hex: string) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h || "000000", 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
/** Texto legível (preto/branco) sobre qualquer cor — escolhe o de maior contraste (WCAG). */
export function readableText(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.3 ? "#111111" : "#FFFFFF";
}

export const HOLIDAY_COLOR = "#DC2626"; // feriado nacional (vermelho)
export const LOCAL_HOLIDAY_COLOR = "#92400E"; // feriado estadual/municipal (marrom)
