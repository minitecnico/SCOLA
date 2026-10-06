import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/cn';
import { localIso } from '../lib/format';
import { readableText, vividColor } from '../lib/calendarColors';
import { dashboardMonth, type DashboardMonth, type UpcomingEvent } from '../lib/queries';
import type { Tone } from '../lib/tone';
import { UpcomingList } from './DashboardAgenda';

/**
 * Painéis do Início no estilo "widget": título em caixa alta com ícone, corpo limpo.
 * Um único calendário do mês, com duas visões: eventos da escola e presença das chamadas.
 */
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const SEMANA = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D']; // começa na segunda
const pad = (n: number) => String(n).padStart(2, '0');
const pct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

export function Widget({ icon, title, action, children, className, bodyClassName }: { icon: ReactNode; title: string; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-soft', className)}>
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
        <span className="text-muted-foreground">{icon}</span>
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-bold uppercase tracking-[0.04em] text-foreground">{title}</h2>
        {action}
      </header>
      <div className={cn('flex-1', bodyClassName)}>{children}</div>
    </section>
  );
}

function useMonth() {
  const now = new Date();
  const [cur, setCur] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const move = (n: number) =>
    setCur((c) => {
      const d = new Date(c.y, c.m - 1 + n, 1);
      return { y: d.getFullYear(), m: d.getMonth() + 1 };
    });
  const q = useQuery({ queryKey: ['dash-month', cur.y, cur.m], queryFn: () => dashboardMonth(cur.y, cur.m), staleTime: 60_000 });
  return { ...cur, move, data: q.data as DashboardMonth | undefined };
}

type DayMark = { cls: string; style?: React.CSSProperties; tip: ReactNode; onClick?: () => void };

