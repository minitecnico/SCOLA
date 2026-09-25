/**
 * Correção sem internet (sala sem Wi-Fi, 4G fraco):
 *  - a prova (gabarito + lista de alunos) fica guardada no aparelho depois da 1ª leitura;
 *  - folhas corrigidas sem conexão entram numa fila e são enviadas sozinhas quando a internet volta.
 */
import { ApiError } from '../api';
import { saveExamAnswer, type ExamDetail } from '../queries';

const DETAIL = 'scola:prova:';
const QUEUE = 'scola:provas:fila';

type Pending = { examId: string; studentId: string; answers: string[]; source: 'camera' | 'manual'; at: string };

function read<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* sem armazenamento: segue só online */
  }
}

export const rememberExam = (d: ExamDetail) => write(DETAIL + d.exam.code, d);
export const rememberedExam = (code: string) => read<ExamDetail | null>(DETAIL + code, null);

export const pendingAnswers = () => read<Pending[]>(QUEUE, []);
const setPending = (l: Pending[]) => write(QUEUE, l);

/** Sem conexão (e não um erro de verdade do servidor, como "aluno não pertence à turma")? */
export const isOffline = (e: unknown) => !navigator.onLine || (e instanceof ApiError && e.status === 0);

/** Salva a correção; sem internet, guarda na fila e devolve null. */
export async function saveOrQueue(examId: string, studentId: string, answers: string[], source: 'camera' | 'manual') {
  try {
    return await saveExamAnswer(examId, studentId, answers, source);
  } catch (e) {
    if (!isOffline(e)) throw e;
    // Só a leitura mais recente de cada aluno vale.
    setPending([...pendingAnswers().filter((p) => !(p.examId === examId && p.studentId === studentId)), { examId, studentId, answers, source, at: new Date().toISOString() }]);
    return null;
  }
}

let flushing: Promise<number> | null = null;
/** Envia a fila. Devolve quantas foram enviadas. */
export function flushPending(): Promise<number> {
  flushing ??= (async () => {
    let sent = 0;
    try {
      for (const p of pendingAnswers()) {
        let ok = true;
        try {
          await saveExamAnswer(p.examId, p.studentId, p.answers, p.source);
        } catch (e) {
          if (isOffline(e)) break; // continua offline: tenta de novo depois
          ok = false; // erro definitivo (prova apagada, aluno transferido): descarta
        }
        setPending(pendingAnswers().filter((x) => !(x.examId === p.examId && x.studentId === p.studentId && x.at === p.at)));
        if (ok) sent++;
      }
    } finally {
      flushing = null;
    }
    return sent;
  })();
  return flushing;
}
