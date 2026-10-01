import type { Ctx } from '../auth';
import { first } from '../db';
import { googleConfigured, revokeAndForget } from '../google';

/** Situação da integração para o usuário logado (a tela decide se mostra "Conectar Google"). */
export async function getGoogleStatus(ctx: Ctx) {
  const acc = await first<{ google_email: string; connected_at: string }>(ctx.db, 'SELECT google_email, connected_at FROM google_accounts WHERE user_id = ?', ctx.user.id);
  return { available: googleConfigured(ctx.env), connected: !!acc, email: acc?.google_email ?? null, connected_at: acc?.connected_at ?? null };
}

export async function disconnectGoogle(ctx: Ctx) {
  await revokeAndForget(ctx.env, ctx.user.id);
  return { ok: true };
}
