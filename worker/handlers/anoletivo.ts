import { requireRole, type Ctx } from '../auth';
import { all, fail, json, now, stmt, uid } from '../db';

/**
 * Encerramento do ano letivo (gestão da base; o administrador pelo modo suporte).
 *  1. Arquiva as turmas do ano: saem da chamada/notas/provas e ficam só para consulta.
 *     Quem estava em cada turma fica registrado (class_rosters), então relatórios e
 *     boletins do ano antigo continuam completos mesmo depois da promoção.
 *  2. Cria as turmas do ano seguinte e move os alunos (promovidos, repetentes, quem saiu).
 *  3. Copia a composição das notas para o ano novo.
 * Nada é apagado: chamadas, notas e provas do ano ficam guardadas.
 */
const GESTAO = ['gestor'] as const;

type ClassRow = { id: string; name: string; shift: string | null; year: number | null; does_exams: number; archived_at: string | null; created_at: string };

export async function schoolYearOverview(ctx: Ctx) {
  const base = requireRole(ctx, ...GESTAO);
  const [classes, students, sessions, grades] = await Promise.all([
    all<ClassRow>(ctx.db, 'SELECT id, name, shift, year, does_exams, archived_at, created_at FROM classes WHERE base_id = ? ORDER BY name COLLATE NOCASE', base),
    all<{ id: string; full_name: string; class_id: string; registration: string | null }>(ctx.db,
      'SELECT id, full_name, class_id, registration FROM students WHERE base_id = ? AND active = 1 AND class_id IS NOT NULL ORDER BY full_name COLLATE NOCASE', base),
    all<{ class_id: string; y: string; n: number }>(ctx.db,
      `SELECT class_id, substr(session_date, 1, 4) AS y, COUNT(*) AS n FROM attendance_sessions
        WHERE base_id = ? AND deleted_at IS NULL GROUP BY class_id, y`, base),
    all<{ class_id: string; year: number; term: number; n: number }>(ctx.db,
      'SELECT class_id, year, term, COUNT(*) AS n FROM term_grades WHERE base_id = ? GROUP BY class_id, year, term', base),
  ]);
  const rosters = await all<{ class_id: string; n: number }>(ctx.db, 'SELECT class_id, COUNT(*) AS n FROM class_rosters WHERE base_id = ? GROUP BY class_id', base);
  const rosterN = new Map(rosters.map((r) => [r.class_id, r.n]));
  return {
    today: now().slice(0, 10),
    classes: classes.map((c) => {
      // Ano da turma: o informado; sem ano, o da última chamada (ou de criação).
      const yrs = sessions.filter((s) => s.class_id === c.id).map((s) => Number(s.y));
      const inferred = c.year ?? (yrs.length ? Math.max(...yrs) : Number(c.created_at.slice(0, 4)));
      const y = inferred;
      return {
        id: c.id,
        name: c.name,
        shift: c.shift,
        year: c.year,
        effective_year: y,
        archived_at: c.archived_at,
        students: c.archived_at ? rosterN.get(c.id) ?? 0 : students.filter((s) => s.class_id === c.id).length,
        sessions: sessions.filter((s) => s.class_id === c.id && Number(s.y) === y).reduce((a, s) => a + s.n, 0),
        terms_with_grades: [1, 2, 3].filter((t) => grades.some((g) => g.class_id === c.id && g.year === y && g.term === t && g.n > 0)),
      };
    }),
    students: students.map((s) => ({ id: s.id, name: s.full_name, class_id: s.class_id, registration: s.registration })),
  };
}

type CloseInput = {
  year: number;
  classIds: string[];
  /** Turmas novas (ano seguinte): `key` é um apelido usado em `moves`. */
  newClasses: { key: string; name: string; shift?: string | null; does_exams?: boolean; from?: string | null }[];
  /** Destino de cada aluno: key de turma nova · 'saiu' (desativa) · 'sem_turma'. */
  moves: { studentId: string; to: string }[];
  copyGradeConfig?: boolean;
};

