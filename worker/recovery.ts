import { clearFailures, hashPassword, iterationsFor, validatePassword } from './auth';
import { insertLog } from './audit';
import { all, fail, first, now, run, uid, type Env } from './db';
import { accessTokenFor, googleConfigured } from './google';

/**
 * "Esqueci minha senha": o link vai por e-mail, enviado pelo Gmail da conta do administrador
 * (conectada em Configurações > Google). O link vale 1 hora e só funciona uma vez; no banco fica só o hash.
 */
const TTL_MIN = 60;
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const b64url = (s: string) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha = async (s: string) => b64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
const utf8b64 = (s: string) => b64(new TextEncoder().encode(s));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Conta do administrador que envia os e-mails (precisa ter permitido o envio no Google). */
export async function resetSender(env: Env) {
  if (!googleConfigured(env)) return null;
  return first<{ user_id: string; google_email: string }>(env.DB,
    `SELECT g.user_id, g.google_email FROM google_accounts g JOIN users u ON u.id = g.user_id
      WHERE u.is_admin = 1 AND g.scopes LIKE '%gmail.send%' ORDER BY g.connected_at LIMIT 1`);
}

async function sendMail(env: Env, userId: string, to: string, subject: string, html: string) {
  const mime = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${utf8b64(subject)}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    utf8b64(html).replace(/(.{76})/g, '$1\r\n'),
  ].join('\r\n');
  const token = await accessTokenFor(env, userId);
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: b64url(b64(new TextEncoder().encode(mime))) }),
  });
  if (!r.ok) throw new Error(`Gmail ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
}

const mailHtml = (name: string, link: string) => `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:auto;color:#111">
<h2 style="margin:0 0 12px">Redefinir sua senha do SCOLA</h2>
<p>Olá${name ? `, ${esc(name.split(' ')[0])}` : ''}! Recebemos um pedido para criar uma nova senha.</p>
<p style="margin:24px 0"><a href="${link}" style="background:#0a0a0a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block">Criar nova senha</a></p>
<p style="font-size:13px;color:#555">O link vale por ${TTL_MIN} minutos e só pode ser usado uma vez. Se o botão não funcionar, copie este endereço no navegador:<br><span style="word-break:break-all">${link}</span></p>
<p style="font-size:13px;color:#555">Não pediu isso? Ignore este e-mail: sua senha continua a mesma.</p></div>`;

/** Pedido de recuperação. A resposta é sempre a mesma, exista ou não a conta (ninguém descobre quem tem cadastro). */
export async function requestReset(env: Env, input: { email: string; ip: string | null; origin: string; device?: string | null }) {
  const email = String(input.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Informe um e-mail válido.');
  const sender = await resetSender(env);
  if (!sender) return fail('A recuperação por e-mail ainda não foi ativada. Fale com a gestão da sua escola ou com o suporte do SCOLA.', 503);
  const hour = new Date(Date.now() - 3600_000).toISOString();
  const byIp = await first<{ n: number }>(env.DB, 'SELECT COUNT(*) AS n FROM password_resets WHERE ip = ? AND created_at > ?', input.ip ?? '', hour);
  if ((byIp?.n ?? 0) >= 10) fail('Muitos pedidos. Tente de novo em uma hora.', 429);

  const user = await first<{ id: string; full_name: string | null; disabled: number }>(env.DB, 'SELECT id, full_name, disabled FROM users WHERE email = ?', email);
  const log = (action: string, summary: string, status: 'ok' | 'erro' | 'negado' = 'ok', detail?: string) =>
    insertLog(env.DB, { action, category: 'acesso', summary, status, detail: detail ?? null, userId: user?.id ?? null, email, ip: input.ip, device: input.device ?? null }).catch(() => null);
  if (!user || user.disabled) {
    await log('reset_pedido', 'Pedido de nova senha para e-mail sem acesso', 'negado', user ? 'Conta bloqueada' : 'E-mail não cadastrado');
    return;
  }
  const recent = await first<{ n: number }>(env.DB, 'SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ? AND created_at > ?', user.id, hour);
  if ((recent?.n ?? 0) >= 3) return; // já mandamos; evita encher a caixa de entrada

  const raw = b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]!);
  const t = now();
  await run(env.DB, 'INSERT INTO password_resets (id, user_id, token_hash, ip, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    uid(), user.id, await sha(raw), input.ip, t, new Date(Date.now() + TTL_MIN * 60_000).toISOString());
  try {
    await sendMail(env, sender.user_id, email, 'Redefinir sua senha do SCOLA', mailHtml(user.full_name ?? '', `${input.origin}/redefinir-senha?token=${raw}`));
    await log('reset_pedido', 'Pediu nova senha (link enviado por e-mail)');
  } catch (e) {
    console.error('recuperação: e-mail não enviado', (e as Error)?.message);
    await log('reset_pedido', 'Pedido de nova senha: o e-mail não pôde ser enviado', 'erro', (e as Error)?.message);
  }
}

/** Confere o link e grava a senha nova. Derruba todas as sessões da pessoa. */
export async function confirmReset(env: Env, input: { token: string; password: string; ip: string | null; device?: string | null }) {
  const token = String(input.token || '');
  if (token.length < 20) fail('Link inválido. Peça um novo.', 400);
  validatePassword(String(input.password ?? ''));
  const row = await first<{ id: string; user_id: string; email: string }>(env.DB,
    `SELECT r.id, r.user_id, u.email FROM password_resets r JOIN users u ON u.id = r.user_id
      WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > ? AND u.disabled = 0`, await sha(token), now());
  if (!row) fail('Este link expirou ou já foi usado. Peça um novo em "Esqueci minha senha".', 400);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash = ?, must_change_pw = 0 WHERE id = ?').bind(await hashPassword(input.password, iterationsFor(env)), row!.user_id),
    env.DB.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL').bind(now(), row!.user_id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(row!.user_id),
  ]);
  await clearFailures(env.DB, row!.email);
  await insertLog(env.DB, { action: 'reset_senha', category: 'acesso', summary: 'Criou nova senha pelo link do e-mail', userId: row!.user_id, email: row!.email, ip: input.ip, device: input.device ?? null }).catch(() => null);
  await run(env.DB, 'DELETE FROM password_resets WHERE expires_at < ?', new Date(Date.now() - 86400_000).toISOString()).catch(() => null);
}

/** Para o painel do administrador: a recuperação por e-mail está pronta? */
export async function resetStatus(env: Env) {
  const s = await resetSender(env);
  return { ready: !!s, sender: s?.google_email ?? null, googleConfigured: googleConfigured(env) };
}
