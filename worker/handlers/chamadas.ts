import { assertClassOpen, requireBase, requireRole, ROSTER_SQL, type Ctx } from '../auth';
import { all, fail, first, inList, json, now, run, uid } from '../db';

const PEDAGOGICO = ['gestor', 'professor'] as const;
const isPresent = (s: string) => s === 'present' || s === 'late';
const mapSession = (r: Record<string, unknown>) => ({ ...r, exam_mode: !!r.exam_mode });

export async function getSession(ctx: Ctx, classId: string, date: string) {
  const base = requireBase(ctx);
  const r = await first(ctx.db,
    'SELECT * FROM attendance_sessions WHERE base_id = ? AND class_id = ? AND session_date = ? AND deleted_at IS NULL', base, classId, date);
  return r ? mapSession(r) : null;
}

export async function getRecords(ctx: Ctx, sessionId: string) {
  const base = requireBase(ctx);
  return all(ctx.db, 'SELECT session_id, student_id, status, note FROM attendance_records WHERE base_id = ? AND session_id = ?', base, sessionId);
}

/** Salva a chamada inteira: cria/atualiza a sessão do dia (sem duplicar) e grava todos os registros. */
export async function saveAttendance(
  ctx: Ctx,
  classId: string,
  date: string,
  records: { student_id: string; status: string; note?: string | null }[],
  opts?: { note?: string; examMode?: boolean },
) {
  const base = requireRole(ctx, ...PEDAGOGICO);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('Data inválida.');
  await assertClassOpen(ctx, base, classId);

  const ts = now();
  // Upsert pela chave (turma, data): reabre a chamada do dia, inclusive se estava na lixeira.
  await run(ctx.db,
    `INSERT INTO attendance_sessions (id, base_id, class_id, session_date, note, exam_mode, deleted_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
     ON CONFLICT (class_id, session_date) DO UPDATE SET note = excluded.note, exam_mode = excluded.exam_mode, deleted_at = NULL, updated_at = excluded.updated_at`,
    uid(), base, classId, date, opts?.note ?? null, !!opts?.examMode, ts);
  const session = await first<{ id: string }>(ctx.db, 'SELECT id FROM attendance_sessions WHERE class_id = ? AND session_date = ?', classId, date);

  const rows = (records ?? []).map((r) => ({ student_id: r.student_id, status: r.status, note: r.note ?? null }));
  if (rows.length) {
    await run(ctx.db,
      `INSERT INTO attendance_records (session_id, student_id, base_id, status, note)
       SELECT ?1, json_extract(value,'$.student_id'), ?2, json_extract(value,'$.status'), json_extract(value,'$.note')
         FROM json_each(?3)
        WHERE json_extract(value,'$.student_id') IN (SELECT id FROM students WHERE base_id = ?2)
       ON CONFLICT (session_id, student_id) DO UPDATE SET status = excluded.status, note = excluded.note`,
      session!.id, base, json(rows));
  }
}

type SessionCount = { id: string; class_id: string; session_date: string; deleted_at?: string | null; present: number; absent: number; total: number };

async function sessionsWithCounts(ctx: Ctx, where: string, order: string, limit: number, ...params: (string | number)[]) {
  const base = requireBase(ctx);
  return all<SessionCount>(ctx.db,
    `SELECT s.id, s.class_id, s.session_date, s.deleted_at,
            COALESCE(SUM(CASE WHEN r.status IN ('present','late') THEN 1 ELSE 0 END), 0) AS present,
            COALESCE(SUM(CASE WHEN r.status = 'absent' THEN 1 ELSE 0 END), 0) AS absent,
            COUNT(r.student_id) AS total
       FROM attendance_sessions s LEFT JOIN attendance_records r ON r.session_id = s.id
      WHERE s.base_id = ? AND ${where}
      GROUP BY s.id ORDER BY ${order} LIMIT ?`,
    base, ...params, limit);
}

export async function listRecentSessions(ctx: Ctx, limit = 10) {
  const rows = await sessionsWithCounts(ctx, 's.deleted_at IS NULL', 's.session_date DESC', Math.min(limit, 500));
  return rows.map(({ deleted_at: _d, ...r }) => r);
}

export async function listDeletedSessions(ctx: Ctx, limit = 50) {
  return sessionsWithCounts(ctx, 's.deleted_at IS NOT NULL', 's.deleted_at DESC', Math.min(limit, 500));
}