export async function closeSchoolYear(ctx: Ctx, input: CloseInput) {
  const base = requireRole(ctx, ...GESTAO);
  const year = Math.floor(Number(input.year));
  if (!(year >= 2000 && year <= 2100)) fail('Ano inválido.');
  const next = year + 1;
  const ids = [...new Set((input.classIds ?? []).map(String))];
  if (!ids.length) fail('Escolha as turmas do ano que vai encerrar.');

  const classes = await all<ClassRow>(ctx.db,
    `SELECT id, name, shift, year, does_exams, archived_at, created_at FROM classes WHERE base_id = ? AND id IN (SELECT value FROM json_each(?))`, base, json(ids));
  if (classes.length !== ids.length) fail('Alguma turma não foi encontrada.');
  if (classes.some((c) => c.archived_at)) fail('Alguma turma escolhida já está arquivada.');

  const newClasses = (input.newClasses ?? []).map((n) => ({ ...n, name: String(n.name || '').trim(), id: uid() }));
  if (newClasses.some((n) => !n.name)) fail('Dê nome a todas as turmas novas.');
  const names = newClasses.map((n) => n.name.toLowerCase());
  if (new Set(names).size !== names.length) fail('Há turmas novas com o mesmo nome.');
  const byKey = new Map(newClasses.map((n) => [n.key, n.id]));

  // Só alunos das turmas encerradas podem ser movidos.
  const roster = await all<{ id: string; class_id: string }>(ctx.db,
    `SELECT id, class_id FROM students WHERE base_id = ? AND active = 1 AND class_id IN (SELECT value FROM json_each(?))`, base, json(ids));
  const inRoster = new Set(roster.map((r) => r.id));
  const moves = (input.moves ?? []).filter((m) => inRoster.has(m.studentId));
  const toNew = moves.filter((m) => byKey.has(m.to)).map((m) => ({ s: m.studentId, c: byKey.get(m.to) }));
  const left = moves.filter((m) => m.to === 'saiu').map((m) => m.studentId);
  const noClass = moves.filter((m) => m.to === 'sem_turma').map((m) => m.studentId);
  const bad = moves.find((m) => !byKey.has(m.to) && m.to !== 'saiu' && m.to !== 'sem_turma');
  if (bad) fail('Destino inválido para um aluno.');

  const ts = now();
  const J = (v: unknown) => json(v);
  await ctx.db.batch([
    // 1) Ano nas turmas sem ano + registro de quem estava em cada turma + arquivar.
    stmt(ctx.db, `UPDATE classes SET year = ? WHERE base_id = ? AND year IS NULL AND id IN (SELECT value FROM json_each(?))`, year, base, J(ids)),
    stmt(ctx.db,
      `INSERT OR IGNORE INTO class_rosters (class_id, student_id, base_id)
       SELECT class_id, id, base_id FROM students WHERE base_id = ? AND active = 1 AND class_id IN (SELECT value FROM json_each(?))`, base, J(ids)),
    stmt(ctx.db, `UPDATE classes SET archived_at = ? WHERE base_id = ? AND id IN (SELECT value FROM json_each(?))`, ts, base, J(ids)),
    // 2) Turmas do ano seguinte.
    ...newClasses.map((n) => {
      const src = classes.find((c) => c.id === n.from);
      return stmt(ctx.db, 'INSERT INTO classes (id, base_id, name, shift, year, does_exams) VALUES (?, ?, ?, ?, ?, ?)',
        n.id, base, n.name, n.shift ?? src?.shift ?? 'Manhã', next, n.does_exams ?? (src ? !!src.does_exams : true));
    }),
    // 3) Alunos: promovidos/repetentes para a turma nova; quem saiu fica inativo (histórico preservado).
    stmt(ctx.db,
      `UPDATE students SET class_id = (SELECT json_extract(j.value, '$.c') FROM json_each(?2) j WHERE json_extract(j.value, '$.s') = students.id)
        WHERE base_id = ?1 AND id IN (SELECT json_extract(value, '$.s') FROM json_each(?2))`, base, J(toNew)),
    stmt(ctx.db, `UPDATE students SET active = 0 WHERE base_id = ? AND id IN (SELECT value FROM json_each(?))`, base, J(left)),
    stmt(ctx.db, `UPDATE students SET class_id = NULL WHERE base_id = ? AND id IN (SELECT value FROM json_each(?))`, base, J(noClass)),
    // 4) Composição das notas: a da escola e a de cada turma seguem para o ano novo (se ainda não houver).
    ...(input.copyGradeConfig === false
      ? []
      : [
          stmt(ctx.db,
            `INSERT OR IGNORE INTO grade_terms (base_id, year, term, activities, updated_at)
             SELECT base_id, ?, term, activities, ? FROM grade_terms WHERE base_id = ? AND year = ?`, next, ts, base, year),
          ...newClasses
            .filter((n) => n.from && ids.includes(n.from))
            .map((n) =>
              stmt(ctx.db,
                `INSERT OR IGNORE INTO evaluation_terms (base_id, class_id, year, term, activities, updated_at)
                 SELECT base_id, ?, ?, term, activities, ? FROM evaluation_terms WHERE base_id = ? AND class_id = ? AND year = ?`,
                n.id, next, ts, base, n.from!, year),
            ),
        ]),
  ]);
  return { archived: ids.length, created: newClasses.length, moved: toNew.length, left: left.length, noClass: noClass.length, year, next };
}

/** Reabre um ano encerrado (as turmas voltam a aceitar chamada e notas). Alunos que já mudaram de turma continuam onde estão. */
export async function reopenSchoolYear(ctx: Ctx, year: number) {
  const base = requireRole(ctx, ...GESTAO);
  const r = await ctx.db
    .prepare('UPDATE classes SET archived_at = NULL WHERE base_id = ? AND year = ? AND archived_at IS NOT NULL')
    .bind(base, Math.floor(Number(year)))
    .run();
  return { reopened: r.meta.changes ?? 0 };
}
