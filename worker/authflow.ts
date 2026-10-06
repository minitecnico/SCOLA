import type { Context, Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import {
  assertNotLocked, burnPasswordCheck, clearFailures, createSession, hashPassword, iterationsFor, needsRehash, recordFailure,
  SESSION_COOKIE, verifyPassword, type UserRow,
} from './auth';
import { acceptLink, previewLink } from './access';
import { deviceOf, insertLog, type LogEntry } from './audit';
import { fail, first, now, run, type Env } from './db';

/** Entrada no sistema: e-mail e senha, e links de convite/redefinição. */
type App = Hono<{ Bindings: Env; Variables: { user: UserRow } }>;
type C = Context<{ Bindings: Env; Variables: { user: UserRow } }>;

const origin = (c: C) => ({
  ip: c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  device: deviceOf(c.req.header('user-agent')),
});
function bg(c: C, p: Promise<unknown>) {
  const safe = p.catch((e) => console.error('audit', e));
  try {
    c.executionCtx.waitUntil(safe);
  } catch {
    /* fora do Worker (testes) */
  }
}
const log = (c: C, e: LogEntry) => bg(c, insertLog(c.env.DB, { ...e, ...origin(c) }));

const randomToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/[+/=]/g, (ch) => ({ '+': '-', '/': '_', '=': '' })[ch]!);

/** Abre a sessão (cookie HttpOnly) e registra o acesso no log. */
async function startSession(c: C, user: UserRow, remember: boolean, summary: string) {
  const { token, maxAge } = await createSession(c.env.DB, user.id, remember);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true, secure: new URL(c.req.url).protocol === 'https:', sameSite: 'Lax', path: '/', ...(maxAge ? { maxAge } : {}),
  });
  bg(c, (async () => {
    const m = await first<{ base_id: string; role: string }>(c.env.DB, 'SELECT base_id, role FROM memberships WHERE user_id = ? LIMIT 1', user.id);
    await insertLog(c.env.DB, {
      userId: user.id, email: user.email, role: user.is_admin ? 'admin' : m?.role ?? null, baseId: user.is_admin ? user.active_base_id : m?.base_id ?? null,
      action: 'login', category: 'acesso', summary, ...origin(c),
    });
  })());
}

export function authRoutes(app: App) {
  /* ---------------------------------- Senha ---------------------------------- */
  app.post('/api/auth/login', async (c) => {
    const body = await c.req.json<{ email?: string; password?: string; remember?: boolean }>().catch(() => ({}) as { email?: string; password?: string; remember?: boolean });
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const remember = body.remember !== false;
    if (!email || !password) fail('Informe e-mail e senha.');
    const db = c.env.DB;
    const { ip } = origin(c);
    try {
      await assertNotLocked(db, email, ip);
    } catch (err) {
      log(c, { email, action: 'login_bloqueado', category: 'acesso', summary: 'Login bloqueado por excesso de tentativas', status: 'negado' });
      throw err;
    }
    const user = await first<UserRow>(db, 'SELECT * FROM users WHERE email = ?', email);
    // Senha copiada do WhatsApp/e-mail costuma vir com espaço no fim: tenta também sem os espaços das pontas.
    let matched: string | null = null;
    if (user) {
      if (await verifyPassword(password, user.password_hash)) matched = password;
      else if (password.trim() !== password && (await verifyPassword(password.trim(), user.password_hash))) matched = password.trim();
    }
    if (!user) await burnPasswordCheck(c.env, password);
    if (!matched) {
      // Quem acabou de pedir cadastro e tenta entrar: com a senha certa, avisa em que pé está o pedido (em vez de "senha incorreta").
      const req = await first<{ status: string; password_hash: string; decision_note: string | null }>(db,
        "SELECT status, password_hash, decision_note FROM access_requests WHERE email = ? AND kind = 'cadastro' AND status <> 'aprovado' ORDER BY created_at DESC LIMIT 1", email);
      if (req && !user && (await verifyPassword(password, req.password_hash))) {
        fail(req.status === 'pendente'
          ? 'Seu cadastro ainda está em análise. Assim que o administrador aprovar, você poderá entrar com este e-mail e senha.'
          : `Seu cadastro não foi aprovado.${req.decision_note ? ` Motivo: ${req.decision_note}` : ''} Fale com a sua escola ou com o suporte do SCOLA.`, 403);
      }
      await recordFailure(db, email, ip);
      log(c, {
        email, userId: user?.id ?? null, action: 'login_falhou', category: 'acesso', summary: 'Tentativa de login falhou', status: 'negado',
        detail: user ? (user.password_hash === '!' ? 'Convite ainda não aceito' : 'Senha incorreta') : 'E-mail não cadastrado', baseId: user?.active_base_id ?? null,
      });
      fail('E-mail ou senha incorretos.', 401);
    }
    await clearFailures(db, email);
    if (user!.disabled) {
      log(c, { email, userId: user!.id, action: 'login_falhou', category: 'acesso', summary: 'Tentativa de login de conta bloqueada', status: 'negado', detail: 'Conta bloqueada pelo administrador', baseId: user!.active_base_id });
      fail('Seu acesso está bloqueado. Fale com o administrador do SCOLA.', 403);
    }
    // Contas migradas (bcrypt) ou com custo antigo ganham hash novo, de forma transparente.
    const it = iterationsFor(c.env);
    if (needsRehash(user!.password_hash, it)) await run(db, 'UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(matched!, it), user!.id);

    await startSession(c, user!, remember, user!.must_change_pw ? 'Entrou com senha provisória' : 'Entrou no sistema');
    return c.json({ ok: true });
  });

  /* ------------------------------ Convites e redefinição ------------------------------ */
  app.post('/api/auth/link/preview', async (c) => {
    const body = await c.req.json<{ token?: string }>().catch(() => ({}) as { token?: string });
    return c.json(await previewLink(c.env, String(body.token ?? '')));
  });
  app.post('/api/auth/reset', async (c) => {
    const body = await c.req.json<{ token?: string; password?: string; name?: string }>().catch(() => ({}) as { token?: string; password?: string; name?: string });
    const r = await acceptLink(c.env, { token: String(body.token ?? ''), password: String(body.password ?? ''), name: body.name, ip: origin(c).ip, device: origin(c).device });
    // Convite: a pessoa acabou de escolher a senha, então já entra. Redefinição: volta ao login.
    if (r.kind === 'invite') {
      const user = await first<UserRow>(c.env.DB, 'SELECT * FROM users WHERE id = ?', r.userId);
      if (user) await startSession(c, user, true, 'Entrou no sistema (primeiro acesso)');
    }
    return c.json({ ok: true, kind: r.kind, signedIn: r.kind === 'invite' });
  });
}
