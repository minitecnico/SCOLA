export function fmtNumber(n: number | null | undefined, decimals = 1): string {
  if (n == null || Number.isNaN(n)) return '—';
  const fixed = n.toFixed(decimals);
  // troca ponto por vírgula
  return fixed.replace('.', ',');
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/** Data local de hoje (ou de `d`) como yyyy-mm-dd — sem o deslocamento de fuso do toISOString. */
export const localIso = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** "agora", "há 5 min", "há 3 h", "ontem", "há 12 dias" — e a data completa depois de 30 dias. */
export function timeAgo(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return 'ontem';
  if (d < 30) return `há ${d} dias`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

/** Número pt-BR com até 2 casas (notas, pontos): 7,5 · 10 · 8,25. */
export const fmtScore = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

/** "2026-10-06" → "06/10". */
export const fmtDM = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** "06/10 14:30" — dia, mês e hora de um instante ISO. */
export const fmtDayTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
