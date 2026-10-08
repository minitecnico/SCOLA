import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';

/* Gráficos leves em SVG/HTML (sem biblioteca): responsivos, com dica ao passar o dedo/mouse e só tons de cinza (vermelho = problema). */
export const INK = '#0A0A0A';
export const GRAY = '#737373';
export const SOFT = '#BDBDBD';
export const BAD = '#DC2626';

/** Largura real do elemento (reage a rotação de tela e menu lateral). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.round(el.clientWidth)));
    ro.observe(el);
    setW(Math.round(el.clientWidth));
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Marcas "redondas" para o eixo (1, 2, 5 × 10ⁿ). */
function ticks(max: number, n = 4) {
  const raw = Math.max(max, 1) / n;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((m) => m * p >= raw) ?? 10) * p;
  return Array.from({ length: Math.ceil(Math.max(max, 1) / step) + 1 }, (_, i) => i * step);
}

export interface Series {
  name: string;
  data: number[];
  color?: string;
  kind?: 'line' | 'area' | 'bar';
  dashed?: boolean;
}

/** Série temporal: linhas, áreas e/ou barras no mesmo eixo, com dica que acompanha o dedo. */
export function Chart({ labels, tips, series, height = 190, fmt = (n) => String(Math.round(n * 10) / 10) }: { labels: string[]; tips?: string[]; series: Series[]; height?: number; fmt?: (n: number) => string }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  const L = 34, R = 8, T = 8, B = 22;
  const pw = Math.max(1, w - L - R);
  const ph = height - T - B;
  const ts = ticks(Math.max(0, ...series.flatMap((s) => s.data)));
  const top = ts[ts.length - 1] || 1;
  const hasBar = series.some((s) => s.kind === 'bar');
  const band = pw / Math.max(n, 1);
  const x = (i: number) => L + (hasBar ? band * (i + 0.5) : n > 1 ? (pw * i) / (n - 1) : pw / 2);
  const y = (v: number) => T + ph - (v / top) * ph;
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / 58))));
  const bars = series.filter((s) => s.kind === 'bar');
  const path = (s: Series) => s.data.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {w > 0 ? (
        <svg width={w} height={height} role="img" aria-label={series.map((s) => s.name).join(', ')} onPointerLeave={() => setHover(null)}
          onPointerMove={(e) => {
            const px = e.clientX - e.currentTarget.getBoundingClientRect().left - L;
            setHover(Math.min(n - 1, Math.max(0, Math.round(hasBar ? px / band - 0.5 : (px / pw) * (n - 1)))));
          }}>
          {ts.map((t) => (
            <g key={t}>
              <line x1={L} x2={w - R} y1={y(t)} y2={y(t)} stroke="#E5E5E5" />
              <text x={L - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill={GRAY}>{fmt(t)}</text>
            </g>
          ))}
          {labels.map((l, i) => (i % every === 0 ? <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fontSize="10" fill={GRAY}>{l}</text> : null))}
          {series.map((s) => {
            const c = s.color ?? INK;
            if (s.kind === 'bar') {
              const k = bars.indexOf(s);
              const bw = Math.max(1, (band * 0.7) / bars.length);
              return <g key={s.name}>{s.data.map((v, i) => <rect key={i} x={x(i) - (bw * bars.length) / 2 + k * bw} y={y(v)} width={Math.max(1, bw - 1)} height={Math.max(0, T + ph - y(v))} rx={1.5} fill={c} opacity={hover === i ? 1 : 0.85} />)}</g>;
            }
            return (
              <g key={s.name}>
                {s.kind === 'area' ? <path d={`${path(s)}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`} fill={c} opacity={0.08} /> : null}
                <path d={path(s)} fill="none" stroke={c} strokeWidth={2} strokeLinejoin="round" strokeDasharray={s.dashed ? '4 4' : undefined} />
              </g>
            );
          })}
          {hover != null ? (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={T} y2={T + ph} stroke={GRAY} strokeDasharray="3 3" />
              {series.filter((s) => s.kind !== 'bar').map((s) => <circle key={s.name} cx={x(hover)} cy={y(s.data[hover])} r={3.5} fill="#fff" stroke={s.color ?? INK} strokeWidth={2} />)}
            </g>
          ) : null}
        </svg>
      ) : null}
      {hover != null && w > 0 ? (
        <div className="pointer-events-none absolute top-1 z-10 min-w-[8rem] rounded-lg bg-neutral-950 px-2.5 py-1.5 text-xs text-white shadow-lift" style={{ left: Math.min(Math.max(4, x(hover) - 64), w - 140) }}>
          <p className="mb-0.5 font-bold">{tips?.[hover] ?? labels[hover]}</p>
          {series.map((s) => (
            <p key={s.name} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-full" style={{ background: s.color ?? INK, outline: '1px solid #fff6' }} />{s.name}</span>
              <b className="tabular-nums">{fmt(s.data[hover])}</b>
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Mini-gráfico de linha (tendência dentro de cartões e tabelas). */
export function Spark({ data, w = 72, h = 22, color = INK }: { data: number[]; w?: number; h?: number; color?: string }) {
  const max = Math.max(1, ...data);
  const pts = data.map((v, i) => `${((w * i) / Math.max(1, data.length - 1)).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(' ');
  return <svg width={w} height={h} className="shrink-0" aria-hidden><polyline points={pts} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

/** Variação contra o período anterior. `good`: o que é bom — subir ou descer. */
export function Delta({ cur, prev, good = 'up' }: { cur: number; prev: number; good?: 'up' | 'down' }) {
  if (!prev && !cur) return <span className="text-xs font-semibold text-muted-foreground">—</span>;
  const pct = prev ? ((cur - prev) / prev) * 100 : null;
  const flat = pct != null && Math.abs(pct) < 1;
  const better = (cur > prev) === (good === 'up');
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-bold tabular-nums', flat || cur === prev ? 'text-muted-foreground' : better ? 'text-foreground' : 'text-red-600')} title="Contra o período anterior de mesma duração">
      {flat || cur === prev ? '▬' : cur > prev ? '▲' : '▼'} {pct == null ? 'novo' : `${Math.abs(Math.round(pct))}%`}
    </span>
  );
}

/** Barras horizontais com rótulo e valor (rankings). */
export function HBars({ items, fmt = (n) => String(n) }: { items: { label: string; value: number; hint?: ReactNode; bad?: boolean }[]; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.label}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate font-semibold">{i.label}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground"><b className="text-foreground">{fmt(i.value)}</b>{i.hint ? <> · {i.hint}</> : null}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${(i.value / max) * 100}%`, background: i.bad ? BAD : INK }} /></div>
        </li>
      ))}
    </ul>
  );
}

const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
/** Mapa de calor semana × hora (grade[dia 0=dom][hora]). Começa na segunda. */
export function Heat({ grid }: { grid: number[][] }) {
  const max = Math.max(1, ...grid.flat());
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div className="grid gap-[3px]" style={{ gridTemplateColumns: 'auto repeat(24, minmax(0, 1fr))' }} role="img" aria-label="Atividade por dia da semana e hora">
      <span />
      {Array.from({ length: 24 }, (_, h) => <span key={h} className="text-center text-[9px] leading-none text-muted-foreground">{h % 3 === 0 ? h : ''}</span>)}
      {order.map((d) => (
        <div key={d} className="contents">
          <span className="pr-1.5 text-[10px] font-semibold leading-[1.6] text-muted-foreground">{DOW[d]}</span>
          {grid[d].map((v, h) => <span key={h} title={`${DOW[d]}, ${h}h: ${v} ação(ões)`} className="aspect-square rounded-[3px] bg-neutral-900" style={{ opacity: v ? 0.08 + 0.92 * (v / max) : 0.04 }} />)}
        </div>
      ))}
    </div>
  );
}

