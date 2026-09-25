/**
 * Cores com SIGNIFICADO — padrão único para chamadas, notas, avaliações e relatórios.
 *   ok   (verde)    presente, aprovado, frequência/nota em dia, entregue
 *   warn (laranja)  atenção: recuperação, perto do mínimo, prova
 *   bad  (vermelho) falta, abaixo do mínimo
 *   none (neutro)   sem dado / informação
 * Amarelo e preto são a MARCA (botões, menu) — nunca indicam situação.
 */
import { MEDIA_APROVACAO } from './types';

export type Tone = 'ok' | 'warn' | 'bad' | 'none';

export const TONE: Record<Tone, { text: string; soft: string; solid: string; bar: string; dot: string; border: string }> = {
  ok: { text: 'text-green-700', soft: 'bg-green-50 text-green-700 ring-green-200', solid: 'bg-green-600 text-white', bar: 'bg-green-500', dot: 'bg-green-500', border: 'border-green-200' },
  warn: { text: 'text-orange-600', soft: 'bg-orange-50 text-orange-700 ring-orange-200', solid: 'bg-orange-500 text-white', bar: 'bg-orange-500', dot: 'bg-orange-500', border: 'border-orange-200' },
  bad: { text: 'text-red-600', soft: 'bg-red-50 text-red-700 ring-red-200', solid: 'bg-red-600 text-white', bar: 'bg-red-500', dot: 'bg-red-500', border: 'border-red-200' },
  none: { text: 'text-foreground', soft: 'bg-muted text-muted-foreground ring-border', solid: 'bg-neutral-800 text-white', bar: 'bg-neutral-400', dot: 'bg-neutral-300', border: 'border-border' },
};

/** Nota (em qualquer escala): ≥ 60% do máximo = verde; 50–59% = laranja; abaixo = vermelho. */
export function gradeTone(value: number | null | undefined, max = 10): Tone {
  if (value == null || !Number.isFinite(value)) return 'none';
  const ratio = value / (max || 10);
  const pass = MEDIA_APROVACAO / 10;
  if (ratio >= pass) return 'ok';
  if (ratio >= pass - 0.1) return 'warn';
  return 'bad';
}

/** Frequência (%): no mínimo = verde; até 10 pontos abaixo = laranja; abaixo disso = vermelho. */
export function freqTone(pct: number | null | undefined, min = 75): Tone {
  if (pct == null || !Number.isFinite(pct)) return 'none';
  if (pct >= min) return 'ok';
  if (pct >= min - 10) return 'warn';
  return 'bad';
}

/** Situação por média: Aprovado (verde) ou Recuperação (laranja; vermelho se muito abaixo). */
export function situationOf(media: number | null | undefined): { label: string; tone: Tone } {
  if (media == null) return { label: '—', tone: 'none' };
  if (media >= MEDIA_APROVACAO) return { label: 'Aprovado', tone: 'ok' };
  return { label: 'Recuperação', tone: gradeTone(media) === 'bad' ? 'bad' : 'warn' };
}
