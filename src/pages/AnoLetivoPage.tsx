import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Archive, ArrowRight, BarChart3, CalendarCheck2, Check, ChevronLeft, GraduationCap, Plus, RotateCcw, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { successToast } from '../components/Feedback';
import { Button, EmptyState, Input, Loading, PageHeader, Select } from '../components/ui';
import { cn } from '../lib/cn';
import { canManageOrg } from '../lib/permissions';
import { closeSchoolYear, reopenSchoolYear, schoolYearOverview, type YearOverview } from '../lib/queries';

/**
 * Ano letivo: encerra o ano (arquiva as turmas, que ficam só para consulta),
 * cria as turmas do ano seguinte e leva os alunos. Nada é apagado.
 */
type OClass = YearOverview['classes'][number];
type NewClass = { key: string; name: string; shift: string; from: string | null };

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '');
const SHIFTS = ['Manhã', 'Tarde', 'Noite', 'Integral'];

/** "6º ano A" → "7º ano A" · "9º ano A" → "1ª série A" · "1ª série" → "2ª série" · sem número: mantém. */
export function nextClassName(name: string) {
  if (/^\s*9\s*[º°o]?\s*ano\b/i.test(name)) return name.replace(/^\s*9\s*[º°o]?\s*ano/i, '1ª série');
  return name.replace(/(\d+)(\s*[º°ª]?)/, (_m, n: string, suf: string) => `${Number(n) + 1}${suf}`);
}

/** Última série (3ª série / 3º ano do médio): por padrão, não continua. */
const isLastGrade = (name: string) => /\b3\s*[ªa]\s*s[ée]rie\b|\b3\s*[º°o]?\s*ano\s*(do\s*)?(ensino\s*)?m[ée]dio/i.test(name);

