import { hashPassword, iterationsFor, requireAdmin, tempPassword, validatePassword, type Ctx, type Role } from '../auth';
import { all, fail, first, run, stmt, uid } from '../db';

/**
 * Usuários da plataforma (só o administrador): todas as contas, de todas as bases.
 * Edita dados de login, senha, bloqueio, sessões, vínculos com bases e exclusão.
 */
const ROLES: Role[] = ['gestor', 'professor', 'secretaria'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normEmail = (e: string) => String(e || '').trim().toLowerCase();

type UserRow = { id: string; email: string; full_name: string | null; is_admin: number; disabled: number };

async function target(ctx: Ctx, userId: string) {
  const u = await first<UserRow>(ctx.db, 'SELECT id, email, full_name, is_admin, disabled FROM users WHERE id = ?', userId);
  if (!u) fail('Usuário não encontrado.', 404);
  return u!;
}

export async function listUsersAdmin(ctx: Ctx) {
  requireAdmin(ctx);
  const rows = await all<Record<string, unknown> & { bases: string }>(ctx.db,
    `SELECT u.id, u.email, u.full_name, u.phone, u.is_admin, u.disabled, u.must_change_pw, u.created_at, u.last_login_at,
            (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS sessions,
            (SELECT json_group_array(json_object('base_id', b.id, 'base_name', b.name, 'role', m.role, 'active', b.active))
               FROM memberships m JOIN bases b ON b.id = m.base_id WHERE m.user_id = u.id) AS bases
       FROM users u ORDER BY u.is_admin DESC, u.full_name COLLATE NOCASE`, new Date().toISOString());
  return rows.map((r) => ({
    ...r,
    is_admin: !!r.is_admin,
    disabled: !!r.disabled,
    must_change_pw: !!r.must_change_pw,
    bases: (JSON.parse(r.bases || '[]') as { base_id: string | null }[]).filter((b) => b.base_id),
  }));
}

/** Nome, e-mail (login) e telefone. Vale também para a sua própria conta. */
export async function updateUserAdmin(ctx: Ctx, userId: string, input: { full_name?: string; email?: string; phone?: string | null }) {
  requireAdmin(ctx);
  const u = await target(ctx, userId);
  const name = String(input.full_name ?? u.full_name ?? '').trim();
  if (!name) fail('Informe o nome.');
  const email = normEmail(input.email ?? u.email);
  if (!EMAIL_RE.test(email)) fail('E-mail inválido.');
  if (email !== u.email.toLowerCase()) {
    const dup = await first<{ full_name: string | null }>(ctx.db, 'SELECT full_name FROM users WHERE email = ? AND id <> ?', email, userId);
    if (dup) fail(`Esse e-mail já é usado por ${dup.full_name || 'outra conta'}.`);
  }
  const phone = input.phone === undefined ? undefined : String(input.phone || '').trim() || null;
  await run(ctx.db,
    `UPDATE users SET full_name = ?, email = ?${phone === undefined ? '' : ', phone = ?'} WHERE id = ?`,
    ...(phone === undefined ? [name, email, userId] : [name, email, phone, userId]));
  // Tentativas de login erradas no e-mail antigo não travam o novo.
  await run(ctx.db, 'DELETE FROM login_failures WHERE email = ?', email);
  return { id: userId, email, full_name: name };
}

/**
 * Senha: sem `password`, gera uma provisória. `mustChange` = a pessoa troca no próximo acesso.
 * Derruba as sessões abertas da pessoa (exceto a sua, se for você).
 */
export async function setUserPasswordAdmin(ctx: Ctx, userId: string, password?: string | null, mustChange = true) {
  requireAdmin(ctx);
  const u = await target(ctx, userId);
  const pw = password ? String(password) : tempPassword();
  if (password) validatePassword(pw);
  const self = u.id === ctx.user.id;
  await ctx.db.batch([
    stmt(ctx.db, 'UPDATE users SET password_hash = ?, must_change_pw = ? WHERE id = ?', await hashPassword(pw, iterationsFor(ctx.env)), self ? 0 : mustChange ? 1 : 0, userId),
    stmt(ctx.db, 'DELETE FROM login_failures WHERE email = ?', u.email.toLowerCase()),
    ...(self ? [] : [stmt(ctx.db, 'DELETE FROM sessions WHERE user_id = ?', userId)]),
  ]);
  return { password: password ? null : pw, email: u.email, name: u.full_name };
}

/** Bloqueia (ou libera) o acesso. Bloqueado: não entra e é desconectado na hora. */
export async function setUserDisabled(ctx: Ctx, userId: string, disabled: boolean) {
  requireAdmin(ctx);
  const u = await target(ctx, userId);
  if (u.id === ctx.user.id || u.is_admin) fail('Não é possível bloquear o administrador.');
  await ctx.db.batch([
    stmt(ctx.db, 'UPDATE users SET disabled = ? WHERE id = ?', disabled ? 1 : 0, userId),
    ...(disabled ? [stmt(ctx.db, 'DELETE FROM sessions WHERE user_id = ?', userId)] : []),
  ]);
}

/** Desconecta a pessoa de todos os aparelhos (ela entra de novo com a mesma senha). */
export async function endUserSessions(ctx: Ctx, userId: string) {
  requireAdmin(ctx);
  const u = await target(ctx, userId);
  if (u.id === ctx.user.id) fail('Para sair da sua própria conta, use "Sair".');
  const r = await run(ctx.db, 'DELETE FROM sessions WHERE user_id = ?', userId);
  return { ended: r.meta.changes ?? 0 };
}

/** Vincula a uma base com um papel, troca o papel, ou desvincula (`role` = null). */
export async function setUserBase(ctx: Ctx, userId: string, baseId: string, role: Role | null) {
  requireAdmin(ctx);
  const u = await target(ctx, userId);
  if (u.is_admin) fail('O administrador acessa todas as bases pelo modo suporte.');
  if (!(await first(ctx.db, 'SELECT id FROM bases WHERE id = ?', baseId))) fail('Base não encontrada.', 404);
  if (role === null) {
    await ctx.db.batch([
      stmt(ctx.db, 'DELETE FROM memberships WHERE user_id = ? AND base_id = ?', userId, baseId),
      stmt(ctx.db, 'UPDATE users SET active_base_id = NULL WHERE id = ? AND active_base_id = ?', userId, baseId),
    ]);
    return;
  }
  if (!ROLES.includes(role)) fail('Papel inválido.');
  await run(ctx.db,
    `INSERT INTO memberships (id, user_id, base_id, role) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, base_id) DO UPDATE SET role = excluded.role`, uid(), userId, baseId, role);
}

/**
 * Exclui a conta de vez. Somem junto os avisos, planejamentos e mensagens que ela escreveu.
 * Chamadas, notas e provas continuam (o histórico da escola não se perde).
 */
export async function deleteUserAdmin(ctx: Ctx, userId: string) {
  requireAdmin(ctx);
  const u = await target(ctx, userId);
  if (u.id === ctx.user.id || u.is_admin) fail('Não é possível excluir o administrador.');
  // Anexos dos avisos/planejamentos dela vão para a fila de limpeza do KV (rotina diária).
  const owned = `SELECT f.id FROM files f WHERE (f.owner_type = 'notice' AND f.owner_id IN (SELECT id FROM notices WHERE author_id = ?1))
                    OR (f.owner_type = 'plan' AND f.owner_id IN (SELECT id FROM lesson_plans WHERE author_id = ?1))`;
  await ctx.db.batch([
    stmt(ctx.db, `INSERT OR IGNORE INTO kv_trash (id) ${owned} UNION SELECT id FROM plan_docs WHERE author_id = ?1`, userId),
    stmt(ctx.db, `DELETE FROM files WHERE id IN (${owned})`, userId),
    stmt(ctx.db, 'DELETE FROM users WHERE id = ?', userId),
  ]);
}
