import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookCheck, Download, FileSpreadsheet, MoreHorizontal, Pencil, Printer, ScanLine, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { DateInput } from '../components/DateInput';
import { ExamScanner } from '../components/ExamScanner';
import { successToast } from '../components/Feedback';
import { Button, DropdownMenu, EmptyState, Field, Input, Loading, Modal, PageHeader, SegmentedField, StatTile, StatusBadge, fieldCls } from '../components/ui';
import { cn } from '../lib/cn';
import { downloadXlsx } from '../lib/importSheet';
import { LETTERS } from '../lib/omr/layout';
import { keyComplete, scoreAnswers } from '../lib/omr/score';
import { printSheets, sheetSvg } from '../lib/omr/sheet';
import {
  deleteExam, deleteExamAnswer, examGradeTargets, getExam, listClasses, listSchools, saveExam, saveExamAnswer, sendExamToGrades, type ExamDetail,
} from '../lib/queries';
import { gradeTone, TONE, type Tone } from '../lib/tone';

type Tab = 'gabarito' | 'folhas' | 'resultados';
const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

export function ProvaDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['exam', id], queryFn: () => getExam(id) });
  const [tab, setTab] = useState<Tab | null>(null);
  const [scanning, setScanning] = useState(false);

  // Aba inicial conforme o andamento: gabarito → folhas → resultados.
  useEffect(() => {
    if (!data || tab) return;
    const ready = keyComplete(data.exam.answer_key, data.exam.questions);
    setTab(!ready ? 'gabarito' : data.answers.length ? 'resultados' : 'folhas');
  }, [data, tab]);

  const remove = useMutation({
    mutationFn: () => deleteExam(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exams'] });
      navigate('/provas');
    },
  });

  if (isLoading) return <Loading />;
  if (isError || !data) return <EmptyState icon={<BookCheck size={26} />} title="Prova não encontrada" hint={(error as Error)?.message} />;
  const { exam } = data;
  const ready = keyComplete(exam.answer_key, exam.questions);

  return (
    <>
      <PageHeader
        title={exam.title}
        subtitle={`${exam.class_name} · ${exam.questions} questões · vale ${fmt(exam.points)} · código ${exam.code}`}
        action={
          <div className="flex gap-2">
            <DropdownMenu
              label="Mais ações"
              iconOnly
              icon={<MoreHorizontal size={16} />}
              items={[
                {
                  label: 'Excluir prova',
                  hint: 'Apaga o gabarito e todas as correções.',
                  icon: <Trash2 size={15} />,
                  danger: true,
                  onClick: () => {
                    if (confirm(`Excluir "${exam.title}" e todas as correções? Não dá para desfazer.`)) remove.mutate();
                  },
                },
              ]}
            />
            <Button onClick={() => setScanning(true)} disabled={!ready} title={ready ? undefined : 'Complete o gabarito primeiro'}>
              <ScanLine size={16} /> Corrigir
            </Button>
          </div>
        }
      />

      <div className="mb-5 max-w-md">
        <SegmentedField<Tab>
          value={tab ?? 'gabarito'}
          onChange={setTab}
          options={[
            { value: 'gabarito', label: '1. Gabarito' },
            { value: 'folhas', label: '2. Folhas' },
            { value: 'resultados', label: `3. Resultados${data.answers.length ? ` (${data.answers.length})` : ''}` },
          ]}
        />
      </div>

      {tab === 'gabarito' ? <KeyTab data={data} onSaved={() => setTab('folhas')} /> : null}
      {tab === 'folhas' ? <SheetsTab data={data} /> : null}
      {tab === 'resultados' ? <ResultsTab data={data} onScan={() => setScanning(true)} /> : null}

      <ExamScanner open={scanning} onClose={() => setScanning(false)} initial={data} />
    </>
  );
}

