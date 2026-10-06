import { issueLink, NO_PASSWORD } from '../access';
import { requireAdmin, type Ctx } from '../auth';
import { fail, first } from '../db';

/** Situação do acesso da própria conta (a tela de Segurança usa para saber se já existe senha). */
export async function getSecurityStatus(ctx: Ctx) {
  return { hasPassword: ctx.user.password_hash !== NO_PASSWORD };
}

/**
 * Administrador: gera um link de acesso para qualquer pessoa.
 * Quem ainda não criou a senha recebe o convite; quem já tem recebe um link de redefinição (24 h).
 */
export async function generateAccessLink(ctx: Ctx, userId: string) {
  requireAdmin(ctx);
  const u = await first<{ email: string; full_name: string | null; is_admin: number; password_hash: string }>(ctx.db, 'SELECT email, full_name, is_admin, password_hash FROM users WHERE id = ?', userId);
  if (!u) fail('Usuário não encontrado.', 404);
  if (u!.is_admin && userId !== ctx.user.id) fail('Não é possível gerar link para o administrador.');
  const m = await first<{ base_id: string; name: string }>(ctx.db, 'SELECT m.base_id, b.name FROM memberships m JOIN bases b ON b.id = m.base_id WHERE m.user_id = ? ORDER BY b.name LIMIT 1', userId);
  const kind = u!.password_hash === NO_PASSWORD && m ? 'invite' : 'reset';
  const link = await issueLink(ctx.env, { userId, kind, baseId: kind === 'invite' ? m!.base_id : null, origin: ctx.origin ?? '' });
  return { url: link.url, kind, email: u!.email, name: u!.full_name, baseName: m?.name ?? null };
}
