import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BAD, Chart, Delta, Donut, GRAY, HBars, Heat, SOFT, Spark } from '../../components/Charts';
import { Button, Card, Loading, PageHeader, Segmented } from '../../components/ui';
import { adminMetrics, type AdminMetrics } from '../../lib/queries';

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const WEEK = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const DAYNAME = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const pct = (n: number) => `${Math.round(n)}%`;
const CATEGORY: Record<string, string> = { cadastro: 'Cadastros', chamada: 'Chamadas', notas: 'Notas e provas', comunicacao: 'Comunicação', equipe: 'Equipe', acesso: 'Acesso', admin: 'Administração', sistema: 'Sistema' };

/** Últimos n dias (do mais antigo ao de hoje) a partir da data de hoje do servidor. */
const lastDays = (today: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${today}T12:00:00Z`) - (n - 1 - i) * 86400_000).toISOString().slice(0, 10));
const tipOf = (d: string) => `${WEEK[new Date(`${d}T12:00:00Z`).getUTCDay()]}, ${br(d)}`;
const deviceKind = (d: string | null) => (/iPad/.test(d ?? '') ? 'Tablet' : /iPhone|Android/.test(d ?? '') ? 'Celular' : /Windows|Mac|Linux/.test(d ?? '') ? 'Computador' : 'Outro');

function Panel({ title, hint, action, className = '', children }: { title: string; hint?: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <Card className={`min-w-0 ${className}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0"><h2 className="text-base font-bold">{title}</h2>{hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}</div>
        {action}
      </div>
      {children}
    </Card>
  );
}

function Kpi({ label, value, hint, cur, prev, good, spark }: { label: string; value: string; hint?: string; cur: number; prev: number; good?: 'up' | 'down'; spark?: number[] }) {
  return (
    <Card className="p-4">
      <p className="truncate text-[13px] font-semibold text-muted-foreground" title={hint}>{label}</p>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <p className="text-2xl font-extrabold leading-none tabular-nums">{value}</p>
        {spark ? <Spark data={spark} /> : null}
      </div>
      <div className="mt-2 flex items-center gap-2"><Delta cur={cur} prev={prev} good={good} />{hint ? <span className="truncate text-[11px] text-muted-foreground">{hint}</span> : null}</div>
    </Card>
  );
}

function useMetrics(range: number) {
  const force = useRef(false);
  const q = useQuery({ queryKey: ['admin-metrics', range], queryFn: () => { const f = force.current; force.current = false; return adminMetrics(range, f); }, staleTime: 5 * 60_000 });
  return { ...q, refresh: () => { force.current = true; return q.refetch(); } };
}

