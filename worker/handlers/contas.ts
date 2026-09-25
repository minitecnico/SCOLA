import {
  hashPassword, iterationsFor, requireAdmin, tempPassword, validatePassword, verifyPassword,
  type Ctx, type Role,
} from '../auth';
import { all, fail, first, run, stmt, uid } from '../db';

const ROLES: Role[] = ['gestor', 'professor', 'secretaria'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normEmail = (e: string) => String(e || '').trim().toLowerCase();

/* ------------------------------------ Perfil ------------------------------------- */
export async function getProfile(ctx: Ctx) {
  const u = ctx.user;
  return { id: u.id, full_name: u.full_name, email: u.email, avatar_url: u.avatar_url, phone: u.phone, is_superadmin: !!u.is_admin, active_org_id: ctx.baseId };
}

export async function updateProfile(ctx: Ctx, input: { full_name?: string; avatar_url?: string | null; phone?: string | null }) {
  const name = String(input.full_name ?? ctx.user.full_name ?? '').trim();
  if (!name) fail('Informe seu nome.');
  if (input.avatar_url && input.avatar_url.length > 400_000) fail('Foto grande demais.');
  await run(ctx.db, 'UPDATE users SET full_name = ?, avatar_url = ?, phone = ? WHERE id = ?',
    name, input.avatar_url ?? null, input.phone === undefined ? ctx.user.phone : input.phone, ctx.user.id);
  return getProfile({ ...ctx, user: { ...ctx.user, full_name: name, avatar_url: input.avatar_url ?? null } });
}

export async function changePassword(ctx: Ctx, current: string, next: string) {
  validatePassword(next);
  // Na troca obrigatória do primeiro acesso, a senha atual é a provisória (já digitada no login).
  if (!ctx.user.must_change_pw || current) {
    if (!(await verifyPassword(String(current || ''), ctx.user.password_hash))) fail('Senha atual incorreta.');
  }
  await run(ctx.db, 'UPDATE users SET password_hash = ?, must_change_pw = 0 WHERE id = ?',
    await hashPassword(next, iterationsFor(ctx.env)), ctx.user.id);
}

/** Troca a base ativa (usuário com mais de uma base, ou o administrador dando suporte). */
export async function setActiveOrg(ctx: Ctx, baseId: string | null) {
  if (baseId) {
    if (ctx.isAdmin) {
      if (!(await first(ctx.db, 'SELECT id FROM bases WHERE id = ?', baseId))) fail('Base não encontrada.', 404);
    } else if (!(await first(ctx.db, 'SELECT id FROM memberships WHERE user_id = ? AND base_id = ?', ctx.user.id, baseId))) {
      fail('Você não pertence a esta base.', 403);
    }
  }
  await run(ctx.db, 'UPDATE users SET active_base_id = ? WHERE id = ?', baseId, ctx.user.id);
}

/* ------------------------- Equipe (gestor da base ou admin) ----------------------- */
function assertCanManage(ctx: Ctx, baseId: string) {
  if (ctx.isAdmin) return;
  if (ctx.baseId !== baseId || ctx.role !== 'gestor') fail('Apenas o gestor da base gerencia a equipe.', 403);
}

export async function listOrgMembers(ctx: Ctx, baseId: string) {
  assertCanManage(ctx, baseId);
  return all(ctx.db,
    `SELECT u.id AS user_id, m.role, u.full_name, u.email, u.phone, u.last_login_at, u.must_change_pw
       FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.base_id = ? ORDER BY m.role, u.full_name COLLATE NOCASE`, baseId);
}

/**
 * Adiciona alguém à base. Se o e-mail ainda não tem conta, cria com senha provisória
 * (devolvida UMA vez para você repassar). Se já tem, só vincula (ex.: professor em 2 escolas).
 */
export async function addMember(ctx: Ctx, baseId: string, input: { email: string; full_name?: string; role: Role }) {
  assertCanManage(ctx, baseId);
  const email = normEmail(input.email);
  if (!EMAIL_RE.test(email)) fail('E-mail inválido.');
  if (!ROLES.includes(input.role)) fail('Papel inválido.');
  if (!(await first(ctx.db, 'SELECT id FROM bases WHERE id = ?', baseId))) fail('Base não encontrada.', 404);

  let user = await first<{ id: string; is_admin: number }>(ctx.db, 'SELECT id, is_admin FROM users WHERE email = ?', email);
  let password: string | null = null;
  if (!user) {
    const name = String(input.full_name || '').trim();
    if (!name) fail('Informe o nome da pessoa.');
    password = tempPassword();
    const id = uid();
    await run(ctx.db, 'INSERT INTO users (id, email, password_hash, full_name, must_change_pw, active_base_id) VALUES (?, ?, ?, ?, 1, ?)',
      id, email, await hashPassword(password, iterationsFor(ctx.env)), name, baseId);
    user = { id, is_admin: 0 };
  }
  if (user.is_admin) fail('Esse e-mail é do administrador do sistema.');
  await run(ctx.db,
    `INSERT INTO memberships (id, user_id, base_id, role) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, base_id) DO UPDATE SET role = excluded.role`, uid(), user.id, baseId, input.role);
  return { userId: user.id, email, password };
}

export async function setMemberRole(ctx: Ctx, baseId: string, userId: string, role: Role) {
  assertCanManage(ctx, baseId);
  if (!ROLES.includes(role)) fail('Papel inválido.');
  if (userId === ctx.user.id && role !== 'gestor' && !ctx.isAdmin) fail('Você não pode tirar o seu próprio papel de gestor.');
  await run(ctx.db, 'UPDATE memberships SET role = ? WHERE user_id = ? AND base_id = ?', role, userId, baseId);
}

export async function removeMember(ctx: Ctx, baseId: string, userId: string) {
  assertCanManage(ctx, baseId);
  if (userId === ctx.user.id) fail('Você não pode remover a si mesmo.');
  await ctx.db.batch([
    stmt(ctx.db, 'DELETE FROM memberships WHERE user_id = ? AND base_id = ?', userId, baseId),
    stmt(ctx.db, 'UPDATE users SET active_base_id = NULL WHERE id = ? AND active_base_id = ?', userId, baseId),
    stmt(ctx.db, 'DELETE FROM sessions WHERE user_id = ? AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = ?)', userId, userId),
  ]);
}

/** Gera senha provisória nova e derruba as sessões da pessoa. Devolve a senha para repassar. */
export async function resetMemberPassword(ctx: Ctx, baseId: string, userId: string) {
  assertCanManage(ctx, baseId);
  const m = await first(ctx.db, 'SELECT id FROM memberships WHERE user_id = ? AND base_id = ?', userId, baseId);
  if (!m) fail('Pessoa não pertence a esta base.', 404);
  const target = await first<{ is_admin: number }>(ctx.db, 'SELECT is_admin FROM users WHERE id = ?', userId);
  if (target?.is_admin) fail('Não é possível redefinir a senha do administrador.');
  const password = tempPassword();
  await ctx.db.batch([
    stmt(ctx.db, 'UPDATE users SET password_hash = ?, must_change_pw = 1 WHERE id = ?', await hashPassword(password, iterationsFor(ctx.env)), userId),
    stmt(ctx.db, 'DELETE FROM sessions WHERE user_id = ?', userId),
  ]);
  return { password };
}

/* ----------------------------- Administrador (você) ------------------------------ */
export async function listOrgAdmin(ctx: Ctx) {
  requireAdmin(ctx);
  const rows = await all<Record<string, unknown>>(ctx.db,
    `SELECT b.*,
            (SELECT COUNT(*) FROM students s WHERE s.base_id = b.id AND s.active = 1) AS students,
            (SELECT COUNT(*) FROM classes c WHERE c.base_id = b.id) AS classes,
            (SELECT COUNT(*) FROM memberships m WHERE m.base_id = b.id) AS members,
            (SELECT MAX(a.session_date) FROM attendance_sessions a WHERE a.base_id = b.id AND a.deleted_at IS NULL) AS last_attendance,
            (SELECT MAX(u.last_login_at) FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.base_id = b.id) AS last_login
       FROM bases b ORDER BY b.name COLLATE NOCASE`);
  return rows.map((r) => ({ ...r, active: !!r.active, logo_url: undefined, has_logo: !!r.logo_url }));
}

export async function hqStats(ctx: Ctx) {
  requireAdmin(ctx);
  const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  return first(ctx.db,
    `SELECT (SELECT COUNT(*) FROM bases) AS bases,
            (SELECT COUNT(*) FROM bases WHERE active = 1) AS bases_active,
            (SELECT COUNT(*) FROM students WHERE active = 1) AS students,
            (SELECT COUNT(*) FROM users WHERE is_admin = 0) AS users,
            (SELECT COUNT(*) FROM attendance_sessions WHERE deleted_at IS NULL AND session_date >= ?) AS sessions_30d`, since);
}

/** Cria uma base nova já com o gestor responsável. Devolve a senha provisória do gestor (se a conta for nova). */
export async function createBase(ctx: Ctx, input: {
  name: string; city?: string; plan?: string; max_students?: number | null; subject?: string;
  manager_name: string; manager_email: string;
}) {
  requireAdmin(ctx);
  const name = String(input.name || '').trim();
  if (!name) fail('Informe o nome da base (escola ou professor).');
  const id = uid();
  await run(ctx.db, 'INSERT INTO bases (id, name, city, plan, max_students, subject) VALUES (?, ?, ?, ?, ?, ?)',
    id, name, input.city || null, input.plan || 'ativo', input.max_students || null, (input.subject || '').trim() || null);
  try {
    const gestor = await addMember(ctx, id, { email: input.manager_email, full_name: input.manager_name, role: 'gestor' });
    return { id, ...gestor };
  } catch (e) {
    await run(ctx.db, 'DELETE FROM bases WHERE id = ?', id);
    throw e;
  }
}

export async function updateOrganization(ctx: Ctx, id: string, input: {
  name?: string; cnpj?: string | null; plan?: string; max_students?: number | null; notes?: string | null; city?: string | null;
}) {
  requireAdmin(ctx);
  const cur = await first<Record<string, unknown>>(ctx.db, 'SELECT * FROM bases WHERE id = ?', id);
  if (!cur) fail('Base não encontrada.', 404);
  const n = { ...cur, ...input };
  if (!String(n.name || '').trim()) fail('Informe o nome.');
  await run(ctx.db, 'UPDATE bases SET name = ?, cnpj = ?, plan = ?, max_students = ?, notes = ?, city = ? WHERE id = ?',
    String(n.name).trim(), (n.cnpj as string) || null, (n.plan as string) || 'ativo', (n.max_students as number) || null,
    (n.notes as string) || null, (n.city as string) || null, id);
}

export async function setOrgActive(ctx: Ctx, id: string, active: boolean) {
  requireAdmin(ctx);
  await run(ctx.db, 'UPDATE bases SET active = ? WHERE id = ?', active, id);
}

/** Exclui a base e TODOS os dados dela. Usuários sem outra base são removidos.
 *  Os anexos vão para a fila kv_trash e são apagados do KV pela rotina diária (limite de subrequests). */
export async function deleteOrganization(ctx: Ctx, id: string) {
  requireAdmin(ctx);
  const orphans = await all<{ user_id: string }>(ctx.db,
    `SELECT m.user_id FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.base_id = ? AND u.is_admin = 0 AND NOT EXISTS (SELECT 1 FROM memberships o WHERE o.user_id = m.user_id AND o.base_id <> ?)`, id, id);
  await ctx.db.batch([
    stmt(ctx.db, 'INSERT OR IGNORE INTO kv_trash (id) SELECT id FROM files WHERE base_id = ? UNION SELECT id FROM plan_docs WHERE base_id = ?', id, id),
    stmt(ctx.db, 'UPDATE users SET active_base_id = NULL WHERE active_base_id = ?', id),
    stmt(ctx.db, 'DELETE FROM bases WHERE id = ?', id),
    ...orphans.map((o) => stmt(ctx.db, 'DELETE FROM users WHERE id = ?', o.user_id)),
  ]);
}
