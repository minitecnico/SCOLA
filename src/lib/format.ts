export function fmtNumber(n: number | null | undefined, decimals = 1): string {
  if (n == null || Number.isNaN(n)) return '—';
  const fixed = n.toFixed(decimals);
  // troca ponto por vírgula
  return fixed.replace('.', ',');
}

export function fmtInteger(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return String(n);
}
