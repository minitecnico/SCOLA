import { clearFailures, requireAdmin, ROLES, type Ctx, type Role } from '../auth';
import { all, fail, first, now, run, stmt, uid } from '../db';

/**
 * Solicitações de acesso (fila no painel do administrador):
 *  - cadastro: pessoa nova pedindo para entrar; ao aprovar, a conta nasce com a senha que ela escolheu;
 *  - senha: "esqueci minha senha"; ao aprovar, a senha que ela escolheu passa a valer (confirme que é ela!).
 * Pedidos de senha também podem ser decididos pela coordenação da escola da pessoa.
 */
type Req = {
  id: string; kind: 'cadastro' | 'senha'; status: string; full_name: string | null; email: string; phone: string | null; institution: string | null;
  role: string | null; city: string | null; note: string | null; password_hash: string; match_base_id: string | null; match_score: number | null;
  user_id: string | null; created_at: string;
};

export async function listAccessRequests(ctx: Ctx, status: 'pendente' | 'aprovado' | 'recusado' = 'pendente') {
  requireAdmin(ctx);
  const rows = await all<Record<string, unknown>>(ctx.db,
    `SELECT r.id, r.kind, r.status, r.full_name, r.email, r.phone, r.institution, r.role, r.city, r.note, r.match_base_id, r.match_score, r.user_id,
            r.device, r.created_at, r.decided_at, r.decision_note, b.name AS match_name,
            (SELECT json_group_array(json_object('base_name', bb.name, 'role', m.role)) FROM memberships m JOIN bases bb ON bb.id = m.base_id WHERE m.user_id = r.user_id) AS memberships,
            (SELECT last_login_at FROM users u WHERE u.id = r.user_id) AS last_login_at
       FROM access_requests r LEFT JOIN bases b ON b.id = r.match_base_id
      WHERE r.status = ? ORDER BY ${status === 'pendente' ? 'r.created_at ASC' : 'r.decided_at DESC'} LIMIT 200`, status);
  return rows.map((r) => ({ ...r, memberships: JSON.parse(String(r.memberships || '[]')) as { base_name: string; role: string }[] }));
}

/** Quantos pedidos esperam resposta (selo do menu). */
export async function countAccessRequests(ctx: Ctx) {
  requireAdmin(ctx);
  const r = await first<{ cadastros: number; senhas: number }>(ctx.db, "SELECT COALESCE(SUM(kind = 'cadastro'), 0) AS cadastros, COALESCE(SUM(kind = 'senha'), 0) AS senhas FROM access_requests WHERE status = 'pendente'");
  return { cadastros: r?.cadastros ?? 0, senhas: r?.senhas ?? 0 };
}

/** Coordenação: pedidos de nova senha de quem é da sua escola (professores e secretaria; a coordenação pede ao administrador). */
export async function listPasswordRequests(ctx: Ctx) {
  if (ctx.role !== 'gestor' && ctx.role !== 'superadmin') return [];
  if (!ctx.baseId) return [];
  return all<{ id: string; full_name: string | null; email: string; phone: string | null; role: string; device: string | null; created_at: string; last_login_at: string | null }>(ctx.db,
    `SELECT r.id, u.full_name, r.email, u.phone, m.role, r.device, r.created_at, u.last_login_at
       FROM access_requests r JOIN users u ON u.id = r.user_id JOIN memberships m ON m.user_id = u.id AND m.base_id = ?1
      WHERE r.kind = 'senha' AND r.status = 'pendente' AND m.role <> 'gestor'
        AND (SELECT COUNT(*) FROM memberships x WHERE x.user_id = u.id) = 1
      ORDER BY r.created_at`, ctx.baseId);
}

/** Pedido de senha: administrador decide qualquer um; coordenação só os da própria escola (ver listPasswordRequests). */
async function loadForDecision(ctx: Ctx, id: string): Promise<Req> {
  const r = await first<Req>(ctx.db, 'SELECT * FROM access_requests WHERE id = ?', id);
  if (!r) fail('Pedido não encontrado.', 404);
  if (r!.status !== 'pendente') fail('Este pedido já foi respondido.');
  if (ctx.isAdmin) return r!;
  if (r!.kind !== 'senha' || ctx.role !== 'gestor' || !ctx.baseId) fail('Sem permissão para esta ação.', 403);
  const ok = await first(ctx.db,
    `SELECT 1 FROM memberships m WHERE m.user_id = ? AND m.base_id = ? AND m.role <> 'gestor' AND (SELECT COUNT(*) FROM memberships x WHERE x.user_id = m.user_id) = 1`, r!.user_id, ctx.baseId);
  if (!ok) fail('Este pedido deve ser aprovado pelo administrador do SCOLA.', 403);
  return r!;
}

