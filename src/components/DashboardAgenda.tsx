import { CalendarDays, ChevronRight, Megaphone, Paperclip } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../lib/cn';
import type { ReceivedNotice, UpcomingEvent } from '../lib/queries';
import { ROLE_LABEL } from '../lib/types';

/**
 * Agenda do Início: próximos eventos e avisos recentes, no mesmo padrão visual.
 * A cor da categoria do evento aparece só como um ponto — o bloco de data é neutro,
 * para não competir com as cores de situação (verde/laranja/vermelho).
 */
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const DIA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const localIso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const asDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`);
const daysUntil = (iso: string) => Math.round((asDate(iso).getTime() - asDate(localIso()).getTime()) / 86400_000);

function whenLabel(start: string, end: string | null) {
  const today = localIso();
  if (end && start <= today && end >= today) return 'Acontecendo agora';
  const d = daysUntil(start);
  if (d <= 0) return 'Hoje';
  if (d === 1) return 'Amanhã';
  if (d < 7) return `Em ${d} dias`;
  if (d < 14) return 'Semana que vem';
  return `Em ${d} dias`;
}

function ago(iso: string) {
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

function Panel({ icon, title, badge, to, linkLabel, children }: { icon: ReactNode; title: string; badge?: ReactNode; to: string; linkLabel: string; children: ReactNode }) {
  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-soft">
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-muted text-foreground">{icon}</span>
        <h2 className="text-sm font-bold text-foreground">{title}</h2>
        {badge}
        <Link to={to} className="ml-auto inline-flex items-center gap-0.5 rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground">
          {linkLabel} <ChevronRight size={14} />
        </Link>
      </header>
      <div className="flex-1">{children}</div>
    </section>
  );
}

function Empty({ icon, title, hint }: { icon: ReactNode; title: string; hint: string }) {
  return (
    <div className="flex h-full min-h-[9rem] flex-col items-center justify-center px-6 py-8 text-center">
      <span className="mb-2 text-muted-foreground">{icon}</span>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export function UpcomingEventsPanel({ events }: { events: UpcomingEvent[] }) {
  return (
    <Panel icon={<CalendarDays size={16} />} title="Próximos eventos" to="/calendario" linkLabel="Calendário">
      {events.length === 0 ? (
        <Empty icon={<CalendarDays size={22} />} title="Nenhum evento pela frente" hint="Feriados, provas e reuniões do calendário aparecem aqui." />
      ) : (
        <ul className="divide-y divide-border">
          {events.map((e) => {
            const d = asDate(e.event_date);
            const soon = daysUntil(e.event_date) <= 1 || (!!e.end_date && e.event_date <= localIso());
            return (
              <li key={e.id}>
                <Link to="/calendario" className="flex items-center gap-3 px-4 py-3 transition hover:bg-muted/50">
                  <span
                    className={cn(
                      'flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg leading-none',
                      soon ? 'bg-neutral-950 text-white' : 'bg-muted text-foreground',
                    )}
                  >
                    <span className={cn('text-[10px] font-semibold uppercase', soon ? 'text-brand' : 'text-muted-foreground')}>{MES[d.getMonth()]}</span>
                    <span className="mt-0.5 text-lg font-extrabold tabular-nums">{d.getDate()}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">{e.title}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: e.color }} aria-hidden="true" />
                      <span className="truncate">
                        {e.category} · {DIA[d.getDay()]}
                        {e.end_date && e.end_date !== e.event_date ? ` até ${e.end_date.slice(8, 10)}/${e.end_date.slice(5, 7)}` : ''}
                      </span>
                    </span>
                  </span>
                  <span className={cn('shrink-0 text-xs font-semibold', soon ? 'text-foreground' : 'text-muted-foreground')}>{whenLabel(e.event_date, e.end_date)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function RecentNoticesPanel({ notices, unread }: { notices: ReceivedNotice[]; unread: number }) {
  return (
    <Panel
      icon={<Megaphone size={16} />}
      title="Avisos recentes"
      badge={unread ? <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold text-neutral-950">{unread} {unread === 1 ? 'novo' : 'novos'}</span> : null}
      to="/avisos"
      linkLabel="Todos"
    >
      {notices.length === 0 ? (
        <Empty icon={<Megaphone size={22} />} title="Nenhum aviso recebido" hint="Recados da coordenação e da equipe aparecem aqui." />
      ) : (
        <ul className="divide-y divide-border">
          {notices.map((n) => (
            <li key={n.id}>
              <Link to="/avisos" className="flex gap-3 px-4 py-3 transition hover:bg-muted/50">
                <span className="relative mt-0.5 shrink-0">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-muted text-xs font-bold uppercase text-foreground">
                    {(n.authorName || '?').slice(0, 1)}
                  </span>
                  {!n.read ? <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-brand ring-2 ring-card" aria-label="Não lido" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className={cn('min-w-0 flex-1 truncate text-sm text-foreground', n.read ? 'font-medium' : 'font-bold')}>{n.title}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{ago(n.created_at)}</span>
                  </span>
                  <span className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{n.body}</span>
                  <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="truncate">
                      {n.authorName ?? 'Equipe'}
                      {n.authorRole ? ` · ${ROLE_LABEL[n.authorRole]}` : ''}
                    </span>
                    {n.attachments?.length ? (
                      <span className="inline-flex shrink-0 items-center gap-0.5">
                        · <Paperclip size={11} /> {n.attachments.length}
                      </span>
                    ) : null}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
