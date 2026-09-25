import { MAX_QUESTIONS, studentShort } from '../../src/lib/omr/layout';
import { scoreAnswers } from '../../src/lib/omr/score';
import { actKey } from '../../src/lib/types';
import { assertClassInBase, requireRole, type Ctx } from '../auth';
import { all, fail, first, json, now, parse, run, uid } from '../db';
import { composeTermActs } from './notas';

/**
 * Provas com gabarito e correção pela câmera.
 * As respostas ficam guardadas "cruas"; a nota sai sempre do gabarito atual.
 */
const PEDAGOGICO = ['gestor', 'professor'] as const;
const KEY_VALUES = new Set(['', 'A', 'B', 'C', 'D', 'E', 'X']);
const ANSWER_VALUES = new Set(['', 'A', 'B', 'C', 'D', 'E', '*']);
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I

type ExamRow = {
  id: string; base_id: string; class_id: string; author_id: string | null; code: string; title: string; exam_date: string | null;
  questions: number; choices: number; answer_key: string; points: number; created_at: string; updated_at: string | null;
};
const mapExam = (e: ExamRow) => ({ ...e, answer_key: parse<string[]>(e.answer_key, []) });

async function examInBase(ctx: Ctx, base: string, id: string) {
  const e = await first<ExamRow>(ctx.db, 'SELECT * FROM exams WHERE id = ? AND base_id = ?', id, base);
  if (!e) fail('Prova não encontrada.', 404);
  return e!;
}

export async function listExams(ctx: Ctx) {
  const base = requireRole(ctx, ...PEDAGOGICO);
  const [exams, answers] = await Promise.all([
    all<ExamRow & { class_name: string; students: number }>(ctx.db,
      `SELECT e.*, c.name AS class_name,
              (SELECT COUNT(*) FROM students s WHERE s.class_id = e.class_id AND s.active = 1) AS students
         FROM exams e JOIN classes c ON c.id = e.class_id
        WHERE e.base_id = ? ORDER BY COALESCE(e.exam_date, e.created_at) DESC`, base),
    all<{ exam_id: string; answers: string }>(ctx.db, 'SELECT exam_id, answers FROM exam_answers WHERE base_id = ?', base),
  ]);
  const byExam = new Map<string, string[][]>();
  for (const a of answers) {
    const l = byExam.get(a.exam_id) ?? [];
    l.push(parse<string[]>(a.answers, []));
    byExam.set(a.exam_id, l);
  }
  return exams.map((e) => {
    const key = parse<string[]>(e.answer_key, []);
    const got = byExam.get(e.id) ?? [];
    const scores = got.map((a) => scoreAnswers(key, a, e.questions, e.points).score);
    return {
      ...mapExam(e),
      corrected: got.length,
      average: scores.length ? Math.round((scores.reduce((s, x) => s + x, 0) / scores.length) * 100) / 100 : null,
    };
  });
}

async function examDetail(ctx: Ctx, base: string, e: ExamRow) {
  const [cls, students, answers] = await Promise.all([
    first<{ name: string }>(ctx.db, 'SELECT name FROM classes WHERE id = ?', e.class_id),
    all<{ id: string; full_name: string }>(ctx.db,
      'SELECT id, full_name FROM students WHERE base_id = ? AND class_id = ? AND active = 1 ORDER BY full_name COLLATE NOCASE', base, e.class_id),
    all<{ student_id: string; answers: string; source: string; updated_at: string }>(ctx.db,
      'SELECT student_id, answers, source, updated_at FROM exam_answers WHERE exam_id = ?', e.id),
  ]);
  return {
    exam: { ...mapExam(e), class_name: cls?.name ?? 'Turma' },
    students: students.map((s) => ({ id: s.id, name: s.full_name, short: studentShort(s.id) })),
    answers: answers.map((a) => ({ ...a, answers: parse<string[]>(a.answers, []) })),
  };
}

export async function getExam(ctx: Ctx, id: string) {
  const base = requireRole(ctx, ...PEDAGOGICO);
  return examDetail(ctx, base, await examInBase(ctx, base, id));
}

