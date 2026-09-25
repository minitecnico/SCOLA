import { requireBase, type Ctx } from '../auth';
import { all, parse } from '../db';

/**
 * Painel do Início (visão do mês): chamadas por dia, eventos do calendário
 * escolar e frequência por turma no ano. Três consultas, cálculo leve.
 */
export async function dashboardMonth(ctx: Ctx, year: number, month: number) {
  const base = requireBase(ctx);
  const y = Number(year) || new Date().getFullYear();
  const m = Math.min(12, Math.max(1, Number(month) || 1));
  const ym = `${y}-${String(m).padStart(2, '0')}`;
  const first = `${ym}-01`;
  const last = `${ym}-31`;

  const [days, calendars, classes] = await Promise.all([
    all<{ date: string; sessions: number; present: number; total: number }>(ctx.db,
      `SELECT s.session_date AS date, COUNT(DISTINCT s.id) AS sessions,
              SUM(CASE WHEN r.status IN ('present','late') THEN 1 ELSE 0 END) AS present, COUNT(r.student_id) AS total
         FROM attendance_sessions s LEFT JOIN attendance_records r ON r.session_id = s.id
        WHERE s.base_id = ? AND s.deleted_at IS NULL AND s.session_date BETWEEN ? AND ?
        GROUP BY s.session_date ORDER BY s.session_date`, base, first, last),
    all<{ data: string }>(ctx.db, 'SELECT data FROM calendars WHERE base_id = ?', base),
    all<{ id: string; name: string; sessions: number; present: number; total: number }>(ctx.db,
      `SELECT c.id, c.name,
              (SELECT COUNT(*) FROM attendance_sessions s WHERE s.class_id = c.id AND s.deleted_at IS NULL AND substr(s.session_date, 1, 4) = ?) AS sessions,
              (SELECT SUM(CASE WHEN r.status IN ('present','late') THEN 1 ELSE 0 END) FROM attendance_records r JOIN attendance_sessions s ON s.id = r.session_id
                 WHERE s.class_id = c.id AND s.deleted_at IS NULL AND substr(s.session_date, 1, 4) = ?) AS present,
              (SELECT COUNT(*) FROM attendance_records r JOIN attendance_sessions s ON s.id = r.session_id
                 WHERE s.class_id = c.id AND s.deleted_at IS NULL AND substr(s.session_date, 1, 4) = ?) AS total
         FROM classes c WHERE c.base_id = ? ORDER BY c.name COLLATE NOCASE`, String(y), String(y), String(y), base),
  ]);

  type Ev = { id: string; title: string; categoryId: string; start: string; end?: string };
  type Cat = { id: string; label: string; color: string };
  const events: { date: string; end: string | null; title: string; category: string; color: string }[] = [];
  for (const c of calendars) {
    const d = parse<{ events?: Ev[]; categories?: Cat[] }>(c.data, {});
    const cats = new Map((d.categories ?? []).map((k) => [k.id, k]));
    for (const e of d.events ?? []) {
      if (!e?.start) continue;
      const end = e.end || e.start;
      if (end < first || e.start > last) continue;
      const k = cats.get(e.categoryId);
      events.push({ date: e.start, end: e.end ?? null, title: e.title, category: k?.label ?? 'Evento', color: k?.color ?? '#171717' });
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date));

  return {
    days: days.map((d) => ({ ...d, pct: d.total ? Math.round((d.present / d.total) * 1000) / 10 : null })),
    events,
    classes: classes
      .filter((c) => c.total > 0)
      .map((c) => ({ id: c.id, name: c.name, sessions: c.sessions, pct: Math.round(((c.present ?? 0) / c.total) * 1000) / 10 })),
  };
}
