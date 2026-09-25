import { useQuery } from '@tanstack/react-query';
import { BarChart3, BellOff, CheckCircle2, ChevronDown, ClipboardCheck, MessageCircle, MoreHorizontal, RotateCcw, ShieldAlert, Award } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { cn } from '../lib/cn';
import { can } from '../lib/permissions';
import { smartAlerts, type AlertSeverity, type AlertSignal, type ClassAlert, type StudentAlert } from '../lib/queries';
import { TONE, type Tone } from '../lib/tone';
import { DropdownMenu, StatusBadge } from './ui';

/**
 * Central de alertas do painel. O servidor cruza frequência, faltas seguidas,
 * queda recente, notas e pendências de turma; aqui só filtramos por papel,
 * priorizamos e oferecemos a próxima ação (falar com a família, abrir a tela certa).
 */
const SEV: Record<AlertSeverity, { tone: Tone; label: string; plural: string }> = {
  critical: { tone: 'bad', label: 'Crítico', plural: 'Críticos' },
  warning: { tone: 'warn', label: 'Atenção', plural: 'Atenção' },
  info: { tone: 'none', label: 'Observar', plural: 'Observar' },
};
const RANK: Record<AlertSeverity, number> = { critical: 3, warning: 2, info: 1 };
const PAGE = 6;
const CIENTE_KEY = 'scola:alertas:ciente';
const CIENTE_DIAS = 7;

type Item =
  | { type: 'student'; key: string; severity: AlertSeverity; data: StudentAlert }
  | { type: 'class'; key: string; severity: AlertSeverity; data: ClassAlert };

function readCiente(): Record<string, number> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(CIENTE_KEY) || '{}') as Record<string, number>;
    const now = Date.now();
    return Object.fromEntries(Object.entries(raw).filter(([, until]) => until > now));
  } catch {
    return {};
  }
}
function writeCiente(map: Record<string, number>) {
  try {
    window.localStorage.setItem(CIENTE_KEY, JSON.stringify(map));
  } catch {
    /* sem armazenamento: o "Ciente" vale só nesta visita */
  }
}

