import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import {
  assertNotLocked, buildCtx, clearFailures, createSession, destroySession, hashPassword, iterationsFor, needsRehash,
  recordFailure, requireBase, requireRole, SESSION_COOKIE, userFromToken, verifyPassword, type Ctx, type UserRow,
} from './auth';
import { ACTIONS, deviceOf, insertLog, labelOf, type LogEntry, type Refs } from './audit';
import { clearBaseCache } from './cache';
import { all, fail, first, HttpError, parse, run, uid, type Env } from './db';
import * as alertas from './handlers/alertas';
import * as anoletivo from './handlers/anoletivo';
import * as cadastros from './handlers/cadastros';
import * as editor from './handlers/editor';
import * as folders from './handlers/folders';
import * as google from './handlers/google';
import * as ia from './handlers/ia';
import { accessTokenFor, authUrl, exchangeCode, googleConfigured, sealToken } from './google';
import * as chamadas from './handlers/chamadas';
import * as comunicacao from './handlers/comunicacao';
import * as contas from './handlers/contas';
import * as logs from './handlers/logs';
import * as notas from './handlers/notas';
import * as painel from './handlers/painel';
import * as provas from './handlers/provas';
import * as rag from './handlers/rag';
import * as usuarios from './handlers/usuarios';

/* ---------------------------------- Registro RPC ---------------------------------- */
type Handler = (ctx: Ctx, ...args: unknown[]) => Promise<unknown>;
const INTERNAL = new Set(['filesOf', 'purgeFiles', 'fileUrl', 'composeTermActs', 'targetsFor', 'autoGrades', 'docInBase', 'folderInBase', 'canEditDoc', 'saveEditableContent', 'ragForget', 'chatStream']);
const handlers: Record<string, Handler> = {};
for (const mod of [alertas, anoletivo, cadastros, editor, folders, google, ia, chamadas, comunicacao, contas, logs, notas, painel, provas, rag, usuarios]) {
  for (const [name, fn] of Object.entries(mod)) {
    if (typeof fn === 'function' && !INTERNAL.has(name)) handlers[name] = fn as Handler;
  }
}
// Enquanto a senha provisória não for trocada, só isto é permitido.
const ALLOWED_BEFORE_PW_CHANGE = new Set(['changePassword', 'getProfile']);

const MAX_FILE = 20 * 1024 * 1024; // KV aceita até 25 MB por valor
const BLOCKED_EXT = /\.(exe|msi|bat|cmd|com|scr|pif|cpl|jar|js|jse|vbs|vbe|ps1|psm1|sh|app|apk|dll|sys|reg|lnk|hta|wsf|wsh|gadget)$/i;

const app = new Hono<{ Bindings: Env; Variables: { user: UserRow } }>();

/* ------------------------------------- Logs --------------------------------------- */
type C = Context<{ Bindings: Env; Variables: { user: UserRow } }>;
const origin = (c: C) => ({
  ip: c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  device: deviceOf(c.req.header('user-agent')),
});
/** Grava o log sem atrasar a resposta; falha de log nunca derruba a operação. */
function bg(c: C, p: Promise<unknown>) {
  const safe = p.catch((e) => console.error('audit', e));
  try {
    c.executionCtx.waitUntil(safe);
  } catch {
    /* fora do Worker (testes) */
  }
}
const logAs = (c: C, user: Pick<UserRow, 'id' | 'email'> | null, e: Omit<LogEntry, 'userId' | 'email' | 'ip' | 'device'>) =>
  bg(c, insertLog(c.env.DB, { ...e, userId: user?.id ?? null, email: user?.email ?? null, ...origin(c) }));

