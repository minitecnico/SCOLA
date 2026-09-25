import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Award, BarChart3, Bell, CalendarDays, ChevronDown, ClipboardCheck, GraduationCap, Megaphone, MoreHorizontal, RotateCcw, Trash2, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Button, Card, DropdownMenu, Loading, Modal, PageHeader, SectionTitle, StatCard } from '../components/ui';
import { successToast, undoToast } from '../components/Feedback';
import { SmartAlerts } from '../components/SmartAlerts';
import { RecentNoticesPanel, UpcomingEventsPanel } from '../components/DashboardAgenda';
import { cn } from '../lib/cn';
import { can } from '../lib/permissions';
import {
  dashboardCounts,
  deleteAttendanceSession,
  listClasses,
  listDeletedSessions,
  listUpcomingEvents,
  listReceivedNotices,
  listRecentSessions,
  purgeAttendanceSession,
  restoreAttendanceSession,
  unreadNoticeCount,
  type RecentSession,
} from '../lib/queries';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function DashboardPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user, profile, role } = useAuth();
  const uid = user?.id;
  const firstName = (profile?.full_name || user?.email || 'Bem-vindo(a)').split(' ')[0];

  const { data: counts } = useQuery({ queryKey: ['counts'], queryFn: dashboardCounts });
  const { data: classes = [] } = useQuery({ queryKey: ['classes'], queryFn: listClasses });
  const { data: recent = [] } = useQuery({ queryKey: ['recent-sessions'], queryFn: () => listRecentSessions(60) });
  const { data: upcoming = [] } = useQuery({ queryKey: ['cal-upcoming'], queryFn: () => listUpcomingEvents(4) });
  const { data: unread = 0 } = useQuery({ queryKey: ['notices-unread', uid], queryFn: () => unreadNoticeCount(uid!), enabled: !!uid });
  const { data: notices = [] } = useQuery({ queryKey: ['notices-received', uid], queryFn: () => listReceivedNotices(uid!), enabled: !!uid });

  const [open, setOpen] = useState<string | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const className = (id: string) => classes.find((c) => c.id === id)?.name ?? 'Turma';

  const delSession = useMutation({
    mutationFn: (s: RecentSession) => deleteAttendanceSession(s.id),
    onSuccess: (_r, s) => {
      qc.invalidateQueries({ queryKey: ['recent-sessions'] });
      undoToast(`Chamada de ${format(parseISO(s.session_date), 'dd/MM')} movida para a lixeira.`, () =>
        restoreAttendanceSession(s.id).then(() => qc.invalidateQueries({ queryKey: ['recent-sessions'] })),
      );
    },
  });

  const groups = useMemo(() => {
    const map = new Map<string, RecentSession[]>();
    recent.forEach((s) => {
      const arr = map.get(s.class_id) ?? [];
      arr.push(s);
      map.set(s.class_id, arr);
    });
    return [...map.entries()];
  }, [recent]);

  const recentNotices = notices.slice(0, 4);

  // Ações rápidas conforme o papel.
  const actions = [
    can(role, 'chamadas') && { to: '/chamadas', icon: <ClipboardCheck size={22} />, label: 'Fazer chamada', color: '#0A0A0A', soft: '#FEF9C3' },
    can(role, 'notas') && { to: '/notas', icon: <Award size={22} />, label: 'Lançar notas', color: '#0A0A0A', soft: '#FEF9C3' },
    { to: '/avisos', icon: <Megaphone size={22} />, label: 'Avisos', color: '#0A0A0A', soft: '#FEF9C3', badge: unread },
    { to: '/calendario', icon: <CalendarDays size={22} />, label: 'Calendário', color: '#0A0A0A', soft: '#FEF9C3' },
    can(role, 'relatorios') && { to: '/relatorios', icon: <BarChart3 size={22} />, label: 'Relatórios', color: '#0A0A0A', soft: '#FEF9C3' },
  ].filter(Boolean) as { to: string; icon: React.ReactNode; label: string; color: string; soft: string; badge?: number }[];

  return (
    <>
      <PageHeader title={`Olá, ${firstName}`} subtitle={format(new Date(), "EEEE, d 'de' MMMM", { locale: ptBR })} />

      {/* Ações rápidas */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {actions.map((a) => (
          <Link
            key={a.to}
            to={a.to}
            className="group relative flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-soft transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md"
          >
            <span className="grid h-11 w-11 place-items-center rounded-xl" style={{ backgroundColor: a.soft, color: a.color }}>
              {a.icon}
            </span>
            <span className="text-sm font-black text-foreground">{a.label}</span>
            {a.badge ? (
              <span className="absolute right-3 top-3 grid h-6 min-w-6 place-items-center rounded-full bg-emerald-500 px-1.5 text-xs font-black text-white">{a.badge}</span>
            ) : null}
          </Link>
        ))}
      </div>

      {/* KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard to="/turmas" icon={<GraduationCap size={18} />} value={counts?.classes ?? 0} label="Turmas" />
        <StatCard to="/alunos" icon={<Users size={18} />} value={counts?.students ?? 0} label="Alunos" />
        <StatCard to="/avisos" icon={<Bell size={18} />} value={unread} label="Avisos não lidos" highlight={unread > 0} />
        <StatCard to="/calendario" icon={<CalendarDays size={18} />} value={upcoming.length} label="Próximos eventos" />
      </div>

      <SmartAlerts />

      {/* Próximos eventos + Avisos recentes */}
      <div className="mb-6 grid items-stretch gap-4 lg:grid-cols-2">
        <UpcomingEventsPanel events={upcoming} />
        <RecentNoticesPanel notices={recentNotices} unread={unread} />
      </div>

      <SectionTitle
        className="mb-3"
        action={
          <button onClick={() => setTrashOpen(true)} className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground">
            <Trash2 size={14} /> Lixeira
          </button>
        }
      >
        Chamadas recentes por turma
      </SectionTitle>
      {groups.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">Nenhuma chamada registrada ainda.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map(([classId, sessions]) => {
            const isOpen = open === classId;
            const faltas = sessions.reduce((a, s) => a + s.absent, 0);
            const presentes = sessions.reduce((a, s) => a + s.present, 0);
            const total = presentes + faltas;
            const rate = total > 0 ? faltas / total : 0;
            const presPct = total > 0 ? Math.round((presentes / total) * 100) : 100;
            const lastDate = sessions[0]?.session_date;
            // Polimorfismo: o tom acompanha a severidade das faltas da turma.
            // Verde: presença ≥ 90% · laranja: 75–89% · vermelho: abaixo de 75%.
            const tone =
              rate <= 0.1
                ? { accent: 'border-l-green-500', icon: 'bg-green-50 text-green-700', bar: 'bg-green-500', pill: 'bg-green-50 text-green-700' }
                : rate <= 0.25
                ? { accent: 'border-l-orange-500', icon: 'bg-orange-50 text-orange-700', bar: 'bg-orange-500', pill: 'bg-orange-50 text-orange-700' }
                : { accent: 'border-l-red-500', icon: 'bg-red-50 text-red-700', bar: 'bg-red-500', pill: 'bg-red-50 text-red-700' };
            return (
              <Card key={classId} className={cn('overflow-hidden border-l-4 p-0 transition', tone.accent, isOpen && 'sm:col-span-2 xl:col-span-3')}>
                <button onClick={() => setOpen(isOpen ? null : classId)} className="flex w-full items-center gap-3 p-4 text-left">
                  <div className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl', tone.icon)}>
                    <GraduationCap size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-black text-foreground">{className(classId)}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {sessions.length} chamada(s)
                      {lastDate ? <> · últ. {format(parseISO(lastDate), "d 'de' MMM", { locale: ptBR })}</> : null}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className={cn('h-full rounded-full', tone.bar)} style={{ width: `${presPct}%` }} />
                      </div>
                      <span className="shrink-0 text-[11px] font-bold tabular-nums text-muted-foreground">{presPct}% pres.</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-center gap-1">
                    <span className={cn('rounded-full px-2.5 py-1 text-xs font-black tabular-nums', tone.pill)}>{faltas}</span>
                    <ChevronDown size={18} className={cn('text-muted-foreground transition', isOpen && 'rotate-180')} />
                  </div>
                </button>

                {isOpen ? (
                  <div className="divide-y divide-border border-t border-border">
                    {sessions.map((s) => {
                      const openIt = () => navigate('/chamadas', { state: { classId, date: s.session_date } });
                      return (
                        <div key={s.id} className="group flex items-center gap-2 pr-2 transition hover:bg-muted/50">
                          <button onClick={openIt} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 py-3 pl-4 text-left" title="Abrir chamada">
                            <span className="min-w-0 flex-1 text-sm font-bold text-foreground">
                              {cap(format(parseISO(s.session_date), "EEE, d 'de' MMM", { locale: ptBR }))}
                            </span>
                            <span className="flex items-center gap-1.5">
                              <span className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-bold tabular-nums text-green-700">{s.present} pres.</span>
                              <span className={cn('rounded-full px-2.5 py-1 text-xs font-bold tabular-nums', s.absent ? 'bg-red-50 text-red-700' : 'bg-muted text-muted-foreground')}>
                                {s.absent} falt.
                              </span>
                            </span>
                          </button>
                          <div className="transition sm:opacity-0 sm:focus-within:opacity-100 sm:group-hover:opacity-100">
                            <DropdownMenu
                              label="Ações da chamada"
                              variant="plain"
                              iconOnly
                              icon={<MoreHorizontal size={16} />}
                              items={[
                                { label: 'Abrir chamada', hint: 'Ver ou corrigir presenças.', icon: <ClipboardCheck size={15} />, onClick: openIt },
                                { label: 'Mover para a lixeira', hint: 'Dá para restaurar depois.', icon: <Trash2 size={15} />, danger: true, onClick: () => delSession.mutate(s) },
                              ]}
                            />
                          </div>
                        </div>
                      );
                    })}
                    <Link
                      to="/relatorios"
                      state={{ classId }}
                      className="flex items-center gap-2 px-4 py-3 text-sm font-bold text-emerald-700 hover:bg-emerald-50"
                    >
                      <BarChart3 size={16} /> Analisar esta turma →
                    </Link>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      {trashOpen ? <TrashModal classNameOf={className} onClose={() => setTrashOpen(false)} /> : null}
    </>
  );
}

/** Lixeira de chamadas: restaurar ou excluir definitivamente. */
function TrashModal({ classNameOf, onClose }: { classNameOf: (id: string) => string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: items = [], isLoading } = useQuery({ queryKey: ['deleted-sessions'], queryFn: () => listDeletedSessions(), retry: false });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['deleted-sessions'] });
    qc.invalidateQueries({ queryKey: ['recent-sessions'] });
  };
  const restore = useMutation({ mutationFn: restoreAttendanceSession, onSuccess: () => { refresh(); successToast('Chamada restaurada'); } });
  const purge = useMutation({ mutationFn: purgeAttendanceSession, onSuccess: () => { refresh(); successToast('Chamada excluída definitivamente'); } });

  return (
    <Modal open onClose={onClose} title="Lixeira de chamadas">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Chamadas excluídas. Restaure com um clique ou exclua de vez.</p>
        {isLoading ? (
          <Loading />
        ) : items.length === 0 ? (
          <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">A lixeira está vazia.</p>
        ) : (
          <div className="space-y-2">
            {items.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-foreground">{classNameOf(s.class_id)}</p>
                  <p className="text-xs font-bold text-muted-foreground">
                    {format(parseISO(s.session_date), "dd/MM/yyyy", { locale: ptBR })} · {s.present} pres. · {s.absent} falt.
                  </p>
                </div>
                <Button variant="soft" onClick={() => restore.mutate(s.id)} disabled={restore.isPending}>
                  <RotateCcw size={16} /> Restaurar
                </Button>
                <button
                  onClick={() => confirm('Excluir DEFINITIVAMENTE esta chamada? Não dá pra recuperar depois.') && purge.mutate(s.id)}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-red-50 text-red-600 hover:bg-red-100"
                  aria-label="Excluir definitivamente"
                  title="Excluir definitivamente"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

