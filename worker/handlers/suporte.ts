import { requireAdmin, requireBase, type Ctx } from '../auth';
import { all, fail, first, now, run, stmt, uid } from '../db';
import { notifySupport } from '../hub';

/**
 * Suporte nativo: a escola abre conversas com o administrador do SCOLA e acompanha as respostas;
 * o administrador tem uma caixa de entrada única com todas as escolas.
 */
type Thread = {
  id: string; base_id: string; user_id: string; subject: string; status: 'aberta' | 'resolvida'; last_from: 'escola' | 'suporte';
  last_preview: string; unread_admin: number; unread_user: number; created_at: string; updated_at: string;
};
type Message = { id: string; thread_id: string; author_id: string; from_admin: number; body: string; created_at: string; author_name: string | null };

const clip = (s: unknown, n: number) => String(s ?? '').trim().slice(0, n);
const preview = (body: string) => body.replace(/\s+/g, ' ').slice(0, 140);

async function messagesOf(ctx: Ctx, id: string) {
  return all<Message>(ctx.db,
    `SELECT m.id, m.thread_id, m.author_id, m.from_admin, m.body, m.created_at, u.full_name AS author_name
       FROM support_messages m JOIN users u ON u.id = m.author_id WHERE m.thread_id = ? ORDER BY m.created_at`, id);
}

/** Conversa da própria pessoa (o administrador acessa qualquer uma pelas rotas de admin). */
async function ownThread(ctx: Ctx, id: string) {
  const t = await first<Thread>(ctx.db, 'SELECT * FROM support_threads WHERE id = ? AND user_id = ?', id, ctx.user.id);
  if (!t) fail('Conversa não encontrada.', 404);
  return t!;
}

/* ------------------------------------- Escola ------------------------------------- */
export const listSupportThreads = (ctx: Ctx) =>
  all<Thread>(ctx.db, 'SELECT * FROM support_threads WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50', ctx.user.id);

export async function supportUnreadCount(ctx: Ctx) {
  const r = await first<{ n: number }>(ctx.db, 'SELECT COALESCE(SUM(unread_user), 0) AS n FROM support_threads WHERE user_id = ?', ctx.user.id);
  return r?.n ?? 0;
}

export async function getSupportThread(ctx: Ctx, id: string) {
  const t = await ownThread(ctx, id);
  if (t.unread_user) await run(ctx.db, 'UPDATE support_threads SET unread_user = 0 WHERE id = ?', id);
  return { thread: { ...t, unread_user: 0 }, messages: await messagesOf(ctx, id) };
}

export async function createSupportThread(ctx: Ctx, input: { subject: string; body: string }) {
  const base = requireBase(ctx);
  const subject = clip(input?.subject, 120);
  const body = clip(input?.body, 4000);
  if (!subject) fail('Informe o assunto.');
  if (!body) fail('Escreva a mensagem.');
  const hour = new Date(Date.now() - 3600_000).toISOString();
  const recent = await first<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM support_threads WHERE user_id = ? AND created_at > ?', ctx.user.id, hour);
  if ((recent?.n ?? 0) >= 5) fail('Você abriu muitas conversas na última hora. Responda nas que já estão abertas.', 429);
  const id = uid();
  const at = now();
  await ctx.db.batch([
    stmt(ctx.db, `INSERT INTO support_threads (id, base_id, user_id, subject, status, last_from, last_preview, unread_admin, unread_user, created_at, updated_at) VALUES (?, ?, ?, ?, 'aberta', 'escola', ?, 1, 0, ?, ?)`, id, base, ctx.user.id, subject, preview(body), at, at),
    stmt(ctx.db, 'INSERT INTO support_messages (id, thread_id, author_id, from_admin, body, created_at) VALUES (?, ?, ?, 0, ?, ?)', uid(), id, ctx.user.id, body, at),
  ]);
  await notifySupport(ctx.env, { thread: id, toAdmin: true });
  return { id };
}

export async function replySupport(ctx: Ctx, id: string, bodyIn: string) {
  await ownThread(ctx, id);
  const body = clip(bodyIn, 4000);
  if (!body) fail('Escreva a mensagem.');
  const at = now();
  await ctx.db.batch([
    stmt(ctx.db, 'INSERT INTO support_messages (id, thread_id, author_id, from_admin, body, created_at) VALUES (?, ?, ?, 0, ?, ?)', uid(), id, ctx.user.id, body, at),
    stmt(ctx.db, `UPDATE support_threads SET status = 'aberta', last_from = 'escola', last_preview = ?, unread_admin = unread_admin + 1, updated_at = ? WHERE id = ?`, preview(body), at, id),
  ]);
  await notifySupport(ctx.env, { thread: id, toAdmin: true });
}

/* ------------------------------ Administrador (caixa de entrada) ------------------------------ */
export type SupportFilter = 'atender' | 'respondidas' | 'resolvidas' | 'todas';