export async function approveAccessRequest(ctx: Ctx, id: string, input: { baseId?: string; newBase?: { name: string; city?: string; plan?: string }; role?: Role } = {}) {
  const r = await loadForDecision(ctx, id);
  const t = now();
  const done = stmt(ctx.db, "UPDATE access_requests SET status = 'aprovado', decided_at = ?, decided_by = ? WHERE id = ?", t, ctx.user.id, id);

  if (r.kind === 'senha') {
    await ctx.db.batch([
      stmt(ctx.db, 'UPDATE users SET password_hash = ?, must_change_pw = 0 WHERE id = ?', r.password_hash, r.user_id),
      stmt(ctx.db, 'DELETE FROM sessions WHERE user_id = ?', r.user_id),
      stmt(ctx.db, "UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL", t, r.user_id),
      done,
    ]);
    await clearFailures(ctx.db, r.email.toLowerCase());
    return { kind: 'senha', email: r.email };
  }

  // Cadastro: escola existente (reconhecida ou escolhida) ou instituição nova.
  let baseId = input.baseId || r.match_base_id || null;
  let role = (input.role ?? r.role ?? 'professor') as Role;
  const batch = [];
  if (input.newBase) {
    const name = String(input.newBase.name || '').trim();
    if (!name) fail('Informe o nome da nova escola.');
    baseId = uid();
    role = 'gestor'; // quem abre a escola é a coordenação dela
    batch.push(stmt(ctx.db, 'INSERT INTO bases (id, name, city, plan) VALUES (?, ?, ?, ?)', baseId, name, String(input.newBase.city || r.city || '').trim() || null, input.newBase.plan === 'ativo' ? 'ativo' : 'teste'));
  } else {
    if (!baseId) fail('Escolha a escola da pessoa ou crie uma nova.');
    if (!(await first(ctx.db, 'SELECT id FROM bases WHERE id = ?', baseId))) fail('Escola não encontrada.', 404);
  }
  if (!ROLES.includes(role)) fail('Função inválida.');

  let userId = (await first<{ id: string; is_admin: number }>(ctx.db, 'SELECT id, is_admin FROM users WHERE email = ?', r.email));
  if (userId?.is_admin) fail('Este e-mail é do administrador do sistema.');
  if (userId) {
    // Já tem conta: só vincula à escola (a senha atual continua a mesma).
    batch.push(stmt(ctx.db, "UPDATE users SET phone = COALESCE(NULLIF(phone, ''), ?), full_name = COALESCE(NULLIF(full_name, ''), ?) WHERE id = ?", r.phone, r.full_name, userId.id));
  } else {
    const newId = uid();
    userId = { id: newId, is_admin: 0 };
    batch.push(stmt(ctx.db, 'INSERT INTO users (id, email, password_hash, full_name, phone, must_change_pw, active_base_id) VALUES (?, ?, ?, ?, ?, 0, ?)', newId, r.email.toLowerCase(), r.password_hash, r.full_name, r.phone, baseId));
  }
  batch.push(
    stmt(ctx.db, 'INSERT INTO memberships (id, user_id, base_id, role) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, base_id) DO UPDATE SET role = excluded.role', uid(), userId.id, baseId, role),
    stmt(ctx.db, 'UPDATE access_requests SET user_id = ? WHERE id = ?', userId.id, id),
    done,
  );
  await ctx.db.batch(batch);
  return { kind: 'cadastro', email: r.email };
}

export async function rejectAccessRequest(ctx: Ctx, id: string, note?: string) {
  await loadForDecision(ctx, id);
  await run(ctx.db, "UPDATE access_requests SET status = 'recusado', decided_at = ?, decided_by = ?, decision_note = ? WHERE id = ?", now(), ctx.user.id, String(note || '').trim().slice(0, 300) || null, id);
}
