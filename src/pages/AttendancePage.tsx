import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Check, CheckCheck, ClipboardCheck, Layers, Lock, Pencil, Save, Users, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Card, EmptyState, PageHeader, SearchInput, Segmented, Select, Loading} from '../components/ui';
import { successToast } from '../components/Feedback';
import { cn } from '../lib/cn';
import { getRecords, getSession, listClasses, listStudentsByClass, saveAttendance } from '../lib/queries';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import { usePersistentState } from '../lib/usePersistentState';
import type { AttendanceStatus, ClassRoom } from '../lib/types';

export function AttendancePage() {
  const qc = useQueryClient();
  const { activeOrgId, ctxLoading } = useAuth();
  const today = format(new Date(), 'yyyy-MM-dd');
  const orgReady = !ctxLoading && !!activeOrgId;
  const { data: classes = [] } = useQuery({ queryKey: ['classes', activeOrgId], queryFn: listClasses, enabled: orgReady });

  const [mode, setMode] = usePersistentState<'turma' | 'prova'>('scola:attendance:mode', 'turma');
  const [classId, setClassId] = usePersistentState('scola:attendance:classId', '');
  // Sempre inicia no dia de HOJE (não persiste) — evita o professor lançar chamada em data antiga por engano.
  const [date, setDate] = useState(today);
  const [q, setQ] = useState('');
  const [records, setRecords] = useState<Record<string, AttendanceStatus>>({});
  const [saved, setSaved] = useState(false);
  const [editingAttendance, setEditingAttendance] = useState(false);
  const online = useOnlineStatus();

  useEffect(() => {
    if (!orgReady) return;
    if (!classes.length) return;
    if (!classId || !classes.some((c) => c.id === classId)) setClassId(classes[0].id);
  }, [classes, classId, orgReady]);

  const { data: students = [], isLoading } = useQuery({
    queryKey: ['students-by-class', activeOrgId, classId],
    queryFn: () => listStudentsByClass(classId),
    enabled: orgReady && !!classId,
  });

  // Carrega chamada existente (turma + data) para editar em vez de duplicar.
  const {
    data: existing,
    isLoading: existingLoading,
    isError: existingIsError,
    error: existingError,
  } = useQuery({
    queryKey: ['session', activeOrgId, classId, date],
    queryFn: async () => {
      const session = await getSession(classId, date);
      if (!session) return { session: null, records: [] as { student_id: string; status: AttendanceStatus }[] };
      const recs = await getRecords(session.id);
      return { session, records: recs.map((r) => ({ student_id: r.student_id, status: r.status })) };
    },
    enabled: orgReady && !!classId,
  });

  const studentsSig = students.map((s) => s.id).join(',');
  const existingSig = `${existing?.session?.updated_at ?? ''}|${(existing?.records ?? []).map((r) => `${r.student_id}:${r.status}`).join(',')}`;
  const hasSavedAttendance = !!existing?.session;
  const lastMovement = existing?.session?.updated_at;

  function resetRecordsFromSaved() {
    if (!students.length) {
      setRecords({});
      setEditingAttendance(false);
      return;
    }
    const base: Record<string, AttendanceStatus> = {};
    students.forEach((s) => (base[s.id] = 'present'));
    existing?.records.forEach((r) => {
      // qualquer status que não seja presente conta como falta
      if (base[r.student_id] !== undefined) base[r.student_id] = r.status === 'present' ? 'present' : 'absent';
    });
    setRecords(base);
    setSaved(false);
    setEditingAttendance(!existing?.session);
  }

  // Inicializa: todos presentes, sobrescrevendo com a chamada salva.
  useEffect(() => {
    if (!orgReady || isLoading || existingLoading) return;
    resetRecordsFromSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgReady, isLoading, existingLoading, studentsSig, existingSig]);

  const counts = useMemo(() => {
    let present = 0;
    let absent = 0;
    Object.values(records).forEach((s) => (s === 'present' ? present++ : absent++));
    return { present, absent };
  }, [records]);

  const list = useMemo(() => students.filter((s) => s.full_name.toLowerCase().includes(q.toLowerCase())), [students, q]);

  const save = useMutation({
    mutationFn: () =>
      saveAttendance(
        classId,
        date,
        students.map((s) => ({ student_id: s.id, status: records[s.id] ?? 'present', note: null })),
      ),
    onSuccess: () => {
      setSaved(true);
      setEditingAttendance(false);
      qc.invalidateQueries({ queryKey: ['session', activeOrgId, classId, date] });
      qc.invalidateQueries({ queryKey: ['recent-sessions'] });
      successToast('Chamada salva com sucesso');
    },
  });

  function handleSave() {
    if (!online) {
      alert('Sem conexão com a internet. Conecte-se para salvar a chamada — assim nada se perde.');
      return;
    }
    save.mutate();
  }

  function toggle(id: string) {
    if (!editingAttendance) return;
    setRecords((prev) => ({ ...prev, [id]: prev[id] === 'absent' ? 'present' : 'absent' }));
    setSaved(false);
  }
  function allPresent() {
    if (!editingAttendance) return;
    const next: Record<string, AttendanceStatus> = {};
    students.forEach((s) => (next[s.id] = 'present'));
    setRecords(next);
    setSaved(false);
  }

  if (!orgReady) {
    return (
      <>
        <PageHeader title="Chamadas" subtitle="Carregando…" />
        <Loading label="Preparando os dados da escola…" />
      </>
    );
  }

  if (classes.length === 0) {
    return (
      <>
        <PageHeader title="Chamadas" subtitle="Registre presenças e faltas." />
        <EmptyState icon={<ClipboardCheck size={26} />} title="Nenhuma turma" hint="Cadastre escola, turma e alunos para iniciar as chamadas." />
      </>
    );
  }

  if (mode === 'prova') return <ExamRoll classes={classes} today={today} mode={mode} setMode={setMode} />;

  return (
    <div className="pb-28">
      <PageHeader title="Chamadas" subtitle="Toque no aluno para marcar falta. As faltas ficam salvas por dia." />

      <ModeToggle mode={mode} setMode={setMode} />

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <input
          type="date"
          value={date}
          max={today}
          onChange={(e) => setDate(e.target.value)}
          className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
        />
      </div>

      {existing?.session?.exam_mode ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-black text-amber-800">
          <Layers size={16} /> Chamada feita em MODO PROVA — turmas misturadas nesta sala.
        </div>
      ) : null}

      {hasSavedAttendance && !editingAttendance ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted px-4 py-3 text-sm font-semibold text-muted-foreground">
          <Lock size={16} className="text-muted-foreground" />
          Chamada bloqueada para evitar alterações acidentais. Clique em Editar chamada para reabrir.
          {lastMovement ? <span className="ml-auto text-xs font-bold text-muted-foreground">Últ. mov. {format(new Date(lastMovement), 'dd/MM')}</span> : null}
        </div>
      ) : null}
      <div className="mb-4 grid grid-cols-3 gap-2 sm:gap-3">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-center">
          <p className="text-2xl font-black text-emerald-700">{counts.present}</p>
          <p className="text-[11px] font-black uppercase tracking-wide text-emerald-700/70">Presentes</p>
        </div>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-center">
          <p className="text-2xl font-black text-red-600">{counts.absent}</p>
          <p className="text-[11px] font-black uppercase tracking-wide text-red-600/70">Faltas</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-3 text-center">
          <p className={cn('text-2xl font-black', students.length && counts.present / students.length < 0.75 ? 'text-amber-600' : 'text-foreground')}>
            {students.length ? Math.round((counts.present / students.length) * 100) : 0}%
          </p>
          <p className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">Presença</p>
        </div>
      </div>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar aluno…" className="flex-1" />
        <button
          onClick={allPresent}
          disabled={!editingAttendance}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-50 px-4 text-sm font-bold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
        >
          <CheckCheck size={18} /> Todos presentes
        </button>
      </div>

      {isLoading ? (
        <Loading label="Carregando alunos…" />
      ) : existingIsError ? (
        <EmptyState icon={<ClipboardCheck size={26} />} title="Não foi possível carregar a chamada" hint={(existingError as Error).message} />
      ) : existingLoading ? (
        <Loading label="Carregando chamada salva…" />
      ) : students.length === 0 ? (
        <EmptyState icon={<ClipboardCheck size={26} />} title="Turma sem alunos" hint="Cadastre alunos nesta turma para fazer a chamada." />
      ) : (
        <div className="space-y-2">
          {list.map((s, i) => {
            const absent = records[s.id] === 'absent';
            return (
              <button
                key={s.id}
                onClick={() => toggle(s.id)}
                disabled={!editingAttendance}
                className={cn(
                  'flex w-full items-center gap-3 rounded-2xl border p-3 text-left shadow-sm transition active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-80 disabled:active:scale-100',
                  absent ? 'border-red-200 bg-red-50' : 'border-border bg-card hover:border-emerald-200',
                )}
              >
                <span
                  className={cn(
                    'grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-black tabular-nums',
                    absent ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-700',
                  )}
                >
                  {i + 1}
                </span>
                <span className={cn('min-w-0 flex-1 break-words text-base font-bold leading-snug', absent ? 'text-red-800' : 'text-foreground')}>
                  {s.full_name}
                </span>
                <span
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-black',
                    absent ? 'bg-red-600 text-white' : 'bg-emerald-50 text-emerald-700',
                  )}
                >
                  {absent ? <X size={18} /> : <Check size={18} />}
                  {absent ? 'Falta' : 'Presente'}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {students.length > 0 ? (
        <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 p-3 backdrop-blur lg:pl-72">
          <div className="mx-auto flex max-w-5xl items-center gap-2 px-1 sm:gap-3">
            <div className="hidden min-w-0 flex-1 sm:block">
              <p className="truncate text-sm font-bold text-foreground">
                {saved ? '✓ Chamada salva e bloqueada' : editingAttendance ? 'Edição aberta' : 'Chamada do dia'}
              </p>
              <p className="truncate text-xs text-muted-foreground">{counts.absent} falta(s) • {students.length} alunos</p>
            </div>
            {editingAttendance ? (
              <>
                {hasSavedAttendance ? (
                  <button
                    onClick={resetRecordsFromSaved}
                    disabled={save.isPending}
                    className="inline-flex min-h-12 items-center justify-center rounded-xl border border-border px-4 text-sm font-black text-muted-foreground transition hover:bg-muted disabled:opacity-60"
                  >
                    Cancelar
                  </button>
                ) : null}
                <button
                  onClick={handleSave}
                  disabled={save.isPending}
                  className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-base font-black text-white transition hover:bg-emerald-700 disabled:opacity-60 sm:flex-none sm:px-8"
                >
                  <Save size={20} />
                  <span className="sm:hidden">{save.isPending ? 'Salvando…' : 'Salvar'}</span>
                  <span className="hidden sm:inline">{save.isPending ? 'Salvando…' : 'Salvar e bloquear'}</span>
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  setEditingAttendance(true);
                  setSaved(false);
                }}
                className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-base font-black text-white transition hover:bg-slate-800 sm:flex-none sm:px-8"
              >
                <Pencil size={20} />
                Editar chamada
              </button>
            )}
          </div>
          {save.isError ? <p className="mx-auto mt-2 max-w-5xl px-1 text-sm font-semibold text-red-600">{(save.error as Error).message}</p> : null}
        </footer>
      ) : null}
    </div>
  );
}

