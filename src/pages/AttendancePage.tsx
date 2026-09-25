import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Check, CheckCheck, ClipboardCheck, Layers, Pencil, Save, Search, Users, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { ActionFooter, EmptyState, FilterBar, FilterField, FooterButton, Loading, Notice, PageHeader, Segmented, StatGrid, StatTile, fieldCls } from '../components/ui';
import { freqTone } from '../lib/tone';
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

  const pct = students.length ? Math.round((counts.present / students.length) * 100) : 0;

  return (
    <div className="pb-28">
      <PageHeader title="Chamadas" subtitle="Toque no aluno para marcar falta." action={<ModeToggle mode={mode} setMode={setMode} />} />

      <FilterBar>
        <FilterField label="Turma" grow>
          <select value={classId} onChange={(e) => setClassId(e.target.value)} className={fieldCls}>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Data">
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={fieldCls} />
        </FilterField>
        <FilterField label="Buscar aluno" wide grow>
          <SearchField value={q} onChange={setQ} />
        </FilterField>
      </FilterBar>

      {existing?.session?.exam_mode ? (
        <Notice tone="warn" icon={<Layers size={15} />}>Chamada feita em modo prova (turmas misturadas na sala).</Notice>
      ) : null}
      {hasSavedAttendance && !editingAttendance ? (
        <Notice aside={lastMovement ? `Salva em ${format(new Date(lastMovement), 'dd/MM HH:mm')}` : undefined}>
          Chamada salva e bloqueada. Toque em <b>Editar</b> para alterar.
        </Notice>
      ) : null}

      <StatGrid cols={3}>
        <StatTile label="Presentes" value={counts.present} tone="ok" />
        <StatTile label="Faltas" value={counts.absent} tone={counts.absent ? 'bad' : 'none'} />
        <StatTile label="Presença" value={`${pct}%`} tone={students.length ? freqTone(pct) : 'none'} />
      </StatGrid>

      {isLoading ? (
        <Loading label="Carregando alunos…" />
      ) : existingIsError ? (
        <EmptyState icon={<ClipboardCheck size={26} />} title="Não foi possível carregar a chamada" hint={(existingError as Error).message} />
      ) : existingLoading ? (
        <Loading label="Carregando chamada salva…" />
      ) : students.length === 0 ? (
        <EmptyState icon={<ClipboardCheck size={26} />} title="Turma sem alunos" hint="Cadastre alunos nesta turma para fazer a chamada." />
      ) : (
        <>
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">{list.length} aluno(s)</p>
            {editingAttendance && counts.absent > 0 ? (
              <button onClick={allPresent} className="inline-flex items-center gap-1.5 text-sm font-semibold text-green-700 hover:underline">
                <CheckCheck size={16} /> Marcar todos presentes
              </button>
            ) : null}
          </div>
          <StudentRollList
            items={list.map((s) => ({ id: s.id, name: s.full_name }))}
            records={records}
            disabled={!editingAttendance}
            onToggle={toggle}
          />
        </>
      )}

      {students.length > 0 ? (
        <ActionFooter
          title={saved ? 'Chamada salva e bloqueada' : editingAttendance ? 'Edição aberta' : 'Chamada do dia'}
          detail={`${counts.absent} falta(s) · ${students.length} alunos · ${format(new Date(date + 'T00:00:00'), 'dd/MM/yyyy')}`}
          error={save.isError ? (save.error as Error).message : null}
        >
          {editingAttendance ? (
            <>
              {hasSavedAttendance ? (
                <FooterButton kind="secondary" onClick={resetRecordsFromSaved} disabled={save.isPending}>Cancelar</FooterButton>
              ) : null}
              <FooterButton onClick={handleSave} disabled={save.isPending}>
                <Save size={18} /> {save.isPending ? 'Salvando…' : 'Salvar chamada'}
              </FooterButton>
            </>
          ) : (
            <FooterButton
              onClick={() => {
                setEditingAttendance(true);
                setSaved(false);
              }}
            >
              <Pencil size={18} /> Editar chamada
            </FooterButton>
          )}
        </ActionFooter>
      ) : null}
    </div>
  );
}

/** Campo de busca compacto (mesma altura dos filtros). */
function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <span className="relative block">
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Nome do aluno" className={cn(fieldCls, 'pl-9')} />
    </span>
  );
}

