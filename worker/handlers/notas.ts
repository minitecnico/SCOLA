import { calcMedia, normalizeScores, withRecoveryActivity, type GradeActivity } from '../../src/lib/types';
import { assertClassInBase, requireBase, requireRole, type Ctx } from '../auth';
import { all, fail, first, inList, json, now, parse, run } from '../db';

const PEDAGOGICO = ['gestor', 'professor'] as const;
const cleanActs = (v: unknown) => parse<GradeActivity[]>(v, []).filter((a) => a && a.name);

/* ------------------------- Composição de notas (por base) ------------------------ */
export async function getSavedTermConfig(ctx: Ctx, year: number, term: number) {
  const base = requireBase(ctx);
  const r = await first<{ activities: string }>(ctx.db, 'SELECT activities FROM grade_terms WHERE base_id = ? AND year = ? AND term = ?', base, year, term);
  return cleanActs(r?.activities);
}

export async function getTermConfig(ctx: Ctx, year: number, term: number) {
  return withRecoveryActivity(await getSavedTermConfig(ctx, year, term));
}

export async function saveTermConfig(ctx: Ctx, year: number, term: number, activities: GradeActivity[]) {
  const base = requireRole(ctx, ...PEDAGOGICO);
  await run(ctx.db,
    `INSERT INTO grade_terms (base_id, year, term, activities, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (base_id, year, term) DO UPDATE SET activities = excluded.activities, updated_at = excluded.updated_at`,
    base, year, term, json(activities ?? []), now());
}

/* ------------------------------- Notas lançadas ---------------------------------- */
type TermGradeRow = { student_id: string; scores: Record<string, number>; observacao?: string | null; updated_at?: string | null };

export async function listTermGrades(ctx: Ctx, classId: string, year: number, term: number) {
  const base = requireBase(ctx);
  const rows = await all<{ student_id: string; scores: string; observacao: string | null; updated_at: string | null }>(ctx.db,
    'SELECT student_id, scores, observacao, updated_at FROM term_grades WHERE base_id = ? AND class_id = ? AND year = ? AND term = ?',
    base, classId, year, term);
  return rows.map((r) => ({ ...r, scores: parse<Record<string, number>>(r.scores, {}) }));
}

async function upsertTermGrades(ctx: Ctx, base: string, classId: string, year: number, term: number, rows: TermGradeRow[]) {
  if (!rows.length) return;
  const payload = rows.map((r) => ({ s: r.student_id, g: JSON.stringify(r.scores ?? {}), o: r.observacao ?? null }));
  await run(ctx.db,
    `INSERT INTO term_grades (base_id, class_id, student_id, year, term, scores, observacao, updated_at)
     SELECT ?1, ?2, json_extract(value,'$.s'), ?3, ?4, json_extract(value,'$.g'), json_extract(value,'$.o'), ?5
       FROM json_each(?6)
      WHERE json_extract(value,'$.s') IN (SELECT id FROM students WHERE base_id = ?1)
     ON CONFLICT (student_id, year, term) DO UPDATE SET
       class_id = excluded.class_id, scores = excluded.scores, observacao = excluded.observacao, updated_at = excluded.updated_at`,
    base, classId, year, term, now(), json(payload));
}

export async function saveTermGrades(ctx: Ctx, classId: string, year: number, term: number, rows: TermGradeRow[]) {
  const base = requireRole(ctx, ...PEDAGOGICO);
  await assertClassInBase(ctx, base, classId);
  await upsertTermGrades(ctx, base, classId, year, term, rows ?? []);
}

export async function bulkDeleteTermGrades(ctx: Ctx, classId: string, year: number, term: number, studentIds: string[]) {
  const base = requireRole(ctx, 'gestor');
  await run(ctx.db, `DELETE FROM term_grades WHERE base_id = ? AND class_id = ? AND year = ? AND term = ? AND student_id IN ${inList}`,
    base, classId, year, term, json(studentIds));
}

/* ---------------------------- Central de Avaliações ------------------------------ */
type EvalMark = { done: boolean; score: number | null };
type EvalGradeRow = { student_id: string; marks: Record<string, EvalMark>; updated_at?: string | null };

export async function getEvalConfig(ctx: Ctx, classId: string, year: number, term: number) {
  const base = requireBase(ctx);
  const r = await first<{ activities: string }>(ctx.db,
    'SELECT activities FROM evaluation_terms WHERE base_id = ? AND class_id = ? AND year = ? AND term = ?', base, classId, year, term);
  return cleanActs(r?.activities);
}

