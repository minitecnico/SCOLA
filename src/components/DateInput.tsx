import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '../lib/cn';

/**
 * Campo de data SEMPRE no padrão brasileiro (dd/mm/aaaa), independente do idioma
 * do navegador/sistema — o <input type="date"> nativo segue o idioma do aparelho
 * e aparece como mm/dd/yyyy em computadores em inglês.
 * Valor de entrada/saída continua ISO (aaaa-mm-dd), então nada muda no resto do código.
 */
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

const pad = (n: number) => String(n).padStart(2, '0');
const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const isoToBr = (iso: string | null | undefined) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

function brToIso(br: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return toIso(dt);
}

function mask(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

export function DateInput({
  value,
  onChange,
  min,
  max,
  className,
  placeholder = 'dd/mm/aaaa',
  disabled,
  'aria-label': ariaLabel,
}: {
  value: string | null | undefined;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  const [text, setText] = useState(isoToBr(value));
  useEffect(() => setText(isoToBr(value)), [value]);

  const inRange = (iso: string) => (!min || iso >= min) && (!max || iso <= max);

  function onType(v: string) {
    const next = mask(v);
    setText(next);
    if (!next) return onChange('');
    const iso = brToIso(next);
    if (iso && inRange(iso)) onChange(iso);
  }

  return (
    <div
      className={cn(
        'flex h-10 w-full items-center gap-1 rounded-lg border border-input bg-card pl-3 pr-1 text-sm transition focus-within:border-neutral-900 focus-within:ring-2 focus-within:ring-brand/40',
        disabled && 'bg-muted text-muted-foreground',
        className,
      )}
    >
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel ?? 'Data (dd/mm/aaaa)'}
        onChange={(e) => onType(e.target.value)}
        onBlur={() => setText(isoToBr(value))}
        className="w-full min-w-[6.5rem] flex-1 bg-transparent tabular-nums outline-none placeholder:text-muted-foreground"
      />
      <Popover className="relative">
        <PopoverButton
          disabled={disabled}
          aria-label="Abrir calendário"
          className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <CalendarDays size={16} />
        </PopoverButton>
        <PopoverPanel anchor="bottom end" className="z-[60] mt-1 rounded-xl border border-border bg-card p-3 shadow-lift [--anchor-gap:6px]">
          {({ close }) => <MonthGrid value={value || ''} min={min} max={max} onPick={(iso) => { onChange(iso); close(); }} />}
        </PopoverPanel>
      </Popover>
    </div>
  );
}

function MonthGrid({ value, min, max, onPick }: { value: string; min?: string; max?: string; onPick: (iso: string) => void }) {
  const today = toIso(new Date());
  const start = value || (max && today > max ? max : today);
  const [cursor, setCursor] = useState(() => new Date(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, 1));

  const days = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const total = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const cells: (string | null)[] = Array(first.getDay()).fill(null);
    for (let d = 1; d <= total; d++) cells.push(toIso(new Date(cursor.getFullYear(), cursor.getMonth(), d)));
    return cells;
  }, [cursor]);

  const move = (n: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1));
  const off = (iso: string) => (min && iso < min) || (max && iso > max);

  return (
    <div className="w-64 select-none">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => move(-1)} className="grid h-8 w-8 place-items-center rounded-md hover:bg-muted" aria-label="Mês anterior">
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-semibold text-foreground">
          {MESES[cursor.getMonth()]} de {cursor.getFullYear()}
        </span>
        <button type="button" onClick={() => move(1)} className="grid h-8 w-8 place-items-center rounded-md hover:bg-muted" aria-label="Próximo mês">
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {SEMANA.map((d, i) => (
          <span key={i} className="py-1 text-[11px] font-semibold text-muted-foreground">
            {d}
          </span>
        ))}
        {days.map((iso, i) =>
          iso ? (
            <button
              key={iso}
              type="button"
              disabled={!!off(iso)}
              onClick={() => onPick(iso)}
              className={cn(
                'h-8 rounded-md text-sm tabular-nums transition disabled:cursor-not-allowed disabled:opacity-30',
                iso === value ? 'bg-neutral-950 font-semibold text-white' : 'text-foreground hover:bg-muted',
                iso === today && iso !== value && 'font-bold ring-1 ring-inset ring-brand',
              )}
            >
              {Number(iso.slice(8, 10))}
            </button>
          ) : (
            <span key={`e${i}`} />
          ),
        )}
      </div>
      {!off(today) ? (
        <button type="button" onClick={() => onPick(today)} className="mt-2 w-full rounded-md py-1.5 text-xs font-semibold text-foreground hover:bg-muted">
          Hoje
        </button>
      ) : null}
    </div>
  );
}
