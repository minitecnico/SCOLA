import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ClipboardCheck, ScanLine } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ExamScanner } from '../components/ExamScanner';
import { QuickGrade, type QuickResult } from '../components/QuickGrade';
import { Button, EmptyState, Loading } from '../components/ui';
import { isOffline, rememberExam, rememberedExam } from '../lib/omr/offline';
import { getExamByCode, type ExamDetail } from '../lib/queries';

/**
 * Aberta pelo QR da prova da escola (câmera do celular ou leitor do app):
 *   /p/<código>          → escolhe o aluno e corrige
 *   /p/<código>/<aluno>  → já no aluno da etiqueta
 */
const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

export function CorrigirLinkPage() {
  const { code = '', student = '' } = useParams();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['exam-code', code.toUpperCase()],
    queryFn: async () => {
      try {
        const d = await getExamByCode(code.toUpperCase());
        rememberExam(d);
        return d;
      } catch (e) {
        const saved = isOffline(e) ? rememberedExam(code.toUpperCase()) : null;
        if (saved) return saved;
        throw e;
      }
    },
  });
  const [last, setLast] = useState<QuickResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [labelStudent, setLabelStudent] = useState<string | null | undefined>(undefined); // undefined = da URL

  if (isLoading) return <Loading />;
  if (!data) return <EmptyState icon={<ClipboardCheck size={24} />} title="Prova não encontrada" hint={(error as Error)?.message} action={<Link to="/provas" className="text-sm font-semibold underline">Ver provas</Link>} />;

  const fromUrl = student ? data.students.find((s) => s.short === student.toUpperCase())?.id ?? null : null;
  const fixed = labelStudent === undefined ? fromUrl : labelStudent;

  function saved(r: QuickResult) {
    setLast(r);
    qc.setQueryData<ExamDetail>(['exam-code', code.toUpperCase()], (d) =>
      d ? { ...d, answers: [...d.answers.filter((a) => a.student_id !== r.studentId), { student_id: r.studentId, answers: r.answers, source: 'manual', updated_at: new Date().toISOString() }] } : d,
    );
    qc.invalidateQueries({ queryKey: ['exams'] });
    qc.invalidateQueries({ queryKey: ['exam', data!.exam.id] });
    setLabelStudent(null); // próxima: escolhe na lista (ou escaneia)
  }

  const corrected = data.answers.length;
  return (
    <div className="rounded-xl border border-border bg-card">
      {last ? (
        <div className="flex flex-wrap items-center gap-3 rounded-t-xl border-b border-green-200 bg-green-50 px-4 py-3 sm:px-6">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-green-600 text-white">
            <Check size={16} />
          </span>
          <p className="min-w-0 flex-1 text-sm">
            <b>{last.name}</b>: {last.correct}/{last.total} · nota <b>{fmt(last.score)}</b>
            {last.grade?.column && last.grade.value != null ? ' · lançada no diário' : ''}
            {last.queued ? ' · envia quando a internet voltar' : ''}
            <span className="ml-1 text-muted-foreground">
              ({corrected} de {data.students.length} corrigidas)
            </span>
          </p>
          <Button onClick={() => setScanning(true)}>
            <ScanLine size={16} /> Escanear próxima
          </Button>
        </div>
      ) : null}
      <QuickGrade detail={data} studentId={fixed} onSaved={saved} className="rounded-xl" stickyActions />
      <ExamScanner open={scanning} onClose={() => setScanning(false)} initial={data} />
    </div>
  );
}
