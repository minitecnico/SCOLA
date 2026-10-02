import { CalendarDays, ChevronDown, ClipboardList, ExternalLink, FileSpreadsheet, FileText, GraduationCap, HardDrive, Loader2, Mail, Plus, Presentation, Video, Youtube, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { GoogleKind } from '../lib/queries';
import { cn } from '../lib/cn';

const CREATE: { kind: GoogleKind; label: string; icon: LucideIcon; color: string }[] = [
  { kind: 'document', label: 'Documento', icon: FileText, color: 'bg-blue-600' },
  { kind: 'spreadsheet', label: 'Planilha', icon: FileSpreadsheet, color: 'bg-green-600' },
  { kind: 'presentation', label: 'Apresentação', icon: Presentation, color: 'bg-yellow-500' },
  { kind: 'form', label: 'Formulário', icon: ClipboardList, color: 'bg-purple-600' },
];

/** Atalhos: só abrem o app do Google em outra aba (não precisam de permissão). */
const APPS: { label: string; href: string; icon: LucideIcon; color: string }[] = [
  { label: 'Gmail', href: 'https://mail.google.com', icon: Mail, color: 'text-red-600' },
  { label: 'Drive', href: 'https://drive.google.com', icon: HardDrive, color: 'text-emerald-600' },
  { label: 'Agenda', href: 'https://calendar.google.com', icon: CalendarDays, color: 'text-blue-600' },
  { label: 'Meet', href: 'https://meet.google.com', icon: Video, color: 'text-teal-600' },
  { label: 'Classroom', href: 'https://classroom.google.com', icon: GraduationCap, color: 'text-green-700' },
  { label: 'YouTube', href: 'https://www.youtube.com', icon: Youtube, color: 'text-red-600' },
];

/** Botão com painel flutuante que fecha ao clicar fora. */
function Menu({ label, icon, primary, children }: { label: ReactNode; icon: ReactNode; primary?: boolean; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', off);
    return () => {
      document.removeEventListener('mousedown', off);
      document.removeEventListener('keydown', off);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          'inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition',
          primary ? 'bg-slate-900 text-white hover:bg-slate-800' : 'border border-border bg-card hover:bg-muted',
        )}
      >
        {icon} {label} <ChevronDown size={14} className={cn('transition', open && 'rotate-180')} />
      </button>
      {open ? (
        <div className="absolute left-0 z-30 mt-1.5 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-card p-2 shadow-xl sm:w-80">{children(() => setOpen(false))}</div>
      ) : null}
    </div>
  );
}

export function GoogleMenus({ available, connected, email, busy, message, onCreate, onDisconnect }: {
  available: boolean;
  connected: boolean;
  email: string | null;
  busy: boolean;
  message?: string;
  onCreate: (kind: GoogleKind) => void;
  onDisconnect: () => void;
}) {
  return (
    <>
      {available ? (
        connected ? (
          <Menu primary label="Novo" icon={busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}>
            {(close) => (
              <>
                <p className="px-2 pb-1 text-[11px] font-black uppercase tracking-wide text-muted-foreground">Cria no seu Google Drive e na pasta aberta</p>
                {CREATE.map(({ kind, label, icon: Icon, color }) => (
                  <button
                    key={kind}
                    disabled={busy}
                    onClick={() => {
                      close();
                      onCreate(kind);
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm font-semibold hover:bg-muted disabled:opacity-50"
                  >
                    <span className={cn('grid h-8 w-8 place-items-center rounded-lg text-white', color)}><Icon size={16} /></span>
                    Google {label}
                  </button>
                ))}
              </>
            )}
          </Menu>
        ) : (
          <a href="/api/google/connect" className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-bold text-white hover:bg-slate-800" title="Crie Docs, Sheets, Slides e Forms no seu Drive. O SCOLA só acessa o que ele mesmo criar.">
            <ExternalLink size={15} /> Conectar Google
          </a>
        )
      ) : null}

      <Menu label="Google" icon={<ExternalLink size={15} />}>
        {() => (
          <>
            <div className="grid grid-cols-3 gap-1.5">
              {APPS.map(({ label, href, icon: Icon, color }) => (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center gap-1 rounded-lg px-1 py-2.5 text-xs font-semibold hover:bg-muted">
                  <span className={color}><Icon size={22} /></span>
                  {label}
                </a>
              ))}
            </div>
            {available && connected ? (
              <p className="mt-2 border-t border-border px-2 pt-2 text-xs text-muted-foreground">
                Conectado como <b className="break-all">{email || 'sua conta'}</b> ·{' '}
                <button onClick={onDisconnect} className="font-bold underline">desconectar</button>
              </p>
            ) : null}
            {message ? <p className="mt-2 rounded-lg bg-neutral-100 p-2 text-xs font-bold text-neutral-800">{message}</p> : null}
          </>
        )}
      </Menu>
    </>
  );
}