/* -------------------------------- Erros e proteção -------------------------------- */
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
  console.error(err);
  const msg = String((err as Error)?.message || '');
  // Plano gratuito do D1: estourou o limite diário (zera à meia-noite UTC = 21h em Brasília).
  if (/D1 DB reached|exceeded .*limit|7500/i.test(msg)) return c.json({ error: 'O limite diário gratuito do banco de dados foi atingido. O sistema volta a funcionar às 21h (horário de Brasília).' }, 503);
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
  try {
    await assertNotLocked(db, email);
  } catch (err) {
    bg(c, insertLog(db, { email, action: 'login_bloqueado', category: 'acesso', summary: 'Login bloqueado por excesso de tentativas', status: 'negado', ...origin(c) }));
    throw err;
  }
  const user = await first<UserRow>(db, 'SELECT * FROM users WHERE email = ?', email);
  // Senha copiada do WhatsApp/e-mail costuma vir com espaço no fim: tenta também sem os espaços das pontas.
  let matched: string | null = null;
  if (user) {
    if (await verifyPassword(password, user.password_hash)) matched = password;
    else if (password.trim() !== password && (await verifyPassword(password.trim(), user.password_hash))) matched = password.trim();
  }
  if (!matched) {
    await recordFailure(db, email);
    bg(c, insertLog(db, {
      email, userId: user?.id ?? null, action: 'login_falhou', category: 'acesso', summary: 'Tentativa de login falhou', status: 'negado',
      detail: user ? 'Senha incorreta' : 'E-mail não cadastrado',
      baseId: user?.active_base_id ?? null, ...origin(c),
    }));
    fail('E-mail ou senha incorretos.', 401);
  }
  await clearFailures(db, email);
  // Conta bloqueada pelo administrador: a senha está certa, mas não entra.
  if (user!.disabled) {
    bg(c, insertLog(db, {
      email, userId: user!.id, action: 'login_falhou', category: 'acesso', summary: 'Tentativa de login de conta bloqueada', status: 'negado',
      detail: 'Conta bloqueada pelo administrador', baseId: user!.active_base_id, ...origin(c),
    }));
    fail('Seu acesso está bloqueado. Fale com o administrador do SCOLA.', 403);
  }
  // Contas migradas (bcrypt) ou com custo antigo ganham hash novo, de forma transparente.
  const it = iterationsFor(c.env);
  if (needsRehash(user!.password_hash, it)) {
    await run(db, 'UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(matched!, it), user!.id);
  }
  const { token, maxAge } = await createSession(db, user!.id);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true, secure: new URL(c.req.url).protocol === 'https:', sameSite: 'Lax', path: '/', maxAge,
  });
  bg(c, (async () => {
    const m = await first<{ base_id: string; role: string }>(db, 'SELECT base_id, role FROM memberships WHERE user_id = ? LIMIT 1', user!.id);
    await insertLog(db, {
      userId: user!.id, email: user!.email, role: user!.is_admin ? 'admin' : m?.role ?? null, baseId: user!.is_admin ? user!.active_base_id : m?.base_id ?? null,
      action: 'login', category: 'acesso', summary: user!.must_change_pw ? 'Entrou com senha provisória' : 'Entrou no sistema', ...origin(c),
    });
  })());
  return c.json({ ok: true });
});

app.post('/api/auth/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const u = await userFromToken(c.env.DB, token);
    if (u) logAs(c, u, { action: 'logout', category: 'acesso', summary: 'Saiu do sistema', baseId: u.active_base_id });
    await destroySession(c.env.DB, token);
  }
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

  // Log: escritas sempre; leituras só quando falham (erro interno ou acesso negado).
  const spec = ACTIONS[name];
  let refs: Refs = {};
  try {
    refs = spec?.refs?.(args, ctx) ?? {};
  } catch {
    /* argumentos inesperados: registra sem alvo */
  }
  const entry: LogEntry = {
    userId: user!.id, email: user!.email, role: ctx.isAdmin ? 'admin' : ctx.role, ...origin(c),
    action: name, category: spec?.cat ?? 'sistema', summary: spec ? labelOf(spec, args) : `Falha ao consultar (${name})`,
    refs, baseId: refs.baseId ?? ctx.baseId,
  };
  const preId = spec?.pre ? (await insertLog(ctx.db, entry)).meta.last_row_id : null;
  try {
    const result = await fn!(ctx, ...args);
    if (spec && !spec.pre) bg(c, insertLog(ctx.db, { ...entry, detail: spec.result?.(result) ?? null }));
    // Gravou algo: as agregações em cache dessa base ficam velhas.
    if (spec && entry.baseId) bg(c, clearBaseCache(ctx.db, entry.baseId));
    return c.json({ data: result ?? null });
  } catch (err) {
    const code = err instanceof HttpError ? err.status : 500;
    const status = code === 403 ? 'negado' : 'erro';
    const detail = err instanceof HttpError ? err.message : String((err as Error)?.message || 'Erro interno').slice(0, 300);
    if (preId) bg(c, run(ctx.db, 'UPDATE audit_log SET status = ?, detail = ? WHERE id = ?', status, detail, preId));
    else if (spec || code === 403 || code >= 500) bg(c, insertLog(ctx.db, { ...entry, status, detail }));
    throw err;
  }
});

