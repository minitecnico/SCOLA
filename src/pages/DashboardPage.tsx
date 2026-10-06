import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Award, ClipboardCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { RecentNoticesPanel } from '../components/DashboardAgenda';
import { MonthCalendarWidget } from '../components/DashboardWidgets';
import { RecentCalls } from '../components/RecentCalls';
import { SmartAlerts } from '../components/SmartAlerts';
import { cn } from '../lib/cn';
import { can } from '../lib/permissions';
import { dashboardCounts, listReceivedNotices, listUpcomingEvents, unreadNoticeCount } from '../lib/queries';
import { YearEndBanner } from './AnoLetivoPage';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Início: o que precisa de ação (alertas) em destaque, o mês num único calendário,
 * os avisos e as chamadas recentes. Nada aparece duas vezes — atalhos de menu e contagens
 * soltas ficam fora; cada informação tem um lugar só.
 */
export function DashboardPage() {
  const { user, profile, role } = useAuth();
  const uid = user?.id;
  const firstName = (profile?.full_name || user?.email || 'Bem-vindo(a)').split(' ')[0];

  const { data: counts } = useQuery({ queryKey: ['counts'], queryFn: dashboardCounts });
  const { data: upcoming = [] } = useQuery({ queryKey: ['cal-upcoming'], queryFn: () => listUpcomingEvents(3) });
  const { data: unread = 0 } = useQuery({ queryKey: ['notices-unread', uid], queryFn: () => unreadNoticeCount(uid!), enabled: !!uid });
  const { data: notices = [] } = useQuery({ queryKey: ['notices-received', uid], queryFn: () => listReceivedNotices(uid!), enabled: !!uid });

  const canCall = can(role, 'chamadas');
  const canGrade = can(role, 'notas');
  const seeAttendance = canCall || can(role, 'relatorios');
  const actions = [
    canCall && { to: '/chamadas', icon: <ClipboardCheck size={16} />, label: 'Fazer chamada' },
    canGrade && { to: '/notas', icon: <Award size={16} />, label: 'Lançar notas' },
  ].filter(Boolean) as { to: string; icon: React.ReactNode; label: string }[];

  return (
    <>
      <YearEndBanner />

      {/* Saudação, contagem da base e as duas tarefas do dia a dia */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">Olá, {firstName}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {cap(format(new Date(), "EEEE, d 'de' MMMM", { locale: ptBR }))}
            {counts && can(role, 'turmas') ? (
              <>
                {' · '}
                <Link to="/turmas" className="font-semibold text-foreground hover:underline">{plural(counts.classes, 'turma', 'turmas')}</Link>
                {can(role, 'alunos') ? (
                  <>
                    {' · '}
                    <Link to="/alunos" className="font-semibold text-foreground hover:underline">{plural(counts.students, 'aluno', 'alunos')}</Link>
                  </>
                ) : null}
              </>
            ) : null}
          </p>
        </div>
        {actions.length ? (
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            {actions.map((a, i) => (
              <Link
                key={a.to}
                to={a.to}
                className={cn(
                  'inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 text-sm font-semibold transition',
                  i === 0 ? 'bg-neutral-950 text-white hover:bg-black' : 'bg-card text-foreground ring-1 ring-inset ring-border hover:bg-muted',
                )}
              >
                {a.icon}
                {a.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      {/* Alertas à direita (primeiro no celular); calendário e avisos à esquerda */}
      <div className="mb-6 grid items-start gap-5 lg:grid-cols-12">
        <div className="grid min-w-0 items-stretch gap-5 md:grid-cols-2 lg:col-span-7 xl:col-span-8">
          <MonthCalendarWidget upcoming={upcoming} showAttendance={seeAttendance} />
          <RecentNoticesPanel notices={notices.slice(0, 4)} unread={unread} />
        </div>
        <div className="order-first min-w-0 lg:sticky lg:top-[8.5rem] lg:order-none lg:col-span-5 xl:col-span-4">
          <SmartAlerts side />
        </div>
      </div>

      <RecentCalls />
    </>
  );
}
