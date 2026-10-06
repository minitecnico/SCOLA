import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Building2, CalendarCheck, ChevronRight, LifeBuoy, LogIn, Plus, ScrollText, ShieldAlert, UserCog, Users } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { AiEngineCard } from '../../components/AiEngineCard';
import { Button, Card, Loading, PageHeader, StatCard } from '../../components/ui';
import { cn } from '../../lib/cn';
import { suporte } from '../../lib/suporte';
import { getAccessStatus, hqStats, listLogs, listOrgAdmin, logOverview, type OrgAdmin } from '../../lib/queries';

const DAY = 86400_000;
const daysSince = (s: string | null) => (s ? Math.floor((Date.now() - new Date(s.length === 10 ? `${s}T12:00:00` : s).getTime()) / DAY) : null);
const ago = (s: string | null) => {
  const d = daysSince(s);
  return d == null ? 'nunca' : d <= 0 ? 'hoje' : d === 1 ? 'ontem' : `há ${d} dias`;
};

interface Alert {
  key: string;
  tone: 'bad' | 'warn' | 'info';
  title: string;
  hint: string;
  school?: OrgAdmin;
  to?: string;
}

/** Alertas inteligentes: calculados a partir dos dados das escolas e dos logs. */
function buildAlerts(bases: OrgAdmin[]): Alert[] {
  const out: Alert[] = [];
  for (const b of bases) {
    if (!b.active) continue;
    const age = daysSince(b.created_at) ?? 0;
    const login = daysSince(b.last_login);
    const att = daysSince(b.last_attendance);
    if (b.max_students && b.students >= b.max_students) {
      out.push({ key: `lim-${b.id}`, tone: 'bad', title: `${b.name}: limite de alunos atingido`, hint: `${b.students} de ${b.max_students} alunos. Ajuste o plano.`, school: b });
    } else if (b.max_students && b.students >= b.max_students * 0.9) {
      out.push({ key: `lim-${b.id}`, tone: 'warn', title: `${b.name}: perto do limite de alunos`, hint: `${b.students} de ${b.max_students} alunos.`, school: b });
    }
    if (age >= 7 && (login == null || login > 14)) {
      out.push({ key: `sem-${b.id}`, tone: 'warn', title: `${b.name}: sem acesso ${login == null ? 'desde a criação' : `há ${login} dias`}`, hint: 'Vale um contato para ajudar a começar a usar.', school: b });
    } else if (age >= 14 && b.students > 0 && (att == null || att > 30)) {
      out.push({ key: `cha-${b.id}`, tone: 'info', title: `${b.name}: sem chamadas ${att == null ? 'registradas' : `há ${att} dias`}`, hint: 'Acessa o sistema, mas não registra frequência.', school: b });
    }
    if (b.plan === 'teste' && age >= 14) {
      out.push({ key: `tst-${b.id}`, tone: 'info', title: `${b.name}: em teste há ${age} dias`, hint: 'Hora de converter para plano ativo?', school: b });
    }
  }
  const rank = { bad: 0, warn: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

const TONE = {
  bad: 'bg-red-50 text-red-700',
  warn: 'bg-neutral-200 text-neutral-900',
  info: 'bg-neutral-100 text-neutral-700',
};

export function AdminOverviewPage() {
  const navigate = useNavigate();
  const { profile, user, switchOrg } = useAuth();
  const first = (profile?.full_name || user?.email || '').split(/[ @]/)[0];
  const { data: stats } = useQuery({ queryKey: ['admin-stats'], queryFn: hqStats });
  const { data: bases = [], isLoading } = useQuery({ queryKey: ['admin-bases'], queryFn: listOrgAdmin });
  const { data: ov } = useQuery({ queryKey: ['admin-log-overview'], queryFn: logOverview, refetchInterval: 60_000 });
  const { data: recent } = useQuery({ queryKey: ['admin-recent-logs'], queryFn: () => listLogs({ period: '24h' }, 8), refetchInterval: 60_000 });

  const { data: pending = 0 } = useQuery({ queryKey: ['support-admin-unread'], queryFn: suporte.admin.unread, refetchInterval: 30_000 });
  const { data: access } = useQuery({ queryKey: ['admin-access-status'], queryFn: getAccessStatus });
  const alerts = useMemo(() => buildAlerts(bases), [bases]);
  const trial = bases.filter((b) => b.active && b.plan === 'teste').length;
  const suspended = bases.filter((b) => !b.active).length;
  const top = useMemo(() => [...(ov?.bases ?? [])].filter((b) => b.active).sort((a, b) => b.actions7d - a.actions7d).slice(0, 5), [ov]);
  const topMax = Math.max(1, ...top.map((b) => b.actions7d));
  const problems = (ov?.failed24h ?? 0) + (ov?.errors24h ?? 0) + (ov?.denied24h ?? 0);

  async function enter(b: OrgAdmin) {
    await switchOrg(b.id);
    navigate('/');
  }

  const { hash } = useLocation();
  useEffect(() => {
    if (hash === '#motor-ia' && !isLoading) document.getElementById('motor-ia')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hash, isLoading]);

  if (isLoading) return <Loading />;

  return (
    <>
      <PageHeader
        title={first ? `Olá, ${first}` : 'Painel do administrador'}
        subtitle="Visão geral de todas as escolas e professores do SCOLA."
        back={false}
        action={
          <Button onClick={() => navigate('/admin/escolas?novo=1')}>
            <Plus size={16} /> Nova escola
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard to="/admin/escolas" icon={<Building2 size={18} />} value={stats?.bases_active ?? '—'} label="Escolas ativas" sub={stats ? [`${stats.bases} no total`, trial ? `${trial} em teste` : '', suspended ? `${suspended} suspensas` : ''].filter(Boolean).join(' · ') : undefined} />
        <StatCard icon={<Users size={18} />} value={stats?.students ?? '—'} label="Alunos ativos" />
        <StatCard to="/admin/usuarios" icon={<UserCog size={18} />} value={stats?.users ?? '—'} label="Usuários" sub={ov ? `${ov.users7d} ativos em 7 dias` : undefined} />
        <StatCard icon={<CalendarCheck size={18} />} value={stats?.sessions_30d ?? '—'} label="Chamadas (30 dias)" />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle size={17} />
            <h2 className="text-base font-bold">Precisa de atenção</h2>
            {alerts.length ? <span className="rounded-full bg-neutral-900 px-2 py-0.5 text-[11px] font-bold text-white">{alerts.length}</span> : null}
          </div>
          {access && !access.mail.ready ? (
            <div className="mb-2 flex items-start gap-3 rounded-lg bg-neutral-100 px-3 py-2.5 text-sm text-neutral-800">
              <ShieldAlert size={16} className="mt-0.5 shrink-0" />
              <span className="min-w-0 flex-1"><b>E-mail de acesso não configurado.</b> Convites e novos links funcionam por link (WhatsApp), mas “Esqueci minha senha” fica desligado. Ative em minutos com Resend ou Brevo (grátis) — veja “E-mail de acesso” no README.</span>
            </div>
          ) : null}
          {pending ? (
            <Link to="/admin/suporte" className="mb-2 flex items-center gap-3 rounded-lg bg-neutral-900 px-3 py-2.5 text-sm text-white hover:bg-black">
              <LifeBuoy size={16} className="shrink-0" />
              <span className="min-w-0 flex-1"><b>{pending} conversa(s) do suporte</b> esperando sua resposta</span>
              <ChevronRight size={15} />
            </Link>
          ) : null}
          {ov?.suspicious?.length ? (
            <Link to="/admin/logs" className="mb-2 flex items-center gap-3 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700 hover:brightness-95">
              <ShieldAlert size={16} className="shrink-0" />
              <span className="min-w-0 flex-1">
                <b>{ov.suspicious.length} tentativa(s) de login suspeita(s)</b> nas últimas 24h
              </span>
              <ChevronRight size={15} />
            </Link>
          ) : null}
          {alerts.length === 0 && !ov?.suspicious?.length && !pending && (access?.mail.ready ?? true) ? (
            <p className="rounded-lg bg-muted px-3 py-6 text-center text-sm text-muted-foreground">Tudo em ordem. Nenhuma escola precisa de atenção agora.</p>
          ) : (
            <ul className="space-y-1.5">
              {alerts.slice(0, 8).map((a) => (
                <li key={a.key} className={cn('flex items-center gap-3 rounded-lg px-3 py-2.5', TONE[a.tone])}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{a.title}</p>
                    <p className="truncate text-xs opacity-80">{a.hint}</p>
                  </div>
                  {a.school ? (
                    <Button variant="ghost" className="min-h-9 shrink-0 px-3 py-1.5" onClick={() => enter(a.school!)}>
                      <LogIn size={14} /> Acessar
                    </Button>
                  ) : null}
                </li>
              ))}
              {alerts.length > 8 ? <p className="px-1 pt-1 text-xs text-muted-foreground">+ {alerts.length - 8} avisos. Veja em <Link to="/admin/escolas" className="font-semibold underline">Escolas</Link>.</p> : null}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="mb-3 text-base font-bold">Últimas 24 horas</h2>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Acessos', v: ov?.logins24h },
              { label: 'Ações', v: ov?.actions24h },
              { label: 'Falhas de login', v: ov?.failed24h },
              { label: 'Erros e negados', v: ov ? ov.errors24h + ov.denied24h : undefined },
            ].map((t) => (
              <div key={t.label} className="rounded-lg bg-muted px-3 py-3">
                <p className="text-2xl font-extrabold tabular-nums">{t.v ?? '—'}</p>
                <p className="text-xs font-semibold text-muted-foreground">{t.label}</p>
              </div>
            ))}
          </div>
          <p className={cn('mt-3 text-xs font-semibold', problems ? 'text-red-600' : 'text-muted-foreground')}>
            {problems ? `${problems} ocorrência(s) para revisar nos logs.` : 'Nenhuma ocorrência de erro ou falha.'}
          </p>
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="mb-3 text-base font-bold">Escolas mais ativas (7 dias)</h2>
          {top.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">Ainda sem atividade registrada.</p>
          ) : (
            <ul className="space-y-3">
              {top.map((b) => (
                <li key={b.id}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate font-semibold">{b.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{b.actions7d} ações · {ago(b.last)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-neutral-900" style={{ width: `${(b.actions7d / topMax) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-bold">Atividade recente</h2>
            <Link to="/admin/logs" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
              <ScrollText size={13} /> Ver todos os logs
            </Link>
          </div>
          {!recent?.rows.length ? (
            <p className="py-4 text-sm text-muted-foreground">Nada nas últimas 24 horas.</p>
          ) : (
            <ul className="divide-y divide-border">
              {recent.rows.map((r) => (
                <li key={r.id} className="flex items-start gap-3 py-2">
                  <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', r.status === 'ok' ? 'bg-neutral-400' : 'bg-red-600')} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{r.summary}</p>
                    <p className="truncate text-xs text-muted-foreground">{[r.base_name, r.user_email].filter(Boolean).join(' · ')}</p>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{new Date(r.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4 scroll-mt-32" id="motor-ia">
        <AiEngineCard />
      </div>
    </>
  );
}
