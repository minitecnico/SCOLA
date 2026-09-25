import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ClipboardList, MoreHorizontal, Pencil, Plus, Save, Search, Sliders, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { successToast } from '../components/Feedback';
import { ConfirmClearModal } from '../components/ConfirmClearModal';
import { canManageOrg } from '../lib/permissions';
import { ActionFooter, Button, Card, DropdownMenu, EmptyState, FilterBar, FilterField, FooterButton, Input, Loading, Modal, Notice, PageHeader, SegmentedField, StatGrid, StatTile, fieldCls } from '../components/ui';
import { TONE, gradeTone, type Tone } from '../lib/tone';
import { cn } from '../lib/cn';
import {
  applyCreditoToGrades,
  bulkDeleteEvalGrades,
  getEvalConfig,
  listClasses,
  listEvalGrades,
  listStudentsByClass,
  saveEvalConfig,
  saveEvalGrades,
  type EvalGradeRow,
} from '../lib/queries';
import { actKey, CREDITO_ACTIVITIES, sanitizeGrade, TERMS, TERM_LABEL, type GradeActivity } from '../lib/types';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import { usePersistentState } from '../lib/usePersistentState';

type CellState = { done: boolean; score: string };

/** Entregas: 100–80% verde · 79–50% laranja · abaixo vermelho. */
function deliveryTone(pct: number, possible: number): Tone {
  if (!possible) return 'none';
  if (pct >= 80) return 'ok';
  if (pct >= 50) return 'warn';
  return 'bad';
}