/** Tudo calculado a partir de uma resposta só: séries diárias, KPIs, insights e saúde das escolas. */
function derive(m: AdminMetrics) {
  const r = m.range;
  const dates = lastDays(m.today, 2 * r);
  const row = new Map(m.daily.map((x) => [x.d, x]));
  const col = (k: 'actions' | 'logins' | 'problems' | 'failed' | 'dau') => dates.map((d) => row.get(d)?.[k] ?? 0);
  const ses = new Map(m.sessions.map((x) => [x.d, x.n]));
  const sessions = dates.map((d) => ses.get(d) ?? 0);
  const cur = dates.slice(r);
  const part = (a: number[]) => ({ cur: a.slice(r), prev: a.slice(0, r) });
  const actions = part(col('actions')), problems = part(col('problems')), failed = part(col('failed')), dau = part(col('dau')), ch = part(sessions);
  const heat = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  m.heat.forEach((h) => (heat[h.w][h.h] += h.n));
  // Horário de pico e a janela de 2 h mais calma (bom para manutenção).
  const byHour = Array.from({ length: 24 }, (_, h) => sum(heat.map((d) => d[h])));
  const calm = byHour.map((v, h) => ({ h, v: v + byHour[(h + 1) % 24] })).sort((a, b) => a.v - b.v)[0].h;
  let peak = { w: 0, h: 0, n: 0 };
  m.heat.forEach((h) => h.n > peak.n && (peak = h));
  // Escolas: tendência de 14 dias e situação.
  const d14 = lastDays(m.today, 14);
  const schools = m.schools.filter((s) => s.active).map((s) => {
    const spark = d14.map((d) => s.days[d]?.n ?? 0);
    const a = sum(spark.slice(7)), b = sum(spark.slice(0, 7));
    const age = (Date.parse(m.today) - Date.parse(s.created.slice(0, 10))) / 86400_000;
    const status = age < 7 ? 'Nova' : a + b === 0 ? 'Sem uso' : b >= 10 && a < b * 0.5 ? 'Em queda' : a > b * 1.3 && a >= 10 ? 'Crescendo' : 'Estável';
    const risk = { 'Sem uso': 0, 'Em queda': 1, Estável: 2, Nova: 3, Crescendo: 4 }[status] ?? 2;
    return { ...s, spark, a, b, status, risk, maxU: Math.max(0, ...Object.values(s.days).map((x) => x.u)) };
  }).sort((x, y) => x.risk - y.risk || y.a - x.a);
  const avgDau = sum(dau.cur.slice(-Math.min(r, 30))) / Math.min(r, 30);
  return { r, dates: cur, tips: cur.map(tipOf), labels: cur.map(br), actions, problems, failed, dau, ch, logins: col('logins').slice(r), heat, byHour, calm, peak, schools, stick: m.users.mau ? (avgDau / m.users.mau) * 100 : 0, avgDau };
}

