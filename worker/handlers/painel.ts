import { requireBase, type Ctx } from '../auth';
import { cached } from '../cache';
import { all, parse } from '../db';

/**
 * Painel do Início (visão do mês): chamadas por dia, eventos do calendário
 * escolar e frequência por turma no ano. Três consultas, cálculo leve.
 */
export const dashboardMonth = (ctx: Ctx, year: number, month: number) => cached(ctx, 'dashboardMonth', [year, month], () => dashboardMonthRaw(ctx, year, month));

async function dashboardMonthRaw(ctx: Ctx, year: number, month: number) {
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
    // Presença por turma no ano: soma por chamada (só as do ano, pelo índice de datas) e depois por turma.
    all<{ id: string; name: string; sessions: number; present: number; total: number }>(ctx.db,
      `SELECT c.id, c.name, COALESCE(x.n, 0) AS sessions, x.p AS present, COALESCE(x.t, 0) AS total
         FROM classes c
         LEFT JOIN (
           SELECT s.class_id, COUNT(*) AS n, SUM(a.p) AS p, SUM(a.t) AS t
             FROM attendance_sessions s
             LEFT JOIN (SELECT r.session_id, SUM(CASE WHEN r.status IN ('present','late') THEN 1 ELSE 0 END) AS p, COUNT(*) AS t
                          FROM attendance_records r
                         WHERE r.session_id IN (SELECT id FROM attendance_sessions WHERE base_id = ?1 AND deleted_at IS NULL AND session_date BETWEEN ?2 AND ?3)
                         GROUP BY r.session_id) a ON a.session_id = s.id
            WHERE s.base_id = ?1 AND s.deleted_at IS NULL AND s.session_date BETWEEN ?2 AND ?3
            GROUP BY s.class_id) x ON x.class_id = c.id
        WHERE c.base_id = ?1 ORDER BY c.name COLLATE NOCASE`, base, `${y}-01-01`, `${y}-12-31`),
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
