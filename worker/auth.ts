import bcrypt from 'bcryptjs';
import { all, fail, first, now, run, type Env } from './db';

export type Role = 'gestor' | 'professor' | 'secretaria';
export type AppRole = Role | 'superadmin';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  is_admin: number;
  must_change_pw: number;
  active_base_id: string | null;
}

/** Contexto de cada chamada autenticada. baseId/role se referem à base ativa. */
export interface Ctx {
  env: Env;
  db: D1Database;
  user: UserRow;
  isAdmin: boolean;
  baseId: string | null;
  role: AppRole | null;
}

export const SESSION_COOKIE = 'scola_sessao';
const SESSION_DAYS = 30;
const enc = new TextEncoder();

/* --------------------------------- Senhas ---------------------------------------- */
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

// Workers limita PBKDF2 a 100 mil iterações. 50 mil ≈ 20 ms de CPU: aceitável porque
// login é raro (sessão dura 30 dias). Mudou o valor? Os hashes antigos são refeitos no próximo login.
export const iterationsFor = (env: Env) => Math.min(100_000, Number(env.PBKDF2_ITER) || 50_000);

export async function hashPassword(password: string, iterations: number): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${iterations}$${b64(salt)}$${b64(await pbkdf2(password, salt, iterations))}`;
}

function safeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Verifica a senha. Aceita também bcrypt ($2a$/$2b$) das contas migradas do Supabase. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith('pbkdf2$')) {
    const [, it, salt, hash] = stored.split('$');
    const got = new Uint8Array(await pbkdf2(password, unb64(salt), Number(it)));
    return safeEqual(got, unb64(hash));
  }
  if (stored.startsWith('$2')) return bcrypt.compare(password, stored);
  return false;
}

export const needsRehash = (stored: string, iterations: number) =>
  !stored.startsWith('pbkdf2$') || Number(stored.split('$')[1]) !== iterations;

export function validatePassword(pw: string) {
  if (typeof pw !== 'string' || pw.length < 6) fail('A senha precisa de pelo menos 6 caracteres.');
  if (pw.length > 200) fail('Senha longa demais.');
}

/** Senha provisória legível (sem caracteres ambíguos). */
export function tempPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/* --------------------------------- Sessões --------------------------------------- */
async function sha256(s: string) {
  return b64(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

export async function createSession(db: D1Database, userId: string): Promise<{ token: string; maxAge: number }> {
  const token = b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]!);
  const maxAge = SESSION_DAYS * 86400;
  const expires = new Date(Date.now() + maxAge * 1000).toISOString();
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').bind(userId, now()),
    db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), userId, expires),
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now(), userId),
  ]);
  return { token, maxAge };
}

export async function destroySession(db: D1Database, token: string) {
  await run(db, 'DELETE FROM sessions WHERE id = ?', await sha256(token));
}

export async function userFromToken(db: D1Database, token: string | undefined): Promise<UserRow | null> {
  if (!token) return null;
  return first<UserRow>(
    db,
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?`,
    await sha256(token),
    now(),
  );
}

/* ------------------------- Base ativa e papel do usuário -------------------------- */
export interface Membership {
  id: string;
  user_id: string;
  base_id: string;
  role: Role;
  base_name: string;
  base_active: number;
}

export async function membershipsOf(db: D1Database, userId: string): Promise<Membership[]> {
  return all<Membership>(
    db,
    `SELECT m.id, m.user_id, m.base_id, m.role, b.name AS base_name, b.active AS base_active
       FROM memberships m JOIN bases b ON b.id = m.base_id
      WHERE m.user_id = ? ORDER BY b.name`,
    userId,
  );
}

export async function buildCtx(env: Env, user: UserRow): Promise<Ctx & { memberships: Membership[] }> {
  const db = env.DB;
  const isAdmin = !!user.is_admin;
  const memberships = await membershipsOf(db, user.id);
  let baseId: string | null = null;
  let role: AppRole | null = null;

  if (isAdmin) {
    // O administrador "entra" numa base para dar suporte; sem base ativa, fica no painel.
    if (user.active_base_id) {
      const exists = await first(db, 'SELECT id FROM bases WHERE id = ?', user.active_base_id);
      if (exists) {
        baseId = user.active_base_id;
        role = 'superadmin';
      }
    }
  } else {
    const usable = memberships.filter((m) => m.base_active);
    const m = usable.find((x) => x.base_id === user.active_base_id) ?? usable[0];
    if (m) {
      baseId = m.base_id;
      role = m.role;
    }
  }
  return { env, db, user, isAdmin, baseId, role, memberships };
}

/* ------------------------------- Autorização ------------------------------------- */
export function requireBase(ctx: Ctx): string {
  if (!ctx.baseId) fail('Nenhuma base selecionada.', 403);
  return ctx.baseId as string;
}

/** Exige base ativa e um dos papéis (o administrador sempre passa). */
export function requireRole(ctx: Ctx, ...roles: Role[]): string {
  const base = requireBase(ctx);
  if (ctx.role === 'superadmin') return base;
  if (!ctx.role || !roles.includes(ctx.role as Role)) fail('Sem permissão para esta ação.', 403);
  return base;
}

/** Garante que a turma pertence à base (evita gravar referência a turma de outro cliente). */
export async function assertClassInBase(ctx: Ctx, base: string, classId: string | null | undefined) {
  if (!classId) return;
  const k = await ctx.db.prepare('SELECT 1 AS ok FROM classes WHERE id = ? AND base_id = ?').bind(classId, base).first();
  if (!k) fail('Turma não encontrada.', 404);
}

export function requireAdmin(ctx: Ctx) {
  if (!ctx.isAdmin) fail('Apenas o administrador do sistema.', 403);
}

/* ------------------------- Proteção contra força bruta ---------------------------- */
const MAX_FAILURES = 8;
const WINDOW_MIN = 15;

export async function assertNotLocked(db: D1Database, email: string) {
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
  const row = await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM login_failures WHERE email = ? AND at > ?', email, since);
  if ((row?.n ?? 0) >= MAX_FAILURES) fail(`Muitas tentativas. Aguarde ${WINDOW_MIN} minutos e tente de novo.`, 429);
}

export async function recordFailure(db: D1Database, email: string) {
  const old = new Date(Date.now() - 86400_000).toISOString();
  await db.batch([
    db.prepare('INSERT INTO login_failures (email, at) VALUES (?, ?)').bind(email, now()),
    db.prepare('DELETE FROM login_failures WHERE at < ?').bind(old),
  ]);
}

export async function clearFailures(db: D1Database, email: string) {
  await run(db, 'DELETE FROM login_failures WHERE email = ?', email);
}