/** Usado pelo leitor: o QR traz só o código da prova. */
export async function getExamByCode(ctx: Ctx, code: string) {
  const base = requireRole(ctx, ...PEDAGOGICO);
  const e = await first<ExamRow>(ctx.db, 'SELECT * FROM exams WHERE code = ?', String(code || '').toUpperCase());
  if (!e) fail('Esta folha não é de nenhuma prova cadastrada.', 404);
  if (e!.base_id !== base) fail('Esta folha é de uma prova de outra escola.', 403);
  return examDetail(ctx, base, e!);
}

function cleanKey(v: unknown, questions: number): string[] {
  const arr = Array.isArray(v) ? v : [];
  return Array.from({ length: questions }, (_, i) => {
    const k = String(arr[i] ?? '').toUpperCase();
    return KEY_VALUES.has(k) ? k : '';
  });
}

export async function saveExam(ctx: Ctx, input: {
  id?: string; class_id: string; title: string; exam_date?: string | null; questions: number; choices: number; points: number; answer_key?: string[];
}) {
  const base = requireRole(ctx, ...PEDAGOGICO);
  const title = String(input.title || '').trim();
  if (!title) fail('Dê um nome para a prova.');
  const questions = Math.floor(Number(input.questions));
  const choices = Math.floor(Number(input.choices));
  const points = Number(input.points);
  if (!(questions >= 1 && questions <= MAX_QUESTIONS)) fail(`A prova pode ter de 1 a ${MAX_QUESTIONS} questões.`);
  if (!(choices >= 2 && choices <= 5)) fail('Use de 2 a 5 alternativas (A a E).');
  if (!(points > 0 && points <= 1000)) fail('Informe o valor da prova.');
  const date = input.exam_date && /^\d{4}-\d{2}-\d{2}$/.test(input.exam_date) ? input.exam_date : null;
  await assertClassInBase(ctx, base, input.class_id);
  const key = cleanKey(input.answer_key, questions);
  // Alternativa do gabarito precisa existir na folha (ex.: "E" numa prova de 4 alternativas).
  const allowed = new Set(['', 'X', ...'ABCDE'.slice(0, choices).split('')]);
  if (key.some((k) => !allowed.has(k))) fail('O gabarito usa uma alternativa que não existe nesta prova.');

  if (input.id) {
    const cur = await examInBase(ctx, base, input.id);
    const hasAnswers = await first(ctx.db, 'SELECT 1 FROM exam_answers WHERE exam_id = ? LIMIT 1', cur.id);
    if (hasAnswers && (cur.questions !== questions || cur.choices !== choices || cur.class_id !== input.class_id)) {
      fail('Já existem folhas corrigidas: não dá para mudar turma, número de questões ou alternativas (as folhas impressas ficariam diferentes).');
    }
    await run(ctx.db,
      'UPDATE exams SET class_id = ?, title = ?, exam_date = ?, questions = ?, choices = ?, points = ?, answer_key = ?, updated_at = ? WHERE id = ?',
      input.class_id, title, date, questions, choices, points, json(key), now(), cur.id);
    return getExam(ctx, cur.id);
  }

  const id = uid();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    try {
      await run(ctx.db,
        `INSERT INTO exams (id, base_id, class_id, author_id, code, title, exam_date, questions, choices, answer_key, points, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, base, input.class_id, ctx.user.id, code, title, date, questions, choices, json(key), points, now());
      return getExam(ctx, id);
    } catch (err) {
      if (!String((err as Error)?.message).includes('UNIQUE')) throw err;
    }
  }
  return fail('Não consegui gerar o código da prova. Tente de novo.');
}

export async function deleteExam(ctx: Ctx, id: string) {
  const base = requireRole(ctx, ...PEDAGOGICO);
  await run(ctx.db, 'DELETE FROM exams WHERE id = ? AND base_id = ?', id, base);
}

export async function saveExamAnswer(ctx: Ctx, examId: string, studentId: string, answers: string[], source: 'camera' | 'manual' = 'camera') {
  const base = requireRole(ctx, ...PEDAGOGICO);
  const e = await examInBase(ctx, base, examId);
  const st = await first(ctx.db, 'SELECT 1 FROM students WHERE id = ? AND base_id = ? AND class_id = ?', studentId, base, e.class_id);
  if (!st) fail('Aluno não pertence à turma desta prova.');
  const arr = Array.isArray(answers) ? answers : [];
  const clean = Array.from({ length: e.questions }, (_, i) => {
    const a = String(arr[i] ?? '').toUpperCase();
    return ANSWER_VALUES.has(a) ? a : '';
  });
  await run(ctx.db,
    `INSERT INTO exam_answers (exam_id, student_id, base_id, answers, source, checked_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (exam_id, student_id) DO UPDATE SET answers = excluded.answers, source = excluded.source, checked_by = excluded.checked_by, updated_at = excluded.updated_at`,
    e.id, studentId, base, json(clean), source === 'manual' ? 'manual' : 'camera', ctx.user.id, now());
  return scoreAnswers(parse<string[]>(e.answer_key, []), clean, e.questions, e.points);
}

export async function deleteExamAnswer(ctx: Ctx, examId: string, studentId: string) {
  const base = requireRole(ctx, ...PEDAGOGICO);
  await examInBase(ctx, base, examId);
  await run(ctx.db, 'DELETE FROM exam_answers WHERE exam_id = ? AND student_id = ?', examId, studentId);
}

/** Colunas de Notas disponíveis para receber a prova (mesma composição da tela de Notas). */
export async function examGradeTargets(ctx: Ctx, examId: string, year: number, term: number) {
  const base = requireRole(ctx, ...PEDAGOGICO);
  const e = await examInBase(ctx, base, examId);
  const [cfg, evalCfg, filled] = await Promise.all([
    first<{ activities: string }>(ctx.db, 'SELECT activities FROM grade_terms WHERE base_id = ? AND year = ? AND term = ?', base, year, term),
    first<{ activities: string }>(ctx.db, 'SELECT activities FROM evaluation_terms WHERE class_id = ? AND year = ? AND term = ?', e.class_id, year, term),
    all<{ scores: string }>(ctx.db, 'SELECT scores FROM term_grades WHERE class_id = ? AND year = ? AND term = ?', e.class_id, year, term),
  ]);
  const acts = composeTermActs(cfg?.activities, evalCfg?.activities);
  const scores = filled.map((f) => parse<Record<string, number>>(f.scores, {}));
  return acts.map((a) => ({
    key: actKey(a),
    name: a.name,
    max: a.max,
    filled: scores.filter((s) => s[actKey(a)] != null || s[a.name] != null).length,
  }));
}

/**
 * Lança a nota de cada aluno corrigido numa coluna de Notas.
 * Nota = acertos ÷ questões × valor da coluna (nunca passa do máximo dela).
 * Só mexe nessa coluna; as demais notas do aluno ficam como estão.
 */
export async function sendExamToGrades(ctx: Ctx, examId: string, year: number, term: number, key: string) {
  const base = requireRole(ctx, ...PEDAGOGICO);
  const e = await examInBase(ctx, base, examId);
  if (!(term >= 1 && term <= 3)) fail('Trimestre inválido.');
  const targets = await examGradeTargets(ctx, examId, year, term);
  const target = targets.find((t) => t.key === key);
  if (!target) fail('Coluna de notas não encontrada neste trimestre.');
  if (/["\\]/.test(key)) fail('Coluna de notas com nome inválido.');
  const answers = await all<{ student_id: string; answers: string }>(ctx.db,
    `SELECT a.student_id, a.answers FROM exam_answers a JOIN students s ON s.id = a.student_id
      WHERE a.exam_id = ? AND s.class_id = ?`, e.id, e.class_id);
  if (!answers.length) fail('Nenhuma folha corrigida ainda.');
  const answerKey = parse<string[]>(e.answer_key, []);
  const rows = answers.map((a) => {
    const r = scoreAnswers(answerKey, parse<string[]>(a.answers, []), e.questions, e.points);
    return { s: a.student_id, v: Math.round((r.correct / e.questions) * target!.max * 100) / 100 };
  });
  const path = `$."${key}"`;
  await run(ctx.db,
    `INSERT INTO term_grades (base_id, class_id, student_id, year, term, scores, updated_at)
     SELECT ?, ?, json_extract(j.value, '$.s'), ?, ?, json_object(?, json_extract(j.value, '$.v')), ?
       FROM json_each(?) j WHERE 1
     ON CONFLICT (student_id, year, term) DO UPDATE
       SET scores = json_set(term_grades.scores, ?, json_extract(excluded.scores, ?)), updated_at = excluded.updated_at`,
    base, e.class_id, year, term, key, now(), json(rows), path, path);
  return { sent: rows.length, column: target!.name, max: target!.max };
}