const monthsBack = (today: string, n: number) => Array.from({ length: n }, (_, i) => { const d = new Date(`${today.slice(0, 7)}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - (n - 1 - i)); return d.toISOString().slice(0, 7); });
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function MetricsPage() {
  const [range, setRange] = useState(30);
  const [grow, setGrow] = useState<'users' | 'bases'>('users');
  const [rank, setRank] = useState<'mod' | 'top' | 'err'>('mod');
  const { data: m, isLoading, isFetching, refresh } = useMetrics(range);
  const d = useMemo(() => (m ? derive(m) : null), [m]);

  const growth = useMemo(() => {
    if (!m) return null;
    const months = monthsBack(m.today, 12);
    const src = m.growth[grow];
    let acc = sum(src.filter((x) => x.m < months[0]).map((x) => x.n));
    const data = months.map((mm) => (acc += src.find((x) => x.m === mm)?.n ?? 0));
    return { labels: months.map((x) => `${MES[+x.slice(5) - 1]}/${x.slice(2, 4)}`), data };
  }, [m, grow]);

  if (isLoading || !m || !d) return <Loading />;

  const mods = Object.entries(m.mix.reduce<Record<string, { n: number; bad: number }>>((o, x) => ({ ...o, [x.category]: { n: (o[x.category]?.n ?? 0) + x.n, bad: (o[x.category]?.bad ?? 0) + x.bad } }), {}))
    .map(([k, v]) => ({ label: CATEGORY[k] ?? k, value: v.n, hint: v.bad ? `${v.bad} com erro` : undefined, bad: false })).sort((a, b) => b.value - a.value);
  const top = [...m.mix].sort((a, b) => b.n - a.n).slice(0, 8).map((x) => ({ label: x.label, value: x.n, hint: x.bad ? `${x.bad} com erro` : undefined, bad: false }));
  const errs = m.mix.filter((x) => x.bad).sort((a, b) => b.bad - a.bad).slice(0, 8).map((x) => ({ label: x.label, value: x.bad, hint: `${pct((x.bad / x.n) * 100)} de ${x.n}`, bad: true }));
  const list = rank === 'mod' ? mods : rank === 'top' ? top : errs;
  const kinds = Object.entries(m.devices.reduce<Record<string, number>>((o, x) => ({ ...o, [deviceKind(x.device)]: (o[deviceKind(x.device)] ?? 0) + x.u }), {})).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  const roles = Object.entries(m.devices.reduce<Record<string, number>>((o, x) => ({ ...o, [x.role ?? '?']: (o[x.role ?? '?'] ?? 0) + x.u }), {})).map(([k, value]) => ({ label: ({ gestor: 'Gestão', professor: 'Professores', secretaria: 'Secretaria' } as Record<string, string>)[k] ?? k, value })).sort((a, b) => b.value - a.value);
  const errRate = (a: { cur: number[]; prev: number[] }, b: { cur: number[]; prev: number[] }, k: 'cur' | 'prev') => { const t = sum(a[k]) + sum(b[k]); return t ? (sum(b[k]) / t) * 100 : 0; };
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(m.generatedAt)) / 60_000));
  const insight = d.peak.n ? `Pico de uso: ${DAYNAME[d.peak.w]}, ${d.peak.h}h. Menor movimento (bom para manutenção): ${d.calm}h–${(d.calm + 2) % 24}h.` : 'Ainda sem atividade suficiente para mostrar horários.';
  const engines = m.engines.filter((e) => e.ok + e.fail > 0).map((e) => ({ label: e.engine_id.split('/').pop() ?? e.engine_id, value: Math.round((e.ok / (e.ok + e.fail)) * 100), hint: `${e.ewma_ms ? `${Math.round(e.ewma_ms)} ms · ` : ''}${e.ok + e.fail} chamadas`, bad: e.fail > e.ok * 0.2 }));

  return (
    <>
      <PageHeader
        title="Métricas"
        subtitle={`Uso da plataforma · atualizado há ${mins < 1 ? 'instantes' : `${mins} min`}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented<number> value={range} onChange={setRange} options={[{ value: 7, label: '7 dias' }, { value: 30, label: '30 dias' }, { value: 90, label: '90 dias' }]} />
            <Button variant="ghost" onClick={() => refresh()} disabled={isFetching} aria-label="Atualizar agora" title="Atualizar agora"><RefreshCw size={16} className={isFetching ? 'animate-spin' : ''} /></Button>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Usuários ativos" value={String(m.users.cur)} hint={`${m.users.dau} hoje · ${m.users.wau} em 7d`} cur={m.users.cur} prev={m.users.prev} />
        <Kpi label="Fidelidade (DAU/MAU)" value={m.users.mau ? pct(d.stick) : '—'} hint={`${d.avgDau.toFixed(1)} por dia de ${m.users.mau}`} cur={sum(d.dau.cur)} prev={sum(d.dau.prev)} spark={d.dau.cur} />
        <Kpi label="Ações no sistema" value={String(sum(d.actions.cur))} cur={sum(d.actions.cur)} prev={sum(d.actions.prev)} spark={d.actions.cur} />
        <Kpi label="Chamadas registradas" value={String(sum(d.ch.cur))} cur={sum(d.ch.cur)} prev={sum(d.ch.prev)} spark={d.ch.cur} />
        <Kpi label="Taxa de erros" value={pct(errRate(d.actions, d.problems, 'cur'))} hint={`${sum(d.problems.cur)} ocorrência(s)`} cur={errRate(d.actions, d.problems, 'cur')} prev={errRate(d.actions, d.problems, 'prev')} good="down" spark={d.problems.cur} />
        <Kpi label="Logins falhos" value={String(sum(d.failed.cur))} cur={sum(d.failed.cur)} prev={sum(d.failed.prev)} good="down" spark={d.failed.cur} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-6">
        <Panel className="lg:col-span-4" title="Atividade por dia" hint="Ações registradas e acessos (login)">
          <Chart labels={d.labels} tips={d.tips} series={[{ name: 'Ações', data: d.actions.cur, kind: 'area' }, { name: 'Acessos', data: d.logins, color: GRAY }]} />
        </Panel>
        <Panel className="lg:col-span-2" title="Usuários ativos por dia" hint={`Média de ${d.avgDau.toFixed(1)} por dia`}>
          <Chart labels={d.labels} tips={d.tips} series={[{ name: 'Usuários', data: d.dau.cur }, { name: 'Média', data: d.dau.cur.map(() => d.avgDau), color: SOFT, dashed: true }]} />
        </Panel>

        <Panel className="lg:col-span-3" title="Chamadas por dia" hint="Frequência lançada nas escolas">
          <Chart labels={d.labels} tips={d.tips} series={[{ name: 'Chamadas', data: d.ch.cur, kind: 'bar' }]} />
        </Panel>
        <Panel className="lg:col-span-3" title="Crescimento" hint="Acumulado em 12 meses" action={<Segmented<'users' | 'bases'> value={grow} onChange={setGrow} options={[{ value: 'users', label: 'Usuários' }, { value: 'bases', label: 'Escolas' }]} />}>
          {growth ? <Chart labels={growth.labels} series={[{ name: grow === 'users' ? 'Usuários' : 'Escolas', data: growth.data, kind: 'area' }]} /> : null}
        </Panel>

        <Panel className="lg:col-span-3" title="Onde as pessoas atuam" action={<Segmented<'mod' | 'top' | 'err'> value={rank} onChange={setRank} options={[{ value: 'mod', label: 'Módulos' }, { value: 'top', label: 'Ações' }, { value: 'err', label: 'Erros' }]} />}>
          {list.length ? <HBars items={list} /> : <p className="py-6 text-center text-sm text-muted-foreground">{rank === 'err' ? 'Nenhuma ação com erro no período. 🎯' : 'Sem atividade no período.'}</p>}
        </Panel>
        <Panel className="lg:col-span-3" title="Quando usam" hint={insight}>
          <Heat grid={d.heat} />
        </Panel>

        <Panel className="lg:col-span-2" title="Quem e como acessa" hint="Usuários distintos no período">
          <div className="space-y-4"><Donut parts={kinds} /><Donut parts={roles} /></div>
        </Panel>
        <Panel className="lg:col-span-4" title="Confiabilidade" hint="Erros e acessos negados por dia, e logins que falharam">
          <Chart labels={d.labels} tips={d.tips} height={170} series={[{ name: 'Erros/negados', data: d.problems.cur, kind: 'bar', color: BAD }, { name: 'Logins falhos', data: d.failed.cur, color: GRAY }]} />
        </Panel>

        <Panel className="lg:col-span-4" title="Saúde das escolas" hint="Ações nos últimos 7 dias contra os 7 anteriores" action={<Link to="/admin/escolas" className="text-xs font-semibold text-muted-foreground underline hover:text-foreground">Ver todas</Link>}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground"><th className="pb-2 font-bold">Escola</th><th className="pb-2 font-bold">14 dias</th><th className="pb-2 text-right font-bold">Ações 7d</th><th className="pb-2 text-right font-bold">Alunos</th><th className="pb-2 text-right font-bold">Situação</th></tr></thead>
              <tbody className="divide-y divide-border">
                {d.schools.slice(0, 10).map((s) => (
                  <tr key={s.id}>
                    <td className="max-w-[14rem] truncate py-2 pr-2 font-semibold">{s.name}{s.plan === 'teste' ? <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">TESTE</span> : null}</td>
                    <td className="py-2"><Spark data={s.spark} color={s.status === 'Em queda' || s.status === 'Sem uso' ? BAD : undefined} /></td>
                    <td className="py-2 text-right tabular-nums">{s.a} <Delta cur={s.a} prev={s.b} /></td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">{s.students}{s.max ? `/${s.max}` : ''}</td>
                    <td className="py-2 text-right"><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${s.risk <= 1 ? 'bg-red-50 text-red-700' : 'bg-muted text-foreground'}`}>{s.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d.schools.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma escola ativa.</p> : null}
          </div>
        </Panel>
        <Panel className="lg:col-span-2" title="Motor de IA" hint="Taxa de sucesso por modelo">
          {engines.length ? <HBars items={engines} fmt={(n) => `${n}%`} /> : <p className="py-6 text-center text-sm text-muted-foreground">Sem chamadas de IA registradas.</p>}
        </Panel>
      </div>
    </>
  );
}
