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
          { icon: <FileText size={16} />, t: 'Preencha o gabarito', d: 'As respostas certas da prova de vocês, em sequência (ABDCE…).' },
          { icon: <Printer size={16} />, t: 'Gere o QR', d: 'Cole o QR no modelo da prova ou imprima etiquetas com o nome de cada aluno.' },
          { icon: <ScanLine size={16} />, t: 'Escaneie e corrija', d: 'O gabarito vem marcado: toque só nas erradas. A nota sai na hora.' },
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
  const [form, setForm] = useState({ title: '', class_id: '', exam_date: localToday(), questions: '10', choices: 5, points: '10', sheet: 'propria' as 'propria' | 'scola', key: '' });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const classId = form.class_id || classes[0]?.id || '';
  // Gabarito digitado em sequência ("ABDCE ACBDA…"); X = anulada.
  const nQ = Math.max(1, Math.min(MAX_QUESTIONS, Number(form.questions) || 1));
  const validLetters = 'ABCDE'.slice(0, form.choices) + 'X';
  const keySeq = form.key.toUpperCase().split('').filter((c) => validLetters.includes(c));

  const create = useMutation({
    mutationFn: () =>
      saveExam({
        class_id: classId,
        title: form.title.trim(),
        exam_date: form.exam_date || null,
        questions: Number(form.questions),
        choices: form.choices,
        points: Number(String(form.points).replace(',', '.')),
        sheet: form.sheet,
        answer_key: keySeq.slice(0, nQ),
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
        <Field label="Gabarito (respostas certas, em sequência)">
          <input
            value={form.key}
            onChange={(e) => set('key', e.target.value.toUpperCase().replace(new RegExp(`[^${validLetters} ]`, 'g'), ''))}
            placeholder={form.choices === 4 ? 'Ex.: ABDC ACBD DA…' : 'Ex.: ABDCE ACBDA…'}
            className={cn(fieldCls, 'font-mono uppercase tracking-widest')}
            autoCapitalize="characters"
            autoComplete="off"
          />
          <p className={cn('mt-1 text-xs', keySeq.length > nQ ? 'text-red-600' : 'text-muted-foreground')}>
            {keySeq.length} de {nQ} preenchidas{keySeq.length > nQ ? ' (sobrou resposta)' : ''} · X = questão anulada · dá para completar depois.
          </p>
        </Field>
        <Field label="Como os alunos respondem">
          <SegmentedField
            value={form.sheet}
            onChange={(v) => set('sheet', v as 'propria' | 'scola')}
            options={[
              { value: 'propria', label: 'Prova da escola' },
              { value: 'scola', label: 'Folha SCOLA' },
            ]}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {form.sheet === 'propria'
              ? 'Use a prova de vocês: o SCOLA gera o QR (no modelo ou em etiquetas) e você corrige tocando nas erradas.'
              : 'Folha de bolinhas do SCOLA, lida automaticamente pela câmera.'}
          </p>
        </Field>
        {create.isError ? <p className="text-sm font-semibold text-red-600">{(create.error as Error).message}</p> : null}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={create.isPending || !classId}>
            {create.isPending ? 'Criando…' : keySeq.length >= nQ ? 'Criar e gerar QR' : 'Criar prova'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
