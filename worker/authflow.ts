import type { Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import {
  assertNotLocked, burnPasswordCheck, clearFailures, createSession, hashPassword, iterationsFor, needsRehash, recordFailure,
  SESSION_COOKIE, verifyPassword, type UserRow,
} from './auth';
import { acceptLink, previewLink } from './access';
import { deviceOf, insertLog, type LogEntry } from './audit';
import { fail, first, now, run, type Env } from './db';
import { exchangeLoginCode, googleLoginReady, loginAuthUrl } from './google';

/** Entrada no sistema: Google, e-mail e senha, e links de convite/redefinição. */
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
  /** O que a tela de login pode oferecer neste servidor (o botão do Google só aparece se estiver configurado). */
  app.get('/api/auth/config', (c) => c.json({ google: googleLoginReady(c.env) }));

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

  /* ------------------------------ Entrar com Google ------------------------------ */
  // O "state" fica num cookie de curta duração (nada é gravado no servidor).
  app.get('/api/auth/google/start', (c) => {
    if (!googleLoginReady(c.env)) return c.redirect('/login?erro=google-indisponivel');
    const state = randomToken();
    const remember = c.req.query('remember') === '0' ? '0' : '1';
    setCookie(c, 'scola_gstate', `${state}.${remember}`, { httpOnly: true, secure: new URL(c.req.url).protocol === 'https:', sameSite: 'Lax', path: '/api/auth/google', maxAge: 600 });
    return c.redirect(loginAuthUrl(c.env, c.req.url, state));
  });

  app.get('/api/auth/google/callback', async (c) => {
    const back = (e: string) => c.redirect(`/login?erro=${e}`);
    const saved = getCookie(c, 'scola_gstate') ?? '';
    deleteCookie(c, 'scola_gstate', { path: '/api/auth/google' });
    const [state, remember] = saved.split('.');
    const code = c.req.query('code');
    if (!state || state !== c.req.query('state') || !code) return back(c.req.query('error') ? 'google-cancelado' : 'google-erro');
    const g = await exchangeLoginCode(c.env, c.req.url, code);
    if (!g) return back('google-erro');
    const db = c.env.DB;
    // Só entra quem já tem cadastro (ou convite): o e-mail do Google, verificado por ele, precisa ser o mesmo da conta.
    const user = (await first<UserRow>(db, 'SELECT * FROM users WHERE google_sub = ?', g.sub)) ?? (await first<UserRow>(db, 'SELECT * FROM users WHERE email = ?', g.email));
    if (!user) {
      log(c, { email: g.email, action: 'login_falhou', category: 'acesso', summary: 'Entrar com Google: e-mail sem cadastro', status: 'negado', detail: 'E-mail não cadastrado' });
      return back('sem-conta');
    }
    if (user.disabled) return back('bloqueado');
    // Prova de identidade pelo Google: vincula a conta, aceita convites pendentes e dispensa a senha provisória.
    await db.batch([
      db.prepare("UPDATE users SET google_sub = COALESCE(google_sub, ?), must_change_pw = 0, full_name = COALESCE(NULLIF(full_name, ''), ?) WHERE id = ?").bind(g.sub, g.name, user.id),
      db.prepare('UPDATE users SET active_base_id = (SELECT base_id FROM memberships WHERE user_id = ? LIMIT 1) WHERE id = ? AND active_base_id IS NULL').bind(user.id, user.id),
      db.prepare("UPDATE password_resets SET used_at = ? WHERE user_id = ? AND kind = 'invite' AND used_at IS NULL").bind(now(), user.id),
    ]);
    await startSession(c, user, remember !== '0', 'Entrou com o Google');
    return c.redirect('/');
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