const SHADES = [INK, '#7A7A7A', '#B5B5B5', '#DADADA'];
/** Rosca com legenda (composição: dispositivos, perfis…). */
export function Donut({ parts }: { parts: { label: string; value: number }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const r = 15.9;
  let acc = 0;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 36 36" className="h-24 w-24 shrink-0 -rotate-90" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(', ')}>
        <circle cx="18" cy="18" r={r} fill="none" stroke="#F0F0F0" strokeWidth="5" />
        {total ? parts.map((p, i) => {
          const len = (p.value / total) * 100;
          const el = <circle key={p.label} cx="18" cy="18" r={r} fill="none" stroke={SHADES[i % SHADES.length]} strokeWidth="5" strokeDasharray={`${Math.max(0, len - 0.6)} ${100 - len + 0.6}`} strokeDashoffset={-acc} />;
          acc += len;
          return el;
        }) : null}
      </svg>
      <ul className="min-w-0 flex-1 space-y-1 text-sm">
        {parts.map((p, i) => (
          <li key={p.label} className="flex items-center gap-2">
            <i className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: SHADES[i % SHADES.length] }} />
            <span className="min-w-0 flex-1 truncate font-medium">{p.label}</span>
            <b className="tabular-nums">{total ? Math.round((p.value / total) * 100) : 0}%</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
