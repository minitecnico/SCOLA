import { clearFailures, hashPassword, iterationsFor, validatePassword } from './auth';
import { insertLog } from './audit';
import { fail, first, now, run, uid, type Env } from './db';

/**
 * Links de acesso — o jeito de entrar pela primeira vez e de recuperar a senha, sem senha provisória:
 *  - convite (`invite`): a gestão cadastra a pessoa e o link leva à tela onde ELA cria a própria senha (vale 7 dias);
 *  - redefinição (`reset`): link gerado pela gestão (vale 24 horas) para quem esqueceu a senha.
 * O link é entregue por quem administra (WhatsApp, e-mail pessoal…): nenhum serviço de e-mail é necessário.
 * Cada link vale uma vez só; no banco fica apenas o hash. Conta convidada ainda sem senha tem password_hash = '!'.
 */
export type LinkKind = 'reset' | 'invite';
const TTL_MIN: Record<LinkKind, number> = { reset: 24 * 60, invite: 7 * 24 * 60 };
export const NO_PASSWORD = '!';

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const sha = async (s: string) => b64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));

export async function issueLink(env: Env, o: { userId: string; kind: LinkKind; baseId?: string | null; origin: string; ip?: string | null; ttlMin?: number }) {
  const raw = b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]!);
  const t = now();
  const expiresAt = new Date(Date.now() + (o.ttlMin ?? TTL_MIN[o.kind]) * 60_000).toISOString();
  await env.DB.batch([
    // O link novo substitui o anterior do mesmo tipo (evita ficar com vários links soltos por aí).
    env.DB.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND kind = ? AND used_at IS NULL').bind(t, o.userId, o.kind),
    env.DB.prepare('INSERT INTO password_resets (id, user_id, token_hash, ip, created_at, expires_at, kind, base_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(uid(), o.userId, await sha(raw), o.ip ?? null, t, expiresAt, o.kind, o.baseId ?? null),
  ]);
  return { url: `${o.origin}/${o.kind === 'invite' ? 'convite' : 'redefinir-senha'}?token=${raw}`, expiresAt };
}

type LinkRow = { id: string; user_id: string; kind: LinkKind; base_id: string | null; email: string; full_name: string | null; base_name: string | null; has_password: number };

async function findLink(env: Env, token: string): Promise<LinkRow> {
  if (String(token || '').length < 20) fail('Link inválido. Peça um novo.', 400);
  const row = await first<LinkRow>(env.DB,
    `SELECT r.id, r.user_id, r.kind, r.base_id, u.email, u.full_name, b.name AS base_name, (u.password_hash <> '${NO_PASSWORD}') AS has_password
       FROM password_resets r JOIN users u ON u.id = r.user_id LEFT JOIN bases b ON b.id = r.base_id
      WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > ? AND u.disabled = 0`, await sha(token), now());
  if (!row) fail('Este link expirou ou já foi usado. Peça um novo à gestão da sua escola ou use "Esqueci minha senha" na tela de login.', 400);
  return row!;
}

/** O que a página do link mostra antes de a pessoa criar a senha. */
export async function previewLink(env: Env, token: string) {
  const l = await findLink(env, token);
  const m = l.base_id ? await first<{ role: string }>(env.DB, 'SELECT role FROM memberships WHERE user_id = ? AND base_id = ?', l.user_id, l.base_id) : null;
  return { kind: l.kind, email: l.email, name: l.full_name, baseName: l.base_name, role: m?.role ?? null, hasPassword: !!l.has_password };
}

/** Grava a senha escolhida. Convite: a pessoa já entra. Redefinição: derruba as outras sessões e pede novo login. */
export async function acceptLink(env: Env, input: { token: string; password: string; name?: string; ip: string | null; device?: string | null }) {
  validatePassword(String(input.password ?? ''));
  const l = await findLink(env, input.token);
  const name = String(input.name ?? '').trim();
  const t = now();
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash = ?, must_change_pw = 0, full_name = COALESCE(NULLIF(?, \'\'), full_name), active_base_id = COALESCE(?, active_base_id) WHERE id = ?')
      .bind(await hashPassword(input.password, iterationsFor(env)), name, l.kind === 'invite' ? l.base_id : null, l.user_id),
    env.DB.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL').bind(t, l.user_id),
    ...(l.kind === 'reset' ? [env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(l.user_id)] : []),
  ]);
  await clearFailures(env.DB, l.email);
  await insertLog(env.DB, {
    action: l.kind === 'invite' ? 'convite_aceito' : 'reset_senha', category: 'acesso',
    summary: l.kind === 'invite' ? 'Aceitou o convite e criou a senha' : 'Criou nova senha pelo link do e-mail',
    userId: l.user_id, email: l.email, baseId: l.base_id, ip: input.ip, device: input.device ?? null,
  }).catch(() => null);
  await run(env.DB, 'DELETE FROM password_resets WHERE expires_at < ?', new Date(Date.now() - 86400_000).toISOString()).catch(() => null);
  return { userId: l.user_id, kind: l.kind };
}