export async function deleteAttendanceSession(ctx: Ctx, id: string) {
  const base = requireRole(ctx, ...PEDAGOGICO);
  await run(ctx.db, 'UPDATE attendance_sessions SET deleted_at = ? WHERE id = ? AND base_id = ? AND class_id NOT IN (SELECT id FROM classes WHERE archived_at IS NOT NULL)', now(), id, base);
}

export async function restoreAttendanceSession(ctx: Ctx, id: string) {
  const base = requireRole(ctx, ...PEDAGOGICO);
  await run(ctx.db, 'UPDATE attendance_sessions SET deleted_at = NULL WHERE id = ? AND base_id = ? AND class_id NOT IN (SELECT id FROM classes WHERE archived_at IS NOT NULL)', id, base);
}

export async function purgeAttendanceSession(ctx: Ctx, id: string) {
  const base = requireRole(ctx, ...PEDAGOGICO);
  await run(ctx.db, 'DELETE FROM attendance_sessions WHERE id = ? AND base_id = ? AND class_id NOT IN (SELECT id FROM classes WHERE archived_at IS NOT NULL)', id, base);
}

/** Alunos com frequência abaixo do mínimo no ano (ignora quem tem poucas chamadas). */
export async function listAttendanceAlerts(ctx: Ctx, minPct = 75, year = new Date().getFullYear(), minSessions = 4) {
  const base = requireBase(ctx);
  const rows = await all<{ student_id: string; name: string; class_id: string | null; present: number; total: number }>(ctx.db,
    `SELECT st.id AS student_id, st.full_name AS name, st.class_id,
            SUM(CASE WHEN r.status IN ('present','late') THEN 1 ELSE 0 END) AS present, COUNT(*) AS total
       FROM attendance_records r
       JOIN attendance_sessions s ON s.id = r.session_id AND s.deleted_at IS NULL
       JOIN students st ON st.id = r.student_id
      WHERE r.base_id = ? AND substr(s.session_date, 1, 4) = ?
      GROUP BY st.id`,
    base, String(year));
  return rows
    .filter((a) => a.total >= minSessions)
    .map((a) => ({ ...a, pct: Math.round((a.present / a.total) * 1000) / 10, absent: a.total - a.present }))
    .filter((a) => a.pct < minPct)
    .map(({ present: _p, ...a }) => a)
    .sort((x, y) => x.pct - y.pct);
}

export async function reportAttendance(ctx: Ctx, classId: string, from: string, to: string) {
  const base = requireBase(ctx);
  const sessions = await all<{ id: string; session_date: string; exam_mode: number }>(ctx.db,
    `SELECT id, session_date, exam_mode FROM attendance_sessions
      WHERE base_id = ? AND class_id = ? AND deleted_at IS NULL AND session_date BETWEEN ? AND ?`,
    base, classId, from, to);
  const examDates = [...new Set(sessions.filter((s) => s.exam_mode).map((s) => s.session_date))].sort();
  const records = sessions.length
    ? await all<{ student_id: string; status: string; session_id: string }>(ctx.db,
        `SELECT student_id, status, session_id FROM attendance_records WHERE base_id = ? AND session_id IN ${inList}`,
        base, json(sessions.map((s) => s.id)))
    : [];
  const dateById = new Map(sessions.map((s) => [s.id, s.session_date]));
  const students = await all<{ id: string; full_name: string }>(ctx.db, ROSTER_SQL, base, classId);
  const dates = [...new Set(sessions.map((s) => s.session_date))].sort();

  const byStudent = new Map<string, typeof records>();
  for (const r of records) {
    const l = byStudent.get(r.student_id) ?? [];
    l.push(r);
    byStudent.set(r.student_id, l);
  }

  const rows = students.map((s) => {
    const mine = byStudent.get(s.id) ?? [];
    const present = mine.filter((r) => isPresent(r.status)).length;
    const absentRecs = mine.filter((r) => !isPresent(r.status));
    const total = mine.length;
    const days: Record<string, boolean> = {};
    for (const r of mine) {
      const d = dateById.get(r.session_id);
      if (d) days[d] = isPresent(r.status);
    }
    const absentDates = absentRecs.map((r) => dateById.get(r.session_id)).filter((d): d is string => !!d).sort();
    return {
      student_id: s.id, name: s.full_name, present, absent: absentRecs.length, total,
      pct: total ? Math.round((present / total) * 1000) / 10 : 0, absentDates, days,
    };
  });
  return { sessions: sessions.length, rows, examDates, dates };
}