/** yyyy-mm-dd → dd/mm (prazo curto no cabeçalho). */
function fmtDM(d: string): string {
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

export function EvaluationsPage() {
  const qc = useQueryClient();
  const { activeOrgId, ctxLoading, role } = useAuth();
  const canClear = canManageOrg(role); // só coordenação/direção limpa avaliações
  const now = new Date();
  const [classId, setClassId] = usePersistentState('scola:avaliacoes:classId', '');
  const [term, setTerm] = usePersistentState('scola:avaliacoes:term', 1);
  const [year, setYear] = usePersistentState('scola:avaliacoes:year', now.getFullYear());
  const [q, setQ] = useState('');
  const [cells, setCells] = useState<Record<string, Record<string, CellState>>>({});
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const online = useOnlineStatus();
  const orgReady = !ctxLoading && !!activeOrgId;

  const { data: classes = [] } = useQuery({ queryKey: ['classes', activeOrgId], queryFn: listClasses, enabled: orgReady });

  useEffect(() => {
    if (!orgReady || !classes.length) return;
    if (!classId || !classes.some((c) => c.id === classId)) setClassId(classes[0].id);
  }, [classes, classId, orgReady]);

  const { data: activities = [] } = useQuery({
    queryKey: ['eval-config', activeOrgId, classId, year, term],
    queryFn: () => getEvalConfig(classId, year, term),
    enabled: orgReady && !!classId,
  });

  const { data: students = [], isLoading } = useQuery({
    queryKey: ['students-by-class', activeOrgId, classId],
    queryFn: () => listStudentsByClass(classId),
    enabled: orgReady && !!classId,
  });

  const { data: marksRows = [], isLoading: marksLoading } = useQuery({
    queryKey: ['eval-grades', activeOrgId, classId, year, term],
    queryFn: () => listEvalGrades(classId, year, term),
    enabled: orgReady && !!classId,
  });

  const studentsSig = students.map((s) => s.id).join(',');
  const marksSig = marksRows.map((g) => `${g.student_id}:${JSON.stringify(g.marks)}`).join('|');
  const actNames = activities.map(actKey).join(',');

  const hasSavedMarks = marksRows.length > 0;
  function resetCells() {
    const map: Record<string, Record<string, CellState>> = {};
    students.forEach((s) => {
      const g = marksRows.find((x) => x.student_id === s.id);
      const row: Record<string, CellState> = {};
      activities.forEach((a) => {
        const k = actKey(a);
        const m = g?.marks?.[k];
        row[k] = { done: !!m?.done, score: m?.score != null ? String(m.score) : '' };
      });
      map[s.id] = row;
    });
    setCells(map);
    setSaved(false);
    setEditing(marksRows.length === 0);
  }

  useEffect(() => {
    if (!orgReady || isLoading || marksLoading) return;
    resetCells();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgReady, isLoading, marksLoading, studentsSig, marksSig, actNames]);

  const list = useMemo(() => students.filter((s) => s.full_name.toLowerCase().includes(q.toLowerCase())), [students, q]);
  const hasCredito = activities.some((a) => a.credito);
  // Agrupa o cabeçalho do crédito (colspan) só quando as colunas de crédito são contíguas.
  const firstCreditoIdx = activities.findIndex((a) => a.credito);
  const lastCreditoIdx = activities.map((a) => !!a.credito).lastIndexOf(true);
  const creditoCount = activities.filter((a) => a.credito).length;
  const creditoGrouped = creditoCount > 0 && lastCreditoIdx - firstCreditoIdx + 1 === creditoCount;

  function toggleDone(id: string, act: string) {
    if (!editing) return;
    setCells((p) => ({ ...p, [id]: { ...p[id], [act]: { ...p[id]?.[act], done: !p[id]?.[act]?.done, score: p[id]?.[act]?.score ?? '' } } }));
    setSaved(false);
  }
  function setScore(id: string, act: string, raw: string, max: number) {
    if (!editing) return;
    const v = sanitizeGrade(raw, max);
    setCells((p) => ({ ...p, [id]: { ...p[id], [act]: { done: v !== '' ? true : p[id]?.[act]?.done ?? false, score: v } } }));
    setSaved(false);
  }

  const save = useMutation({
    mutationFn: async () => {
      const rows: EvalGradeRow[] = students
        .map((s) => {
          const row = cells[s.id] || {};
          const marks: Record<string, { done: boolean; score: number | null }> = {};
          activities.forEach((a) => {
            const k = actKey(a);
            const c = row[k];
            if (c && (c.done || c.score !== '')) marks[k] = { done: c.done || c.score !== '', score: c.score !== '' ? Number(c.score) : null };
          });
          return { student_id: s.id, marks };
        })
        .filter((r) => Object.keys(r.marks).length > 0);
      await saveEvalGrades(classId, year, term, rows);
      // Se houver coluna de nota ligada ao crédito variável, grava o total já nas notas.
      const applied = await applyCreditoToGrades(classId, year, term);
      return applied;
    },
    onSuccess: (applied) => {
      setSaved(true);
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['eval-grades', activeOrgId, classId, year, term] });
      qc.invalidateQueries({ queryKey: ['term-grades'] });
      qc.invalidateQueries({ queryKey: ['credito-data'] });
      successToast(applied ? 'Avaliações salvas e crédito lançado nas notas' : 'Avaliações salvas com sucesso');
    },
  });

  function handleSave() {
    if (!online) {
      alert('Sem conexão com a internet. Conecte-se para salvar as avaliações — assim nada se perde.');
      return;
    }
    save.mutate();
  }

  // Limpa (apaga) as avaliações da turma no trimestre/ano e remove o crédito das notas.
  const clearEval = useMutation({
    mutationFn: async () => {
      await bulkDeleteEvalGrades(classId, year, term, students.map((s) => s.id));
      await applyCreditoToGrades(classId, year, term);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['eval-grades', activeOrgId, classId, year, term] });
      qc.invalidateQueries({ queryKey: ['term-grades'] });
      qc.invalidateQueries({ queryKey: ['credito-data'] });
      setClearOpen(false);
      successToast('Avaliações apagadas');
    },
    onError: (e) => alert('Não foi possível limpar: ' + (e as Error).message),
  });
  const turmaNome = classes.find((c) => c.id === classId)?.name ?? 'turma';

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];

  // Resumo: entregas por atividade e total.
  const totals = useMemo(() => {
    let done = 0;
    list.forEach((s) => activities.forEach((a) => cells[s.id]?.[actKey(a)]?.done && done++));
    const possible = list.length * activities.length;
    return { done, possible, pct: possible ? Math.round((done / possible) * 100) : 0 };
  }, [list, activities, cells]);

  if (!orgReady) {
    return (
      <>
        <PageHeader title="Central de Avaliações" subtitle="Carregando…" />
        <Loading label="Preparando os dados da escola…" />
      </>
    );
  }
  if (classes.length === 0) {
    return (
      <>
        <PageHeader title="Central de Avaliações" subtitle="Controle de atividades da turma" />
        <EmptyState icon={<ClipboardList size={26} />} title="Nenhuma turma" hint="Cadastre turma e alunos para controlar as atividades." />
      </>
    );
  }

  return (
    <div className="pb-28">
      <PageHeader
        title="Central de Avaliações"
        subtitle="Quem entregou cada atividade e a pontuação (não calcula média)."
        action={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setConfigOpen(true)} className="min-h-10 py-2">
              <Sliders size={16} /> Atividades
            </Button>
            <DropdownMenu
              label="Mais ações"
              iconOnly
              icon={<MoreHorizontal size={18} />}
              items={[{ label: 'Limpar avaliações do trimestre', icon: <Trash2 size={16} />, danger: true, onClick: () => setClearOpen(true), hidden: !(canClear && hasSavedMarks) }]}
            />
          </div>
        }
      />

      <FilterBar>
        <FilterField label="Trimestre" wide>
          <SegmentedField<number> value={term} onChange={setTerm} options={TERMS.map((t) => ({ value: t, label: `${t}º tri` }))} />
        </FilterField>
        <FilterField label="Turma" grow>
          <select value={classId} onChange={(e) => setClassId(e.target.value)} className={fieldCls}>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Ano">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={fieldCls}>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Buscar aluno" wide grow>
          <span className="relative block">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome do aluno" className={cn(fieldCls, 'pl-9')} />
          </span>
        </FilterField>
      </FilterBar>

      {activities.length === 0 ? (
        <EmptyState
          icon={<Sliders size={26} />}
          title="Defina as atividades deste trimestre"
          hint="Em Composição de avaliações, dê nome às atividades que a turma vai fazer (ex.: Trabalho de Ciências, Leitura)."
          action={<Button onClick={() => setConfigOpen(true)}><Sliders size={18} /> Definir atividades</Button>}
        />
      ) : (
        <>
          {isLoading || marksLoading ? (
            <Loading />
          ) : students.length === 0 ? (
            <EmptyState icon={<ClipboardList size={26} />} title="Turma sem alunos" hint="Cadastre alunos nesta turma." />
          ) : (
            <>
              <StatGrid cols={3}>
                <StatTile label="Alunos" value={list.length} />
                <StatTile label="Atividades" value={activities.length} />
                <StatTile label="Entregas" value={`${totals.pct}%`} tone={deliveryTone(totals.pct, totals.possible)} hint={`${totals.done} de ${totals.possible}`} />
              </StatGrid>

              {hasSavedMarks && !editing ? (
                <Notice>Avaliações salvas e bloqueadas. Toque em <b>Editar</b> para alterar.</Notice>
              ) : null}
              <Card className="max-h-[70vh] overflow-auto p-0">
                <table className="w-full border-collapse text-sm">
                  <thead className="sticky top-0 z-20 bg-muted text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    {creditoGrouped ? (
                      <>
                        <tr>
                          <th rowSpan={2} className="sticky left-0 top-0 z-30 w-[160px] min-w-[160px] max-w-[160px] bg-muted px-3 py-3 text-left shadow-[2px_0_0_0_rgba(226,232,240,1)]">Aluno</th>
                          {activities.map((a, idx) => {
                            if (a.credito) {
                              if (idx !== firstCreditoIdx) return null;
                              return (
                                <th key="credito-group" colSpan={creditoCount} className="border-b border-border bg-muted px-2 py-2 text-center">
                                  Crédito variável <span className="font-medium normal-case text-muted-foreground">· vale 1 nota</span>
                                </th>
                              );
                            }
                            return (
                              <th key={actKey(a)} rowSpan={2} className="min-w-[84px] px-1.5 py-2 text-center align-bottom">
                                <span className="block text-[11px] leading-tight text-muted-foreground">{a.name}</span>
                                <span className="mt-1 inline-block rounded bg-muted/70 px-1.5 py-0.5 text-[9px] font-black text-muted-foreground">{a.max > 0 ? `0–${a.max}` : 'nota livre'}</span>
                                {a.date ? <span className="mt-0.5 block text-[9px] font-semibold text-muted-foreground">até {fmtDM(a.date)}</span> : null}
                              </th>
                            );
                          })}
                          {hasCredito ? <th rowSpan={2} className="min-w-[96px] px-3 py-3 text-center">Crédito Variável</th> : null}
                          <th rowSpan={2} className="px-3 py-3 text-center">Feitas</th>
                        </tr>
                        <tr>
                          {activities.filter((a) => a.credito).map((a) => (
                            <th key={actKey(a)} className="min-w-[84px] bg-muted px-1.5 py-2 text-center align-bottom">
                              <span className="block text-[11px] leading-tight text-muted-foreground">{a.name}</span>
                              <span className="mt-1 inline-block rounded bg-muted/70 px-1.5 py-0.5 text-[9px] font-black text-muted-foreground">{a.max > 0 ? `0–${a.max}` : 'nota livre'}</span>
                              {a.date ? <span className="mt-0.5 block text-[9px] font-semibold text-muted-foreground">até {fmtDM(a.date)}</span> : null}
                            </th>
                          ))}
                        </tr>
                      </>
                    ) : (
                      <tr>
                        <th className="sticky left-0 top-0 z-30 w-[160px] min-w-[160px] max-w-[160px] bg-muted px-3 py-3 text-left shadow-[2px_0_0_0_rgba(226,232,240,1)]">Aluno</th>
                        {activities.map((a) => (
                          <th key={actKey(a)} className={cn('min-w-[84px] px-1.5 py-2 text-center align-bottom', a.credito && 'bg-muted')}>
                            <span className="block text-[11px] leading-tight text-muted-foreground">{a.name}</span>
                            <span className="mt-1 inline-block rounded bg-muted/70 px-1.5 py-0.5 text-[9px] font-black text-muted-foreground">{a.max > 0 ? `0–${a.max}` : 'nota livre'}</span>
                            {a.date ? <span className="mt-0.5 block text-[9px] font-semibold text-muted-foreground">até {fmtDM(a.date)}</span> : null}
                          </th>
                        ))}
                        {hasCredito ? <th className="min-w-[96px] px-3 py-3 text-center">Crédito Variável</th> : null}
                        <th className="px-3 py-3 text-center">Feitas</th>
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {list.map((s, i) => {
                      const doneCount = activities.filter((a) => cells[s.id]?.[actKey(a)]?.done).length;
                      const creditoTotal = activities
                        .filter((a) => a.credito)
                        .reduce((acc, a) => acc + (Number(cells[s.id]?.[actKey(a)]?.score) || 0), 0);
                      return (
                        <tr key={s.id} className="border-t border-border bg-card transition even:bg-neutral-50 hover:bg-neutral-100">
                          <td className="sticky left-0 z-10 w-[160px] min-w-[160px] max-w-[160px] bg-inherit px-3 py-2.5 align-middle shadow-[2px_0_0_0_rgba(241,245,249,1)]">
                            <div className="flex items-center gap-2.5">
                              <span className="w-6 shrink-0 text-right text-xs font-bold tabular-nums text-muted-foreground">{i + 1}</span>
                              <span className="min-w-0 break-words text-[13px] font-bold leading-snug text-foreground">{s.full_name}</span>
                            </div>
                          </td>
                          {activities.map((a) => {
                            const k = actKey(a);
                            const c = cells[s.id]?.[k] ?? { done: false, score: '' };
                            const hasScore = c.score !== '';
                            // Modo leitura: nada de caixas vazias — só o que importa (nota / ✓ / vazio discreto).
                            if (!editing) {
                              return (
                                <td key={k} className="px-1.5 py-2 text-center">
                                  {hasScore || c.done ? (
                                    <span
                                      className={cn(
                                        'inline-flex min-w-[2rem] items-center justify-center rounded-lg px-2 py-1 text-[13px] font-bold tabular-nums ring-1 ring-inset',
                                        TONE[hasScore && a.max > 0 ? gradeTone(Number(c.score), a.max) : 'ok'].soft,
                                      )}
                                    >
                                      {hasScore ? c.score : <Check size={14} />}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">·</span>
                                  )}
                                </td>
                              );
                            }
                            return (
                              <td key={k} className="px-1 py-1.5 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    onClick={() => toggleDone(s.id, k)}
                                    title={c.done ? 'Fez' : 'Não fez'}
                                    className={cn(
                                      'grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition',
                                      c.done
                                        ? 'border-green-600 bg-green-600 text-white shadow-sm'
                                        : 'border-border bg-card text-neutral-300 hover:border-green-300 hover:bg-green-50 hover:text-green-500',
                                    )}
                                  >
                                    <Check size={16} />
                                  </button>
                                  {/* Híbrido: marca presença E aceita nota. Quando a atividade não tem valor
                                      definido na composição (max 0), a nota é livre (sem limite). */}
                                  <input
                                    inputMode="decimal"
                                    value={String(c.score).replace('.', ',')}
                                    onChange={(e) => setScore(s.id, k, e.target.value, a.max)}
                                    placeholder="nota"
                                    className="h-8 w-11 rounded-lg border border-border bg-card text-center font-semibold tabular-nums text-foreground outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-brand/40"
                                  />
                                </div>
                              </td>
                            );
                          })}
                          {hasCredito ? (
                            <td className="px-3 py-3 text-center">
                              <span className={cn('inline-block min-w-[44px] rounded-lg px-2 py-1 text-sm font-bold tabular-nums ring-1 ring-inset', TONE[gradeTone(creditoTotal)].soft)}>
                                {creditoTotal % 1 === 0 ? creditoTotal : creditoTotal.toFixed(1).replace('.', ',')}
                              </span>
                            </td>
                          ) : null}
                          <td className="px-3 py-3 text-center">
                            <span className={cn('inline-block min-w-[44px] rounded-lg px-2 py-1 text-sm font-bold tabular-nums ring-1 ring-inset', TONE[deliveryTone((doneCount / activities.length) * 100, activities.length)].soft)}>
                              {doneCount}/{activities.length}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>

              <p className="mt-3 text-xs text-muted-foreground">
                Controle de atividades — marque quem fez e a pontuação. Não calcula média (isso fica em Notas).
              </p>
            </>
          )}
        </>
      )}

      {students.length > 0 && activities.length > 0 ? (
        <ActionFooter
          title={saved ? 'Avaliações salvas e bloqueadas' : editing ? 'Edição aberta' : `${TERM_LABEL[term]} · ${year}`}
          detail={`${totals.done} entrega(s) registrada(s)`}
          error={save.isError ? (save.error as Error).message : null}
        >
          {editing ? (
            <>
              {hasSavedMarks ? (
                <FooterButton kind="secondary" onClick={resetCells} disabled={save.isPending}>Cancelar</FooterButton>
              ) : null}
              <FooterButton onClick={handleSave} disabled={save.isPending}>
                <Save size={18} /> {save.isPending ? 'Salvando…' : 'Salvar avaliações'}
              </FooterButton>
            </>
          ) : (
            <FooterButton onClick={() => { setEditing(true); setSaved(false); }}>
              <Pencil size={18} /> Editar
            </FooterButton>
          )}
        </ActionFooter>
      ) : null}

      <ComposicaoAvaliacoesModal
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        classId={classId}
        className={classes.find((c) => c.id === classId)?.name ?? 'Turma'}
        term={term}
        year={year}
        initial={activities}
        onSaved={() => qc.invalidateQueries({ queryKey: ['eval-config', activeOrgId, classId, year, term] })}
      />

      <ConfirmClearModal
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title="Limpar avaliações da turma"
        description={`Isso apaga as marcações/pontuações de ${turmaNome} no ${TERM_LABEL[term]} / ${year} e remove o crédito variável correspondente das notas. Ação irreversível.`}
        keyword="APAGAR"
        confirmLabel="Apagar avaliações"
        busy={clearEval.isPending}
        onConfirm={() => clearEval.mutate()}
      />
    </div>
  );
}

function ComposicaoAvaliacoesModal({
  open,
  onClose,
  classId,
  className,
  term,
  year,
  initial,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  classId: string;
  className: string;
  term: number;
  year: number;
  initial: GradeActivity[];
  onSaved: () => void;
}) {
  const [items, setItems] = useState<GradeActivity[]>([]);
  useEffect(() => {
    // Garante um id estável por atividade (liga ao boletim/Notas por id, não por nome).
    if (open)
      setItems(
        initial.length
          ? initial.map((a) => ({ ...a, id: a.id ?? crypto.randomUUID() }))
          : CREDITO_ACTIVITIES.map((a) => ({ ...a, id: crypto.randomUUID() })),
      );
  }, [open, initial]);

  const save = useMutation({
    mutationFn: () =>
      saveEvalConfig(classId, year, term, items.filter((a) => a.name.trim()).map((a) => ({ id: a.id ?? crypto.randomUUID(), name: a.name.trim(), max: Number(a.max) || 0, credito: !!a.credito, date: a.date }))),
    onSuccess: () => {
      onSaved();
      onClose();
      successToast('Composição de avaliações salva');
    },
  });

  const clone = useMutation({
    mutationFn: async (sourceTerm: number) => {
      const prev = await getEvalConfig(classId, year, sourceTerm);
      if (!prev.length) throw new Error(`${TERM_LABEL[sourceTerm]} ainda não tem composição de avaliações salva nesta turma. Monte e salve o ${TERM_LABEL[sourceTerm]} primeiro.`);
      return { sourceTerm, prev };
    },
    onSuccess: ({ sourceTerm, prev }) => {
      // Clona com novos ids (são colunas deste trimestre).
      setItems(prev.map((a) => ({ id: crypto.randomUUID(), name: a.name, max: a.max, credito: !!a.credito })));
      successToast(`Composição clonada do ${TERM_LABEL[sourceTerm]}`);
    },
    onError: (e) => alert((e as Error).message),
  });

  return (
    <Modal open={open} onClose={onClose} title={`Avaliações — ${className} • ${TERM_LABEL[term]}/${year}`}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Dê nome às atividades que a turma vai fazer. A pontuação (valor) é opcional — deixe 0 para apenas marcar quem fez.
          Marque <strong>Crédito variável</strong> nas atividades que, juntas, formam uma única nota (ex.: Simulado + Projeto + Crédito variável).
        </p>

        {term > 1 ? (
          <div className="rounded-xl border border-border bg-muted p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-black text-foreground">Reaproveitar composição</p>
                <p className="text-xs font-semibold text-muted-foreground">Clone as atividades de um trimestre anterior para não redigitar.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: term - 1 }, (_, i) => i + 1).map((src) => (
                  <Button key={src} variant="soft" onClick={() => clone.mutate(src)} disabled={clone.isPending}>
                    {clone.isPending ? 'Clonando…' : `Clonar ${TERM_LABEL[src]}`}
                  </Button>
                ))}
              </div>
            </div>
            {clone.isError ? <p className="mt-2 text-xs font-semibold text-red-600">{(clone.error as Error).message}</p> : null}
          </div>
        ) : null}
        <div className="space-y-3">
          {items.map((a, i) => (
            <div key={i} className="rounded-xl border border-border bg-muted p-2.5">
              <div className="flex items-center gap-2">
                <Input
                  value={a.name}
                  onChange={(e) => setItems((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  placeholder="Nome da atividade (ex.: Simulado)"
                  className="flex-1"
                />
                <Input
                  value={String(a.max)}
                  onChange={(e) => setItems((p) => p.map((x, j) => (j === i ? { ...x, max: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 } : x)))}
                  inputMode="decimal"
                  className="w-20 text-center"
                  placeholder="Valor"
                />
                <button
                  onClick={() => setItems((p) => p.filter((_, j) => j !== i))}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-red-50 text-red-600 hover:bg-red-100"
                  aria-label="Remover"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={!!a.credito}
                    onChange={(e) => setItems((p) => p.map((x, j) => (j === i ? { ...x, credito: e.target.checked } : x)))}
                    className="h-4 w-4 rounded border-border text-neutral-900 focus:ring-brand"
                  />
                  Compõe o crédito variável
                </label>
                <label className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
                  Prazo / entrega
                  <Input
                    type="date"
                    value={a.date ?? ''}
                    onChange={(e) => setItems((p) => p.map((x, j) => (j === i ? { ...x, date: e.target.value || undefined } : x)))}
                    className="h-9 w-auto py-1"
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
        <Button variant="ghost" onClick={() => setItems((p) => [...p, { id: crypto.randomUUID(), name: '', max: 0 }])}>
          <Plus size={18} /> Adicionar atividade
        </Button>
        {save.isError ? <p className="text-sm font-semibold text-red-600">{(save.error as Error).message}</p> : null}
        <div className="mt-1 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Salvando…' : 'Salvar composição'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