function whatsappUrl(phone: string | null, text: string): string | null {
  let digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  if (digits.length <= 11) digits = `55${digits}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function SmartAlerts() {
  const { role, activeBase } = useAuth();
  const navigate = useNavigate();
  const seeFreq = can(role, 'chamadas') || can(role, 'relatorios');
  const seeGrades = can(role, 'notas');
  const seeCalls = can(role, 'chamadas');

  const { data, isLoading } = useQuery({ queryKey: ['smart-alerts'], queryFn: () => smartAlerts(), enabled: seeFreq || seeGrades, staleTime: 60_000 });
  const [filter, setFilter] = useState<AlertSeverity | 'all'>('all');
  const [expanded, setExpanded] = useState(false);
  const [ciente, setCiente] = useState<Record<string, number>>(readCiente);
  const [showCiente, setShowCiente] = useState(false);

  // Só o que o papel pode ver e agir sobre.
  const items = useMemo<Item[]>(() => {
    if (!data) return [];
    const allowed = (s: AlertSignal) =>
      s.kind === 'grade_low' || s.kind === 'missing_grades' ? seeGrades : s.kind === 'no_call' ? seeCalls : seeFreq;
    const students: Item[] = data.students
      .map((a) => ({ ...a, signals: a.signals.filter(allowed) }))
      .filter((a) => a.signals.length)
      .map((a) => ({ type: 'student', key: a.key, severity: a.severity, data: a }));
    const classes: Item[] = data.classes.filter((c) => allowed(c.signal)).map((c) => ({ type: 'class', key: c.key, severity: c.severity, data: c }));
    // Turmas primeiro dentro da mesma gravidade: uma chamada esquecida afeta todos os alunos.
    return [...classes, ...students].sort((x, y) => RANK[y.severity] - RANK[x.severity]);
  }, [data, seeFreq, seeGrades, seeCalls]);

  const active = items.filter((i) => !ciente[i.key]);
  const hiddenCount = items.length - active.length;
  const pool = showCiente ? items : active;
  const counts = { critical: 0, warning: 0, info: 0 } as Record<AlertSeverity, number>;
  pool.forEach((i) => counts[i.severity]++);
  const filtered = filter === 'all' ? pool : pool.filter((i) => i.severity === filter);
  const visible = expanded ? filtered : filtered.slice(0, PAGE);

  if (!(seeFreq || seeGrades) || isLoading || !data) return null;

  function toggleCiente(key: string) {
    const next = { ...ciente };
    if (next[key]) delete next[key];
    else next[key] = Date.now() + CIENTE_DIAS * 86_400_000;
    setCiente(next);
    writeCiente(next);
  }

  function openReport(classId: string, tipo: 'freq' | 'notas') {
    navigate('/relatorios', { state: { classId, tipo } });
  }
  function openWith(path: string, storageKey: string, classId: string) {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(classId));
    } catch {
      /* segue sem pré-seleção */
    }
    navigate(path);
  }

  const top = active.length ? worstOf(active) : null;

  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-border bg-card shadow-soft">
      {/* Cabeçalho + filtro por gravidade */}
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', top ? TONE[SEV[top].tone].soft : TONE.ok.soft)}>
            {top ? <ShieldAlert size={19} /> : <CheckCircle2 size={19} />}
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-extrabold text-foreground">Central de alertas</h2>
            <p className="text-xs text-muted-foreground">
              {active.length
                ? `${active.length} ${active.length === 1 ? 'situação pede' : 'situações pedem'} ação · frequência mín. ${data.minPct}% · média ${data.media}`
                : 'Nenhuma pendência. Frequência, notas e chamadas em dia.'}
            </p>
          </div>
        </div>
        {pool.length ? (
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
            <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} label="Todos" count={pool.length} />
            {(['critical', 'warning', 'info'] as const).map((s) =>
              counts[s] ? (
                <FilterChip key={s} active={filter === s} onClick={() => setFilter(filter === s ? 'all' : s)} label={SEV[s].plural} count={counts[s]} tone={SEV[s].tone} />
              ) : null,
            )}
          </div>
        ) : null}
      </div>

      {/* Lista priorizada */}
      {visible.length ? (
        <ul className="divide-y divide-border">
          {visible.map((item) => {
            const isCiente = !!ciente[item.key];
            const tone = SEV[item.severity].tone;
            if (item.type === 'class') {
              const c = item.data;
              const isCall = c.signal.kind === 'no_call';
              return (
                <AlertRow
                  key={item.key}
                  tone={tone}
                  muted={isCiente}
                  title={c.class_name}
                  subtitle="Turma"
                  signals={[c.signal]}
                  primary={
                    isCall
                      ? { label: 'Fazer chamada', icon: <ClipboardCheck size={15} />, onClick: () => openWith('/chamadas', 'scola:attendance:classId', c.class_id) }
                      : { label: 'Lançar notas', icon: <Award size={15} />, onClick: () => openWith('/notas', 'scola:notas:classId', c.class_id) }
                  }
                  menu={[{ label: isCiente ? 'Voltar a alertar' : `Ciente por ${CIENTE_DIAS} dias`, icon: isCiente ? <RotateCcw size={15} /> : <BellOff size={15} />, onClick: () => toggleCiente(item.key) }]}
                />
              );
            }
            const a = item.data;
            const hasFreq = a.signals.some((s) => s.kind !== 'grade_low');
            const hasGrade = a.signals.some((s) => s.kind === 'grade_low');
            const reasons = a.signals.map((s) => s.label.toLowerCase()).join(', ');
            const guardian = a.guardian_name?.split(' ')[0];
            const wa = whatsappUrl(
              a.guardian_phone,
              `Olá${guardian ? `, ${guardian}` : ''}! Aqui é da ${activeBase?.name ?? 'escola'}. Gostaríamos de conversar sobre ${a.name.split(' ')[0]} (${a.class_name}): ${reasons}. Podemos falar?`,
            );
            return (
              <AlertRow
                key={item.key}
                tone={tone}
                muted={isCiente}
                title={a.name}
                subtitle={a.class_name}
                signals={a.signals}
                primary={
                  wa && hasFreq
                    ? { label: 'Falar com a família', icon: <MessageCircle size={15} />, href: wa }
                    : hasFreq
                    ? { label: 'Ver frequência', icon: <BarChart3 size={15} />, onClick: () => openReport(a.class_id, 'freq') }
                    : { label: 'Ver notas', icon: <Award size={15} />, onClick: () => openWith('/notas', 'scola:notas:classId', a.class_id) }
                }
                menu={[
                  { label: 'Falar com a família', hint: 'Mensagem pronta no WhatsApp.', icon: <MessageCircle size={15} />, onClick: () => window.open(wa!, '_blank', 'noopener'), hidden: !wa || hasFreq },
                  { label: 'Relatório de frequência', icon: <BarChart3 size={15} />, onClick: () => openReport(a.class_id, 'freq'), hidden: !hasFreq },
                  { label: 'Relatório de notas', icon: <Award size={15} />, onClick: () => openReport(a.class_id, 'notas'), hidden: !hasGrade },
                  {
                    label: isCiente ? 'Voltar a alertar' : `Ciente por ${CIENTE_DIAS} dias`,
                    hint: isCiente ? undefined : 'Volta antes se a situação piorar.',
                    icon: isCiente ? <RotateCcw size={15} /> : <BellOff size={15} />,
                    onClick: () => toggleCiente(item.key),
                  },
                ]}
              />
            );
          })}
        </ul>
      ) : null}

      {/* Rodapé */}
      {filtered.length > PAGE || hiddenCount ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-xs font-semibold text-muted-foreground">
          {filtered.length > PAGE ? (
            <button onClick={() => setExpanded((v) => !v)} className="inline-flex items-center gap-1 text-foreground hover:underline">
              {expanded ? 'Mostrar menos' : `Ver todos (${filtered.length})`}
              <ChevronDown size={14} className={cn('transition', expanded && 'rotate-180')} />
            </button>
          ) : (
            <span />
          )}
          {hiddenCount ? (
            <button onClick={() => setShowCiente((v) => !v)} className="hover:text-foreground hover:underline">
              {showCiente ? 'Ocultar os marcados como ciente' : `${hiddenCount} marcado(s) como ciente`}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function worstOf(items: Item[]): AlertSeverity {
  return items.reduce<AlertSeverity>((w, i) => (RANK[i.severity] > RANK[w] ? i.severity : w), 'info');
}

function FilterChip({ active, onClick, label, count, tone }: { active: boolean; onClick: () => void; label: string; count: number; tone?: Tone }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ring-1 ring-inset transition',
        active ? 'bg-neutral-950 text-white ring-neutral-950' : 'bg-card text-foreground ring-border hover:bg-muted',
      )}
    >
      {tone ? <span className={cn('h-2 w-2 rounded-full', TONE[tone].dot)} /> : null}
      {label}
      <span className={cn('tabular-nums', active ? 'text-white/70' : 'text-muted-foreground')}>{count}</span>
    </button>
  );
}

type Primary = { label: string; icon: React.ReactNode; onClick?: () => void; href?: string };

function AlertRow({
  tone,
  muted,
  title,
  subtitle,
  signals,
  primary,
  menu,
}: {
  tone: Tone;
  muted: boolean;
  title: string;
  subtitle: string;
  signals: AlertSignal[];
  primary: Primary;
  menu: { label: string; icon: React.ReactNode; onClick: () => void; hidden?: boolean; hint?: string }[];
}) {
  const main = signals.find((s) => s.severity === 'critical') ?? signals.find((s) => s.severity === 'warning') ?? signals[0];
  const btn =
    'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-card px-3 text-xs font-semibold text-foreground ring-1 ring-inset ring-border transition hover:bg-muted';
  return (
    <li className={cn('relative flex flex-col gap-3 py-3 pl-5 pr-4 sm:flex-row sm:items-center', muted && 'opacity-55')}>
      <span className={cn('absolute bottom-3 left-0 top-3 w-1 rounded-r-full', TONE[tone].bar)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold leading-snug text-foreground">
          {title} <span className="font-medium text-muted-foreground">· {subtitle}</span>
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {signals.map((s) => (
            <StatusBadge key={s.kind} tone={SEV[s.severity].tone} className="py-0.5">
              {s.label}
            </StatusBadge>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">{main.detail}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {primary.href ? (
          <a href={primary.href} target="_blank" rel="noreferrer" className={cn(btn, 'flex-1 sm:flex-none')}>
            {primary.icon}
            {primary.label}
          </a>
        ) : (
          <button onClick={primary.onClick} className={cn(btn, 'flex-1 sm:flex-none')}>
            {primary.icon}
            {primary.label}
          </button>
        )}
        <DropdownMenu label="Mais ações" icon={<MoreHorizontal size={16} />} iconOnly items={menu} />
      </div>
    </li>
  );
}