export async function saveEvalConfig(ctx: Ctx, classId: string, year: number, term: number, activities: GradeActivity[]) {
  const base = requireRole(ctx, ...PEDAGOGICO);
  await assertClassInBase(ctx, base, classId);
  await run(ctx.db,
    `INSERT INTO evaluation_terms (base_id, class_id, year, term, activities, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (class_id, year, term) DO UPDATE SET activities = excluded.activities, updated_at = excluded.updated_at`,
    base, classId, year, term, json(activities ?? []), now());
}

export async function listEvalGrades(ctx: Ctx, classId: string, year: number, term: number): Promise<EvalGradeRow[]> {
  const base = requireBase(ctx);
  const rows = await all<{ student_id: string; marks: string; updated_at: string | null }>(ctx.db,
    'SELECT student_id, marks, updated_at FROM evaluation_grades WHERE base_id = ? AND class_id = ? AND year = ? AND term = ?',
    base, classId, year, term);
  return rows.map((r) => ({ ...r, marks: parse<Record<string, EvalMark>>(r.marks, {}) }));
}

export async function saveEvalGrades(ctx: Ctx, classId: string, year: number, term: number, rows: EvalGradeRow[]) {
  const base = requireRole(ctx, ...PEDAGOGICO);
  if (!rows?.length) return;
  await assertClassInBase(ctx, base, classId);
  const payload = rows.map((r) => ({ s: r.student_id, m: JSON.stringify(r.marks ?? {}) }));
  await run(ctx.db,
    `INSERT INTO evaluation_grades (base_id, class_id, student_id, year, term, marks, updated_at)
     SELECT ?1, ?2, json_extract(value,'$.s'), ?3, ?4, json_extract(value,'$.m'), ?5
       FROM json_each(?6)
      WHERE json_extract(value,'$.s') IN (SELECT id FROM students WHERE base_id = ?1)
     ON CONFLICT (class_id, student_id, year, term) DO UPDATE SET marks = excluded.marks, updated_at = excluded.updated_at`,
    base, classId, year, term, now(), json(payload));
}

export async function bulkDeleteEvalGrades(ctx: Ctx, classId: string, year: number, term: number, studentIds: string[]) {
  const base = requireRole(ctx, 'gestor');
  if (!studentIds?.length) return;
  await run(ctx.db, `DELETE FROM evaluation_grades WHERE base_id = ? AND class_id = ? AND year = ? AND term = ? AND student_id IN ${inList}`,
    base, classId, year, term, json(studentIds));
}

/** Crédito variável vindo da Central de Avaliações, ligado pelo id estável da coluna. */
export async function getCreditoData(ctx: Ctx, classId: string, year: number, term: number) {
  const [acts, grades] = await Promise.all([getEvalConfig(ctx, classId, year, term), listEvalGrades(ctx, classId, year, term)]);
  const defs = acts.filter((a) => a.credito && a.id);
  if (!defs.length) return { defs: [], byStudent: {} };
  const byStudent: Record<string, Record<string, number>> = {};
  for (const g of grades) {
    const row: Record<string, number> = {};
    let any = false;
    for (const d of defs) {
      const m = g.marks?.[d.id as string];
      if (!m) continue;
      if (m.score != null || m.done) {
        row[d.id as string] = m.score != null ? Number(m.score) || 0 : 0;
        any = true;
      }
    }
    if (any) byStudent[g.student_id] = row;
  }
  return { defs, byStudent };
}

/** Grava o crédito variável dentro das notas do trimestre (merge; preserva as demais notas e a observação). */
export async function applyCreditoToGrades(ctx: Ctx, classId: string, year: number, term: number) {
  const base = requireRole(ctx, ...PEDAGOGICO);
  await assertClassInBase(ctx, base, classId);
  const { defs, byStudent } = await getCreditoData(ctx, classId, year, term);
  if (!defs.length) return 0;
  const creditIds = defs.map((d) => d.id as string);
  const maxById = new Map(defs.map((d) => [d.id as string, d.max] as const));
  const existing = await listTermGrades(ctx, classId, year, term);
  const byId = new Map(existing.map((r) => [r.student_id, r]));
  const sids = new Set<string>([...existing.map((r) => r.student_id), ...Object.keys(byStudent)]);

  const rows: TermGradeRow[] = [...sids].map((sid) => {
    const cur = byId.get(sid);
    const scores = { ...(cur?.scores ?? {}) };
    for (const id of creditIds) {
      const v = byStudent[sid]?.[id];
      if (v == null) delete scores[id];
      else {
        const max = maxById.get(id) ?? 0;
        scores[id] = max > 0 ? Math.min(v, max) : v;
      }
    }
    return { student_id: sid, scores, observacao: cur?.observacao ?? null };
  });
  await upsertTermGrades(ctx, base, classId, year, term, rows);
  return rows.length;
}