export function AnoLetivoPage() {
  const { data, isLoading } = useQuery({ queryKey: ['school-year'], queryFn: schoolYearOverview });
  const [closing, setClosing] = useState<number | null>(null);
  const qc = useQueryClient();
  const reopen = useMutation({
    mutationFn: reopenSchoolYear,
    onSuccess: (r, y) => {
      qc.invalidateQueries();
      successToast(`${y} reaberto (${r.reopened} turma(s))`);
    },
  });

  if (isLoading || !data) return <Loading />;
  if (closing) return <CloseWizard data={data} year={closing} onExit={() => setClosing(null)} />;

  const currentYear = Number(data.today.slice(0, 4));
  const open = data.classes.filter((c) => !c.archived_at);
  const archived = data.classes.filter((c) => c.archived_at);
  const openYears = [...new Set(open.map((c) => c.effective_year))].sort();
  const archivedYears = [...new Set(archived.map((c) => c.year ?? c.effective_year))].sort((a, b) => b - a);

  return (
    <>
      <PageHeader title="Ano letivo" subtitle="Encerre o ano, arquive as turmas e prepare o próximo. Nada é apagado: tudo continua nos relatórios." />

      <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Em andamento</h2>
      {!openYears.length ? (
        <EmptyState icon={<GraduationCap size={24} />} title="Nenhuma turma em andamento" hint="Cadastre as turmas do ano em Cadastros → Turmas." />
      ) : (
        <div className="mb-8 grid gap-3 md:grid-cols-2">
          {openYears.map((y) => {
            const cs = open.filter((c) => c.effective_year === y);
            const ended = y < currentYear;
            const late = y === currentYear && Number(data.today.slice(5, 7)) >= 11;
            return (
              <section key={y} className={cn('rounded-xl border bg-card p-4 shadow-soft sm:p-5', ended ? 'border-orange-300' : 'border-border')}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-2xl font-extrabold tabular-nums">{y}</p>
                    <p className="text-sm text-muted-foreground">
                      {cs.length} turma(s) · {cs.reduce((a, c) => a + c.students, 0)} aluno(s) · {cs.reduce((a, c) => a + c.sessions, 0)} chamada(s)
                    </p>
                  </div>
                  {ended ? (
                    <span className="shrink-0 whitespace-nowrap rounded-full bg-orange-100 px-2.5 py-1 text-[11px] font-bold text-orange-800">Ano terminou</span>
                  ) : late ? (
                    <span className="shrink-0 whitespace-nowrap rounded-full bg-brand/25 px-2.5 py-1 text-[11px] font-bold text-neutral-900">Fim de ano</span>
                  ) : (
                    <span className="shrink-0 whitespace-nowrap rounded-full bg-muted px-2.5 py-1 text-[11px] font-bold text-muted-foreground">Em curso</span>
                  )}
                </div>
                <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{cs.map((c) => c.name).join(' · ')}</p>
                <Button className="mt-4 w-full sm:w-auto" variant={ended || late ? undefined : 'ghost'} onClick={() => setClosing(y)}>
                  <Archive size={16} /> Encerrar {y} e preparar {y + 1}
                </Button>
              </section>
            );
          })}
        </div>
      )}

      <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">Anos encerrados</h2>
      {!archivedYears.length ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Nenhum ano encerrado ainda.</p>
      ) : (
        <div className="space-y-3">
          {archivedYears.map((y) => {
            const cs = archived.filter((c) => (c.year ?? c.effective_year) === y);
            return (
              <section key={y} className="overflow-hidden rounded-xl border border-border bg-card">
                <header className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/40 px-4 py-3">
                  <Archive size={16} className="text-muted-foreground" />
                  <p className="font-bold">{y}</p>
                  <p className="text-xs text-muted-foreground">
                    {cs.length} turma(s) · encerrado em {fmt(cs[0]?.archived_at ?? null)}
                  </p>
                  <button
                    onClick={() =>
                      confirm(`Reabrir ${y}? As turmas voltam a aceitar chamada e notas.\nAlunos que já foram para as turmas de ${y + 1} continuam lá.`) && reopen.mutate(y)
                    }
                    className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <RotateCcw size={13} /> Reabrir
                  </button>
                </header>
                <ul className="divide-y divide-border">
                  {cs.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{c.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {c.students} aluno(s) · {c.sessions} chamada(s)
                        </span>
                      </span>
                      <Link
                        to="/relatorios"
                        state={{ classId: c.id }}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <BarChart3 size={13} /> Relatórios
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ------------------------------ Assistente ------------------------------ */
function CloseWizard({ data, year, onExit }: { data: YearOverview; year: number; onExit: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const next = year + 1;
  const open = data.classes.filter((c) => !c.archived_at);
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(open.filter((c) => c.effective_year === year).map((c) => c.id)));
  const chosen = open.filter((c) => selected.has(c.id));

  // Passo 2: turmas do ano seguinte (uma para cada turma encerrada, por padrão).
  const [plan, setPlan] = useState<Record<string, { keep: boolean; name: string; shift: string }>>(() =>
    Object.fromEntries(open.map((c) => [c.id, { keep: !isLastGrade(c.name), name: nextClassName(c.name), shift: c.shift ?? 'Manhã' }])),
  );
  const [extra, setExtra] = useState<NewClass[]>([]);
  const newClasses: NewClass[] = useMemo(
    () => [
      ...chosen.filter((c) => plan[c.id]?.keep).map((c) => ({ key: `from:${c.id}`, name: plan[c.id].name, shift: plan[c.id].shift, from: c.id })),
      ...extra,
    ],
    [chosen, plan, extra],
  );

  // Passo 3: destino de cada aluno.
  const students = data.students.filter((s) => selected.has(s.class_id));
  const defaultDest = (classId: string) => (plan[classId]?.keep ? `from:${classId}` : 'sem_turma');
  const [dest, setDest] = useState<Record<string, string>>({});
  const destOf = (s: { id: string; class_id: string }) => {
    const d = dest[s.id];
    return d && (d === 'saiu' || d === 'sem_turma' || newClasses.some((n) => n.key === d)) ? d : defaultDest(s.class_id);
  };
  const [copyConfig, setCopyConfig] = useState(true);

  const counts = useMemo(() => {
    const c = { moved: 0, left: 0, none: 0 };
    for (const s of students) {
      const d = destOf(s);
      if (d === 'saiu') c.left++;
      else if (d === 'sem_turma') c.none++;
      else c.moved++;
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, dest, newClasses]);

  const run = useMutation({
    mutationFn: () =>
      closeSchoolYear({
        year,
        classIds: chosen.map((c) => c.id),
        newClasses: newClasses.map((n) => ({ key: n.key, name: n.name, shift: n.shift, from: n.from })),
        moves: students.map((s) => ({ studentId: s.id, to: destOf(s) })),
        copyGradeConfig: copyConfig,
      }),
    onSuccess: () => {
      qc.invalidateQueries();
      setStep(5);
    },
  });

  const warnings = chosen.filter((c) => c.terms_with_grades.length < 3 && c.students > 0);
  const dupNames = newClasses.map((n) => n.name.trim().toLowerCase());
  const namesOk = newClasses.every((n) => n.name.trim()) && new Set(dupNames).size === dupNames.length;

  const steps = ['Turmas de ' + year, 'Turmas de ' + next, 'Alunos', 'Confirmar'];

  if (step === 5) {
    const r = run.data!;
    return (
      <div className="mx-auto max-w-xl py-8 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-green-100 text-green-700">
          <Check size={28} />
        </span>
        <h1 className="mt-4 text-2xl font-extrabold">{year} encerrado</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {r.archived} turma(s) arquivada(s) · {r.created} turma(s) criada(s) para {next} · {r.moved} aluno(s) nas turmas novas
          {r.left ? ` · ${r.left} saíram` : ''}
          {r.noClass ? ` · ${r.noClass} sem turma` : ''}.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">Relatórios e boletins de {year} continuam em Relatórios (as turmas aparecem com "({year})").</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button onClick={() => navigate('/turmas')}>
            <GraduationCap size={16} /> Ver turmas de {next}
          </Button>
          <Button variant="ghost" onClick={onExit}>
            Voltar ao ano letivo
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-24">
      <div className="mb-5 flex items-center gap-3">
        <button onClick={onExit} className="grid h-10 w-10 place-items-center rounded-lg ring-1 ring-inset ring-border hover:bg-muted" aria-label="Voltar">
          <ChevronLeft size={18} />
        </button>
        <div>
          <h1 className="text-xl font-extrabold">Encerrar {year}</h1>
          <p className="text-xs text-muted-foreground">e preparar {next}</p>
        </div>
      </div>

      <ol className="mb-6 grid grid-cols-4 gap-1.5">
        {steps.map((t, i) => (
          <li key={t} className={cn('rounded-lg px-2 py-2 text-center text-[11px] font-semibold sm:text-xs', step === i + 1 ? 'bg-neutral-950 text-brand' : step > i + 1 ? 'bg-muted text-foreground' : 'bg-muted/50 text-muted-foreground')}>
            <span className="tabular-nums">{i + 1}.</span> {t}
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <section className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Estas turmas serão <b className="text-foreground">arquivadas</b>: saem da chamada, das notas e das provas, mas continuam nos relatórios e boletins.
          </p>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {open.map((c) => {
              const on = selected.has(c.id);
              return (
                <li key={c.id}>
                  <label className={cn('flex cursor-pointer items-center gap-3 px-4 py-3', !on && 'opacity-60')}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => setSelected((s) => { const n = new Set(s); if (on) n.delete(c.id); else n.add(c.id); return n; })}
                      className="h-4 w-4 accent-neutral-900"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {c.name} <span className="font-normal text-muted-foreground">· {c.year ?? `${c.effective_year} (sem ano informado)`}</span>
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {c.students} aluno(s) · {c.sessions} chamada(s) em {c.effective_year} · notas: {c.terms_with_grades.length ? c.terms_with_grades.map((t) => `${t}º`).join(', ') + ' tri' : 'nenhuma'}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {warnings.length ? (
            <p className="flex gap-2 rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-900 ring-1 ring-inset ring-orange-200">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                {warnings.map((w) => w.name).join(', ')}: ainda falta{warnings.length > 1 ? 'm' : ''} nota em algum trimestre. Dá para encerrar assim mesmo e, se precisar, reabrir o ano depois.
              </span>
            </p>
          ) : null}
        </section>
      ) : null}

      {step === 2 ? (
        <section className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Turmas de <b className="text-foreground">{next}</b>. Já sugerimos a série seguinte; ajuste os nomes como quiser.
          </p>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {chosen.map((c) => {
              const p = plan[c.id];
              return (
                <li key={c.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                  <span className="flex min-w-0 items-center gap-2 sm:w-52">
                    <span className="truncate text-sm font-semibold">{c.name}</span>
                    <ArrowRight size={14} className="shrink-0 text-muted-foreground" />
                  </span>
                  {p.keep ? (
                    <>
                      <Input value={p.name} onChange={(e) => setPlan((s) => ({ ...s, [c.id]: { ...p, name: e.target.value } }))} className="flex-1" aria-label="Nome da turma nova" />
                      <Select value={p.shift} onChange={(e) => setPlan((s) => ({ ...s, [c.id]: { ...p, shift: e.target.value } }))} className="sm:w-32" aria-label="Turno">
                        {SHIFTS.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </Select>
                    </>
                  ) : (
                    <span className="flex-1 text-sm text-muted-foreground">Sem turma em {next} (última série, turma extinta…)</span>
                  )}
                  <button
                    onClick={() => setPlan((s) => ({ ...s, [c.id]: { ...p, keep: !p.keep } }))}
                    className="h-9 shrink-0 rounded-lg px-2.5 text-xs font-semibold text-muted-foreground ring-1 ring-inset ring-border hover:bg-muted"
                  >
                    {p.keep ? 'Não continuar' : 'Criar turma'}
                  </button>
                </li>
              );
            })}
            {extra.map((n, i) => (
              <li key={n.key} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                <span className="text-sm font-semibold text-muted-foreground sm:w-52">Turma nova</span>
                <Input value={n.name} onChange={(e) => setExtra((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Ex.: 6º ano B" className="flex-1" autoFocus />
                <Select value={n.shift} onChange={(e) => setExtra((l) => l.map((x, j) => (j === i ? { ...x, shift: e.target.value } : x)))} className="sm:w-32">
                  {SHIFTS.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </Select>
                <button onClick={() => setExtra((l) => l.filter((_, j) => j !== i))} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted" aria-label="Remover">
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
          <Button variant="ghost" onClick={() => setExtra((l) => [...l, { key: `new:${Date.now()}`, name: '', shift: 'Manhã', from: null }])}>
            <Plus size={16} /> Adicionar outra turma para {next}
          </Button>
          {!namesOk ? <p className="text-xs font-semibold text-red-600">Dê nomes diferentes (e não vazios) para as turmas novas.</p> : null}
        </section>
      ) : null}

      {step === 3 ? (
        <section className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Para onde vai cada aluno em {next}. Repetente? Escolha a turma certa. Quem saiu da escola fica <b className="text-foreground">inativo</b>, com o histórico guardado.
          </p>
          {chosen.map((c) => {
            const list = students.filter((s) => s.class_id === c.id);
            if (!list.length) return null;
            return (
              <div key={c.id} className="overflow-hidden rounded-xl border border-border bg-card">
                <header className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
                  <Users size={15} className="text-muted-foreground" />
                  <p className="text-sm font-bold">{c.name}</p>
                  <span className="text-xs text-muted-foreground">{list.length} aluno(s)</span>
                  <Select
                    value=""
                    onChange={(e) => e.target.value && setDest((d) => ({ ...d, ...Object.fromEntries(list.map((s) => [s.id, e.target.value])) }))}
                    className="ml-auto w-auto py-1.5 text-xs"
                    aria-label="Mover todos"
                  >
                    <option value="">Todos para…</option>
                    <DestOptions newClasses={newClasses} />
                  </Select>
                </header>
                <ul className="divide-y divide-border">
                  {list.map((s) => {
                    const d = destOf(s);
                    return (
                      <li key={s.id} className="flex items-center gap-3 px-4 py-2">
                        <span className={cn('min-w-0 flex-1 truncate text-sm', d === 'saiu' && 'text-muted-foreground line-through')}>{s.name}</span>
                        <Select value={d} onChange={(e) => setDest((x) => ({ ...x, [s.id]: e.target.value }))} className={cn('w-44 py-1.5 text-xs sm:w-56', d === 'saiu' && 'text-red-700')} aria-label={`Destino de ${s.name}`}>
                          <DestOptions newClasses={newClasses} />
                        </Select>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          {!students.length ? <p className="text-sm text-muted-foreground">As turmas escolhidas não têm alunos ativos.</p> : null}
        </section>
      ) : null}

      {step === 4 ? (
        <section className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={`Turmas de ${year} arquivadas`} value={chosen.length} />
            <Stat label={`Turmas de ${next} criadas`} value={newClasses.length} />
            <Stat label="Alunos nas turmas novas" value={counts.moved} />
            <Stat label="Saíram / sem turma" value={`${counts.left} / ${counts.none}`} />
          </div>
          <label className="flex items-start gap-2.5 rounded-xl border border-border bg-card p-4">
            <input type="checkbox" checked={copyConfig} onChange={(e) => setCopyConfig(e.target.checked)} className="mt-0.5 h-4 w-4 accent-neutral-900" />
            <span>
              <span className="block text-sm font-semibold">Manter a mesma composição de notas em {next}</span>
              <span className="block text-xs text-muted-foreground">Atividades e pesos dos trimestres (da escola e de cada turma) seguem para o ano novo. Dá para mudar depois.</span>
            </span>
          </label>
          <div className="rounded-xl bg-muted/50 p-4 text-xs text-muted-foreground">
            <p className="mb-1 flex items-center gap-1.5 font-semibold text-foreground">
              <CalendarCheck2 size={14} /> Nada é apagado
            </p>
            Chamadas, notas, provas e boletins de {year} ficam guardados e aparecem em Relatórios. Se algo ficar errado, dá para reabrir {year} nesta tela.
          </div>
          {run.isError ? <p className="text-sm font-semibold text-red-600">{(run.error as Error).message}</p> : null}
        </section>
      ) : null}

      {/* Navegação */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-2">
          <Button variant="ghost" onClick={() => (step === 1 ? onExit() : setStep(step - 1))}>
            {step === 1 ? 'Cancelar' : 'Voltar'}
          </Button>
          <span className="ml-auto" />
          {step < 4 ? (
            <Button onClick={() => setStep(step + 1)} disabled={(step === 1 && !chosen.length) || (step === 2 && !namesOk)}>
              Continuar <ArrowRight size={16} />
            </Button>
          ) : (
            <Button
              onClick={() => confirm(`Encerrar ${year}? As ${chosen.length} turma(s) passam a ser só para consulta.`) && run.mutate()}
              disabled={run.isPending}
            >
              <Archive size={16} /> {run.isPending ? 'Encerrando…' : `Encerrar ${year}`}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function DestOptions({ newClasses }: { newClasses: NewClass[] }) {
  return (
    <>
      {newClasses.map((n) => (
        <option key={n.key} value={n.key}>
          → {n.name || '(sem nome)'}
        </option>
      ))}
      <option value="sem_turma">Sem turma (decidir depois)</option>
      <option value="saiu">Saiu da escola (inativar)</option>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="text-2xl font-extrabold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

/** Aviso no Início (gestão): o ano terminou e ainda não foi encerrado. */
export function YearEndBanner() {
  const { role } = useAuth();
  const manager = canManageOrg(role);
  const month = new Date().getMonth() + 1;
  const { data } = useQuery({ queryKey: ['school-year'], queryFn: schoolYearOverview, enabled: manager, staleTime: 10 * 60_000 });
  if (!manager || !data) return null;
  const y = Number(data.today.slice(0, 4));
  const open = data.classes.filter((c) => !c.archived_at);
  const past = open.filter((c) => c.effective_year < y);
  const endingNow = month >= 11 && open.some((c) => c.effective_year === y);
  if (!past.length && !endingNow) return null;
  const target = past.length ? Math.min(...past.map((c) => c.effective_year)) : y;
  return (
    <Link to="/ano-letivo" className="mb-4 flex items-center gap-3 rounded-xl border border-brand/60 bg-brand/15 px-4 py-3 transition hover:bg-brand/25">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-neutral-950 text-brand">
        <Archive size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-foreground">{past.length ? `O ano letivo ${target} terminou` : `Fim do ano letivo ${target}`}</span>
        <span className="block text-xs text-muted-foreground">Arquive as turmas e prepare {target + 1}: turmas novas e alunos promovidos em poucos cliques.</span>
      </span>
      <ArrowRight size={16} className="shrink-0 text-foreground" />
    </Link>
  );
}
