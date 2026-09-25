import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import {
  assertNotLocked, buildCtx, clearFailures, createSession, destroySession, hashPassword, iterationsFor, needsRehash,
  recordFailure, requireBase, requireRole, SESSION_COOKIE, userFromToken, verifyPassword, type Ctx, type UserRow,
} from './auth';
import { all, fail, first, HttpError, parse, run, uid, type Env } from './db';
import * as cadastros from './handlers/cadastros';
import * as chamadas from './handlers/chamadas';
import * as comunicacao from './handlers/comunicacao';
import * as contas from './handlers/contas';
import * as notas from './handlers/notas';

/* ---------------------------------- Registro RPC ---------------------------------- */
type Handler = (ctx: Ctx, ...args: unknown[]) => Promise<unknown>;
const INTERNAL = new Set(['filesOf', 'purgeFiles', 'fileUrl']);
const handlers: Record<string, Handler> = {};
for (const mod of [cadastros, chamadas, comunicacao, contas, notas]) {
  for (const [name, fn] of Object.entries(mod)) {
    if (typeof fn === 'function' && !INTERNAL.has(name)) handlers[name] = fn as Handler;
  }
}
// Enquanto a senha provisória não for trocada, só isto é permitido.
const ALLOWED_BEFORE_PW_CHANGE = new Set(['changePassword', 'getProfile']);

const MAX_FILE = 20 * 1024 * 1024; // KV aceita até 25 MB por valor
const BLOCKED_EXT = /\.(exe|msi|bat|cmd|com|scr|pif|cpl|jar|js|jse|vbs|vbe|ps1|psm1|sh|app|apk|dll|sys|reg|lnk|hta|wsf|wsh|gadget)$/i;

const app = new Hono<{ Bindings: Env; Variables: { user: UserRow } }>();

/* -------------------------------- Erros e proteção -------------------------------- */
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
  console.error(err);
  const msg = String((err as Error)?.message || '');
  if (msg.includes('UNIQUE constraint failed')) return c.json({ error: 'Registro duplicado.' }, 409);
  if (msg.includes('FOREIGN KEY constraint failed')) return c.json({ error: 'Registro relacionado não encontrado.' }, 400);
  return c.json({ error: 'Erro interno. Tente novamente.' }, 500);
});

// CSRF: toda escrita exige um cabeçalho próprio (navegadores não enviam de outro site sem CORS).
app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.header('x-scola') !== '1') fail('Requisição inválida.', 403);
  await next();
  c.header('Cache-Control', 'no-store');
});

async function authed(c: Context<{ Bindings: Env; Variables: { user: UserRow } }>) {
  const user = await userFromToken(c.env.DB, getCookie(c, SESSION_COOKIE));
  if (!user) fail('Sessão expirada. Entre novamente.', 401);
  if (user!.must_change_pw) fail('Troque a senha provisória para continuar.', 403);
  return buildCtx(c.env, user!);
}

/* ------------------------------------- Login -------------------------------------- */
app.post('/api/auth/login', async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>().catch(() => ({}) as { email?: string; password?: string });
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) fail('Informe e-mail e senha.');
  const db = c.env.DB;
  await assertNotLocked(db, email);
  const user = await first<UserRow>(db, 'SELECT * FROM users WHERE email = ?', email);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    await recordFailure(db, email);
    fail('E-mail ou senha incorretos.', 401);
  }
  await clearFailures(db, email);
  // Contas migradas (bcrypt) ou com custo antigo ganham hash novo, de forma transparente.
  const it = iterationsFor(c.env);
  if (needsRehash(user!.password_hash, it)) {
    await run(db, 'UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(password, it), user!.id);
  }
  const { token, maxAge } = await createSession(db, user!.id);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true, secure: new URL(c.req.url).protocol === 'https:', sameSite: 'Lax', path: '/', maxAge,
  });
  return c.json({ ok: true });
});

