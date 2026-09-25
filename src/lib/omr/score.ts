/**
 * Correção a partir do gabarito. Usado na tela e no servidor (mesma regra).
 *  - "X" no gabarito = questão anulada: conta como acerto para todos.
 *  - Resposta "*" (duas ou mais marcadas) ou "" (em branco) conta como erro.
 */
export type ExamScore = { correct: number; wrong: number; blank: number; multiple: number; score: number; total: number };

export function scoreAnswers(key: string[], answers: string[], questions: number, points: number): ExamScore {
  let correct = 0;
  let blank = 0;
  let multiple = 0;
  for (let i = 0; i < questions; i++) {
    const k = key[i] ?? '';
    const a = answers[i] ?? '';
    if (k === 'X' || (k && a === k)) correct++;
    else if (a === '') blank++;
    else if (a === '*') multiple++;
  }
  const wrong = questions - correct - blank - multiple;
  const score = questions ? Math.round(((points * correct) / questions) * 100) / 100 : 0;
  return { correct, wrong, blank, multiple, score, total: questions };
}

/** Gabarito completo? (toda questão tem alternativa ou está anulada) */
export const keyComplete = (key: string[], questions: number) => Array.from({ length: questions }, (_, i) => key[i]).every((k) => !!k);