/* --------------------------------- Gabarito --------------------------------- */
function KeyTab({ data, onSaved }: { data: ExamDetail; onSaved: () => void }) {
  const qc = useQueryClient();
  const { exam } = data;
  const locked = data.answers.length > 0;
  const { data: classes = [] } = useQuery({ queryKey: ['classes'], queryFn: listClasses });
  const initial = useMemo(
    () => ({
      title: exam.title,
      class_id: exam.class_id,
      exam_date: exam.exam_date ?? '',
      questions: String(exam.questions),
      choices: exam.choices,
      points: String(exam.points).replace('.', ','),
      key: Array.from({ length: exam.questions }, (_, i) => exam.answer_key[i] ?? ''),
    }),
    [exam],
  );
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial), [initial]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const n = Math.max(1, Math.min(60, Number(form.questions) || 1));
  const key = Array.from({ length: n }, (_, i) => form.key[i] ?? '');
  const letters = LETTERS.slice(0, form.choices);
  const filled = key.filter(Boolean).length;
  const [quick, setQuick] = useState('');

  const save = useMutation({
    mutationFn: () =>
      saveExam({
        id: exam.id,
        class_id: form.class_id,
        title: form.title.trim(),
        exam_date: form.exam_date || null,
        questions: n,
        choices: form.choices,
        points: Number(form.points.replace(',', '.')),
        answer_key: key,
      }),
    onSuccess: (d) => {
      qc.setQueryData(['exam', exam.id], d);
      qc.invalidateQueries({ queryKey: ['exams'] });
      successToast('Gabarito salvo');
      if (keyComplete(d.exam.answer_key, d.exam.questions)) onSaved();
    },
  });

  function setKey(q: number, v: string) {
    const next = [...key];
    next[q] = next[q] === v ? '' : v;
    setForm((f) => ({ ...f, key: next }));
  }
  function applyQuick(text: string) {
    setQuick(text);
    const seq = text.toUpperCase().replace(/[^A-EX]/g, '').split('');
    const next = [...key];
    seq.forEach((c, i) => {
      if (i < n && (c === 'X' || letters.includes(c as (typeof LETTERS)[number]))) next[i] = c;
    });
    setForm((f) => ({ ...f, key: next }));
  }

  return (
    <div className="space-y-5 pb-24">
      <section className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5">
        <h2 className="mb-4 text-sm font-bold text-foreground">Dados da prova</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Nome da prova">
            <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </Field>
          <Field label="Data de aplicação">
            <DateInput value={form.exam_date} onChange={(v) => setForm((f) => ({ ...f, exam_date: v }))} />
          </Field>
          <Field label="Valor da prova">
            <input value={form.points} onChange={(e) => setForm((f) => ({ ...f, points: e.target.value.replace(/[^\d,.]/g, '') }))} inputMode="decimal" className={fieldCls} />
          </Field>
          <Field label="Turma">
            <select value={form.class_id} onChange={(e) => setForm((f) => ({ ...f, class_id: e.target.value }))} className={fieldCls} disabled={locked}>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Questões">
            <input
              value={form.questions}
              onChange={(e) => setForm((f) => ({ ...f, questions: e.target.value.replace(/\D/g, '').slice(0, 2) }))}
              inputMode="numeric"
              className={fieldCls}
              disabled={locked}
            />
          </Field>
          <Field label="Alternativas">
            {locked ? (
              <input value={form.choices === 4 ? 'A a D' : 'A a E'} disabled className={fieldCls} />
            ) : (
              <SegmentedField
                value={form.choices}
                onChange={(v) => setForm((f) => ({ ...f, choices: Number(v) }))}
                options={[
                  { value: 4, label: 'A a D' },
                  { value: 5, label: 'A a E' },
                ]}
              />
            )}
          </Field>
        </div>
        {locked ? <p className="mt-3 text-xs text-muted-foreground">Turma, questões e alternativas ficam travadas depois da primeira correção (as folhas já impressas dependem disso).</p> : null}
      </section>

      <section className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-foreground">Gabarito</h2>
            <p className="text-xs text-muted-foreground">
              {filled} de {n} preenchidas · toque na resposta certa · "Anular" conta a questão como certa para todos.
            </p>
          </div>
          <label className="w-full sm:w-72">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Digitar em sequência</span>
            <input value={quick} onChange={(e) => applyQuick(e.target.value)} placeholder="Ex.: ABDCE ACBDA…" className={cn(fieldCls, 'font-mono uppercase tracking-widest')} autoCapitalize="characters" />
          </label>
        </div>
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
          {key.map((k, q) => (
            <div key={q} className="flex items-center gap-2 py-1">
              <span className={cn('w-7 text-right text-sm font-bold tabular-nums', k ? 'text-foreground' : 'text-orange-600')}>{String(q + 1).padStart(2, '0')}</span>
              <div className="flex gap-1">
                {letters.map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setKey(q, l)}
                    className={cn(
                      'grid h-9 w-9 place-items-center rounded-full text-sm font-bold ring-1 ring-inset transition sm:h-8 sm:w-8',
                      k === l ? 'bg-neutral-950 text-brand ring-neutral-950' : 'bg-card text-muted-foreground ring-border hover:bg-muted',
                    )}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setKey(q, 'X')}
                className={cn('ml-auto rounded-md px-2 py-1 text-[11px] font-semibold', k === 'X' ? 'bg-orange-100 text-orange-800' : 'text-muted-foreground hover:bg-muted')}
              >
                {k === 'X' ? 'Anulada' : 'Anular'}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Barra de salvar fixa */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 px-4 py-3 backdrop-blur lg:left-72">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <span className={cn('mr-auto text-xs', save.isError ? 'font-semibold text-red-600' : 'text-muted-foreground')}>
            {save.isError ? (save.error as Error).message : dirty ? 'Alterações não salvas' : filled < n ? `Faltam ${n - filled} questão(ões) no gabarito` : 'Gabarito completo'}
          </span>
          {dirty ? (
            <Button variant="ghost" onClick={() => setForm(initial)} disabled={save.isPending}>
              Descartar
            </Button>
          ) : null}
          <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
            {save.isPending ? 'Salvando…' : 'Salvar gabarito'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- Folhas ---------------------------------- */
function SheetsTab({ data }: { data: ExamDetail }) {
  const { exam, students } = data;
  const { activeBase } = useAuth();
  const { data: schools = [] } = useQuery({ queryKey: ['schools'], queryFn: listSchools });
  const school = schools[0];
  const [blanks, setBlanks] = useState(0);
  const [preview, setPreview] = useState('');
  const info = useMemo(
    () => ({
      school: school?.name ?? activeBase?.name ?? 'Escola',
      logo: school?.logo_url ?? null,
      title: exam.title,
      className: exam.class_name,
      date: exam.exam_date,
      examCode: exam.code,
      questions: exam.questions,
      choices: exam.choices,
    }),
    [school, activeBase, exam],
  );

  useEffect(() => {
    let alive = true;
    void sheetSvg(info, students[0] ? { id: students[0].id, name: students[0].name } : null).then((svg) => {
      if (alive) setPreview(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    });
    return () => {
      alive = false;
    };
  }, [info, students]);

  const ready = keyComplete(exam.answer_key, exam.questions);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5">
        <div>
          <h2 className="text-sm font-bold text-foreground">Folhas de resposta</h2>
          <p className="text-xs text-muted-foreground">Cada folha já sai com o nome do aluno e um QR code. Na correção, a câmera reconhece quem é o aluno sozinha.</p>
        </div>
        {!ready ? (
          <p className="rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-900 ring-1 ring-inset ring-orange-200">
            Dá para imprimir antes, mas complete o gabarito antes de corrigir.
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={() => printSheets(info, students)} disabled={!students.length} className="sm:flex-1">
            <Printer size={16} /> Imprimir folhas da turma ({students.length})
          </Button>
        </div>
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
          <label>
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Folhas avulsas (sem nome)</span>
            <input value={blanks || ''} onChange={(e) => setBlanks(Math.min(60, Number(e.target.value.replace(/\D/g, '')) || 0))} inputMode="numeric" placeholder="0" className={cn(fieldCls, 'w-28')} />
          </label>
          <Button variant="ghost" onClick={() => printSheets(info, [], blanks)} disabled={!blanks}>
            <Printer size={16} /> Imprimir avulsas
          </Button>
          <p className="w-full text-xs text-muted-foreground">Para aluno novo ou folha perdida. Na correção você escolhe o aluno.</p>
        </div>
        <ul className="space-y-1.5 border-t border-border pt-4 text-xs text-muted-foreground">
          <li>• Imprima em A4, escala 100%. Preto e branco serve.</li>
          <li>• Oriente os alunos a preencher todo o círculo com caneta azul ou preta.</li>
          <li>• Não dobre a folha nem escreva perto dos quadrados pretos dos cantos.</li>
          <li>• Na correção, apoie a folha numa mesa com boa luz e enquadre a folha inteira.</li>
        </ul>
      </section>
      <div className="rounded-xl border border-border bg-muted/40 p-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Prévia</p>
        {preview ? <img src={preview} alt="Prévia da folha de respostas" className="w-full rounded-md bg-white shadow-sm" /> : <Loading />}
      </div>
    </div>
  );
}

/* -------------------------------- Resultados -------------------------------- */
function ResultsTab({ data, onScan }: { data: ExamDetail; onScan: () => void }) {
  const qc = useQueryClient();
  const { exam, students, answers } = data;
  const [editing, setEditing] = useState<{ id: string; name: string; answers: string[] } | null>(null);
  const [sending, setSending] = useState(false);
  const byStudent = useMemo(() => new Map(answers.map((a) => [a.student_id, a])), [answers]);

  const rows = students.map((s) => {
    const a = byStudent.get(s.id);
    return { ...s, a, r: a ? scoreAnswers(exam.answer_key, a.answers, exam.questions, exam.points) : null };
  });
  const done = rows.filter((x) => x.r);
  const scores = done.map((x) => x.r!.score);
  const avg = scores.length ? scores.reduce((s, x) => s + x, 0) / scores.length : null;

  // Análise por questão: % de acerto e alternativa mais marcada.
  const items = Array.from({ length: exam.questions }, (_, q) => {
    const k = exam.answer_key[q];
    const marks = done.map((x) => x.a!.answers[q] ?? '');
    const right = marks.filter((m) => k === 'X' || (k && m === k)).length;
    const counts = new Map<string, number>();
    marks.forEach((m) => m && m !== '*' && counts.set(m, (counts.get(m) ?? 0) + 1));
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const pct = marks.length ? Math.round((right / marks.length) * 100) : 0;
    const suspicious = !!top && k !== 'X' && top[0] !== k && top[1] >= Math.max(3, marks.length * 0.5);
    return { q, k, pct, top: top?.[0] ?? null, suspicious };
  });

  const delAnswer = useMutation({
    mutationFn: (sid: string) => deleteExamAnswer(exam.id, sid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exam', exam.id] });
      qc.invalidateQueries({ queryKey: ['exams'] });
    },
  });

  function exportXlsx() {
    void downloadXlsx(
      `${exam.title} - ${exam.class_name}.xlsx`.replace(/[\\/:*?"<>|]/g, '-'),
      [
        ['Aluno', 'Situação', 'Acertos', `Nota (vale ${exam.points})`, ...Array.from({ length: exam.questions }, (_, i) => `Q${i + 1}`)],
        ...rows.map((x) => [
          x.name,
          x.r ? 'Corrigida' : 'Pendente',
          x.r ? x.r.correct : null,
          x.r ? x.r.score : null,
          ...Array.from({ length: exam.questions }, (_, i) => (x.a ? (x.a.answers[i] === '*' ? '2+' : x.a.answers[i] || '-') : '')),
        ]),
        [],
        ['Gabarito', '', '', '', ...exam.answer_key.map((k) => (k === 'X' ? 'anulada' : k))],
        ['% de acerto', '', '', '', ...items.map((i) => (done.length ? `${i.pct}%` : ''))],
      ],
      'Resultados',
    );
  }

  if (!answers.length) {
    return (
      <EmptyState
        icon={<ScanLine size={26} />}
        title="Nenhuma folha corrigida ainda"
        hint="Depois de aplicar a prova, toque em Corrigir e aponte a câmera para cada folha."
        action={
          <Button onClick={onScan}>
            <ScanLine size={16} /> Corrigir agora
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <StatTile label="Corrigidas" value={`${done.length}/${students.length}`} />
        <StatTile label="Média" value={avg != null ? fmt(Math.round(avg * 100) / 100) : '—'} tone={avg != null ? gradeTone(avg, exam.points) : 'none'} />
        <StatTile label="Maior nota" value={scores.length ? fmt(Math.max(...scores)) : '—'} />
        <StatTile label="Menor nota" value={scores.length ? fmt(Math.min(...scores)) : '—'} />
      </div>

      <div className="grid grid-cols-3 gap-2 sm:flex sm:justify-end">
        <Button variant="ghost" onClick={exportXlsx}>
          <FileSpreadsheet size={16} /> <span>Excel</span>
        </Button>
        <Button variant="ghost" onClick={() => setSending(true)}>
          <Download size={16} /> <span className="sm:hidden">Diário</span>
          <span className="hidden sm:inline">Lançar no diário</span>
        </Button>
        <Button onClick={onScan}>
          <ScanLine size={16} /> Corrigir
        </Button>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Alunos */}
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
          <ul className="divide-y divide-border">
            {rows.map((x) => (
              <li key={x.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">{x.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {x.r ? `${x.r.correct}/${x.r.total} acertos${x.a!.source === 'manual' ? ' · ajustada à mão' : ''}` : 'Pendente'}
                  </span>
                </span>
                {x.r ? (
                  <span className={cn('rounded-lg px-2.5 py-1 text-sm font-bold tabular-nums ring-1 ring-inset', TONE[gradeTone(x.r.score, exam.points)].soft)}>{fmt(x.r.score)}</span>
                ) : (
                  <StatusBadge tone="none">—</StatusBadge>
                )}
                <DropdownMenu
                  label="Ações"
                  variant="plain"
                  iconOnly
                  icon={<MoreHorizontal size={16} />}
                  items={[
                    {
                      label: x.r ? 'Ajustar respostas' : 'Lançar respostas à mão',
                      hint: x.r ? undefined : 'Para folha rasgada ou perdida.',
                      icon: <Pencil size={15} />,
                      onClick: () => setEditing({ id: x.id, name: x.name, answers: x.a?.answers ?? Array(exam.questions).fill('') }),
                    },
                    { label: 'Apagar correção', icon: <Trash2 size={15} />, danger: true, hidden: !x.r, onClick: () => confirm(`Apagar a correção de ${x.name}?`) && delAnswer.mutate(x.id) },
                  ]}
                />
              </li>
            ))}
          </ul>
        </section>

        {/* Por questão */}
        <section className="rounded-xl border border-border bg-card p-4 shadow-soft">
          <h2 className="text-sm font-bold text-foreground">Acerto por questão</h2>
          <p className="mb-3 text-xs text-muted-foreground">Questões com acerto baixo merecem revisão em sala.</p>
          <ul className="space-y-1.5">
            {items.map((it) => {
              const tone: Tone = it.k === 'X' ? 'none' : it.pct >= 60 ? 'ok' : it.pct >= 40 ? 'warn' : 'bad';
              return (
                <li key={it.q} className="text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-6 font-bold tabular-nums text-foreground">{String(it.q + 1).padStart(2, '0')}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className={cn('h-full rounded-full', TONE[tone].bar)} style={{ width: `${it.k === 'X' ? 100 : it.pct}%` }} />
                    </div>
                    <span className="w-10 text-right tabular-nums text-muted-foreground">{it.k === 'X' ? 'anul.' : `${it.pct}%`}</span>
                  </div>
                  {it.suspicious ? (
                    <p className="ml-8 mt-0.5 text-orange-700">
                      A maioria marcou {it.top} (gabarito: {it.k}). Confira o gabarito.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {editing ? (
        <AnswersModal
          exam={exam}
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ['exam', exam.id] });
            qc.invalidateQueries({ queryKey: ['exams'] });
          }}
        />
      ) : null}
      <SendToGradesModal open={sending} onClose={() => setSending(false)} data={data} count={done.length} />
    </div>
  );
}

function AnswersModal({
  exam,
  editing,
  onClose,
  onSaved,
}: {
  exam: ExamDetail['exam'];
  editing: { id: string; name: string; answers: string[] };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [ans, setAns] = useState<string[]>(Array.from({ length: exam.questions }, (_, i) => editing.answers[i] ?? ''));
  const r = scoreAnswers(exam.answer_key, ans, exam.questions, exam.points);
  const save = useMutation({ mutationFn: () => saveExamAnswer(exam.id, editing.id, ans, 'manual'), onSuccess: onSaved });
  const letters = LETTERS.slice(0, exam.choices);
  return (
    <Modal open onClose={onClose} title={`Respostas de ${editing.name}`} size="lg">
      <p className="mb-3 text-sm text-muted-foreground">
        Nota <b className="text-foreground">{fmt(r.score)}</b> · {r.correct}/{r.total} acertos. Toque na alternativa que o aluno marcou (toque de novo para deixar em branco).
      </p>
      <div className="grid max-h-[55vh] gap-x-6 gap-y-1 overflow-y-auto sm:grid-cols-2">
        {ans.map((a, q) => (
          <div key={q} className="flex items-center gap-2 py-0.5">
            <span className="w-7 text-right text-sm font-bold tabular-nums">{String(q + 1).padStart(2, '0')}</span>
            {letters.map((l) => {
              const key = exam.answer_key[q];
              return (
                <button
                  key={l}
                  onClick={() => setAns((p) => p.map((x, i) => (i === q ? (x === l ? '' : l) : x)))}
                  className={cn(
                    'grid h-8 w-8 place-items-center rounded-full text-xs font-bold ring-1 ring-inset',
                    a === l ? (key === 'X' || key === l ? 'bg-green-600 text-white ring-green-600' : 'bg-red-600 text-white ring-red-600') : key === l ? 'text-green-700 ring-green-300' : 'text-muted-foreground ring-border',
                  )}
                >
                  {l}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {save.isError ? <p className="mt-2 text-sm font-semibold text-red-600">{(save.error as Error).message}</p> : null}
      <div className="mt-4 flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? 'Salvando…' : 'Salvar respostas'}
        </Button>
      </div>
    </Modal>
  );
}

function SendToGradesModal({ open, onClose, data, count }: { open: boolean; onClose: () => void; data: ExamDetail; count: number }) {
  const year = new Date().getFullYear();
  const [term, setTerm] = useState(() => (new Date().getMonth() < 4 ? 1 : new Date().getMonth() < 8 ? 2 : 3));
  const [key, setKey] = useState('');
  const { data: targets = [], isLoading } = useQuery({
    queryKey: ['exam-targets', data.exam.id, year, term],
    queryFn: () => examGradeTargets(data.exam.id, year, term),
    enabled: open,
  });
  useEffect(() => {
    if (targets.length && !targets.some((t) => t.key === key)) setKey(targets[0].key);
  }, [targets, key]);
  const target = targets.find((t) => t.key === key);
  const send = useMutation({
    mutationFn: () => sendExamToGrades(data.exam.id, year, term, key),
    onSuccess: (r) => {
      onClose();
      successToast(`${r.sent} nota(s) lançada(s) em ${r.column}`);
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Lançar no diário">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Leva a nota de {count} aluno(s) corrigido(s) para uma coluna da tela de Notas ({year}). A nota é proporcional ao valor da coluna.
        </p>
        <Field label="Trimestre">
          <SegmentedField
            value={term}
            onChange={(v) => setTerm(Number(v))}
            options={[
              { value: 1, label: '1º' },
              { value: 2, label: '2º' },
              { value: 3, label: '3º' },
            ]}
          />
        </Field>
        <Field label="Coluna de notas">
          <select value={key} onChange={(e) => setKey(e.target.value)} className={fieldCls} disabled={isLoading || !targets.length}>
            {targets.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name} (vale {fmt(t.max)})
              </option>
            ))}
          </select>
        </Field>
        {target ? (
          <p className="text-xs text-muted-foreground">
            Exemplo: quem acertou metade recebe {fmt(Math.round(target.max * 50) / 100)} em {target.name}.
            {target.filled ? ` ${target.filled} aluno(s) já têm nota nessa coluna; a nota de quem fez a prova será substituída.` : ''}
          </p>
        ) : null}
        {send.isError ? <p className="text-sm font-semibold text-red-600">{(send.error as Error).message}</p> : null}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => send.mutate()} disabled={!key || send.isPending || !count}>
            {send.isPending ? 'Lançando…' : 'Lançar notas'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
