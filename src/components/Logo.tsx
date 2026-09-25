import { cn } from '../lib/cn';

/** Marca SCOLA: quadrado amarelo com "S" preto + nome. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('h-9 w-9 shrink-0', className)} aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#FACC15" />
      <path
        d="M44 20.5c-2.6-3-6.9-4.5-11.6-4.5-7.4 0-12.4 3.9-12.4 9.6 0 5.6 4.6 7.7 11 9l2.6.5c4 .8 5.7 1.8 5.7 3.9 0 2.4-2.6 4-6.6 4-4.4 0-7.8-1.7-10-4.6l-4.7 4.4c3.2 3.9 8.4 6.2 14.6 6.2 8 0 13.2-4 13.2-10.3 0-5.5-3.6-8.1-10.9-9.5l-2.6-.5c-3.8-.7-5.2-1.6-5.2-3.4 0-2.1 2.2-3.5 5.6-3.5 3.3 0 5.9 1.1 7.8 3.1z"
        fill="#0A0A0A"
      />
    </svg>
  );
}

export function Logo({ variant = 'light', compact = false }: { variant?: 'light' | 'dark'; compact?: boolean }) {
  const dark = variant === 'dark';
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark className={compact ? 'h-8 w-8' : undefined} />
      <div className="leading-none">
        <p className={cn('text-lg font-extrabold tracking-[0.18em]', dark ? 'text-white' : 'text-neutral-950')}>SCOLA</p>
        {compact ? null : (
          <p className={cn('mt-1 text-[10px] font-medium uppercase tracking-[0.16em]', dark ? 'text-neutral-500' : 'text-neutral-500')}>Gestão escolar</p>
        )}
      </div>
    </div>
  );
}
