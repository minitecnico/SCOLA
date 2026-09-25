import { requireAdmin, type Ctx } from '../auth';
import { all, first } from '../db';

/** Central de logs — só o administrador da plataforma. */
export interface LogFilters {
  period?: '24h' | '7d' | '30d' | '90d' | 'all';
  baseId?: string | null;
  category?: string | null;
  status?: 'ok' | 'erro' | 'negado' | 'problemas' | null;
  q?: string | null;
  before?: number | null; // paginação: id do último item carregado
}

const PERIOD_MS: Record<string, number> = { '24h': 86400_000, '7d': 7 * 86400_000, '30d': 30 * 86400_000, '90d': 90 * 86400_000 };
const since = (ms: number) => new Date(Date.now() - ms).toISOString();
const LOGIN_EVENTS = "('login_falhou','login_bloqueado')";

export async function listLogs(ctx: Ctx, f: LogFilters = {}, limit = 60) {
  requireAdmin(ctx);
  const where: string[] = [];
  const params: (string | number)[] = [];
  const period = f.period ?? '7d';
  if (PERIOD_MS[period]) {
    where.push('at >= ?');
    params.push(since(PERIOD_MS[period]));
  }
  if (f.baseId) {
    where.push('base_id = ?');
    params.push(f.baseId);
  }
  if (f.category) {
    where.push('category = ?');
    params.push(f.category);
  }
  if (f.status === 'problemas') where.push("status <> 'ok'");
  else if (f.status) {
    where.push('status = ?');
    params.push(f.status);
  }
  const q = String(f.q ?? '').trim();
  if (q) {
    where.push('(user_email LIKE ? OR summary LIKE ? OR target LIKE ? OR base_name LIKE ? OR ip LIKE ? OR detail LIKE ?)');
    const like = `%${q.replace(/[%_]/g, '')}%`;
    params.push(like, like, like, like, like, like);
  }
  if (f.before) {
    where.push('id < ?');
    params.push(Number(f.before));
  }
  const size = Math.min(200, Math.max(10, Number(limit) || 60));
  const rows = await all<Record<string, unknown> & { id: number }>(ctx.db,
    `SELECT id, at, base_id, base_name, user_email, role, action, category, summary, target, status, detail, ip, device
       FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY id DESC LIMIT ${size + 1}`,
    ...params);
  const more = rows.length > size;
  const page = more ? rows.slice(0, size) : rows;
  return { rows: page, next: more ? page[page.length - 1].id : null };
}

export async function logOverview(ctx: Ctx) {
  requireAdmin(ctx);
  const d1 = since(86400_000);
  const d7 = since(7 * 86400_000);
  const [counts, suspicious, bases] = await Promise.all([
    first<{ logins: number; failed: number; errors: number; denied: number; actions: number; users7d: number }>(ctx.db,
      `SELECT
         SUM(CASE WHEN action = 'login' AND at >= ?1 THEN 1 ELSE 0 END) AS logins,
         SUM(CASE WHEN action IN ${LOGIN_EVENTS} AND at >= ?1 THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN status = 'erro' AND at >= ?1 THEN 1 ELSE 0 END) AS errors,
         SUM(CASE WHEN status = 'negado' AND action NOT IN ${LOGIN_EVENTS} AND at >= ?1 THEN 1 ELSE 0 END) AS denied,
         SUM(CASE WHEN at >= ?1 AND action NOT IN ('login','logout') THEN 1 ELSE 0 END) AS actions,
         COUNT(DISTINCT CASE WHEN at >= ?2 THEN user_id END) AS users7d
       FROM audit_log WHERE at >= ?2`,
      d1, d7),
    // Possível ataque ou usuário perdido: muitas falhas de login no mesmo e-mail em 24h.
    all<{ user_email: string; n: number; ips: string; last: string; exists_user: number }>(ctx.db,
      `SELECT a.user_email, COUNT(*) AS n, GROUP_CONCAT(DISTINCT a.ip) AS ips, MAX(a.at) AS last,
              EXISTS (SELECT 1 FROM users u WHERE u.email = a.user_email) AS exists_user
         FROM audit_log a
        WHERE a.action IN ${LOGIN_EVENTS} AND a.at >= ?
        GROUP BY a.user_email HAVING COUNT(*) >= 3
        ORDER BY n DESC LIMIT 6`,
      d1),
    // Última atividade de cada base: base parada é cliente em risco de cancelar.
    all<{ id: string; name: string; active: number; last: string | null; actions7d: number }>(ctx.db,
      `SELECT b.id, b.name, b.active,
              NULLIF(MAX(
                COALESCE((SELECT MAX(at) FROM audit_log a WHERE a.base_id = b.id AND COALESCE(a.role, '') <> 'admin' AND a.status = 'ok'), ''),
                COALESCE((SELECT MAX(u.last_login_at) FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.base_id = b.id AND u.is_admin = 0), '')
              ), '') AS last,
              (SELECT COUNT(*) FROM audit_log a WHERE a.base_id = b.id AND COALESCE(a.role, '') <> 'admin' AND a.status = 'ok' AND a.at >= ?) AS actions7d
         FROM bases b ORDER BY b.name COLLATE NOCASE`,
      d7),
  ]);
  return {
    logins24h: counts?.logins ?? 0,
    failed24h: counts?.failed ?? 0,
    errors24h: counts?.errors ?? 0,
    denied24h: counts?.denied ?? 0,
    actions24h: counts?.actions ?? 0,
    users7d: counts?.users7d ?? 0,
    suspicious: suspicious.map((s) => ({ ...s, exists_user: !!s.exists_user })),
    bases: bases.map((b) => ({ ...b, active: !!b.active })),
  };
}