/* ------------------------------- IA: conversa em streaming ------------------------------- */
app.post('/api/ai/chat', async (c) => {
  const user = await userFromToken(c.env.DB, getCookie(c, SESSION_COOKIE));
  if (!user) fail('Sessão expirada. Entre novamente.', 401);
  if (user!.must_change_pw) fail('Troque a senha provisória para continuar.', 403);
  const ctx = await buildCtx(c.env, user!);
  const body = await c.req.json<{ messages?: never[] }>().catch(() => ({}));
  return ia.chatStream(ctx, body);
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
  logAs(c, ctx.user, {
    role: ctx.isAdmin ? 'admin' : ctx.role, baseId: base, action: 'uploadFile', category: 'comunicacao',
    summary: ownerType === 'notice' ? 'Anexou arquivo a aviso' : 'Anexou arquivo a planejamento', refs: { text: file.name },
  });
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
  const folderId = (form.get('folder_id') as string) || null;
  if (folderId && !(await first(ctx.db, 'SELECT 1 FROM plan_folders WHERE id = ? AND base_id = ?', folderId, base))) fail('Pasta não encontrada.', 404);
  const id = uid();
  await putFile(c.env, id, file);
  await run(ctx.db,
    'INSERT INTO plan_docs (id, base_id, author_id, segment, term, class_id, turma_label, name, mime, folder_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, base, ctx.user.id, String(form.get('segment') || 'geral'), term ? Number(term) : null,
    classId, (form.get('turma_label') as string) || null, file.name, file.type || null, folderId);
  logAs(c, ctx.user, {
    role: ctx.isAdmin ? 'admin' : ctx.role, baseId: base, action: 'uploadPlanDoc', category: 'comunicacao',
    summary: 'Enviou documento de planejamento', refs: { classId, text: file.name },
  });
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

/* ------------------------ Editor de documentos/planilhas ------------------------ */
/** Conteúdo editável (JSON do editor). Vazio = documento novo ou arquivo ainda não aberto no editor. */
app.get('/api/plandocs/:id/content', async (c) => {
  const ctx = await authed(c);
  const d = await editor.docInBase(ctx, c.req.param('id'));
  const body = d.kind === 'file' ? null : await c.env.FILES.get(`c:${d.id}`, 'text');
  return new Response(body || null, {
    status: body ? 200 : 204,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Doc-Version': String(d.version) },
  });
});

/** Uma versão do histórico. */
app.get('/api/plandocs/:id/versions/:vid', async (c) => {
  const ctx = await authed(c);
  const d = await editor.docInBase(ctx, c.req.param('id'));
  const v = await first(ctx.db, 'SELECT 1 FROM plan_doc_versions WHERE id = ? AND doc_id = ?', c.req.param('vid'), d.id);
  if (!v) fail('Versão não encontrada.', 404);
  const body = await c.env.FILES.get(`v:${c.req.param('vid')}`, 'text');
  if (!body) fail('Versão não encontrada.', 404);
  return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
});

/** Salvar: conteúdo do editor + o arquivo .docx/.xlsx já exportado pelo navegador. */
app.post('/api/plandocs/:id/content', async (c) => {
  const ctx = await authed(c);
  const form = await c.req.formData();
  const content = form.get('content');
  const file = form.get('file');
  const kind = String(form.get('kind'));
  if (typeof content !== 'string' || (kind !== 'doc' && kind !== 'sheet')) fail('Conteúdo inválido.');
  const buf = file && typeof file !== 'string' ? await (file as unknown as File).arrayBuffer() : null;
  if (buf && buf.byteLength > MAX_FILE) fail('Arquivo grande demais (máximo 20 MB).');
  const r = await editor.saveEditableContent(ctx, c.env, c.req.param('id'), {
    content: content as string, file: buf, baseVersion: Number(form.get('base_version') ?? 0), kind: kind as 'doc' | 'sheet',
    name: (form.get('name') as string) || null,
  });
  return c.json({ data: r });
});

/* ------------------------------- Conectar ao Google ------------------------------- */
// Navegação normal (GET): o cookie de sessão acompanha o redirecionamento de volta do Google.
app.get('/api/google/connect', async (c) => {
  const ctx = await authed(c);
  if (!googleConfigured(c.env)) fail('Integração com o Google não configurada.', 503);
  const state = crypto.randomUUID();
  await c.env.FILES.put(`g:${state}`, ctx.user.id, { expirationTtl: 600 });
  return c.redirect(authUrl(c.env, c.req.url, state));
});

app.get('/api/google/callback', async (c) => {
  const back = (r: string) => c.redirect(`/planejamento?google=${r}`);
  const ctx = await authed(c);
  const state = c.req.query('state') || '';
  const owner = state ? await c.env.FILES.get(`g:${state}`) : null;
  if (state) await c.env.FILES.delete(`g:${state}`);
  const code = c.req.query('code');
  if (!owner || owner !== ctx.user.id || !code) return back(c.req.query('error') ? 'negado' : 'erro');
  const g = await exchangeCode(c.env, c.req.url, code);
  // O Google deixa o usuário desmarcar permissões: sem acesso ao Drive a conexão não serve.
  if (!g.scopes.includes('auth/drive.file')) return back('escopo');
  await run(ctx.db,
    `INSERT INTO google_accounts (user_id, google_email, refresh_token, scopes) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET google_email = excluded.google_email, refresh_token = excluded.refresh_token, scopes = excluded.scopes, connected_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    ctx.user.id, g.email, await sealToken(c.env, g.refreshToken), g.scopes);
  logAs(c, ctx.user, { role: ctx.isAdmin ? 'admin' : ctx.role, baseId: ctx.baseId, action: 'connectGoogle', category: 'comunicacao', summary: 'Conectou a conta do Google', refs: { text: g.email } });
  return back('ok');
});

/** Envia um e-mail (já montado pelo navegador, formato RFC 822) pelo Gmail do usuário. O Worker só repassa o corpo, sem processar. */
const MAX_MAIL = 25 * 1024 * 1024;
app.post('/api/google/send-mail', async (c) => {
  const ctx = await authed(c);
  const len = Number(c.req.header('content-length') || 0);
  if (!len) fail('E-mail vazio.');
  if (len > MAX_MAIL) fail('E-mail grande demais: o Gmail aceita até 25 MB (anexos ficam ~33% maiores ao enviar).', 413);
  const acc = await first<{ scopes: string }>(ctx.db, 'SELECT scopes FROM google_accounts WHERE user_id = ?', ctx.user.id);
  if (!acc) fail('Conecte sua conta do Google primeiro.', 409);
  if (!acc!.scopes.includes('gmail.send')) fail('Reconecte o Google e permita o envio de e-mails.', 409);
  const token = await accessTokenFor(c.env, ctx.user.id);
  const r = await fetch('https://www.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'message/rfc822', 'Content-Length': String(len) }, body: c.req.raw.body,
  });
  if (!r.ok) {
    console.error('gmail send', r.status, await r.text().catch(() => ''));
    fail(r.status === 403 ? 'O Google não permitiu enviar. Reconecte o Google e aceite o envio de e-mails.' : 'O Gmail recusou o envio. Confira os endereços e tente de novo.', r.status === 403 ? 409 : 502);
  }
  logAs(c, ctx.user, { role: ctx.isAdmin ? 'admin' : ctx.role, baseId: ctx.baseId, action: 'sendMail', category: 'comunicacao', summary: 'Enviou e-mail com arquivos (Gmail)' });
  return c.json({ data: { ok: true } });
});

/** Exporta um arquivo do Google (Docs/Sheets/Slides) como .docx/.xlsx/.pptx, usando a conta de quem pediu. Repassa o corpo sem processar. */
const EXPORT_TYPES: Record<string, string> = {
  document: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  spreadsheet: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  presentation: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
app.get('/api/google/export/:id', async (c) => {
  const ctx = await authed(c);
  const d = await editor.docInBase(ctx, c.req.param('id'));
  const mime = d.google_kind ? EXPORT_TYPES[d.google_kind] : undefined;
  if (!d.google_id || !mime) fail('Este arquivo não pode ser exportado.', 400);
  const token = await accessTokenFor(c.env, ctx.user.id);
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(d.google_id!)}/export?mimeType=${encodeURIComponent(mime!)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    console.error('google export', r.status, await r.text().catch(() => ''));
    fail(r.status === 404 || r.status === 403 ? 'Só quem criou o arquivo no Google consegue anexá-lo. Peça ao autor ou use o link.' : 'O Google não conseguiu exportar o arquivo.', r.status === 404 || r.status === 403 ? 403 : 502);
  }
  return new Response(r.body, { headers: { 'Content-Type': mime!, 'Cache-Control': 'no-store' } });
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
    // Logs: guarda 180 dias (cabe folgado no plano gratuito do D1).
    await run(env.DB, 'DELETE FROM audit_log WHERE at < ?', new Date(Date.now() - 180 * 86400_000).toISOString());
    await run(env.DB, 'DELETE FROM query_cache WHERE expires_at < ?', new Date().toISOString()).catch(() => null);
    await run(env.DB, 'DELETE FROM sessions WHERE expires_at < ?', new Date().toISOString());
    const rows = await all<{ id: string }>(env.DB, 'SELECT id FROM kv_trash LIMIT 40');
    if (!rows.length) return;
    // Chave com prefixo (c:<id> conteúdo do editor, v:<id> versão) ou id puro (= f:<id>).
    await Promise.all(rows.map((r) => env.FILES.delete(r.id.includes(':') ? r.id : `f:${r.id}`)));
    await run(env.DB, `DELETE FROM kv_trash WHERE id IN (SELECT value FROM json_each(?))`, JSON.stringify(rows.map((r) => r.id)));
  },
} satisfies ExportedHandler<Env>;