/* ---------------------------------- Relatórios ----------------------------------- */
async function termContext(ctx: Ctx, classId: string, year: number) {
  const base = requireBase(ctx);
  const [grades, configs, evalConfigs, students] = await Promise.all([
    all<{ student_id: string; term: number; scores: string }>(ctx.db,
      'SELECT student_id, term, scores FROM term_grades WHERE base_id = ? AND class_id = ? AND year = ?', base, classId, year),
    all<{ term: number; activities: string }>(ctx.db, 'SELECT term, activities FROM grade_terms WHERE base_id = ? AND year = ?', base, year),
    all<{ term: number; activities: string }>(ctx.db,
      'SELECT term, activities FROM evaluation_terms WHERE base_id = ? AND class_id = ? AND year = ?', base, classId, year),
    all<{ id: string; full_name: string }>(ctx.db,
      'SELECT id, full_name FROM students WHERE base_id = ? AND class_id = ? AND active = 1 ORDER BY full_name COLLATE NOCASE', base, classId),
  ]);
  const creditByTerm = new Map(evalConfigs.map((c) => [c.term, cleanActs(c.activities).filter((a) => a.credito && a.id)]));
  // Composição por trimestre = colunas próprias + atividades de crédito (mesma regra das Notas).
  const actByTerm = new Map(
    [1, 2, 3].map((t) => {
      const gradeActs = cleanActs(configs.find((c) => c.term === t)?.activities);
      return [t, withRecoveryActivity([...gradeActs, ...(creditByTerm.get(t) ?? [])])] as const;
    }),
  );
  const gradeOf = (sid: string, t: number) => {
    const g = grades.find((x) => x.student_id === sid && x.term === t);
    return g ? parse<Record<string, number>>(g.scores, {}) : null;
  };
  return { actByTerm, students, gradeOf };
}

export async function reportTerms(ctx: Ctx, classId: string, year: number) {
  const { actByTerm, students, gradeOf } = await termContext(ctx, classId, year);
  return students.map((s) => {
    const terms = [1, 2, 3].map((t) => {
      const g = gradeOf(s.id, t);
      const acts = actByTerm.get(t) ?? [];
      return g ? calcMedia(normalizeScores(g, acts), acts) : null;
    });
    const got = terms.filter((x): x is number => x != null);
    const final = got.length ? Math.round((got.reduce((a, b) => a + b, 0) / got.length) * 10) / 10 : null;
    return { student_id: s.id, name: s.full_name, terms, final };
  });
}

export async function reportTermDetails(ctx: Ctx, classId: string, year: number, term: number) {
  const { actByTerm, students, gradeOf } = await termContext(ctx, classId, year);
  const activities = actByTerm.get(term) ?? [];
  const rows = students.map((s) => {
    const g = gradeOf(s.id, term);
    const scores = normalizeScores(g ?? {}, activities);
    const activitiesMap: Record<string, number | null> = {};
    for (const a of activities) {
      const k = a.id ?? a.name;
      activitiesMap[k] = scores[k] != null ? Number(scores[k]) : null;
    }
    return { student_id: s.id, name: s.full_name, activities: activitiesMap, termAvg: g ? calcMedia(scores, activities) : null };
  });
  return { activities, rows };
}

/* ------------------------- Relatório compartilhado por link ---------------------- */
function shortId() {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => alphabet[b % 36]).join('');
}

export async function createSharedReport(ctx: Ctx, payload: unknown) {
  const base = requireBase(ctx);
  const id = shortId();
  await run(ctx.db, 'INSERT INTO shared_reports (id, base_id, payload) VALUES (?, ?, ?)', id, base, json(payload));
  return id;
}
