import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, FileText, Plus, Printer, ScanLine } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { DateInput } from '../components/DateInput';
import { ExamScanner } from '../components/ExamScanner';
import { Button, EmptyState, Field, Input, Loading, Modal, PageHeader, SegmentedField, StatusBadge, fieldCls } from '../components/ui';
import { cn } from '../lib/cn';
import { MAX_QUESTIONS } from '../lib/omr/layout';
import { keyComplete } from '../lib/omr/score';
import { listClasses, listExams, saveExam } from '../lib/queries';
import { gradeTone, TONE } from '../lib/tone';

const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const br = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function ProvasPage() {
  const navigate = useNavigate();
  const { data: exams = [], isLoading } = useQuery({ queryKey: ['exams'], queryFn: listExams });
  const [creating, setCreating] = useState(false);
  const [scanning, setScanning] = useState(false);
  // Atalho do app instalado ("Corrigir provas"): abre a câmera direto.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get('corrigir') === '1' && exams.length) {
      setScanning(true);
      setParams({}, { replace: true });
    }
  }, [params, exams.length, setParams]);
  // QR do professor lido pela câmera do celular: /corrigir#K1:… abre a correção com o gabarito.
  const location = useLocation();
  const [keyText, setKeyText] = useState<string | null>(null);
  useEffect(() => {
    if (location.pathname === '/corrigir') {
      // A troca de rota remonta a página: o gabarito segue junto no state.
      navigate('/provas', { replace: true, state: { corrigir: location.hash.includes('K1:') ? location.hash.slice(1) : '' } });
      return;
    }
    const st = location.state as { corrigir?: string } | null;
    if (st && typeof st.corrigir === 'string') {
      setKeyText(st.corrigir || null);
      setScanning(true);
      window.history.replaceState({ ...window.history.state, usr: null }, ''); // não reabre ao voltar
    }
  }, [location.pathname, location.hash, location.state, navigate]);

  return (
    <>
      <PageHeader
        title="Provas e correção"
        subtitle="Crie o gabarito, imprima as folhas de resposta e corrija com a câmera do celular."
        action={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setCreating(true)}>
              <Plus size={16} /> Nova prova
            </Button>
            <Button onClick={() => setScanning(true)} disabled={!exams.length}>
              <ScanLine size={16} /> Corrigir
            </Button>
          </div>
        }
      />

      {/* Como funciona: aparece enquanto há poucas provas */}
      <ol className={cn('mb-6 grid gap-2 sm:grid-cols-3', exams.length >= 2 && 'hidden')}>
        {[
          { icon: <FileText size={16} />, t: 'Crie a prova e o gabarito', d: 'Gera 2 QR codes: o seu (com as respostas) e o da folha de cada aluno.' },
          { icon: <Printer size={16} />, t: 'Imprima as folhas', d: 'Uma por aluno, já com o nome e um QR code que identifica a prova.' },
          { icon: <ScanLine size={16} />, t: 'Corrija em massa', d: 'Leia o seu QR e passe as folhas: as notas saem na hora e vão para o diário.' },
        ].map((s, i) => (
          <li key={s.t} className="flex gap-3 rounded-xl border border-border bg-card p-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-neutral-950 text-sm font-bold text-brand">{i + 1}</span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-foreground">{s.t}</span>
              <span className="block text-xs text-muted-foreground">{s.d}</span>
            </span>
          </li>
        ))}
      </ol>

      {isLoading ? (
        <Loading />
      ) : !exams.length ? (
        <EmptyState
          icon={<ClipboardCheck size={26} />}
          title="Nenhuma prova ainda"
          hint="Crie a primeira prova para gerar o gabarito e as folhas de resposta."
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus size={16} /> Nova prova
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {exams.map((e) => {
            const pct = e.students ? Math.round((e.corrected / e.students) * 100) : 0;
            const ready = keyComplete(e.answer_key, e.questions);
            return (
              <Link key={e.id} to={`/provas/${e.id}`} className="group flex flex-col rounded-xl border border-border bg-card p-4 shadow-soft transition hover:border-neutral-300">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-foreground">{e.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {e.class_name}
                      {e.exam_date ? ` · ${br(e.exam_date)}` : ''} · {e.questions} questões
                    </p>
                  </div>
                  {!ready ? <StatusBadge tone="warn">Gabarito incompleto</StatusBadge> : null}
                </div>
                <div className="mt-4 flex items-end justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">
                      <b className="text-foreground">{e.corrected}</b> de {e.students} corrigidas
                    </p>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-neutral-900" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Média</p>
                    <p className={cn('text-xl font-extrabold tabular-nums leading-none', e.average != null ? TONE[gradeTone(e.average, e.points)].text : 'text-muted-foreground')}>
                      {e.average != null ? fmt(e.average) : '—'}
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <NewExamModal open={creating} onClose={() => setCreating(false)} onCreated={(id) => navigate(`/provas/${id}`)} />
      <ExamScanner open={scanning} onClose={() => { setScanning(false); setKeyText(null); }} keyText={keyText} />
    </>
  );
}

/** Criação rápida: o gabarito é preenchido na tela seguinte. */
export function NewExamModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const { data: classes = [] } = useQuery({ queryKey: ['classes'], queryFn: listClasses, enabled: open });
  const [form, setForm] = useState({ title: '', class_id: '', exam_date: localToday(), questions: '10', choices: 5, points: '10' });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const classId = form.class_id || classes[0]?.id || '';

  const create = useMutation({
    mutationFn: () =>
      saveExam({
        class_id: classId,
        title: form.title.trim(),
        exam_date: form.exam_date || null,
        questions: Number(form.questions),
        choices: form.choices,
        points: Number(String(form.points).replace(',', '.')),
      }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['exams'] });
      onClose();
      onCreated(d.exam.id);
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Nova prova">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label="Nome da prova">
          <Input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Ex.: Avaliação bimestral de Matemática" autoFocus required />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Turma">
            <select value={classId} onChange={(e) => set('class_id', e.target.value)} className={fieldCls} required>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Data de aplicação">
            <DateInput value={form.exam_date} onChange={(v) => set('exam_date', v)} />
          </Field>
          <Field label={`Questões (até ${MAX_QUESTIONS})`}>
            <input
              value={form.questions}
              onChange={(e) => set('questions', e.target.value.replace(/\D/g, '').slice(0, 2))}
              inputMode="numeric"
              className={fieldCls}
              required
            />
          </Field>
          <Field label="Valor da prova">
            <input value={form.points} onChange={(e) => set('points', e.target.value.replace(/[^\d,.]/g, ''))} inputMode="decimal" className={fieldCls} required />
          </Field>
        </div>
        <Field label="Alternativas">
          <SegmentedField
            value={form.choices}
            onChange={(v) => set('choices', Number(v))}
            options={[
              { value: 4, label: 'A a D' },
              { value: 5, label: 'A a E' },
            ]}
          />
        </Field>
        {create.isError ? <p className="text-sm font-semibold text-red-600">{(create.error as Error).message}</p> : null}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={create.isPending || !classId}>
            {create.isPending ? 'Criando…' : 'Criar e preencher gabarito'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
