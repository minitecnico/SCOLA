import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  Award, Building2, ChevronDown, ClipboardCheck, Download, KeyRound, Megaphone, RefreshCw, ScrollText, Settings2, ShieldAlert, UserCog, Users, type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, EmptyState, FilterBar, FilterField, Loading, PageHeader, SegmentedField, StatusBadge, fieldCls } from '../../components/ui';
import { cn } from '../../lib/cn';
import { downloadXlsx } from '../../lib/importSheet';
import { listLogs, listOrgAdmin, logOverview, type LogFilters, type LogRow } from '../../lib/queries';
import { DAY, MINUTE, LOCALE } from '../../lib/constants';

/**
 * Central de logs do administrador: quem fez o quê, em qual base, quando e de onde.
 * Inclui acessos, falhas de login, erros e acessos negados — e sinaliza bases paradas.
 */
const CATS: Record<string, { label: string; icon: LucideIcon }> = {
  acesso: { label: 'Acesso', icon: KeyRound },
  cadastro: { label: 'Cadastros', icon: Users },
  chamada: { label: 'Chamadas', icon: ClipboardCheck },
  notas: { label: 'Notas', icon: Award },
  comunicacao: { label: 'Comunicação', icon: Megaphone },
  equipe: { label: 'Equipe', icon: UserCog },
  admin: { label: 'Administração', icon: Building2 },
  sistema: { label: 'Sistema', icon: Settings2 },
};
const ROLE: Record<string, string> = { admin: 'Administrador', gestor: 'Gestão', professor: 'Professor(a)', secretaria: 'Secretaria' };
const PERIODS = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: '90d', label: '90 dias' },
] as const;

const time = (iso: string) => new Date(iso).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
const dateTime = (iso: string) => new Date(iso).toLocaleString(LOCALE, { dateStyle: 'short', timeStyle: 'medium' });
function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Hoje';
  if (d.toDateString() === y.toDateString()) return 'Ontem';
  return d.toLocaleDateString(LOCALE, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}
function ago(iso: string | null) {
  if (!iso) return 'nunca usada';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / DAY);
  if (days <= 0) return 'hoje';
  if (days === 1) return 'ontem';
  return `há ${days} dias`;
}