app.post('/api/auth/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await destroySession(c.env.DB, token);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

/** Contexto da sessão: usuário, bases, base ativa e papel. */
app.get('/api/auth/me', async (c) => {
  const user = await userFromToken(c.env.DB, getCookie(c, SESSION_COOKIE));
  if (!user) return c.json({ user: null });
  const ctx = await buildCtx(c.env, user);
  const db = c.env.DB;
  const bases = ctx.isAdmin
    ? await all<{ id: string; name: string; active: number }>(db, 'SELECT id, name, active FROM bases ORDER BY name COLLATE NOCASE')
    : ctx.memberships.map((m) => ({ id: m.base_id, name: m.base_name, active: m.base_active }));
  const base = ctx.baseId
    ? await first<{ id: string; name: string; logo_url: string | null; subject: string | null }>(db, 'SELECT id, name, logo_url, subject FROM bases WHERE id = ?', ctx.baseId)
    : null;
  return c.json({
    user: { id: user.id, email: user.email, full_name: user.full_name, avatar_url: user.avatar_url, phone: user.phone },
    isAdmin: ctx.isAdmin,
    mustChangePassword: !!user.must_change_pw,
    role: ctx.role,
    base,
    bases: bases.map((b) => ({ ...b, active: !!b.active })),
    memberships: ctx.memberships.map((m) => ({ id: m.id, user_id: m.user_id, org_id: m.base_id, role: m.role })),
    // Tem vínculo, mas todas as bases estão suspensas.
    suspended: !ctx.isAdmin && ctx.memberships.length > 0 && !ctx.baseId,
  });
});

/* -------------------------------------- RPC --------------------------------------- */
app.post('/api/rpc/:name', async (c) => {
  const name = c.req.param('name');
  const fn = Object.prototype.hasOwnProperty.call(handlers, name) ? handlers[name] : undefined;
  if (!fn) fail('Operação desconhecida.', 404);
  const user = await userFromToken(c.env.DB, getCookie(c, SESSION_COOKIE));
  if (!user) fail('Sessão expirada. Entre novamente.', 401);
  if (user!.must_change_pw && !ALLOWED_BEFORE_PW_CHANGE.has(name)) fail('Troque a senha provisória para continuar.', 403);
  const ctx = await buildCtx(c.env, user!);
  const body = await c.req.json<{ args?: unknown[] }>().catch(() => ({ args: [] as unknown[] }));
  const args = Array.isArray(body.args) ? body.args : [];
  const result = await fn!(ctx, ...args);
  return c.json({ data: result ?? null });
});

/* ------------------------------------ Arquivos ------------------------------------ */
async function readUpload(c: Context<{ Bindings: Env; Variables: { user: UserRow } }>) {
  const form = await c.req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') fail('Nenhum arquivo enviado.');
  const f = file as unknown as File;
  if (BLOCKED_EXT.test(f.name)) fail('Por segurança, arquivos executáveis não são aceitos.');
  if (f.size > MAX_FILE) fail('Arquivo muito grande. Envie arquivos de até 20 MB.');
  return { form, file: f };
}

async function putFile(env: Env, id: string, file: File) {
  await env.FILES.put(`f:${id}`, await file.arrayBuffer(), { metadata: { name: file.name, mime: file.type || 'application/octet-stream' } });
}

/** Anexo de aviso ou planejamento. */
app.post('/api/files', async (c) => {
  const ctx = await authed(c);
  const base = requireBase(ctx);
  const { form, file } = await readUpload(c);
  const ownerType = String(form.get('owner_type'));
  const ownerId = String(form.get('owner_id'));
  if (ownerType === 'notice') {
    const n = await first<{ author_id: string }>(ctx.db, 'SELECT author_id FROM notices WHERE id = ? AND base_id = ?', ownerId, base);
    if (!n || (n.author_id !== ctx.user.id && ctx.role !== 'superadmin')) fail('Aviso não encontrado.', 404);
  } else if (ownerType === 'plan') {
    const p = await first<{ author_id: string }>(ctx.db, 'SELECT author_id FROM lesson_plans WHERE id = ? AND base_id = ?', ownerId, base);
    if (!p || (p.author_id !== ctx.user.id && ctx.role !== 'superadmin')) fail('Planejamento não encontrado.', 404);
  } else fail('Tipo de anexo inválido.');
  const id = uid();
  await putFile(c.env, id, file);
  await run(ctx.db, 'INSERT INTO files (id, base_id, owner_type, owner_id, name, mime, size) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, base, ownerType, ownerId, file.name, file.type || null, file.size);
  return c.json({ data: { id } });
});

/** Documento da central de planejamentos. */
app.post('/api/plandocs', async (c) => {
  const ctx = await authed(c);
  const base = requireRole(ctx, 'gestor', 'professor');
  const { form, file } = await readUpload(c);
  const term = form.get('term');
  const classId = (form.get('class_id') as string) || null;
  if (classId && !(await first(ctx.db, 'SELECT 1 FROM classes WHERE id = ? AND base_id = ?', classId, base))) fail('Turma não encontrada.', 404);
  const id = uid();
  await putFile(c.env, id, file);
  await run(ctx.db,
    'INSERT INTO plan_docs (id, base_id, author_id, segment, term, class_id, turma_label, name, mime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, base, ctx.user.id, String(form.get('segment') || 'geral'), term ? Number(term) : null,
    classId, (form.get('turma_label') as string) || null, file.name, file.type || null);
  return c.json({ data: { id } });
});

app.get('/api/files/:id', async (c) => {
  const ctx = await authed(c);
  const id = c.req.param('id');
  const meta =
    (await first<{ base_id: string; name: string; mime: string | null }>(ctx.db, 'SELECT base_id, name, mime FROM files WHERE id = ?', id)) ??
    (await first<{ base_id: string; name: string; mime: string | null }>(ctx.db, 'SELECT base_id, name, mime FROM plan_docs WHERE id = ?', id));
  if (!meta) fail('Arquivo não encontrado.', 404);
  const allowed = ctx.isAdmin || ctx.memberships.some((m) => m.base_id === meta!.base_id && m.base_active);
  if (!allowed) fail('Sem acesso a este arquivo.', 403);
  const body = await c.env.FILES.get(`f:${id}`, 'arrayBuffer');
  if (!body) fail('Arquivo não encontrado.', 404);
  const download = c.req.query('download') === '1';
  return new Response(body, {
    headers: {
      'Content-Type': meta!.mime || 'application/octet-stream',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(meta!.name)}`,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
});

/* -------------------------- Relatório público por link ---------------------------- */
app.get('/api/public/reports/:id', async (c) => {
  const r = await first<{ payload: string }>(c.env.DB, 'SELECT payload FROM shared_reports WHERE id = ?', c.req.param('id'));
  return c.json({ data: r ? parse(r.payload, null) : null });
});

app.all('/api/*', (c) => c.json({ error: 'Rota não encontrada.' }, 404));

export default {
  fetch: app.fetch,
  /** Rotina diária: apaga do KV os anexos de itens/bases excluídos (poucos por vez, limite do plano grátis). */
  async scheduled(_controller: ScheduledController, env: Env) {
    const rows = await all<{ id: string }>(env.DB, 'SELECT id FROM kv_trash LIMIT 40');
    if (!rows.length) return;
    await Promise.all(rows.map((r) => env.FILES.delete(`f:${r.id}`)));
    await run(env.DB, `DELETE FROM kv_trash WHERE id IN (SELECT value FROM json_each(?))`, JSON.stringify(rows.map((r) => r.id)));
  },
} satisfies ExportedHandler<Env>;