function ModeToggle({ mode, setMode }: { mode: 'turma' | 'prova'; setMode: (m: 'turma' | 'prova') => void }) {
  return (
    <Segmented<'turma' | 'prova'>
      className="mb-4"
      value={mode}
      onChange={setMode}
      options={[
        { value: 'turma', label: <><Users size={16} /> Por turma</> },
        { value: 'prova', label: <><Layers size={16} /> Modo prova</> },
      ]}
    />
  );
}

/**
 * Modo prova: em dias de avaliação as turmas se misturam nas salas. Aqui a
 * coordenação escolhe VÁRIAS turmas, vê todos os alunos numa lista única
 * (com a etiqueta da turma) e faz a chamada de uma vez. Ao salvar, cada falta
 * é gravada na chamada da turma correta, na data escolhida.
 */
function ExamRoll({
  classes,
  today,
  mode,
  setMode,
}: {
  classes: ClassRoom[];
  today: string;
  mode: 'turma' | 'prova';
  setMode: (m: 'turma' | 'prova') => void;
}) {
  const qc = useQueryClient();
  const { activeOrgId } = useAuth();
  const [selected, setSelected] = usePersistentState<string[]>('scola:attendance:exam:classes', []);
  const [date, setDate] = useState(today); // Modo prova: também sempre começa em hoje.
  const [q, setQ] = useState('');
  const [records, setRecords] = useState<Record<string, AttendanceStatus>>({});

  // Só turmas que fazem prova entram no Modo prova.
  const examClasses = useMemo(() => classes.filter((c) => c.does_exams !== false), [classes]);
  const selIds = useMemo(() => [...selected].filter((id) => examClasses.some((c) => c.id === id)).sort(), [selected, examClasses]);
  const classNameById = useMemo(() => new Map(classes.map((c) => [c.id, c.name] as const)), [classes]);

  const { data: students = [], isLoading } = useQuery({
    queryKey: ['exam-students', activeOrgId, selIds.join(','), date],
    queryFn: async () => {
      const groups = await Promise.all(selIds.map((id) => listStudentsByClass(id)));
      return groups
        .flat()
        .sort((a, b) => a.full_name.localeCompare(b.full_name, 'pt-BR'));
    },
    enabled: !!activeOrgId && selIds.length > 0,
  });

  // Todos presentes ao carregar a lista.
  const studentsSig = students.map((s) => s.id).join(',');
  useEffect(() => {
    const base: Record<string, AttendanceStatus> = {};
    students.forEach((s) => (base[s.id] = 'present'));
    setRecords(base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentsSig]);

  const counts = useMemo(() => {
    let present = 0;
    let absent = 0;
    Object.values(records).forEach((s) => (s === 'present' ? present++ : absent++));
    return { present, absent };
  }, [records]);

  const list = useMemo(() => students.filter((s) => s.full_name.toLowerCase().includes(q.toLowerCase())), [students, q]);

  const save = useMutation({
    mutationFn: async () => {
      const byClass = new Map<string, { student_id: string; status: AttendanceStatus; note: null }[]>();
      students.forEach((s) => {
        const arr = byClass.get(s.class_id) ?? [];
        arr.push({ student_id: s.id, status: records[s.id] ?? 'present', note: null });
        byClass.set(s.class_id, arr);
      });
      for (const [cid, rows] of byClass) await saveAttendance(cid, date, rows, { examMode: true });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['session'] });
      qc.invalidateQueries({ queryKey: ['recent-sessions'] });
      successToast('Chamada da prova salva — faltas gravadas em cada turma');
    },
  });

  function toggleClass(id: string) {
    setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }
  function toggleStudent(id: string) {
    setRecords((prev) => ({ ...prev, [id]: prev[id] === 'absent' ? 'present' : 'absent' }));
  }

  return (
    <div className="pb-28">
      <PageHeader title="Chamadas" subtitle="Modo prova: turmas misturadas na mesma sala, chamada única." />

      <ModeToggle mode={mode} setMode={setMode} />

      <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-black text-amber-800">
        <Layers size={16} /> MODO PROVA ativo — a chamada será marcada como turmas misturadas.
      </div>

      {/* Seleção de turmas que estão na sala */}
      <Card className="mb-4">
        <p className="mb-2 text-xs font-black uppercase tracking-wide text-muted-foreground">Turmas nesta sala</p>
        {examClasses.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma turma faz provas. Marque "Esta turma faz provas" no cadastro da turma.</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {examClasses.map((c) => {
            const on = selected.includes(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggleClass(c.id)}
                className={cn(
                  'rounded-xl border px-3 py-2 text-sm font-bold transition',
                  on ? 'border-emerald-300 bg-emerald-600 text-white' : 'border-border bg-card text-muted-foreground hover:bg-muted',
                )}
              >
                {c.name}
              </button>
            );
          })}
        </div>
        <div className="mt-3">
          <label className="mb-1 block text-xs font-black uppercase tracking-wide text-muted-foreground">Data</label>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 sm:w-56"
          />
        </div>
      </Card>

      {selIds.length === 0 ? (
        <EmptyState icon={<Layers size={26} />} title="Selecione as turmas" hint="Marque as turmas que estão fazendo prova nesta sala para montar a lista única." />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-2xl border border-border bg-card p-3 text-center">
              <p className="text-2xl font-black text-foreground">{students.length}</p>
              <p className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">Alunos</p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-center">
              <p className="text-2xl font-black text-emerald-700">{counts.present}</p>
              <p className="text-[11px] font-black uppercase tracking-wide text-emerald-700/70">Presentes</p>
            </div>
            <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-center">
              <p className="text-2xl font-black text-red-600">{counts.absent}</p>
              <p className="text-[11px] font-black uppercase tracking-wide text-red-600/70">Faltas</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-3 text-center">
              <p className="text-2xl font-black text-foreground">{selIds.length}</p>
              <p className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">Turmas</p>
            </div>
          </div>

          <SearchInput value={q} onChange={setQ} placeholder="Buscar aluno…" className="mb-3" />

          {isLoading ? (
            <Loading label="Carregando alunos…" />
          ) : students.length === 0 ? (
            <EmptyState icon={<ClipboardCheck size={26} />} title="Turmas sem alunos" hint="As turmas selecionadas não têm alunos cadastrados." />
          ) : (
            <div className="space-y-2">
              {list.map((s, i) => {
                const absent = records[s.id] === 'absent';
                return (
                  <button
                    key={s.id}
                    onClick={() => toggleStudent(s.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-2xl border p-3 text-left shadow-sm transition active:scale-[.99]',
                      absent ? 'border-red-200 bg-red-50' : 'border-border bg-card hover:border-emerald-200',
                    )}
                  >
                    <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-black tabular-nums', absent ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-700')}>
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block break-words text-base font-bold leading-snug', absent ? 'text-red-800' : 'text-foreground')}>{s.full_name}</span>
                      <span className="text-xs font-bold text-muted-foreground">{classNameById.get(s.class_id) ?? 'Turma'}</span>
                    </span>
                    <span className={cn('flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-black', absent ? 'bg-red-600 text-white' : 'bg-emerald-50 text-emerald-700')}>
                      {absent ? <X size={18} /> : <Check size={18} />}
                      {absent ? 'Falta' : 'Presente'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {students.length > 0 ? (
        <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 p-3 backdrop-blur lg:pl-72">
          <div className="mx-auto flex max-w-5xl items-center gap-2 px-1 sm:gap-3">
            <div className="hidden min-w-0 flex-1 sm:block">
              <p className="truncate text-sm font-bold text-foreground">Chamada de prova • {selIds.length} turma(s)</p>
              <p className="truncate text-xs text-muted-foreground">{counts.absent} falta(s) • {students.length} alunos • {format(new Date(date + 'T00:00:00'), 'dd/MM')}</p>
            </div>
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-base font-black text-white transition hover:bg-emerald-700 disabled:opacity-60 sm:flex-none sm:px-8"
            >
              <Save size={20} /> {save.isPending ? 'Salvando…' : 'Salvar chamada'}
            </button>
          </div>
          {save.isError ? <p className="mx-auto mt-2 max-w-5xl px-1 text-sm font-semibold text-red-600">{(save.error as Error).message}</p> : null}
        </footer>
      ) : null}
    </div>
  );
}