function MonthGrid({ y, m, move, marks }: { y: number; m: number; move: (n: number) => void; marks: Map<string, DayMark> }) {
  const today = localIso();
  const cells = useMemo(() => {
    const first = new Date(y, m - 1, 1);
    const lead = (first.getDay() + 6) % 7; // segunda = 0
    const total = new Date(y, m, 0).getDate();
    return [...Array(lead).fill(null), ...Array.from({ length: total }, (_, i) => `${y}-${pad(m)}-${pad(i + 1)}`)] as (string | null)[];
  }, [y, m]);
  return (
    <div className="px-4 pb-4 pt-3">
      <div className="mb-2 flex items-center justify-between">
        <button onClick={() => move(-1)} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Mês anterior">
          <ChevronLeft size={17} />
        </button>
        <p className="text-sm font-semibold text-foreground">
          {MESES[m - 1]} {y}
        </p>
        <button onClick={() => move(1)} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Próximo mês">
          <ChevronRight size={17} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center">
        {SEMANA.map((d, i) => (
          <span key={i} className="pb-1 text-[11px] font-semibold text-muted-foreground">
            {d}
          </span>
        ))}
        {cells.map((iso, i) => {
          if (!iso) return <span key={`e${i}`} />;
          const mk = marks.get(iso);
          const day = Number(iso.slice(8));
          return (
            <span key={iso} className="group relative grid place-items-center">
              <button
                type="button"
                onClick={mk?.onClick}
                disabled={!mk?.onClick}
                style={mk?.style}
                className={cn(
                  'grid h-8 w-8 place-items-center rounded-full text-[13px] tabular-nums transition',
                  mk ? mk.cls : 'text-foreground',
                  iso === today && 'ring-2 ring-neutral-900 ring-offset-1 ring-offset-card',
                  mk?.onClick && 'hover:brightness-95',
                )}
              >
                {day}
              </button>
              {mk ? (
                <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden w-max max-w-[14rem] -translate-x-1/2 rounded-lg bg-neutral-950 px-2.5 py-1.5 text-left text-[11px] leading-snug text-white shadow-lift group-hover:block">
                  {mk.tip}
                </span>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

const Legend = ({ items }: { items: { dot: string; label: string; style?: React.CSSProperties }[] }) => (
  <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
    {items.map((it) => (
      <span key={it.label} className="inline-flex items-center gap-1.5">
        <span className={cn('h-2.5 w-2.5 rounded-full', it.dot)} style={it.style} />
        {it.label}
      </span>
    ))}
  </div>
);

const dayTone = (p: number | null): Tone => (p == null ? 'none' : p >= 90 ? 'ok' : p >= 75 ? 'warn' : 'bad');
const DAY_CLS: Record<Tone, string> = {
  ok: 'bg-green-100 font-semibold text-green-800',
  warn: 'bg-orange-100 font-semibold text-orange-800',
  bad: 'bg-red-100 font-semibold text-red-800',
  none: 'bg-muted font-semibold text-foreground',
};

/** Dias com chamada, coloridos pela presença do dia (todas as turmas). */
function attendanceMarks(data: DashboardMonth | undefined, open: (date: string) => void) {
  const marks = new Map<string, DayMark>();
  for (const d of data?.days ?? []) {
    marks.set(d.date, {
      cls: DAY_CLS[dayTone(d.pct)],
      tip: (
        <>
          <b>{d.date.split('-').reverse().join('/')}</b>
          <br />
          {d.sessions} chamada(s) · {d.pct != null ? `${pct(d.pct)} de presença` : 'sem alunos'}
          <br />
          {d.total - d.present} falta(s)
        </>
      ),
      onClick: () => open(d.date),
    });
  }
  return { marks, legend: ATTENDANCE_LEGEND };
}
const ATTENDANCE_LEGEND = [
  { dot: 'bg-green-500', label: '90% ou mais' },
  { dot: 'bg-orange-500', label: '75–89%' },
  { dot: 'bg-red-500', label: 'abaixo de 75%' },
];

/** Eventos do calendário escolar no mês, em cor sólida por categoria (evento de vários dias marca cada dia). */
function schoolMarks(data: DashboardMonth | undefined, y: number, m: number, open: () => void) {
  const byDay = new Map<string, DashboardMonth['events']>();
  for (const e of data?.events ?? []) {
    const end = new Date(`${e.end || e.date}T12:00:00`);
    for (let d = new Date(`${e.date}T12:00:00`); d <= end; d = new Date(d.getTime() + 86400_000)) {
      const iso = localIso(d);
      if (iso.startsWith(`${y}-${pad(m)}`)) byDay.set(iso, [...(byDay.get(iso) ?? []), e]);
    }
  }
  const marks = new Map<string, DayMark>();
  for (const [iso, list] of byDay) {
    const color = vividColor(list[0].category, list[0].color);
    marks.set(iso, {
      cls: 'font-bold',
      style: { background: color, color: readableText(color) },
      tip: list.map((e, i) => (
        <span key={i} className="block">
          <b>{e.title}</b> · {e.category}
        </span>
      )),
      onClick: open,
    });
  }
  const cats = new Map<string, string>();
  (data?.events ?? []).forEach((e) => cats.set(e.category, vividColor(e.category, e.color)));
  return { marks, legend: [...cats.entries()].map(([label, color]) => ({ dot: '', label, style: { background: color } })) };
}

type View = 'escola' | 'chamadas';

/**
 * Calendário do mês do Início: uma só grade, duas visões (Escola · Chamadas).
 * Na visão da escola, os próximos compromissos ficam logo abaixo — sem painel repetido.
 */
export function MonthCalendarWidget({ upcoming, showAttendance }: { upcoming: UpcomingEvent[]; showAttendance: boolean }) {
  const navigate = useNavigate();
  const { y, m, move, data } = useMonth();
  const [view, setView] = useState<View>('escola');
  const current: View = showAttendance ? view : 'escola';

  const { marks, legend } = useMemo(
    () => (current === 'chamadas' ? attendanceMarks(data, (date) => navigate('/chamadas', { state: { date } })) : schoolMarks(data, y, m, () => navigate('/calendario'))),
    [current, data, y, m, navigate],
  );

  const tabs = (
    <div className="inline-flex gap-0.5 rounded-lg bg-muted p-0.5 text-xs font-semibold" role="tablist" aria-label="Visão do calendário">
      {([['escola', 'Escola'], ['chamadas', 'Chamadas']] as const).map(([id, label]) => (
        <button
          key={id}
          role="tab"
          aria-selected={current === id}
          onClick={() => setView(id)}
          className={cn('rounded-md px-2.5 py-1 transition', current === id ? 'bg-card text-foreground shadow-soft' : 'text-muted-foreground hover:text-foreground')}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <Widget icon={<CalendarDays size={17} />} title="Calendário" action={showAttendance ? tabs : undefined}>
      <MonthGrid y={y} m={m} move={move} marks={marks} />
      {legend.length ? (
        <Legend items={legend} />
      ) : (
        <p className="border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
          {current === 'chamadas' ? 'Nenhuma chamada neste mês.' : 'Nenhum evento neste mês.'}
        </p>
      )}
      {current === 'escola' ? <UpcomingList events={upcoming} /> : null}
    </Widget>
  );
}