export async function listSupportAdmin(ctx: Ctx, input?: { filter?: SupportFilter; q?: string }) {
  requireAdmin(ctx);
  const f = input?.filter ?? 'atender';
  const q = clip(input?.q, 80).toLowerCase();
  const where = f === 'atender' ? "t.status = 'aberta' AND t.last_from = 'escola'" : f === 'respondidas' ? "t.status = 'aberta' AND t.last_from = 'suporte'" : f === 'resolvidas' ? "t.status = 'resolvida'" : '1 = 1';
  const rows = await all<Thread & { base_name: string; user_name: string | null; user_email: string }>(ctx.db,
    `SELECT t.*, b.name AS base_name, u.full_name AS user_name, u.email AS user_email
       FROM support_threads t JOIN bases b ON b.id = t.base_id JOIN users u ON u.id = t.user_id
      WHERE ${where} ORDER BY t.unread_admin > 0 DESC, t.updated_at DESC LIMIT 200`);
  const counts = await first<{ atender: number; respondidas: number; resolvidas: number; nao_lidas: number }>(ctx.db,
    `SELECT SUM(status = 'aberta' AND last_from = 'escola') AS atender, SUM(status = 'aberta' AND last_from = 'suporte') AS respondidas,
            SUM(status = 'resolvida') AS resolvidas, SUM(unread_admin > 0) AS nao_lidas FROM support_threads`);
  const list = q ? rows.filter((r) => `${r.subject} ${r.base_name} ${r.user_name ?? ''} ${r.user_email} ${r.last_preview}`.toLowerCase().includes(q)) : rows;
  return { threads: list, counts: { atender: counts?.atender ?? 0, respondidas: counts?.respondidas ?? 0, resolvidas: counts?.resolvidas ?? 0, nao_lidas: counts?.nao_lidas ?? 0 } };
}

export async function supportUnreadAdmin(ctx: Ctx) {
  requireAdmin(ctx);
  const r = await first<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM support_threads WHERE unread_admin > 0');
  return r?.n ?? 0;
}

export async function getSupportThreadAdmin(ctx: Ctx, id: string) {
  requireAdmin(ctx);
  const t = await first<Thread & { base_name: string; base_city: string | null; base_plan: string; base_active: number; students: number; user_name: string | null; user_email: string; user_phone: string | null; user_role: string | null }>(ctx.db,
    `SELECT t.*, b.name AS base_name, b.city AS base_city, b.plan AS base_plan, b.active AS base_active,
            (SELECT COUNT(*) FROM students s WHERE s.base_id = b.id AND s.active = 1) AS students,
            u.full_name AS user_name, u.email AS user_email, u.phone AS user_phone,
            (SELECT m.role FROM memberships m WHERE m.user_id = u.id AND m.base_id = b.id) AS user_role
       FROM support_threads t JOIN bases b ON b.id = t.base_id JOIN users u ON u.id = t.user_id WHERE t.id = ?`, id);
  if (!t) fail('Conversa não encontrada.', 404);
  if (t!.unread_admin) await run(ctx.db, 'UPDATE support_threads SET unread_admin = 0 WHERE id = ?', id);
  return { thread: { ...t!, unread_admin: 0 }, messages: await messagesOf(ctx, id) };
}

export async function replySupportAdmin(ctx: Ctx, id: string, bodyIn: string, resolve?: boolean) {
  requireAdmin(ctx);
  const th = await first<{ user_id: string }>(ctx.db, 'SELECT user_id FROM support_threads WHERE id = ?', id);
  if (!th) fail('Conversa não encontrada.', 404);
  const body = clip(bodyIn, 4000);
  if (!body) fail('Escreva a mensagem.');
  const at = now();
  await ctx.db.batch([
    stmt(ctx.db, 'INSERT INTO support_messages (id, thread_id, author_id, from_admin, body, created_at) VALUES (?, ?, ?, 1, ?, ?)', uid(), id, ctx.user.id, body, at),
    stmt(ctx.db, `UPDATE support_threads SET status = ?, last_from = 'suporte', last_preview = ?, unread_user = unread_user + 1, unread_admin = 0, updated_at = ? WHERE id = ?`, resolve ? 'resolvida' : 'aberta', preview(body), at, id),
  ]);
  await notifySupport(ctx.env, { thread: id, userId: th!.user_id, toAdmin: true });
}

export async function setSupportStatus(ctx: Ctx, id: string, status: 'aberta' | 'resolvida') {
  requireAdmin(ctx);
  if (status !== 'aberta' && status !== 'resolvida') fail('Situação inválida.');
  await run(ctx.db, 'UPDATE support_threads SET status = ?, unread_admin = 0 WHERE id = ?', status, id);
  const th = await first<{ user_id: string }>(ctx.db, 'SELECT user_id FROM support_threads WHERE id = ?', id);
  await notifySupport(ctx.env, { thread: id, userId: th?.user_id, toAdmin: true });
}

/** A escola também pode encerrar a própria conversa ("já resolvi"). */
export async function resolveSupport(ctx: Ctx, id: string) {
  await ownThread(ctx, id);
  await run(ctx.db, "UPDATE support_threads SET status = 'resolvida', unread_user = 0 WHERE id = ?", id);
  await notifySupport(ctx.env, { thread: id, toAdmin: true });
}
