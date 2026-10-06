import { clearFailures, hashPassword, iterationsFor, validatePassword } from './auth';
import { insertLog } from './audit';
import { fail, first, now, run, uid, type Env } from './db';
import { mailReady, sendMail } from './mail';

/**
 * Links de acesso — o jeito de entrar pela primeira vez e de recuperar a senha, sem senha provisória:
 *  - convite (`invite`): a gestão cadastra a pessoa e o link leva à tela onde ELA cria a própria senha (vale 7 dias);
 *  - redefinição (`reset`): "Esqueci minha senha" (vale 1 hora) ou link gerado pela gestão para mandar no WhatsApp.
 * Cada link vale uma vez só; no banco fica apenas o hash. Conta convidada ainda sem senha tem password_hash = '!'.
 */
export type LinkKind = 'reset' | 'invite';
const TTL_MIN: Record<LinkKind, number> = { reset: 60, invite: 7 * 24 * 60 };
export const NO_PASSWORD = '!';

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const sha = async (s: string) => b64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const ROLE_PT: Record<string, string> = { gestor: 'gestão', professor: 'professor(a)', secretaria: 'secretaria' };

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

/** Manda o link por e-mail (se houver provedor configurado). Nunca derruba quem chamou: devolve se saiu ou não. */
export async function emailAccessLink(env: Env, o: { to: string; name?: string | null; url: string; kind: LinkKind; baseName?: string | null; role?: string | null }): Promise<boolean> {
  if (!mailReady(env)) return false;
  const first = o.name ? `, ${esc(o.name.split(' ')[0])}` : '';
  const invite = o.kind === 'invite';
  const subject = invite ? `Seu acesso ao SCOLA${o.baseName ? ` — ${o.baseName}` : ''}` : 'Redefinir sua senha do SCOLA';
  const lead = invite
    ? `${o.baseName ? `${esc(o.baseName)} liberou o seu acesso${o.role ? ` como ${esc(ROLE_PT[o.role] ?? o.role)}` : ''}.` : 'Seu acesso foi liberado.'} Crie sua senha para começar.`
    : 'Recebemos um pedido para criar uma nova senha.';
  const days = invite ? '7 dias' : 'uma hora';
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:auto;color:#111">
<h2 style="margin:0 0 12px">${invite ? 'Bem-vindo(a) ao SCOLA' : 'Redefinir sua senha do SCOLA'}</h2>
<p>Olá${first}! ${lead}</p>
<p style="margin:24px 0"><a href="${o.url}" style="background:#0a0a0a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block">${invite ? 'Criar minha senha' : 'Criar nova senha'}</a></p>
<p style="font-size:13px;color:#555">O link vale por ${days} e só pode ser usado uma vez. Se o botão não funcionar, copie este endereço no navegador:<br><span style="word-break:break-all">${o.url}</span></p>
<p style="font-size:13px;color:#555">${invite ? 'Não esperava este e-mail? Pode ignorá-lo.' : 'Não pediu isso? Ignore este e-mail: sua senha continua a mesma.'}</p></div>`;
  const text = `${invite ? 'Bem-vindo(a) ao SCOLA' : 'Redefinir senha do SCOLA'}\n\n${lead.replace(/&amp;/g, '&')}\n\nAbra o link (vale por ${days}, uso único):\n${o.url}\n`;
  try {
    await sendMail(env, { to: o.to, subject, html, text });
    return true;
  } catch (e) {
    console.error('e-mail de acesso não enviado', (e as Error)?.message);
    return false;
  }
}

/** "Esqueci minha senha". A resposta é sempre a mesma, exista ou não a conta (ninguém descobre quem tem cadastro). */
export async function requestReset(env: Env, input: { email: string; ip: string | null; origin: string; device?: string | null }) {
  const email = String(input.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Informe um e-mail válido.');
  if (!mailReady(env)) fail('A recuperação por e-mail ainda não foi ativada. Peça à gestão da sua escola para gerar um novo link de acesso para você (Equipe → ícone da chave).', 503);
  const hour = new Date(Date.now() - 3600_000).toISOString();
  const byIp = await first<{ n: number }>(env.DB, 'SELECT COUNT(*) AS n FROM password_resets WHERE ip = ? AND created_at > ?', input.ip ?? '', hour);
  if ((byIp?.n ?? 0) >= 10) fail('Muitos pedidos. Tente de novo em uma hora.', 429);

  const user = await first<{ id: string; full_name: string | null; disabled: number }>(env.DB, 'SELECT id, full_name, disabled FROM users WHERE email = ?', email);
  const log = (summary: string, status: 'ok' | 'erro' | 'negado' = 'ok', detail?: string) =>
    insertLog(env.DB, { action: 'reset_pedido', category: 'acesso', summary, status, detail: detail ?? null, userId: user?.id ?? null, email, ip: input.ip, device: input.device ?? null }).catch(() => null);
  if (!user || user.disabled) {
    await log('Pedido de nova senha para e-mail sem acesso', 'negado', user ? 'Conta bloqueada' : 'E-mail não cadastrado');
    return;
  }
  const recent = await first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ? AND kind = 'reset' AND created_at > ?", user.id, hour);
  if ((recent?.n ?? 0) >= 3) return; // já mandamos; evita encher a caixa de entrada
  const { url } = await issueLink(env, { userId: user.id, kind: 'reset', origin: input.origin, ip: input.ip });
  const sent = await emailAccessLink(env, { to: email, name: user.full_name, url, kind: 'reset' });
  await log(sent ? 'Pediu nova senha (link enviado por e-mail)' : 'Pedido de nova senha: o e-mail não pôde ser enviado', sent ? 'ok' : 'erro');
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
