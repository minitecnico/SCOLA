import { emailAccessLink, issueLink, NO_PASSWORD } from '../access';
import { requireAdmin, verifyPassword, type Ctx } from '../auth';
import { twoFactorAvailable } from '../authflow';
import { fail, first, run } from '../db';
import { googleLoginReady, openToken, sealToken } from '../google';
import { mailProvider, mailReady } from '../mail';
import { hashBackup, newBackupCodes, newSecret, normBackup, otpauthUrl, verifyTotp } from '../totp';

/** Segurança da conta: verificação em duas etapas (TOTP) e links de acesso gerados pelo administrador. */

export async function getSecurityStatus(ctx: Ctx) {
  const u = ctx.user;
  return {
    twoFactorAvailable: twoFactorAvailable(ctx.env),
    twoFactorEnabled: !!u.totp_enabled,
    backupLeft: u.totp_enabled ? (JSON.parse(u.totp_backup || '[]') as string[]).length : 0,
    hasPassword: u.password_hash !== NO_PASSWORD,
    googleLinked: !!u.google_sub,
  };
}

/** Passo 1: gera o segredo (ainda não vale). A pessoa lê o QR code no aplicativo e confirma com um código. */
export async function startTwoFactor(ctx: Ctx) {
  if (!twoFactorAvailable(ctx.env)) fail('A verificação em duas etapas não está disponível neste servidor.', 503);
  if (ctx.user.totp_enabled) fail('A verificação em duas etapas já está ativa.');
  const secret = newSecret();
  await run(ctx.db, 'UPDATE users SET totp_secret = ?, totp_enabled = 0, totp_backup = NULL, totp_last = NULL WHERE id = ?', await sealToken(ctx.env, secret), ctx.user.id);
  return { secret, otpauth: otpauthUrl(secret, ctx.user.email) };
}

/** Passo 2: confere o primeiro código, ativa e entrega os códigos de recuperação (aparecem só agora). */
export async function confirmTwoFactor(ctx: Ctx, code: string) {
  if (ctx.user.totp_enabled || !ctx.user.totp_secret) fail('Comece a configuração de novo.');
  const step = await verifyTotp(await openToken(ctx.env, ctx.user.totp_secret!), String(code ?? ''));
  if (step == null) fail('Código incorreto. Confira o aplicativo e tente de novo.');
  const codes = newBackupCodes();
  await run(ctx.db, 'UPDATE users SET totp_enabled = 1, totp_backup = ?, totp_last = ? WHERE id = ?', JSON.stringify(await Promise.all(codes.map(hashBackup))), step, ctx.user.id);
  return { backupCodes: codes };
}

/** Desativa. Pede a senha (quando a conta tem) e um código do aplicativo ou de recuperação. */
export async function disableTwoFactor(ctx: Ctx, input: { password?: string; code: string }) {
  const u = ctx.user;
  if (!u.totp_enabled || !u.totp_secret) return;
  if (u.password_hash !== NO_PASSWORD && !(await verifyPassword(String(input.password ?? ''), u.password_hash))) fail('Senha incorreta.');
  const code = String(input.code ?? '');
  let ok = (await verifyTotp(await openToken(ctx.env, u.totp_secret), code, u.totp_last)) != null;
  if (!ok && normBackup(code).length >= 8) ok = (JSON.parse(u.totp_backup || '[]') as string[]).includes(await hashBackup(code));
  if (!ok) fail('Código incorreto.');
  await run(ctx.db, 'UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_backup = NULL, totp_last = NULL WHERE id = ?', u.id);
}

/** Administrador: pessoa que perdeu o celular e os códigos de recuperação. */
export async function adminResetTwoFactor(ctx: Ctx, userId: string) {
  requireAdmin(ctx);
  await run(ctx.db, 'UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_backup = NULL, totp_last = NULL WHERE id = ?', userId);
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
  const m = await first<{ base_id: string; role: string; name: string }>(ctx.db, 'SELECT m.base_id, m.role, b.name FROM memberships m JOIN bases b ON b.id = m.base_id WHERE m.user_id = ? ORDER BY b.name LIMIT 1', userId);
  const pending = u!.password_hash === NO_PASSWORD;
  const kind = pending && m ? 'invite' : 'reset';
  const link = await issueLink(ctx.env, { userId, kind, baseId: kind === 'invite' ? m!.base_id : null, origin: ctx.origin ?? '', ttlMin: kind === 'reset' ? 24 * 60 : undefined });
  const emailed = await emailAccessLink(ctx.env, { to: u!.email, name: u!.full_name, url: link.url, kind, baseName: m?.name, role: m?.role });
  return { url: link.url, emailed, kind, email: u!.email, name: u!.full_name };
}

/** Administrador: o que já está ligado no acesso do sistema. */
export async function getAccessStatus(ctx: Ctx) {
  requireAdmin(ctx);
  return {
    mail: { ready: mailReady(ctx.env), provider: mailProvider(ctx.env) },
    google: googleLoginReady(ctx.env),
    twoFactor: twoFactorAvailable(ctx.env),
    captcha: !!(ctx.env.TURNSTILE_SITE_KEY && ctx.env.TURNSTILE_SECRET_KEY),
  };
}