/** Lista de chamada: verde = presente, vermelho = falta. Um toque alterna. */
function StudentRollList({
  items,
  records,
  disabled,
  onToggle,
}: {
  items: { id: string; name: string; sub?: string }[];
  records: Record<string, AttendanceStatus>;
  disabled?: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {items.map((s, i) => {
        const absent = records[s.id] === 'absent';
        return (
          <button
            key={s.id}
            onClick={() => onToggle(s.id)}
            disabled={disabled}
            className={cn(
              'flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left transition last:border-b-0 disabled:cursor-default sm:px-4',
              absent ? 'bg-red-50/70' : 'hover:bg-muted/60',
            )}
          >
            <span className="w-6 shrink-0 text-right text-xs font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className={cn('block break-words text-[15px] font-medium leading-snug', absent ? 'text-red-800' : 'text-foreground')}>{s.name}</span>
              {s.sub ? <span className="block text-xs text-muted-foreground">{s.sub}</span> : null}
            </span>
            <span
              className={cn(
                'inline-flex w-[6.5rem] shrink-0 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold ring-1 ring-inset',
                absent ? 'bg-red-600 text-white ring-red-600' : 'bg-green-50 text-green-700 ring-green-200',
              )}
            >
              {absent ? <X size={16} /> : <Check size={16} />}
              {absent ? 'Falta' : 'Presente'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ModeToggle({ mode, setMode }: { mode: 'turma' | 'prova'; setMode: (m: 'turma' | 'prova') => void }) {
  return (
    <Segmented<'turma' | 'prova'>
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
      <PageHeader title="Chamadas" subtitle="Modo prova: turmas misturadas na mesma sala." action={<ModeToggle mode={mode} setMode={setMode} />} />

      <div className="mb-4 rounded-xl border border-border bg-card p-3 shadow-soft sm:p-4">
        <div className="mb-3 grid grid-cols-2 gap-3 lg:flex lg:items-end">
          <FilterField label="Data">
            <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={fieldCls} />
          </FilterField>
          <FilterField label="Buscar aluno" grow>
            <SearchField value={q} onChange={setQ} />
          </FilterField>
        </div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Turmas nesta sala</p>
        {examClasses.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma turma faz provas. Marque "Esta turma faz provas" no cadastro da turma.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {examClasses.map((c) => {
              const on = selected.includes(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => toggleClass(c.id)}
                  aria-pressed={on}
                  className={cn(
                    'inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold ring-1 ring-inset transition',
                    on ? 'bg-neutral-900 text-white ring-neutral-900' : 'bg-card text-muted-foreground ring-border hover:text-foreground',
                  )}
                >
                  {on ? <Check size={14} /> : null}
                  {c.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selIds.length === 0 ? (
        <EmptyState icon={<Layers size={26} />} title="Selecione as turmas" hint="Marque as turmas que estão fazendo prova nesta sala para montar a lista única." />
      ) : (
        <>
          <StatGrid>
            <StatTile label="Alunos" value={students.length} />
            <StatTile label="Presentes" value={counts.present} tone="ok" />
            <StatTile label="Faltas" value={counts.absent} tone={counts.absent ? 'bad' : 'none'} />
            <StatTile label="Turmas" value={selIds.length} />
          </StatGrid>

          {isLoading ? (
            <Loading label="Carregando alunos…" />
          ) : students.length === 0 ? (
            <EmptyState icon={<ClipboardCheck size={26} />} title="Turmas sem alunos" hint="As turmas selecionadas não têm alunos cadastrados." />
          ) : (
            <StudentRollList
              items={list.map((s) => ({ id: s.id, name: s.full_name, sub: classNameById.get(s.class_id) ?? 'Turma' }))}
              records={records}
              onToggle={toggleStudent}
            />
          )}
        </>
      )}

      {students.length > 0 ? (
        <ActionFooter
          title={`Chamada de prova · ${selIds.length} turma(s)`}
          detail={`${counts.absent} falta(s) · ${students.length} alunos · ${format(new Date(date + 'T00:00:00'), 'dd/MM/yyyy')}`}
          error={save.isError ? (save.error as Error).message : null}
        >
          <FooterButton onClick={() => save.mutate()} disabled={save.isPending}>
            <Save size={18} /> {save.isPending ? 'Salvando…' : 'Salvar chamada'}
          </FooterButton>
        </ActionFooter>
      ) : null}
    </div>
  );
}
