import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  Award, Building2, ClipboardCheck, Download, KeyRound, Megaphone, RefreshCw, ScrollText, Settings2, ShieldAlert, UserCog, Users, type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, EmptyState, FilterBar, FilterField, Loading, PageHeader, SegmentedField, StatTile, StatusBadge, fieldCls } from '../../components/ui';
import { cn } from '../../lib/cn';
import { downloadXlsx } from '../../lib/importSheet';
import { listLogs, listOrgAdmin, logOverview, type LogFilters, type LogRow } from '../../lib/queries';

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

const time = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Hoje';
  if (d.toDateString() === y.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}
function ago(iso: string | null) {
  if (!iso) return 'nunca usada';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
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
  const overview = useQuery({ queryKey: ['log-overview'], queryFn: logOverview, refetchInterval: 60_000 });
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
  const idle = (o?.bases ?? []).filter((b) => b.active && (!b.last || Date.now() - new Date(b.last).getTime() > 7 * 86400_000));

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

      {/* Indicadores */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 xl:grid-cols-6">
        <StatTile label="Acessos" value={o?.logins24h ?? '—'} hint="últimas 24h" />
        <StatTile label="Ações" value={o?.actions24h ?? '—'} hint="últimas 24h" />
        <StatTile label="Usuários ativos" value={o?.users7d ?? '—'} hint="últimos 7 dias" />
        <StatTile label="Falhas de login" value={o?.failed24h ?? '—'} tone={o && o.failed24h >= 5 ? 'warn' : 'none'} hint="últimas 24h" />
        <StatTile label="Erros" value={o?.errors24h ?? '—'} tone={o?.errors24h ? 'bad' : 'none'} hint="últimas 24h" />
        <StatTile label="Negados" value={o?.denied24h ?? '—'} tone={o?.denied24h ? 'warn' : 'none'} hint="acesso sem permissão · 24h" />
      </div>

      {/* Sinais que pedem atenção do administrador */}
      {o && (o.suspicious.length || idle.length) ? (
        <div className="mb-4 grid gap-3 lg:grid-cols-2">
          {o.suspicious.length ? (
            <section className="rounded-xl border border-orange-200 bg-card p-4">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-extrabold text-foreground">
                <ShieldAlert size={16} className="text-orange-600" /> Tentativas de login suspeitas (24h)
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
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.day}>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{g.day}</h3>
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

function LogItem({ r, onBase, onUser }: { r: LogRow; onBase: (id: string) => void; onUser: (email: string) => void }) {
  const cat = CATS[r.category] ?? CATS.sistema;
  const Icon = cat.icon;
  const problem = r.status !== 'ok';
  return (
    <li className={cn('flex gap-3 px-4 py-3', r.status === 'erro' && 'bg-red-50/40', r.status === 'negado' && 'bg-orange-50/40')}>
      <span className="w-11 shrink-0 pt-0.5 text-xs font-semibold tabular-nums text-muted-foreground">{time(r.at)}</span>
      <span className={cn('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg', problem ? 'bg-card ring-1 ring-inset ring-border' : 'bg-muted')}>
        <Icon size={14} className="text-foreground" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-sm font-semibold text-foreground">{r.summary}</p>
          {r.status === 'erro' ? <StatusBadge tone="bad" className="py-0.5">Erro</StatusBadge> : null}
          {r.status === 'negado' ? <StatusBadge tone="warn" className="py-0.5">Negado</StatusBadge> : null}
        </div>
        {r.target ? <p className="text-sm text-foreground/80">{r.target}</p> : null}
        {r.detail ? <p className={cn('text-xs', problem ? 'font-medium text-foreground' : 'text-muted-foreground')}>{r.detail}</p> : null}
        <p className="mt-0.5 flex flex-wrap gap-x-1.5 text-xs text-muted-foreground">
          {r.user_email ? (
            <button onClick={() => onUser(r.user_email!)} className="hover:text-foreground hover:underline">
              {r.user_email}
            </button>
          ) : (
            <span>—</span>
          )}
          {r.role ? <span>· {ROLE[r.role] ?? r.role}</span> : null}
          {r.base_name ? (
            <>
              <span>·</span>
              {r.base_id ? (
                <button onClick={() => onBase(r.base_id!)} className="hover:text-foreground hover:underline">
                  {r.base_name}
                </button>
              ) : (
                <span>{r.base_name}</span>
              )}
            </>
          ) : null}
          <span className="hidden sm:inline">{r.device ? `· ${r.device}` : ''}{r.ip ? ` · ${r.ip}` : ''}</span>
        </p>
      </div>
    </li>
  );
}
