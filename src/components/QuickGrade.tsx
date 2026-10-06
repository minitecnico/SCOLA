import { Check, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '../lib/cn';
import { LETTERS } from '../lib/omr/layout';
import { saveOrQueue } from '../lib/omr/offline';
import { scoreAnswers } from '../lib/omr/score';
import type { AutoGrade, ExamDetail } from '../lib/queries';
import { gradeTone, TONE } from '../lib/tone';
import { Select } from './ui';
import { fmtScore } from '../lib/format';

/**
 * Correção rápida da prova da escola (sem folha SCOLA): o gabarito já vem marcado
 * e o professor toca só nas questões em que o aluno errou, na letra que ele marcou.
 */
export type QuickResult = { studentId: string; answers: string[]; name: string; correct: number; total: number; score: number; grade: AutoGrade; queued: boolean; replaced: boolean };


export function QuickGrade({
  detail,
  studentId: fixed,
  onSaved,
  onCancel,
  cancelLabel = 'Cancelar',
  className,
  stickyActions,
}: {
  detail: ExamDetail;
  /** Aluno já identificado (etiqueta). Sem ele, o professor escolhe na lista. */
  studentId?: string | null;
  onSaved: (r: QuickResult) => void;
  onCancel?: () => void;
  cancelLabel?: string;
  className?: string;
  /** Na página (rolagem do documento): barra de salvar fixa no rodapé da tela. */
  stickyActions?: boolean;
}) {
  const { exam, students } = detail;
  const key = useMemo(() => Array.from({ length: exam.questions }, (_, i) => exam.answer_key[i] ?? ''), [exam]);
  const done = useMemo(() => new Map(detail.answers.map((a) => [a.student_id, a.answers])), [detail.answers]);
  const firstPending = students.find((s) => !done.has(s.id))?.id ?? students[0]?.id ?? '';
  const [studentId, setStudentId] = useState<string>(fixed ?? firstPending);
  useEffect(() => setStudentId(fixed ?? firstPending), [fixed, firstPending]);

  // Resposta inicial: a correção anterior (se houver) ou o próprio gabarito (tudo certo).
  const initial = useMemo(() => {
    const prev = done.get(studentId);
    return key.map((k, i) => (prev ? prev[i] ?? '' : k === 'X' ? '' : k));
  }, [studentId, done, key]);
  const [ans, setAns] = useState<string[]>(initial);
  useEffect(() => setAns(initial), [initial]);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const r = scoreAnswers(exam.answer_key, ans, exam.questions, exam.points);
  const wrong = key.map((k, i) => k && k !== 'X' && ans[i] !== k).filter(Boolean).length;
  const student = students.find((s) => s.id === studentId);
  const letters = LETTERS.slice(0, exam.choices);

  function pick(q: number, v: string) {
    setAns((a) => a.map((x, i) => (i === q ? v : x)));
  }

  async function save() {
    if (!studentId) return;
    setSaving(true);
    setErr('');
    try {
      const res = await saveOrQueue(exam.id, studentId, ans, 'manual');
      onSaved({
        studentId,
        answers: ans,
        name: student?.name ?? 'Aluno',
        correct: r.correct,
        total: r.total,
        score: r.score,
        grade: res?.grade ?? null,
        queued: !res,
        replaced: done.has(studentId),
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={cn('flex min-h-0 flex-col bg-background text-foreground', className)}>
      {/* Aluno + nota */}
      <div className="border-b border-border bg-card px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-muted-foreground">
              {exam.title} · {exam.class_name}
            </p>
            {fixed ? (
              <p className="truncate text-lg font-bold">{student?.name ?? 'Aluno não encontrado nesta turma'}</p>
            ) : (
              <Select value={studentId} onChange={(e) => setStudentId(e.target.value)} className="mt-1 py-2 font-semibold" aria-label="Aluno">
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {done.has(s.id) ? ' ✓' : ''}
                  </option>
                ))}
              </Select>
            )}
            {done.has(studentId) ? <p className="mt-0.5 text-xs text-neutral-800">Já corrigida. Ao salvar, a correção anterior é substituída.</p> : null}
          </div>
          <div className="text-right">
            <p className={cn('text-3xl font-extrabold tabular-nums leading-none', TONE[gradeTone(r.score, exam.points)].text)}>
              {fmtScore(r.score)}
              <span className="ml-1 text-sm font-semibold text-muted-foreground">/ {fmtScore(exam.points)}</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {r.correct} de {r.total} certas{wrong ? ` · ${wrong} errada${wrong > 1 ? 's' : ''}` : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Questões */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              O gabarito já está marcado. <b className="text-foreground">Toque só onde o aluno errou</b>, na letra que ele marcou.
            </p>
            {wrong ? (
              <button onClick={() => setAns(key.map((k) => (k === 'X' ? '' : k)))} className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted">
                <RotateCcw size={13} /> Tudo certo
              </button>
            ) : null}
          </div>
          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {key.map((k, q) => {
              const a = ans[q];
              const isWrong = k && k !== 'X' && a !== k;
              return (
                <div key={q} className={cn('flex items-center gap-1.5 rounded-lg py-1 pl-1', isWrong && 'bg-red-50')}>
                  <span className={cn('w-7 text-right text-sm font-bold tabular-nums', isWrong ? 'text-red-700' : 'text-foreground')}>{String(q + 1).padStart(2, '0')}</span>
                  {k === 'X' ? (
                    <span className="ml-2 text-xs font-semibold text-muted-foreground">Anulada (conta para todos)</span>
                  ) : (
                    <>
                      {letters.map((l) => {
                        const on = a === l;
                        const isKey = k === l;
                        return (
                          <button
                            key={l}
                            onClick={() => pick(q, on && !isKey ? k : l)}
                            className={cn(
                              'grid h-10 w-10 place-items-center rounded-full text-sm font-bold ring-1 ring-inset transition sm:h-9 sm:w-9',
                              on && isKey && 'bg-green-600 text-white ring-green-600',
                              on && !isKey && 'bg-red-600 text-white ring-red-600',
                              !on && isKey && 'text-green-700 ring-green-400',
                              !on && !isKey && 'bg-card text-muted-foreground ring-border hover:bg-muted',
                            )}
                            aria-label={`Questão ${q + 1}: ${l}`}
                          >
                            {l}
                          </button>
                        );
                      })}
                      <button
                        onClick={() => pick(q, a === '' ? k : '')}
                        className={cn(
                          'h-10 rounded-full px-2 text-[11px] font-semibold ring-1 ring-inset sm:h-9',
                          a === '' ? 'bg-red-600 text-white ring-red-600' : 'text-muted-foreground ring-border hover:bg-muted',
                        )}
                        title="Em branco / anulou marcando duas"
                      >
                        Branco
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Ações */}
      <div className={cn('border-t border-border bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]', stickyActions && 'sticky bottom-0 z-20 rounded-b-xl')}>
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          {err ? <p className="mr-auto text-xs font-semibold text-red-600">{err}</p> : null}
          {onCancel ? (
            <button onClick={onCancel} className="h-11 flex-1 rounded-lg text-sm font-semibold ring-1 ring-inset ring-border hover:bg-muted sm:flex-none sm:px-4">
              {cancelLabel}
            </button>
          ) : null}
          <button
            onClick={save}
            disabled={!studentId || !student || saving}
            className="inline-flex h-11 flex-[2] items-center justify-center gap-2 rounded-lg bg-neutral-950 text-sm font-semibold text-white hover:bg-black disabled:opacity-40 sm:ml-auto sm:flex-none sm:px-5"
          >
            <Check size={16} /> {saving ? 'Salvando…' : 'Salvar nota'}
          </button>
        </div>
      </div>
    </div>
  );
}