export function LogsPage() {
  const [period, setPeriod] = useState<NonNullable<LogFilters['period']>>('7d');
  const [baseId, setBaseId] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState<LogFilters['status'] | ''>('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [exporting, setExporting] = useState(false);

  // Busca com pequena espera para não consultar a cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const filters: LogFilters = { period, baseId: baseId || null, category: category || null, status: status || null, q: q || null };
  const { data: bases = [] } = useQuery({ queryKey: ['admin-bases'], queryFn: listOrgAdmin });
  const overview = useQuery({ queryKey: ['log-overview'], queryFn: logOverview, refetchInterval: MINUTE });
  const logs = useInfiniteQuery({
    queryKey: ['logs', filters],
    queryFn: ({ pageParam }) => listLogs({ ...filters, before: pageParam }),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.next,
  });
  const rows = useMemo(() => logs.data?.pages.flatMap((p) => p.rows) ?? [], [logs.data]);
  const groups = useMemo(() => {
    const out: { day: string; items: LogRow[] }[] = [];
    for (const r of rows) {
      const day = dayLabel(r.at);
      if (out[out.length - 1]?.day !== day) out.push({ day, items: [] });
      out[out.length - 1].items.push(r);
    }
    return out;
  }, [rows]);

  const o = overview.data;
  const idle = (o?.bases ?? []).filter((b) => b.active && (!b.last || Date.now() - new Date(b.last).getTime() > 7 * DAY));

  function refresh() {
    void overview.refetch();
    void logs.refetch();
  }

  async function exportXlsx() {
    setExporting(true);
    try {
      const all: LogRow[] = [];
      let before: number | null = null;
      do {
        const page: { rows: LogRow[]; next: number | null } = await listLogs({ ...filters, before }, 200);
        all.push(...page.rows);
        before = page.next;
      } while (before && all.length < 5000);
      await downloadXlsx(
        `logs-scola-${new Date().toISOString().slice(0, 10)}.xlsx`,
        [
          ['Data e hora', 'Usuário', 'Papel', 'Base', 'Categoria', 'Ação', 'Alvo', 'Situação', 'Detalhe', 'IP', 'Aparelho'],
          ...all.map((r) => [
            dateTime(r.at), r.user_email ?? '', ROLE[r.role ?? ''] ?? r.role ?? '', r.base_name ?? '', CATS[r.category]?.label ?? r.category,
            r.summary, r.target ?? '', r.status === 'ok' ? 'OK' : r.status === 'erro' ? 'Erro' : 'Negado', r.detail ?? '', r.ip ?? '', r.device ?? '',
          ]),
        ],
        'Logs',
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Central de logs"
        subtitle="Quem fez o quê, em qual base, quando e de onde."
        back={false}
        action={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={refresh} aria-label="Atualizar">
              <RefreshCw size={16} className={cn((logs.isFetching || overview.isFetching) && 'animate-spin')} />
            </Button>
            <Button variant="ghost" onClick={exportXlsx} disabled={exporting || !rows.length}>
              <Download size={16} /> {exporting ? 'Exportando…' : 'Exportar'}
            </Button>
          </div>
        }
      />

      {/* Indicadores (faixa compacta) */}
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 rounded-xl border border-border bg-card px-3 py-2">
        <Kpi label="Acessos 24h" value={o?.logins24h} />
        <Kpi label="Ações 24h" value={o?.actions24h} />
        <Kpi label="Usuários ativos 7d" value={o?.users7d} />
        <Kpi label="Falhas de login 24h" value={o?.failed24h} alert={!!o && o.failed24h >= 5} />
        <Kpi label="Erros 24h" value={o?.errors24h} alert={!!o?.errors24h} />
        <Kpi label="Negados 24h" value={o?.denied24h} alert={!!o?.denied24h} />
      </div>

      {/* Sinais que pedem atenção do administrador */}
      {o && (o.suspicious.length || idle.length) ? (
        <div className="mb-4 grid gap-3 lg:grid-cols-2">
          {o.suspicious.length ? (
            <section className="rounded-xl border border-neutral-300 bg-card p-4">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-extrabold text-foreground">
                <ShieldAlert size={16} className="text-neutral-800" /> Tentativas de login suspeitas (24h)
              </h2>
              <ul className="divide-y divide-border">
                {o.suspicious.map((s) => (
                  <li key={s.user_email}>
                    <button onClick={() => setSearch(s.user_email)} className="flex w-full items-center gap-3 py-2 text-left hover:bg-muted/50">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-foreground">{s.user_email}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {s.exists_user ? 'Usuário existente' : 'E-mail não cadastrado'} · IP {s.ips || '—'} · última {time(s.last)}
                        </span>
                      </span>
                      <StatusBadge tone={s.n >= 8 ? 'bad' : 'warn'}>{s.n} falhas</StatusBadge>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {idle.length ? (
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-1 flex items-center gap-2 text-sm font-extrabold text-foreground">
                <Building2 size={16} /> Bases sem uso há mais de 7 dias
              </h2>
              <p className="mb-2 text-xs text-muted-foreground">Cliente parado costuma cancelar. Vale um contato.</p>
              <ul className="divide-y divide-border">
                {idle.slice(0, 6).map((b) => (
                  <li key={b.id}>
                    <button onClick={() => { setBaseId(b.id); setPeriod('90d'); }} className="flex w-full items-center justify-between gap-3 py-2 text-left hover:bg-muted/50">
                      <span className="truncate text-sm font-semibold text-foreground">{b.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{b.last ? `Último uso ${ago(b.last)}` : 'Nunca usada'}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {idle.length > 6 ? <p className="pt-2 text-xs text-muted-foreground">+ {idle.length - 6} base(s)</p> : null}
            </section>
          ) : null}
        </div>
      ) : null}

      {/* Filtros */}
      <FilterBar>
        <FilterField label="Período" wide>
          <SegmentedField options={[...PERIODS]} value={period} onChange={(v) => setPeriod(v as typeof period)} />
        </FilterField>
        <FilterField label="Base">
          <select value={baseId} onChange={(e) => setBaseId(e.target.value)} className={fieldCls}>
            <option value="">Todas</option>
            {bases.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Categoria">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={fieldCls}>
            <option value="">Todas</option>
            {Object.entries(CATS).map(([k, c]) => (
              <option key={k} value={k}>
                {c.label}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Situação">
          <select value={status ?? ''} onChange={(e) => setStatus(e.target.value as typeof status)} className={fieldCls}>
            <option value="">Todas</option>
            <option value="problemas">Só problemas</option>
            <option value="erro">Erros</option>
            <option value="negado">Negados</option>
            <option value="ok">Concluídas</option>
          </select>
        </FilterField>
        <FilterField label="Buscar" grow wide>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="E-mail, turma, aluno, IP…" className={fieldCls} />
        </FilterField>
      </FilterBar>

      {/* Linha do tempo */}
      {logs.isLoading ? (
        <Loading />
      ) : !rows.length ? (
        <EmptyState icon={<ScrollText size={28} />} title="Nenhum registro" hint="Nada encontrado com esses filtros. Tente um período maior." />
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <section key={g.day}>
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{g.day}</h3>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {g.items.map((r) => (
                  <LogItem key={r.id} r={r} onBase={(id) => setBaseId(id)} onUser={(e) => setSearch(e)} />
                ))}
              </ul>
            </section>
          ))}
          {logs.hasNextPage ? (
            <div className="flex justify-center">
              <Button variant="ghost" onClick={() => logs.fetchNextPage()} disabled={logs.isFetchingNextPage}>
                {logs.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}

function Kpi({ label, value, alert }: { label: string; value?: number; alert?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
      {label}
      <b className={cn('text-sm tabular-nums', alert ? 'text-foreground underline decoration-2 underline-offset-2' : 'text-foreground')}>{value ?? '—'}</b>
    </span>
  );
}

function LogItem({ r, onBase, onUser }: { r: LogRow; onBase: (id: string) => void; onUser: (email: string) => void }) {
  const [open, setOpen] = useState(false);
  const cat = CATS[r.category] ?? CATS.sistema;
  const Icon = cat.icon;
  const problem = r.status !== 'ok';
  const who = r.user_email ?? '—';
  return (
    <li className={cn(r.status === 'erro' && 'bg-red-50/40', r.status === 'negado' && 'bg-neutral-100/40')}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={cat.label}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/50"
      >
        <span className="w-10 shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">{time(r.at)}</span>
        <Icon size={13} className="shrink-0 text-muted-foreground" aria-label={cat.label} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-5 text-foreground">
            <span className="font-semibold">{r.summary}</span>
            {r.target ? <span className="text-foreground/70"> · {r.target}</span> : null}
          </span>
          <span className="block truncate text-[11px] leading-4 text-muted-foreground md:hidden">
            {who}{r.base_name ? ` · ${r.base_name}` : ''}
          </span>
        </span>
        <span className="hidden w-52 shrink-0 truncate text-xs text-muted-foreground md:block">{who}</span>
        <span className="hidden w-36 shrink-0 truncate text-xs text-muted-foreground lg:block">{r.base_name ?? ''}</span>
        {r.status === 'erro' ? <StatusBadge tone="bad" className="shrink-0 py-0">Erro</StatusBadge> : null}
        {r.status === 'negado' ? <StatusBadge tone="warn" className="shrink-0 py-0">Negado</StatusBadge> : null}
        <ChevronDown size={13} className={cn('shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {problem && r.detail && !open ? <p className="truncate px-3 pb-1.5 pl-[3.75rem] text-[11px] font-medium text-foreground">{r.detail}</p> : null}
      {open ? (
        <div className="space-y-1 border-t border-border/60 bg-muted/30 px-3 py-2 pl-[3.75rem] text-xs text-muted-foreground">
          <p className="text-foreground">{r.summary}{r.target ? ` · ${r.target}` : ''}</p>
          {r.detail ? <p className={cn(problem && 'font-medium text-foreground')}>{r.detail}</p> : null}
          <p>
            {dateTime(r.at)} · {cat.label}
            {r.role ? ` · ${ROLE[r.role] ?? r.role}` : ''}
            {r.device ? ` · ${r.device}` : ''}
            {r.ip ? ` · IP ${r.ip}` : ''}
          </p>
          <p className="flex flex-wrap gap-x-4">
            {r.user_email ? <button onClick={() => onUser(r.user_email!)} className="font-semibold text-foreground hover:underline">Filtrar por {r.user_email}</button> : null}
            {r.base_id && r.base_name ? <button onClick={() => onBase(r.base_id!)} className="font-semibold text-foreground hover:underline">Filtrar por {r.base_name}</button> : null}
          </p>
        </div>
      ) : null}
    </li>
  );
}
