import { requireAdmin, type Ctx } from '../auth';
import { ACTIONS } from '../audit';
import { all, first } from '../db';

/**
 * Métricas da plataforma (só o administrador). Tudo vem do log de auditoria e de poucas contagens,
 * em consultas agregadas (D1 grátis: poucas leituras). O resultado fica 10 min no KV, por período.
 * Dias no fuso de Brasília (UTC−3). Ações do próprio administrador não contam como uso.
 */
const TZ = "'-3 hours'";
const NOT_ADMIN = "COALESCE(role, '') <> 'admin'";
const LOGIN_FAIL = "('login_falhou','login_bloqueado')";
const NOISE = "('login','logout','login_falhou','login_bloqueado')";
const TTL = 600;
const DAY = 86400_000;

export async function adminMetrics(ctx: Ctx, days = 30, fresh = false) {
  requireAdmin(ctx);
  const range = [7, 30, 90].includes(Number(days)) ? Number(days) : 30;
  const key = `metrics:${range}`;
  if (!fresh) {
    const hit = await ctx.env.FILES.get(key, 'json').catch(() => null);
    if (hit) return hit;
  }
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const local = (ms: number) => iso(ms - 3 * 3600_000).slice(0, 10);
  const cur = iso(now - range * DAY);
  const prev = iso(now - 2 * range * DAY);
  const oldest = iso(now - Math.max(2 * range, 30) * DAY);
  const db = ctx.db;

  const [daily, uniq, mix, heat, devices, users, bases, sessions, schools, engines, totals] = await Promise.all([
    all<{ d: string; actions: number; logins: number; problems: number; failed: number; dau: number }>(db,
      `SELECT date(at, ${TZ}) AS d,
              SUM(CASE WHEN action NOT IN ${NOISE} AND status = 'ok' AND ${NOT_ADMIN} THEN 1 ELSE 0 END) AS actions,
              SUM(CASE WHEN action = 'login' AND ${NOT_ADMIN} THEN 1 ELSE 0 END) AS logins,
              SUM(CASE WHEN status <> 'ok' AND action NOT IN ${LOGIN_FAIL} AND ${NOT_ADMIN} THEN 1 ELSE 0 END) AS problems,
              SUM(CASE WHEN action IN ${LOGIN_FAIL} THEN 1 ELSE 0 END) AS failed,
              COUNT(DISTINCT CASE WHEN ${NOT_ADMIN} THEN user_id END) AS dau
         FROM audit_log WHERE at >= ? GROUP BY d ORDER BY d`, prev),
    first<{ dau: number; wau: number; mau: number; cur: number; prev: number }>(db,
      `SELECT COUNT(DISTINCT CASE WHEN at >= ?1 THEN user_id END) AS dau,
              COUNT(DISTINCT CASE WHEN at >= ?2 THEN user_id END) AS wau,
              COUNT(DISTINCT CASE WHEN at >= ?3 THEN user_id END) AS mau,
              COUNT(DISTINCT CASE WHEN at >= ?4 THEN user_id END) AS cur,
              COUNT(DISTINCT CASE WHEN at >= ?5 AND at < ?4 THEN user_id END) AS prev
         FROM audit_log WHERE at >= ?6 AND user_id IS NOT NULL AND status = 'ok' AND ${NOT_ADMIN}`,
      iso(now - DAY), iso(now - 7 * DAY), iso(now - 30 * DAY), cur, prev, oldest),
    all<{ category: string; action: string; n: number; bad: number }>(db,
      `SELECT category, action, COUNT(*) AS n, SUM(CASE WHEN status <> 'ok' THEN 1 ELSE 0 END) AS bad
         FROM audit_log WHERE at >= ? AND action NOT IN ${NOISE} AND ${NOT_ADMIN} GROUP BY category, action`, cur),
    all<{ w: number; h: number; n: number }>(db,
      `SELECT CAST(strftime('%w', at, ${TZ}) AS INTEGER) AS w, CAST(strftime('%H', at, ${TZ}) AS INTEGER) AS h, COUNT(*) AS n
         FROM audit_log WHERE at >= ? AND status = 'ok' AND action <> 'logout' AND ${NOT_ADMIN} GROUP BY w, h`, cur),
    all<{ device: string | null; role: string | null; u: number }>(db,
      `SELECT device, role, COUNT(DISTINCT user_id) AS u FROM audit_log
        WHERE at >= ? AND user_id IS NOT NULL AND status = 'ok' AND ${NOT_ADMIN} GROUP BY device, role`, cur),
    all<{ m: string; n: number }>(db, `SELECT substr(created_at, 1, 7) AS m, COUNT(*) AS n FROM users WHERE is_admin = 0 GROUP BY m ORDER BY m`),
    all<{ m: string; n: number }>(db, `SELECT substr(created_at, 1, 7) AS m, COUNT(*) AS n FROM bases GROUP BY m ORDER BY m`),
    all<{ d: string; n: number }>(db,
      `SELECT session_date AS d, COUNT(*) AS n FROM attendance_sessions WHERE deleted_at IS NULL AND session_date >= ? AND session_date <= ? GROUP BY d`,
      prev.slice(0, 10), local(now)),
    all<{ id: string; name: string; plan: string; active: number; max_students: number | null; students: number; created_at: string; d: string | null; n: number | null; u: number | null }>(db,
      `SELECT b.id, b.name, b.plan, b.active, b.max_students, b.created_at, COALESCE(s.n, 0) AS students, a.d, a.n, a.u
         FROM bases b
         LEFT JOIN (SELECT base_id, COUNT(*) AS n FROM students WHERE active = 1 GROUP BY base_id) s ON s.base_id = b.id
         LEFT JOIN (SELECT base_id, date(at, ${TZ}) AS d, COUNT(*) AS n, COUNT(DISTINCT user_id) AS u FROM audit_log
                     WHERE at >= ? AND base_id IS NOT NULL AND status = 'ok' AND action NOT IN ('logout') AND ${NOT_ADMIN} GROUP BY base_id, d) a ON a.base_id = b.id`,
      iso(now - 14 * DAY)),
    all<{ engine_id: string; ok: number; fail: number; ewma_ms: number | null }>(db, `SELECT engine_id, ok, fail, ewma_ms FROM ai_engine_stats ORDER BY ok + fail DESC LIMIT 8`).catch(() => []),
    first<{ users: number; bases: number; students: number }>(db,
      `SELECT (SELECT COUNT(*) FROM users WHERE is_admin = 0) AS users, (SELECT COUNT(*) FROM bases WHERE active = 1) AS bases,
              (SELECT COUNT(*) FROM students WHERE active = 1) AS students`),
  ]);

  // Escolas: junta as linhas (base × dia) numa linha por escola.
  const byBase = new Map<string, { id: string; name: string; plan: string; active: boolean; max: number | null; students: number; created: string; days: Record<string, { n: number; u: number }> }>();
  for (const r of schools) {
    const s = byBase.get(r.id) ?? { id: r.id, name: r.name, plan: r.plan, active: !!r.active, max: r.max_students, students: r.students, created: r.created_at, days: {} };
    if (r.d) s.days[r.d] = { n: r.n ?? 0, u: r.u ?? 0 };
    byBase.set(r.id, s);
  }

  const result = {
    generatedAt: iso(now),
    range,
    today: local(now),
    daily,
    users: uniq ?? { dau: 0, wau: 0, mau: 0, cur: 0, prev: 0 },
    mix: mix.map((m) => ({ ...m, label: (() => { const s = ACTIONS[m.action]; return typeof s?.label === 'string' ? s.label : m.action; })() })),
    heat,
    devices,
    growth: { users, bases },
    sessions,
    schools: [...byBase.values()],
    engines,
    totals: totals ?? { users: 0, bases: 0, students: 0 },
  };
  await ctx.env.FILES.put(key, JSON.stringify(result), { expirationTtl: TTL }).catch(() => null);
  return result;
}
