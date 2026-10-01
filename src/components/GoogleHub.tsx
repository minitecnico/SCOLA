import { ExternalLink, FileSpreadsheet, FileText, ClipboardList, Presentation, Mail, HardDrive, CalendarDays, Youtube, Video, GraduationCap, Plus, Loader2 } from 'lucide-react';
import type { ComponentType } from 'react';
import type { GoogleKind } from '../lib/queries';
import { cn } from '../lib/cn';

type Icon = ComponentType<{ size?: number }>;

const CREATE: { kind: GoogleKind; label: string; icon: Icon; color: string }[] = [
  { kind: 'document', label: 'Docs', icon: FileText, color: 'bg-blue-600' },
  { kind: 'spreadsheet', label: 'Sheets', icon: FileSpreadsheet, color: 'bg-green-600' },
  { kind: 'presentation', label: 'Slides', icon: Presentation, color: 'bg-yellow-500' },
  { kind: 'form', label: 'Forms', icon: ClipboardList, color: 'bg-purple-600' },
];

/** Atalhos: só abrem o app do Google em outra aba (não precisam de permissão). */
const SHORTCUTS: { label: string; href: string; icon: Icon; color: string }[] = [
  { label: 'Gmail', href: 'https://mail.google.com', icon: Mail, color: 'text-red-600' },
  { label: 'Drive', href: 'https://drive.google.com', icon: HardDrive, color: 'text-emerald-600' },
  { label: 'Agenda', href: 'https://calendar.google.com', icon: CalendarDays, color: 'text-blue-600' },
  { label: 'Meet', href: 'https://meet.google.com', icon: Video, color: 'text-teal-600' },
  { label: 'Classroom', href: 'https://classroom.google.com', icon: GraduationCap, color: 'text-green-700' },
  { label: 'YouTube', href: 'https://www.youtube.com', icon: Youtube, color: 'text-red-600' },
];

export function GoogleHub({ available, connected, email, busy, message, onCreate, onDisconnect }: {
  available: boolean;
  connected: boolean;
  email: string | null;
  busy: boolean;
  message?: string;
  onCreate: (kind: GoogleKind) => void;
  onDisconnect: () => void;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-black">Google</h3>
        {available && connected ? (
          <p className="text-xs text-muted-foreground">
            Conectado como <b>{email || 'sua conta'}</b> ·{' '}
            <button onClick={onDisconnect} className="font-bold underline">desconectar</button>
          </p>
        ) : null}
      </div>

      {/* Abrir apps */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {SHORTCUTS.map(({ label, href, icon: Icon, color }) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center gap-1 rounded-xl border border-border px-2 py-2.5 text-xs font-semibold transition hover:bg-muted"
          >
            <span className={color}><Icon size={20} /></span>
            {label}
          </a>
        ))}
      </div>

      {/* Criar arquivos no Drive do usuário */}
      {available ? (
        connected ? (
          <div>
            <p className="mb-1.5 text-[11px] font-black uppercase tracking-wide text-muted-foreground">Criar novo (salvo no seu Drive e na lista abaixo)</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {CREATE.map(({ kind, label, icon: Icon, color }) => (
                <button
                  key={kind}
                  onClick={() => onCreate(kind)}
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-3 py-2.5 text-sm font-semibold transition hover:bg-muted disabled:opacity-50"
                >
                  <span className={cn('grid h-6 w-6 place-items-center rounded-md text-white', color)}>
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />}
                  </span>
                  <Plus size={13} className="-ml-1" /> {label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <a href="/api/google/connect" className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">
              <ExternalLink size={14} /> Conectar Google
            </a>
            <span className="min-w-0 flex-1 text-xs text-muted-foreground">
              {message ? <b className="text-amber-700">{message} </b> : null}
              Conecte para criar Docs, Sheets, Slides e Forms no seu Drive direto daqui. O SCOLA só acessa o que ele mesmo criar.
            </span>
          </div>
        )
      ) : null}
    </section>
  );
}
